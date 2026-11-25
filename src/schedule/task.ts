/**
 * The scheduled task `ipa-assistant-<repositoryId>` in the Windows Task Scheduler (package 09 §4.3):
 * what `install` would create, what the registered task looks like, and the state derived from both.
 */
import type { Weekday } from '../core/config.js';
import { EXIT, IpaError } from '../core/errors.js';
import { repeats, windowMinutes } from './plan.js';
import { EXECUTION_RESERVE_SECONDS, quoteWindowsArg, type ScheduleTemplateInput, taskName, windowsTaskArguments } from './templates.js';
import { foldToAscii, parseCsv, type SchtasksResult, type SchtasksRunner } from './schtasks.js';
import { childrenNamed, findPath, parseXml, textAt } from './xml.js';

export type TaskState = 'not_installed' | 'active' | 'paused' | 'stale' | 'error';
export type TaskDifference = 'node_path' | 'cli_path' | 'arguments' | 'triggers' | 'execution_time_limit';

/** The properties of a task that the status check compares. */
export interface TaskDefinition {
  enabled: boolean;
  command: string | null;
  arguments: string | null;
  executionTimeLimitSeconds: number | null;
  /** What fires, one entry per weekday: `mon@08:00#7200/36000`, or `mon@17:45#-` without repetition. Sorted. */
  triggers: string[];
}

const WEEKDAY_BY_XML: Record<string, Weekday> = {
  Monday: 'mon',
  Tuesday: 'tue',
  Wednesday: 'wed',
  Thursday: 'thu',
  Friday: 'fri',
  Saturday: 'sat',
  Sunday: 'sun',
};

/** Seconds of an xs:duration such as `PT2H30M` or `P1DT2H`; `null` if the text is no duration. */
export function parseDurationSeconds(text: string | null): number | null {
  if (text === null) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text.trim());
  if (match === null || text.trim() === 'P' || text.trim().endsWith('T')) return null;
  const [, days, hours, minutes, seconds] = match;
  return Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
}

function repetitionKey(interval: number | null, duration: number | null): string {
  return interval === null ? '-' : `${interval}/${duration ?? 0}`;
}

/** What `install` creates for the current configuration. */
export function expectedTask(input: ScheduleTemplateInput): TaskDefinition {
  const { schedule } = input;
  const startRepetition = repeats(schedule) ? repetitionKey(schedule.intervalMinutes * 60, windowMinutes(schedule) * 60) : '-';
  const triggers = [
    ...schedule.workdays.map((day) => `${day}@${schedule.windowStart}#${startRepetition}`),
    ...schedule.extraRunTimes.flatMap((time) => schedule.workdays.map((day) => `${day}@${time}#-`)),
  ];
  return {
    enabled: true,
    command: quoteWindowsArg(input.nodePath),
    arguments: windowsTaskArguments(input),
    executionTimeLimitSeconds: input.maxRunSeconds + EXECUTION_RESERVE_SECONDS,
    triggers: [...new Set(triggers)].sort(),
  };
}

