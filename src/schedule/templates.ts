/**
 * Scheduler templates of `ipa schedule` (package 08 §4, D-15). They are text only: nothing is installed
 * and no system setting is changed.
 */
import type { Weekday } from '../core/config.js';
import { EXIT, IpaError } from '../core/errors.js';
import { describeWindow, type ScheduleConfig, sortedWorkdays } from './window.js';

export const SCHEDULE_TARGETS = ['windows', 'cron'] as const;
export type ScheduleTarget = (typeof SCHEDULE_TARGETS)[number];

/** Reserve of the Windows `ExecutionTimeLimit` beyond `limits.maxRunSeconds` (package 08 §4). */
export const EXECUTION_RESERVE_SECONDS = 600;

export const CRON_UNTESTED_COMMENT = '# nicht geprüft – Plattform in V1 nicht getestet';

export interface ScheduleTemplateInput {
  repositoryId: string;
  /** Canonical repository path with `/`. */
  repoPath: string;
  timezone: string;
  schedule: ScheduleConfig;
  maxRunSeconds: number;
  claudeTimeoutSeconds: number;
  /** Absolute path of the Node.js executable (`process.execPath`). */
  nodePath: string;
  /** Absolute path of `dist/cli.js`. */
  cliPath: string;
  /** Absolute data root, only when the task has to pass it with `--data-dir`. */
  dataDir: string | null;
  /** Date of `StartBoundary`, `YYYY-MM-DD`. */
  startDay: string;
}

export function taskName(repositoryId: string): string {
  return `ipa-assistant-${repositoryId}`;
}

interface CommandArg {
  text: string;
  /** Paths are always quoted; the fixed words never need it. */
  path: boolean;
}

/** `capture --scheduled --repo <repo> [--data-dir <root>]` after the path of `dist/cli.js`. */
function captureArgs(input: ScheduleTemplateInput): CommandArg[] {
  const word = (text: string): CommandArg => ({ text, path: false });
  const file = (text: string): CommandArg => ({ text, path: true });
  return [
    file(input.cliPath),
    word('capture'),
    word('--scheduled'),
    word('--repo'),
    file(input.repoPath),
    ...(input.dataDir === null ? [] : [word('--data-dir'), file(input.dataDir)]),
  ];
}

/**
 * Quotes one argument for the command line rules of the Microsoft C runtime, which Node.js follows:
 * backslashes are literal unless they precede a quote, so the ones before a quote and before the closing
 * quote are doubled. A path like `C:\` would otherwise swallow its closing quote.
 */
export function quoteWindowsArg(arg: string): string {
  let result = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      result += `${'\\'.repeat(backslashes * 2 + 1)}"`;
    } else {
      result += `${'\\'.repeat(backslashes)}${char}`;
    }
    backslashes = 0;
  }
  return `${result}${'\\'.repeat(backslashes * 2)}"`;
}

/** Single quotes for `/bin/sh`; cron itself turns an unescaped `%` into a line break. */
export function quotePosixArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`.replace(/%/g, '\\%');
}

/**
 * Text or attribute value for XML. Everything outside printable ASCII becomes a character reference, so
 * the template survives a redirection that re-encodes the output (for example `>` in Windows PowerShell 5.1).
 */
export function xmlText(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '&') result += '&amp;';
    else if (char === '<') result += '&lt;';
    else if (char === '>') result += '&gt;';
    else if (code >= 0x20 && code < 0x7f) result += char;
    else if (code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x7f && (code < 0xd800 || code > 0xdfff) && code !== 0xfffe && code !== 0xffff)) {
      result += `&#${code};`;
    } else {
      throw new IpaError('schedule_invalid_path', EXIT.usage, 'Ein Pfad der Vorlage enthält ein Steuerzeichen, das XML nicht darstellen kann.');
    }
  }
  return result;
}

/** XML comments must not contain `--` or end with `-`; the text is adjusted instead of rejected. */
function commentLine(text: string): string {
  let result = text;
  while (result.includes('--')) result = result.replace(/--/g, '- -');
  return result.endsWith('-') ? `${result} ` : result;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours! * 60 + minutes!;
}

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** xs:duration such as `PT2H`, `PT1H30M` or `PT40M5S`. */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = `${hours > 0 ? `${hours}H` : ''}${minutes > 0 ? `${minutes}M` : ''}${seconds > 0 ? `${seconds}S` : ''}`;
  return `PT${parts === '' ? '0S' : parts}`;
}

function windowMinutes(schedule: ScheduleConfig): number {
  return minutesOf(schedule.windowEnd) - minutesOf(schedule.windowStart);
}

/** Windows repeats only if at least one repetition fits into the window. */
function repeats(schedule: ScheduleConfig): boolean {
  return schedule.intervalMinutes <= windowMinutes(schedule);
}

