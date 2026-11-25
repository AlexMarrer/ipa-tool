/**
 * `ipa schedule install|status|pause|resume|remove|run` (package 09 §4.3): manages the task
 * `ipa-assistant-<repositoryId>` in the Windows Task Scheduler through `schtasks`. Takes no lock and
 * writes no entry in `runs.jsonl`; only an explicit command changes the Task Scheduler.
 */
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { dataRootCandidate } from '../../core/data-root.js';
import { EXIT, IpaError } from '../../core/errors.js';
import { createFileExclusive } from '../../core/fs-write.js';
import { canonicalizePath, isSameOrInside } from '../../core/paths.js';
import { dayOf, formatZoned } from '../../core/time.js';
import { TOOL_ROOT } from '../../core/tool.js';
import { planSchedule, type SchedulePlan } from '../../schedule/plan.js';
import { createSchtasksRunner, type SchtasksRunner } from '../../schedule/schtasks.js';
import { changeTask, queryTask, type TaskDifference, type TaskState, type TaskStatus } from '../../schedule/task.js';
import { renderWindowsTask, scheduleWarnings, type ScheduleTemplateInput } from '../../schedule/templates.js';
import { checkScheduleWindow } from '../../schedule/window.js';
import { type Emitter, runAction } from '../action.js';
import type { CliDeps } from '../deps.js';
import { formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

/** The built entry point that the scheduler starts with Node.js. */
export const CLI_ENTRY = path.join(TOOL_ROOT, 'dist', 'cli.js');

export type TaskAction = 'install' | 'status' | 'pause' | 'resume' | 'remove' | 'run';

const STATE_TEXT: Record<TaskState, string> = {
  not_installed: 'nicht eingerichtet',
  active: 'aktiv',
  paused: 'pausiert',
  stale: 'veraltet',
  error: 'Fehler',
};

const DIFFERENCE_TEXT: Record<TaskDifference, string> = {
  node_path: 'Pfad zu Node',
  cli_path: 'Pfad zu cli.js',
  arguments: 'Argumente',
  triggers: 'Trigger',
  execution_time_limit: 'Zeitlimit',
};

interface TaskCliOptions extends GlobalOptions {
  json?: boolean;
  update?: boolean;
}

interface TaskEnv {
  ctx: WorkspaceContext;
  input: ScheduleTemplateInput;
  runner: SchtasksRunner;
  out: Emitter;
  deps: CliDeps;
  options: TaskCliOptions;
}

interface TaskStep {
  changed: boolean;
  headline: string;
  insideWindow?: boolean;
}

function requireWindows(deps: CliDeps): void {
  if ((deps.platform ?? process.platform) !== 'win32') {
    throw new IpaError(
      'schedule_platform_unsupported',
      EXIT.usage,
      'Die Zeitplan-Verwaltung nutzt die Windows-Aufgabenplanung (schtasks) und läuft nur unter Windows. ' +
        'Für andere Systeme gibt ipa schedule --os cron eine ungeprüfte Vorlage aus.',
    );
  }
}

/** The task as `install` would create it for the current configuration. */
export function templateInput(ctx: WorkspaceContext, options: { pinDataRoot: boolean; nodePath?: string | undefined; cliPath: string }): ScheduleTemplateInput {
  return {
    repositoryId: ctx.repositoryId,
    repoPath: ctx.repoRoot,
    timezone: ctx.config.timezone,
    schedule: ctx.config.schedule,
    maxRunSeconds: ctx.config.limits.maxRunSeconds,
    claudeTimeoutSeconds: ctx.config.claude.timeoutSeconds,
    nodePath: options.nodePath ?? process.execPath,
    cliPath: options.cliPath,
    dataDir: options.pinDataRoot ? ctx.dataRoot : null,
    startDay: dayOf(ctx.clock.now(), ctx.config.timezone),
  };
}

function requireInstalled(before: TaskStatus, ctx: WorkspaceContext): void {
  if (before.state === 'error') {
    throw new IpaError('schtasks_failed', EXIT.internal, `${before.detail ?? 'Der Zustand der Aufgabe liess sich nicht bestimmen.'}`);
  }
  if (before.state === 'not_installed') {
    throw new IpaError(
      'schedule_not_installed',
      EXIT.usage,
      `Die Aufgabe ${before.taskName} ist nicht eingerichtet. Zuerst ipa schedule install ausführen (Repository ${ctx.repoRoot}).`,
    );
  }
}

async function install(env: TaskEnv, before: TaskStatus): Promise<TaskStep> {
  const { ctx, input, runner, out, deps, options } = env;
  if (before.state === 'error') {
    throw new IpaError('schtasks_failed', EXIT.internal, before.detail ?? 'Der Zustand der Aufgabe liess sich nicht bestimmen.');
  }
  if (!existsSync(input.cliPath)) {
    throw new IpaError(
      'schedule_cli_missing',
      EXIT.usage,
      `${input.cliPath} fehlt. Vor dem Einrichten npm run build im Ordner des Tools ausführen.`,
    );
  }
  const exists = before.state !== 'not_installed';
  if (exists && options.update !== true) {
    throw new IpaError(
      'schedule_exists',
      EXIT.usage,
      `Die Aufgabe ${before.taskName} existiert bereits (Zustand: ${STATE_TEXT[before.state]}). Mit ipa schedule install --update wird sie durch die aktuelle Konfiguration ersetzt.`,
    );
  }
  for (const warning of scheduleWarnings(input, 'windows')) out.warn(warning);
  if (ctx.config.claude.allowPaidUsage === true) {
    out.warn('Hinweis: claude.allowPaidUsage ist aktiv; geplante Läufe können kostenpflichtige Claude-Aufrufe auslösen.');
  }
  // An update never starts what the user paused.
  const xml = renderWindowsTask(input, { encoding: 'UTF-16', enabled: !(exists && before.enabled === false) });
  const dir = path.join(deps.tempDir ?? os.tmpdir(), 'ipa-assistant', 'schedule');
  if (isSameOrInside(await canonicalizePath(dir), ctx.repoRoot) || isSameOrInside(ctx.repoRoot, await canonicalizePath(dir))) {
    // I-01: nothing is written into the repository, not even a short-lived file.
    throw new IpaError(
      'schedule_temp_in_repository',
      EXIT.usage,
      `Das Temp-Verzeichnis ${dir} liegt im untersuchten Repository ${ctx.repoRoot}. ipa schreibt dort nicht; TEMP oder TMP muss ausserhalb zeigen.`,
    );
  }
  const file = path.join(dir, `${ctx.runId}.xml`);
  await mkdir(dir, { recursive: true });
  try {
    // UTF-16 LE with BOM and CRLF, the format that the Task Scheduler imports.
    await createFileExclusive(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml.replace(/\n/g, '\r\n'), 'utf16le')]));
    await changeTask(runner, ['/Create', '/XML', file, '/TN', before.taskName, ...(exists ? ['/F'] : [])], 'Die Aufgabe liess sich nicht einrichten');
  } finally {
    await rm(file, { force: true });
  }
  return { changed: true, headline: exists ? 'Aufgabe aktualisiert.' : 'Aufgabe eingerichtet.' };
}