/** Reads the XML of a task as exported by the Task Scheduler; unknown or extra elements are ignored. */
export function readTaskDefinition(xml: string): TaskDefinition {
  const root = parseXml(xml);
  const triggers: string[] = [];
  for (const trigger of findPath(root, 'Triggers')?.children ?? []) {
    if (textAt(trigger, 'Enabled') === 'false') continue;
    const start = /T(\d{2}:\d{2})/.exec(textAt(trigger, 'StartBoundary') ?? '')?.[1];
    const week = findPath(trigger, 'ScheduleByWeek');
    const days = week === undefined ? [] : (findPath(week, 'DaysOfWeek')?.children ?? []).map((day) => WEEKDAY_BY_XML[day.name]);
    if (trigger.name !== 'CalendarTrigger' || start === undefined || week === undefined || days.length === 0 || days.includes(undefined) || (textAt(week, 'WeeksInterval') ?? '1') !== '1') {
      // Anything else (logon trigger, daily schedule, …) fires differently from the template.
      triggers.push(`other:${trigger.name}`);
      continue;
    }
    const interval = parseDurationSeconds(textAt(trigger, 'Repetition/Interval'));
    const duration = parseDurationSeconds(textAt(trigger, 'Repetition/Duration'));
    for (const day of days) triggers.push(`${day}@${start}#${repetitionKey(interval, duration)}`);
  }
  return {
    enabled: textAt(root, 'Settings/Enabled') !== 'false',
    command: textAt(findPath(root, 'Actions/Exec') ?? root, 'Command'),
    arguments: textAt(findPath(root, 'Actions/Exec') ?? root, 'Arguments'),
    executionTimeLimitSeconds: parseDurationSeconds(textAt(root, 'Settings/ExecutionTimeLimit')),
    triggers: [...new Set(triggers)].sort(),
  };
}

/** Comparison key for a path: ASCII only (OEM output), no case, `/` as separator. Whitespace inside stays: it separates directories. */
function normalizePath(text: string): string {
  return foldToAscii(text).replace(/\\/g, '/').trim().toLowerCase();
}

function unquote(text: string): string {
  const trimmed = text.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

/** Arguments as the Microsoft C runtime reads them (the rules `quoteWindowsArg` writes by). */
export function splitWindowsArguments(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let started = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '\\') {
      let slashes = 0;
      while (text[index] === '\\') {
        slashes += 1;
        index += 1;
      }
      started = true;
      if (text[index] === '"') {
        current += '\\'.repeat(Math.floor(slashes / 2));
        // An odd number of backslashes makes the quote a literal; an even one leaves it to the next pass.
        if (slashes % 2 === 1) {
          current += '"';
          index += 1;
        }
      } else {
        current += '\\'.repeat(slashes);
      }
    } else if (char === '"') {
      inQuotes = !inQuotes;
      started = true;
      index += 1;
    } else if (!inQuotes && /\s/.test(char)) {
      if (started) args.push(current);
      current = '';
      started = false;
      index += 1;
    } else {
      current += char;
      started = true;
      index += 1;
    }
  }
  if (started) args.push(current);
  return args;
}

/** Options whose value is a path; every other token has to match exactly (`--SCHEDULED` is not `--scheduled`). */
const PATH_OPTIONS = new Set(['--repo', '--data-dir']);

function compareArguments(expected: string, actual: string): { cliPath: boolean; rest: boolean } {
  const wanted = splitWindowsArguments(expected);
  const found = splitWindowsArguments(actual);
  const cliPath = normalizePath(wanted[0] ?? '') !== normalizePath(found[0] ?? '');
  let rest = wanted.length !== found.length;
  for (let index = 1; !rest && index < wanted.length; index += 1) {
    const isPath = PATH_OPTIONS.has(wanted[index - 1]!);
    rest = isPath ? normalizePath(wanted[index]!) !== normalizePath(found[index]!) : wanted[index] !== found[index];
  }
  return { cliPath, rest };
}

/** Differences between the task that `install` would create and the registered one. */
export function compareTasks(expected: TaskDefinition, actual: TaskDefinition): TaskDifference[] {
  const differences: TaskDifference[] = [];
  if (normalizePath(unquote(expected.command ?? '')) !== normalizePath(unquote(actual.command ?? ''))) differences.push('node_path');
  const args = compareArguments(expected.arguments ?? '', actual.arguments ?? '');
  if (args.cliPath) differences.push('cli_path');
  if (args.rest) differences.push('arguments');
  if (expected.triggers.join('|') !== actual.triggers.join('|')) differences.push('triggers');
  if (expected.executionTimeLimitSeconds !== actual.executionTimeLimitSeconds) differences.push('execution_time_limit');
  return differences;
}

export type DateOrder = 'dmy' | 'mdy';

