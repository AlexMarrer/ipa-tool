/**
 * `ipa schedule --os <windows|cron> [--output <datei>]` (spec.md §6.2, package 08): prints a scheduler
 * template or writes it to a new file. It installs nothing, changes no system setting (D-15), takes no
 * lock and writes no entry in `runs.jsonl` (spec.md §18).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { dataRootCandidate, describeFsError } from '../../core/data-root.js';
import { errnoCode, EXIT, type ExitCode, FileExistsError, IpaError } from '../../core/errors.js';
import { createFileExclusive } from '../../core/fs-write.js';
import { canonicalizePath, isSameOrInside } from '../../core/paths.js';
import { dayOf } from '../../core/time.js';
import { TOOL_ROOT } from '../../core/tool.js';
import {
  importCommand,
  renderCron,
  renderWindowsTask,
  SCHEDULE_TARGETS,
  type ScheduleTarget,
  type ScheduleTemplateInput,
  scheduleWarnings,
  taskName,
} from '../../schedule/templates.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

/** The built entry point that the scheduler starts with Node.js. */
export const CLI_ENTRY = path.join(TOOL_ROOT, 'dist', 'cli.js');

export interface ScheduleCommandOptions {
  os: string;
  output?: string | undefined;
  /** The data root came from `--data-dir` or `IPA_ASSISTANT_HOME`; the task has to pass it explicitly. */
  pinDataRoot: boolean;
  /** Base of a relative `--output`; default: the current directory. */
  cwd?: string;
  /** Defaults: `process.execPath`, `dist/cli.js` of this installation and `process.platform`. */
  nodePath?: string;
  cliPath?: string;
  platform?: NodeJS.Platform;
}

function isTarget(value: string): value is ScheduleTarget {
  return (SCHEDULE_TARGETS as readonly string[]).includes(value);
}

/**
 * The tool writes only outside the repository or inside its own workspace, and never into
 * `journal/final/` (spec.md §14.1, I-01, I-09). A template inside the repository would also be captured
 * as development work by the next run.
 */
async function assertOutputAllowed(ctx: WorkspaceContext, target: string): Promise<string> {
  const canonical = await canonicalizePath(target);
  if (isSameOrInside(canonical, ctx.repoRoot) && !isSameOrInside(canonical, ctx.workspaceDir)) {
    throw new IpaError(
      'schedule_output_in_repository',
      EXIT.usage,
      `Die Ausgabedatei ${canonical} läge im untersuchten Repository ${ctx.repoRoot}. ipa schreibt dort nicht; ` +
        'bitte einen Pfad ausserhalb wählen, zum Beispiel im Benutzerordner.',
    );
  }
  if (isSameOrInside(canonical, path.join(ctx.workspaceDir, 'journal', 'final'))) {
    throw new IpaError(
      'schedule_output_in_final',
      EXIT.usage,
      `Die Ausgabedatei ${canonical} läge in journal/final/. Dieser Ordner gehört den eigenen Endfassungen; ipa schreibt dort nie.`,
    );
  }
  return canonical;
}

async function writeTemplate(ctx: WorkspaceContext, target: string, data: string | Uint8Array): Promise<string> {
  const file = await assertOutputAllowed(ctx, target);
  try {
    await createFileExclusive(target, data);
  } catch (error) {
    if (error instanceof FileExistsError) {
      throw new IpaError('schedule_output_exists', EXIT.usage, `Die Datei ${file} existiert bereits und wird nicht überschrieben. Bitte einen neuen Dateinamen angeben.`, {
        cause: error,
      });
    }
    if (errnoCode(error) !== undefined) {
      throw new IpaError('schedule_output_failed', EXIT.usage, `Die Datei ${file} lässt sich nicht anlegen (${describeFsError(error)}).`, { cause: error });
    }
    throw error;
  }
  return file;
}

/** UTF-16 LE with BOM and CRLF, the format of an export from the Task Scheduler. */
function utf16File(text: string): Uint8Array {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.replace(/\n/g, '\r\n'), 'utf16le')]);
}