async function toggle(env: TaskEnv, before: TaskStatus, enable: boolean): Promise<TaskStep> {
  requireInstalled(before, env.ctx);
  const target = enable ? 'aktiv' : 'pausiert';
  if (before.enabled === enable) return { changed: false, headline: `Aufgabe ist bereits ${target}.` };
  await changeTask(env.runner, ['/Change', '/TN', before.taskName, enable ? '/ENABLE' : '/DISABLE'], `Die Aufgabe liess sich nicht ${enable ? 'fortsetzen' : 'pausieren'}`);
  return { changed: true, headline: enable ? 'Aufgabe fortgesetzt.' : 'Aufgabe pausiert.' };
}

async function remove(env: TaskEnv, before: TaskStatus): Promise<TaskStep> {
  if (before.state === 'not_installed') return { changed: false, headline: 'Die Aufgabe ist nicht eingerichtet; es gibt nichts zu entfernen.' };
  if (before.state === 'error') throw new IpaError('schtasks_failed', EXIT.internal, before.detail ?? 'Der Zustand der Aufgabe liess sich nicht bestimmen.');
  await changeTask(env.runner, ['/Delete', '/TN', before.taskName, '/F'], 'Die Aufgabe liess sich nicht entfernen');
  return { changed: true, headline: 'Aufgabe entfernt.' };
}

async function run(env: TaskEnv, before: TaskStatus): Promise<TaskStep> {
  requireInstalled(before, env.ctx);
  if (before.enabled === false) {
    throw new IpaError('schedule_paused', EXIT.usage, `Die Aufgabe ${before.taskName} ist pausiert und startet nicht. Zuerst ipa schedule resume ausführen.`);
  }
  const { ctx, out } = env;
  const insideWindow = checkScheduleWindow(ctx.clock.now(), ctx.config.timezone, ctx.config.schedule).inside;
  if (before.running) {
    return { changed: false, headline: 'Die Aufgabe läuft bereits; ein zweiter Lauf startet nicht (IgnoreNew).', insideWindow };
  }
  if (!insideWindow) {
    out.warn(
      'Hinweis: Jetzt ist ausserhalb des Zeitfensters; die Aufgabe führt capture --scheduled aus, und der Lauf endet ohne Aufnahme (outside_window).',
    );
  }
  await changeTask(env.runner, ['/Run', '/TN', before.taskName], 'Die Aufgabe liess sich nicht starten');
  return { changed: true, headline: 'Aufgabe gestartet; sie läuft unabhängig von diesem Befehl.', insideWindow };
}

function describePlan(plan: SchedulePlan): string {
  if (plan.workdays.length === 0) return 'keine Arbeitstage, keine Läufe';
  const boundary = plan.includesWindowEndRun ? ' (der Lauf am Fensterende ist vorsichtig mitgezählt)' : '';
  return `${plan.runTimes.join(', ')} (${plan.runsPerDay} Läufe); höchstens ${plan.maxClaudeCallsPerDay} Claude-Aufrufe pro Arbeitstag${boundary}`;
}

