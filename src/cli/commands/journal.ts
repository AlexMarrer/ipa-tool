/**
 * `ipa journal [--day <YYYY-MM-DD>] [--no-ai]` (spec.md §6.2, package 07): journal draft of a day
 * without lock (D-16) and without an entry in `runs.jsonl` (spec.md §18).
 */
import type { Command } from 'commander';
import { createClaudeRunner } from '../../claude/runner.js';
import type { ClaudeRunner } from '../../claude/types.js';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT, type ExitCode, IpaError } from '../../core/errors.js';
import { dayOf, isValidDay } from '../../core/time.js';
import { generateJournal, type JournalResult } from '../../journal/generate.js';
import { formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

/** `--day` or, without it, today in the configured time zone. */
export function journalDay(ctx: WorkspaceContext, day: string | undefined): string {
  if (day === undefined) return dayOf(ctx.clock.now(), ctx.config.timezone);
  if (!isValidDay(day)) {
    throw new IpaError('day_invalid', EXIT.usage, `--day "${day}" ist kein gültiger Tag. Erwartet wird YYYY-MM-DD, zum Beispiel 2026-10-14.`);
  }
  return day;
}

function portablePath(file: string): string {
  return file.replace(/\\/g, '/');
}

function describeMode(result: JournalResult): string {
  if (result.mode === 'ai') return 'KI-Entwurf mit Claude';
  return result.noAiReason === 'no_data' ? 'ohne KI, weil weder Snapshots noch verwendbare Notizen den Tag betreffen' : 'ohne KI, --no-ai';
}

export interface JournalCommandOptions {
  day?: string | undefined;
  noAi: boolean;
  /** `null` with `--no-ai`. */
  runner: ClaudeRunner | null;
  env?: NodeJS.ProcessEnv;
}

/** Runs one journal command for a resolved context and reports it; returns the exit code. */
export async function runJournalCommand(ctx: WorkspaceContext, io: CliIo, options: JournalCommandOptions): Promise<ExitCode> {
  const day = journalDay(ctx, options.day);
  const result = await generateJournal(ctx, options.runner, { day, noAi: options.noAi, ...(options.env === undefined ? {} : { env: options.env }) });
  for (const warning of result.warnings) io.stderr(`${warning}\n`);
  if (result.failure !== null || result.draftPath === null || result.recordPath === null) {
    io.stderr(`Fehler: Kein Journal-Entwurf für ${day} (${result.failure?.code ?? 'unbekannt'}): ${result.failure?.message ?? ''}\n`);
    if (result.runDir !== null) io.stderr(`Details: ${portablePath(result.runDir)}\n`);
    return result.exitCode;
  }
  const { openItems } = result;
  const open = openItems.analyses.map((item) => `${item.snapshotId} (${item.status})`);
  io.stdout(
    `Journal-Entwurf für ${day} gespeichert: ${describeMode(result)}.\n` +
      formatFields([
        ['Entwurf', portablePath(result.draftPath)],
        ['Datensatz', portablePath(result.recordPath)],
        ['Offene Analysen', open.length === 0 ? 'keine' : open.join(', ')],
        ['Lücken und Prüfungen', String(openItems.gaps.length)],
      ]) +
      'Bitte persönlich prüfen, korrigieren und die Endfassung manuell nach journal/final/ übernehmen.\n',
  );
  return result.exitCode;
}

interface JournalCliOptions extends GlobalOptions {
  day?: string;
  ai?: boolean;
}

export function registerJournalCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('journal')
    .usage('[optionen]')
    .description('Journal-Entwurf für einen Tag aus Notizen, Work-Logs und Belegen erzeugen')
    .option('--day <YYYY-MM-DD>', 'Tag des Journals (Standard: heute in der konfigurierten Zeitzone)')
    .option('--no-ai', 'Entwurf ohne Claude deterministisch aus Notizen und Work-Logs erzeugen')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<JournalCliOptions>();
      const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
      const noAi = options.ai === false;
      state.exitCode = await runJournalCommand(ctx, io, {
        day: options.day,
        noAi,
        runner: noAi ? null : createClaudeRunner({ env: io.env }),
        env: io.env,
      });
    });
}