/** Day-month order of the system language, for dates such as `11/12/2026`. */
export function systemDateOrder(locale?: string): DateOrder {
  const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(2000, 10, 25));
  const types = parts.map((part) => part.type);
  return types.indexOf('month') < types.indexOf('day') ? 'mdy' : 'dmy';
}

const SCHEDULER_DATE = /^\s*(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?\.?[Mm]?\.?\s*$/;

/**
 * Readings of a date that `schtasks` printed in system local time, most likely first. Two readings only for
 * an ambiguous date such as `03/04/2026`; none if the text is no date, for example `Nicht zutreffend`.
 */
export function parseSchedulerDate(text: string, order: DateOrder): Date[] {
  const match = SCHEDULER_DATE.exec(text);
  if (match === null) return [];
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3]);
  const hourText = Number(match[4]);
  const minute = Number(match[5]);
  const second_ = Number(match[6] ?? 0);
  const meridiem = match[7]?.toLowerCase();
  const hour = meridiem === undefined ? hourText : (hourText % 12) + (meridiem === 'p' ? 12 : 0);
  if (hour > 23 || minute > 59 || second_ > 59) return [];
  const readings: [number, number, number][] = [];
  if (match[1]!.length === 4) readings.push([first, second, third]);
  else {
    const year = third < 100 ? 2000 + third : third;
    const dayFirst: [number, number, number] = [year, second, first];
    const monthFirst: [number, number, number] = [year, first, second];
    const preferred = order === 'dmy' ? [dayFirst, monthFirst] : [monthFirst, dayFirst];
    readings.push(...(first === second ? [preferred[0]!] : preferred));
  }
  const dates: Date[] = [];
  for (const [year, month, day] of readings) {
    const date = new Date(year, month - 1, day, hour, minute, second_);
    // `new Date` rolls an impossible date over; such a reading is wrong.
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) dates.push(date);
  }
  return dates;
}

/** The first reading that fits the kind of date (the next run is not in the past, the last not in the future). */
function pickReading(readings: Date[], kind: 'next' | 'last', now: Date): Date | null {
  const slack = 5 * 60_000;
  const plausible = readings.find((date) => (kind === 'next' ? date.getTime() >= now.getTime() - slack : date.getTime() <= now.getTime() + slack));
  return plausible ?? (readings.length === 1 ? readings[0]! : null);
}

/** `/Query … /V` reports this result for a task that never ran, and this one while it runs. */
export const RESULT_NEVER_RUN = 267011;
export const RESULT_RUNNING = 267009;

export interface TaskRuns {
  nextRun: Date | null;
  lastRun: Date | null;
  lastResult: number | null;
}

/** Reads the verbose CSV row (column order of `schtasks`, language independent): 3 next run, 6 last run, 7 last result. */
export function parseTaskRuns(csv: string, now: Date, order: DateOrder = systemDateOrder()): TaskRuns {
  const rows = parseCsv(csv).filter((row) => row.length >= 7);
  const row = rows[0];
  if (row === undefined) return { nextRun: null, lastRun: null, lastResult: null };
  const resultText = (row[6] ?? '').trim();
  const lastResult = /^-?\d+$/.test(resultText) ? Number(resultText) : null;
  const next = rows.map((candidate) => pickReading(parseSchedulerDate(candidate[2] ?? '', order), 'next', now)).filter((date): date is Date => date !== null);
  const lastRun = lastResult === RESULT_NEVER_RUN ? null : pickReading(parseSchedulerDate(row[5] ?? '', order), 'last', now);
  return {
    nextRun: next.sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    // The Task Scheduler prints 1999 or 1899 for "never".
    lastRun: lastRun !== null && lastRun.getFullYear() < 2000 ? null : lastRun,
    lastResult,
  };
}