function formatStatus(status: TaskStatus, plan: SchedulePlan, timezone: string): string {
  const rows: [string, string][] = [
    ['Aufgabe', status.taskName],
    ['Zustand', status.detail === null ? STATE_TEXT[status.state] : `${STATE_TEXT[status.state]} (${status.detail})`],
  ];
  if (status.state !== 'not_installed' && status.state !== 'error') {
    rows.push(['Aktiviert', status.enabled === true ? 'ja' : 'nein']);
    if (status.differences.length > 0) rows.push(['Abweichungen', status.differences.map((difference) => DIFFERENCE_TEXT[difference]).join(', ')]);
    const when = (date: Date | null): string => (date === null ? 'unbekannt' : formatZoned(date, timezone));
    rows.push(['Nächster Lauf', when(status.nextRun)]);
    rows.push(['Letzter Lauf', `${when(status.lastRun)}${status.lastResult === null ? '' : `, Ergebnis ${status.lastResult}`}${status.running ? ', läuft gerade' : ''}`]);
  }
  rows.push(['Läufe', describePlan(plan)]);
  return formatFields(rows);
}

function registerTaskCommand(
  schedule: Command,
  io: CliIo,
  state: CliState,
  deps: CliDeps,
  name: TaskAction,
  description: string,
  configure: (command: Command) => void,
  perform: (env: TaskEnv, before: TaskStatus) => Promise<TaskStep>,
): void {
  const command = schedule.command(name).usage('[optionen]').description(description);
  configure(command);
  command.option('--json', 'Ergebnis als JSON-Objekt auf stdout');
  command.action(async (_options: unknown, self: Command) => {
    const options = self.optsWithGlobals<TaskCliOptions>();
    await runAction({ command: 'schedule', json: options.json === true, io, state }, async (out) => {
      requireWindows(deps);
      const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
      out.runId = ctx.runId;
      const input = templateInput(ctx, {
        // A scheduled task does not see a data root set only for the current shell session.
        pinDataRoot: dataRootCandidate({ dataDir: options.dataDir }).source !== 'default',
        nodePath: deps.nodePath,
        cliPath: deps.cliPath ?? CLI_ENTRY,
      });
      const runner = deps.schtasks ?? createSchtasksRunner();
      const env: TaskEnv = { ctx, input, runner, out, deps, options };
      const before = await queryTask(runner, input, ctx.clock.now());
      const step = name === 'status' ? { changed: false, headline: '' } : await perform(env, before);
      const after = step.changed ? await queryTask(runner, input, ctx.clock.now()) : before;
      const plan = planSchedule(ctx.config.schedule, ctx.config.claude.maxAnalysesPerRun);
      const iso = (date: Date | null): string | null => (date === null ? null : formatZoned(date, ctx.config.timezone));
      return {
        exitCode: EXIT.ok,
        result: {
          action: name,
          taskName: after.taskName,
          changed: step.changed,
          state: after.state,
          enabled: after.enabled,
          differences: after.differences,
          detail: after.detail,
          nextRun: iso(after.nextRun),
          lastRun: iso(after.lastRun),
          lastResult: after.lastResult,
          running: after.running,
          insideWindow: step.insideWindow ?? null,
          plan,
        },
        print: () => {
          if (step.headline !== '') out.stdout(`${step.headline}\n`);
          out.stdout(formatStatus(after, plan, ctx.config.timezone));
        },
      };
    });
  });
}

export function registerScheduleTaskCommands(schedule: Command, io: CliIo, state: CliState, deps: CliDeps): void {
  registerTaskCommand(schedule, io, state, deps, 'status', 'Zustand der Aufgabe in der Windows-Aufgabenplanung anzeigen (nur lesend)', () => undefined, async () => ({
    changed: false,
    headline: '',
  }));
  registerTaskCommand(
    schedule,
    io,
    state,
    deps,
    'install',
    'Aufgabe in der Windows-Aufgabenplanung einrichten (capture --scheduled nach der Konfiguration)',
    (command) => command.option('--update', 'eine vorhandene Aufgabe durch die aktuelle Konfiguration ersetzen; eine pausierte bleibt pausiert'),
    install,
  );
  registerTaskCommand(schedule, io, state, deps, 'pause', 'Aufgabe pausieren (deaktivieren); sie startet dann nichts mehr', () => undefined, (env, before) => toggle(env, before, false));
  registerTaskCommand(schedule, io, state, deps, 'resume', 'Pausierte Aufgabe wieder aktivieren', () => undefined, (env, before) => toggle(env, before, true));
  registerTaskCommand(schedule, io, state, deps, 'remove', 'Aufgabe aus der Windows-Aufgabenplanung entfernen', () => undefined, remove);
  registerTaskCommand(
    schedule,
    io,
    state,
    deps,
    'run',
    'Aufgabe jetzt starten (capture --scheduled, mit Claude, wenn offene Arbeit vorliegt)',
    () => undefined,
    run,
  );
}