function platformNotice(target: ScheduleTarget, platform: NodeJS.Platform): string | null {
  if (target === 'windows' && platform !== 'win32') {
    return `Hinweis: Die Vorlage für die Windows-Aufgabenplanung enthält die Pfade dieses Rechners (${platform}).`;
  }
  if (target === 'cron' && platform === 'win32') {
    return 'Hinweis: Die cron-Vorlage enthält die Pfade dieses Windows-Rechners; cron gibt es unter Windows nicht, und die Vorlage ist nicht geprüft.';
  }
  return null;
}

/** Runs one `schedule` command for a resolved context and reports it; returns the exit code. */
export async function runScheduleCommand(ctx: WorkspaceContext, io: CliIo, options: ScheduleCommandOptions): Promise<ExitCode> {
  if (!isTarget(options.os)) {
    throw new IpaError('schedule_os_invalid', EXIT.usage, `--os "${options.os}" ist unbekannt. Erlaubt sind windows und cron.`);
  }
  const target = options.os;
  const input: ScheduleTemplateInput = {
    repositoryId: ctx.repositoryId,
    repoPath: ctx.repoRoot,
    timezone: ctx.config.timezone,
    schedule: ctx.config.schedule,
    maxRunSeconds: ctx.config.limits.maxRunSeconds,
    claudeTimeoutSeconds: ctx.config.claude.timeoutSeconds,
    nodePath: options.nodePath ?? process.execPath,
    cliPath: options.cliPath ?? CLI_ENTRY,
    dataDir: options.pinDataRoot ? ctx.dataRoot : null,
    startDay: dayOf(ctx.clock.now(), ctx.config.timezone),
  };
  const outputPath = options.output === undefined ? null : path.resolve(options.cwd ?? process.cwd(), options.output);
  const text =
    target === 'windows'
      ? renderWindowsTask(input, { encoding: outputPath === null ? null : 'UTF-16' })
      : renderCron(input);

  const notices = [
    ...scheduleWarnings(input, target),
    platformNotice(target, options.platform ?? process.platform),
    existsSync(input.cliPath) ? null : `Warnung: ${input.cliPath} fehlt. Vor dem Einrichten npm run build im Ordner des Tools ausführen.`,
  ];
  for (const notice of notices) if (notice !== null) io.stderr(`${notice}\n`);

  if (outputPath === null) {
    io.stdout(text);
    return EXIT.ok;
  }
  const file = await writeTemplate(ctx, outputPath, target === 'windows' ? utf16File(text) : text);
  if (target === 'windows') {
    io.stdout(
      `Vorlage für die Windows-Aufgabenplanung geschrieben: ${file}\n` +
        `Aufgabe: ${taskName(ctx.repositoryId)}\n` +
        `Import von Hand (ändert die Aufgabenplanung, ipa installiert nichts): ${importCommand(ctx.repositoryId, path.normalize(file))}\n`,
    );
  } else {
    io.stdout(`cron-Vorlage geschrieben: ${file} (nicht geprüft). Einrichten von Hand, zum Beispiel mit crontab -e.\n`);
  }
  return EXIT.ok;
}

interface ScheduleCliOptions extends GlobalOptions {
  os: string;
  output?: string;
}

export function registerScheduleCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('schedule')
    .usage('--os <windows|cron> [optionen]')
    .description('Vorlage für den Scheduler des Betriebssystems ausgeben; installiert nichts')
    // Checked in the action instead of with choices(), whose help and messages Commander prints in English.
    .requiredOption('--os <windows|cron>', 'windows: XML für die Aufgabenplanung; cron: crontab-Zeilen (nicht geprüft)')
    .option('--output <datei>', 'Vorlage in eine neue Datei schreiben statt auf stdout; eine vorhandene Datei wird nicht überschrieben')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<ScheduleCliOptions>();
      const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
      state.exitCode = await runScheduleCommand(ctx, io, {
        os: options.os,
        output: options.output,
        // A scheduled task does not see a data root set only for the current shell session.
        pinDataRoot: dataRootCandidate({ dataDir: options.dataDir }).source !== 'default',
      });
    });
}