/** Start times of a workday: the window start, every interval up to and including the window end, and the extra runs. */
export function runTimesOfDay(schedule: ScheduleConfig): string[] {
  const start = minutesOf(schedule.windowStart);
  const end = minutesOf(schedule.windowEnd);
  const times = new Set<number>();
  for (let minute = start; minute <= end; minute += schedule.intervalMinutes) times.add(minute);
  for (const extra of schedule.extraRunTimes) times.add(minutesOf(extra));
  return [...times].sort((a, b) => a - b).map(timeOf);
}

function requireWorkdays(schedule: ScheduleConfig): Weekday[] {
  const days = sortedWorkdays(schedule);
  if (days.length === 0) {
    throw new IpaError(
      'schedule_no_workdays',
      EXIT.usage,
      'schedule.workdays in config.json ist leer: Ohne Arbeitstag gibt es keine geplanten Läufe und keine Vorlage.',
    );
  }
  return days;
}

/** Warnings about the configuration; the template is produced anyway (package 08 §6). */
export function scheduleWarnings(input: ScheduleTemplateInput, target: ScheduleTarget): string[] {
  const { schedule } = input;
  const warnings: string[] = [];
  for (const extra of schedule.extraRunTimes) {
    if (extra < schedule.windowStart || extra > schedule.windowEnd) {
      warnings.push(
        `Warnung: Der Zusatzlauf ${extra} (schedule.extraRunTimes) liegt ausserhalb des Zeitfensters ` +
          `${schedule.windowStart}–${schedule.windowEnd}; ipa capture --scheduled würde diesen Lauf überspringen.`,
      );
    }
  }
  if (!repeats(schedule)) {
    warnings.push(
      `Hinweis: schedule.intervalMinutes (${schedule.intervalMinutes}) ist länger als das Zeitfenster ` +
        `(${windowMinutes(schedule)} Minuten); pro Arbeitstag startet nur der Lauf um ${schedule.windowStart}, dazu die Zusatzläufe.`,
    );
  }
  if (target === 'windows' && input.claudeTimeoutSeconds > EXECUTION_RESERVE_SECONDS) {
    warnings.push(
      `Warnung: claude.timeoutSeconds (${input.claudeTimeoutSeconds} s) ist länger als die Reserve von 10 Minuten im ` +
        `ExecutionTimeLimit (${formatDuration(input.maxRunSeconds + EXECUTION_RESERVE_SECONDS)}). Die Aufgabenplanung könnte ` +
        'einen Claude-Aufruf abbrechen, der kurz vor der Laufzeitgrenze beginnt; der Snapshot bleibt dann offen und folgt im nächsten Lauf.',
    );
  }
  return warnings;
}

const WINDOWS_DAYS: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const TASK_NAMESPACE = 'http://schemas.microsoft.com/windows/2004/02/mit/task';

/** `schtasks` command for the import; the tool never runs it. */
export function importCommand(repositoryId: string, file: string | null): string {
  return `schtasks /Create /XML ${file === null ? '"<Pfad dieser Datei>"' : quoteWindowsArg(file)} /TN ${taskName(repositoryId)}`;
}

function calendarTrigger(input: ScheduleTemplateInput, time: string, days: readonly Weekday[], repetition: boolean): string[] {
  const { schedule } = input;
  return [
    '    <CalendarTrigger>',
    ...(repetition
      ? [
          '      <Repetition>',
          `        <Interval>${formatDuration(schedule.intervalMinutes * 60)}</Interval>`,
          `        <Duration>${formatDuration(windowMinutes(schedule) * 60)}</Duration>`,
          '        <StopAtDurationEnd>false</StopAtDurationEnd>',
          '      </Repetition>',
        ]
      : []),
    // Without an offset the time is the local system time; the business window is checked by --scheduled.
    `      <StartBoundary>${input.startDay}T${time}:00</StartBoundary>`,
    '      <Enabled>true</Enabled>',
    '      <ScheduleByWeek>',
    '        <DaysOfWeek>',
    ...days.map((day) => `          <${WINDOWS_DAYS[day]} />`),
    '        </DaysOfWeek>',
    '        <WeeksInterval>1</WeeksInterval>',
    '      </ScheduleByWeek>',
    '    </CalendarTrigger>',
  ];
}

export interface WindowsTaskOptions {
  /** `UTF-16` for a file written as UTF-16 with BOM; `null` leaves the encoding to the reader (stdout). */
  encoding: 'UTF-16' | null;
}

/**
 * XML for the Windows Task Scheduler (task schema 1.2): one weekly trigger per workday from `windowStart`,
 * repeated every `intervalMinutes` until `windowEnd`, one weekly trigger per extra run, only while the
 * user is logged on, without highest privileges and without a stored password.
 */