export interface TaskStatus {
  taskName: string;
  state: TaskState;
  enabled: boolean | null;
  differences: TaskDifference[];
  detail: string | null;
  nextRun: Date | null;
  lastRun: Date | null;
  lastResult: number | null;
  running: boolean;
}

function firstLine(result: SchtasksResult): string {
  const line = (result.stderr.trim() || result.stdout.trim()).split(/\r?\n/)[0] ?? '';
  return line.length > 200 ? `${line.slice(0, 200)} …` : line;
}

async function runSafely(runner: SchtasksRunner, args: readonly string[]): Promise<SchtasksResult | Error> {
  try {
    return await runner.run(args);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function problem(name: string, detail: string): TaskStatus {
  return { taskName: name, state: 'error', enabled: null, differences: [], detail, nextRun: null, lastRun: null, lastResult: null, running: false };
}

function describeRunnerFailure(error: Error): string {
  const code = (error as { code?: unknown }).code;
  return `schtasks lässt sich nicht ausführen (${typeof code === 'string' ? code : 'Zeitüberschreitung oder Abbruch'}).`;
}

/** State of the task of a repository, derived from `schtasks /Query`; never changes anything. */
export async function queryTask(runner: SchtasksRunner, input: ScheduleTemplateInput, now: Date): Promise<TaskStatus> {
  const name = taskName(input.repositoryId);
  const definition = await runSafely(runner, ['/Query', '/TN', name, '/XML']);
  if (definition instanceof Error) return problem(name, describeRunnerFailure(definition));
  if (definition.exitCode !== 0) {
    // The message is localized, so the list of tasks decides between "missing" and "cannot read".
    const list = await runSafely(runner, ['/Query', '/FO', 'CSV', '/NH']);
    if (list instanceof Error) return problem(name, describeRunnerFailure(list));
    if (list.exitCode !== 0) return problem(name, `Die Aufgabenplanung lässt sich nicht abfragen: ${firstLine(list)}`);
    const listed = parseCsv(list.stdout).some((row) => (row[0] ?? '').replace(/^\\/, '').toLowerCase() === name.toLowerCase());
    if (!listed) return { ...problem(name, ''), state: 'not_installed', detail: null };
    return problem(name, `Die Aufgabe lässt sich nicht lesen: ${firstLine(definition)}`);
  }
  let actual: TaskDefinition;
  try {
    actual = readTaskDefinition(definition.stdout);
  } catch (error) {
    return problem(name, `Die Definition der Aufgabe lässt sich nicht lesen (${error instanceof Error ? error.message : 'unbekannter Fehler'}).`);
  }
  const differences = compareTasks(expectedTask(input), actual);
  const runs = await runSafely(runner, ['/Query', '/TN', name, '/FO', 'CSV', '/V', '/NH']);
  const times: TaskRuns =
    runs instanceof Error || runs.exitCode !== 0 ? { nextRun: null, lastRun: null, lastResult: null } : parseTaskRuns(runs.stdout, now);
  return {
    taskName: name,
    state: differences.length > 0 ? 'stale' : actual.enabled ? 'active' : 'paused',
    enabled: actual.enabled,
    differences,
    detail: null,
    nextRun: actual.enabled ? times.nextRun : null,
    lastRun: times.lastRun,
    lastResult: times.lastResult,
    running: times.lastResult === RESULT_RUNNING,
  };
}

/** Runs a command that changes the Task Scheduler; a failure is exit code 1 with the first line of `schtasks`. */
export async function changeTask(runner: SchtasksRunner, args: readonly string[], what: string): Promise<void> {
  const result = await runSafely(runner, args);
  if (result instanceof Error) {
    throw new IpaError('schtasks_failed', EXIT.internal, `${what}: ${describeRunnerFailure(result)}`, { cause: result });
  }
  if (result.exitCode !== 0) {
    throw new IpaError('schtasks_failed', EXIT.internal, `${what}: schtasks endete mit Exit-Code ${result.exitCode}. ${firstLine(result)}`.trim());
  }
}