export function renderWindowsTask(input: ScheduleTemplateInput, options: WindowsTaskOptions): string {
  const { schedule } = input;
  const days = requireWorkdays(schedule);
  const name = taskName(input.repositoryId);
  const window = `${describeWindow(schedule)} in ${input.timezone}`;
  const args = captureArgs(input)
    .map((arg) => (arg.path ? quoteWindowsArg(arg.text) : arg.text))
    .join(' ');
  // Paths stay out of the comment: it must not contain `--`, which paths may (see commentLine).
  const comment = [
    `IPA Assistant: Vorlage für die Windows-Aufgabenplanung, Aufgabe ${name}`,
    'Import (ändert die Aufgabenplanung und ist nur von Hand auszuführen, ipa installiert nichts):',
    `  ${importCommand(input.repositoryId, null)}`,
    'Hinweise:',
    '- Die Trigger verwenden die Systemzeit dieses Rechners. Die fachliche Prüfung des Zeitfensters',
    `  (${window}) übernimmt ipa capture mit der Option scheduled, siehe Arguments.`,
    '- Die Aufgabe läuft nur bei angemeldetem Benutzer, ohne höchste Rechte und ohne gespeichertes Passwort.',
    '- Beim Start kann kurz ein Konsolenfenster erscheinen.',
    `- ExecutionTimeLimit = limits.maxRunSeconds (${input.maxRunSeconds} s) + 10 Minuten; eine zweite Instanz startet nicht (IgnoreNew).`,
  ];
  const description =
    `Geplante Aufnahme des IPA Assistant für ${input.repoPath}. Die Trigger verwenden die Systemzeit; ` +
    `ipa capture --scheduled prüft das Zeitfenster ${window} selbst und beendet Läufe ausserhalb ohne Aufnahme.`;
  const lines = [
    options.encoding === null ? '<?xml version="1.0"?>' : `<?xml version="1.0" encoding="${options.encoding}"?>`,
    '<!--',
    ...comment.map((line) => `  ${commentLine(line)}`),
    '-->',
    `<Task version="1.2" xmlns="${TASK_NAMESPACE}">`,
    '  <RegistrationInfo>',
    `    <Description>${xmlText(description)}</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    ...days.flatMap((day) => calendarTrigger(input, schedule.windowStart, [day], repeats(schedule))),
    ...[...schedule.extraRunTimes].sort().flatMap((time) => calendarTrigger(input, time, days, false)),
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
    '    <WakeToRun>false</WakeToRun>',
    `    <ExecutionTimeLimit>${formatDuration(input.maxRunSeconds + EXECUTION_RESERVE_SECONDS)}</ExecutionTimeLimit>`,
    '    <Priority>7</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${xmlText(quoteWindowsArg(input.nodePath))}</Command>`,
    `      <Arguments>${xmlText(args)}</Arguments>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
  ];
  return `${lines.join('\n')}\n`;
}

const CRON_DAYS: Record<Weekday, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** Day-of-week field, for example `1-5` or `0,6`. */
function cronDayField(days: readonly Weekday[]): string {
  const numbers = [...new Set(days.map((day) => CRON_DAYS[day]))].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let index = 0; index < numbers.length; ) {
    let end = index;
    while (end + 1 < numbers.length && numbers[end + 1] === numbers[end]! + 1) end += 1;
    parts.push(end - index >= 2 ? `${numbers[index]}-${numbers[end]}` : numbers.slice(index, end + 1).join(','));
    index = end + 1;
  }
  return parts.join(',');
}

/**
 * crontab lines with `CRON_TZ` and absolute paths, one line per distinct minute because a single line
 * cannot express every interval together with the extra runs. Marked as untested (spec.md §2.3).
 */
export function renderCron(input: ScheduleTemplateInput): string {
  const { schedule } = input;
  const days = cronDayField(requireWorkdays(schedule));
  const command = [quotePosixArg(input.nodePath), ...captureArgs(input).map((arg) => (arg.path ? quotePosixArg(arg.text) : arg.text))].join(' ');
  const hoursByMinute = new Map<number, number[]>();
  for (const time of runTimesOfDay(schedule)) {
    const minutes = minutesOf(time);
    const hours = hoursByMinute.get(minutes % 60) ?? [];
    hours.push(Math.floor(minutes / 60));
    hoursByMinute.set(minutes % 60, hours);
  }
  const entries = [...hoursByMinute.entries()]
    .sort(([a], [b]) => a - b)
    .map(([minute, hours]) => `${minute} ${hours.sort((a, b) => a - b).join(',')} * * ${days} ${command}`);
  return [
    CRON_UNTESTED_COMMENT,
    `# IPA Assistant: geplante Aufnahme für ${input.repoPath} (${taskName(input.repositoryId)})`,
    `# Zeitfenster ${describeWindow(schedule)} in ${input.timezone}; ipa capture --scheduled prüft es selbst.`,
    '# CRON_TZ kennt nicht jede cron-Variante. cron hat einen knappen PATH: git und claude brauchen ihn',
    '# oder absolute Pfade (claude.command in config.json).',
    `CRON_TZ=${input.timezone}`,
    ...entries,
    '',
  ].join('\n');
}
