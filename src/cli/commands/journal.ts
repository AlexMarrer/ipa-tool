/**
 * `ipa journal [--day <YYYY-MM-DD>] [--no-ai] [--json]` (spec.md §6.2, package 07): journal draft of a day
 * without lock (D-16) and without an entry in `runs.jsonl` (spec.md §18).
 */
import type { Command } from 'commander';
import { createClaudeRunner } from '../../claude/runner.js';
import type { ClaudeRunner } from '../../claude/types.js';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT, type ExitCode, IpaError } from '../../core/errors.js';
import { shortRunError } from '../../core/run-log.js';
import { dayOf, isValidDay } from '../../core/time.js';
import { generateJournal, type JournalResult } from '../../journal/generate.js';
import type { OpenItems } from '../../journal/types.js';
import { type ActionReport, type Emitter, jsonPathOrNull, runAction } from '../action.js';
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

/** The reason of a new starting point is private text of the user: the result names the gap without it. */
const REBASELINE_DETAIL = 'Neuer Ausgangspunkt gesetzt. Der Grund steht im Manifest des Snapshots.';

function publicOpenItems(items: OpenItems): OpenItems {
  return { ...items, gaps: items.gaps.map((gap) => (gap.type === 'rebaseline' ? { ...gap, detail: REBASELINE_DETAIL } : gap)) };
}

/** Generates the journal of a day and describes the result for the output and for `--json`. */
export async function journalReport(ctx: WorkspaceContext, out: Emitter, options: JournalCommandOptions): Promise<ActionReport> {
  const day = journalDay(ctx, options.day);
  const result = await generateJournal(ctx, options.runner, { day, noAi: options.noAi, ...(options.env === undefined ? {} : { env: options.env }) });
  const openItems = publicOpenItems(result.openItems);
  const complete = result.failure === null && result.draftPath !== null && result.recordPath !== null;
  return {
    exitCode: result.exitCode,
    errors: result.failure === null ? [] : [shortRunError(result.failure.code, result.failure.message)],
    result: {
      day,
      mode: result.mode,
      noAiReason: result.noAiReason,
      draftPath: jsonPathOrNull(result.draftPath),
      recordPath: jsonPathOrNull(result.recordPath),
      runDir: jsonPathOrNull(result.runDir),
      failure: result.failure,
      openItems,
    },
    print: () => {
      for (const warning of result.warnings) out.warn(warning);
      if (!complete) {
        out.stderr(`Fehler: Kein Journal-Entwurf für ${day} (${result.failure?.code ?? 'unbekannt'}): ${result.failure?.message ?? ''}\n`);
        if (result.runDir !== null) out.stderr(`Details: ${portablePath(result.runDir)}\n`);
        return;
      }
      const open = openItems.analyses.map((item) => `${item.snapshotId} (${item.status})`);
      out.stdout(
        `Journal-Entwurf für ${day} gespeichert: ${describeMode(result)}.\n` +
          formatFields([
            ['Entwurf', portablePath(result.draftPath!)],
            ['Datensatz', portablePath(result.recordPath!)],
            ['Offene Analysen', open.length === 0 ? 'keine' : open.join(', ')],
            ['Lücken und Prüfungen', String(openItems.gaps.length)],
          ]) +
          'Bitte persönlich prüfen, korrigieren und die Endfassung manuell nach journal/final/ übernehmen.\n',
      );
    },
  };
}

/** Runs one journal command for a resolved context and reports it; returns the exit code. */
export async function runJournalCommand(ctx: WorkspaceContext, io: CliIo, options: JournalCommandOptions): Promise<ExitCode> {
  const out: Emitter = {
    runId: ctx.runId,
    stdout: (text) => io.stdout(text),
    stderr: (text) => io.stderr(text),
    warn: (line) => io.stderr(`${line}\n`),
  };
  const report = await journalReport(ctx, out, options);
  report.print();
  return report.exitCode;
}

interface JournalCliOptions extends GlobalOptions {
  day?: string;
  ai?: boolean;
  json?: boolean;
}

export function registerJournalCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('journal')
    .usage('[optionen]')
    .description('Journal-Entwurf für einen Tag aus Notizen, Work-Logs und Belegen erzeugen')
    .option('--day <YYYY-MM-DD>', 'Tag des Journals (Standard: heute in der konfigurierten Zeitzone)')
    .option('--no-ai', 'Entwurf ohne Claude deterministisch aus Notizen und Work-Logs erzeugen')
    .option('--json', 'Ergebnis als JSON-Objekt auf stdout')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<JournalCliOptions>();
      await runAction({ command: 'journal', json: options.json === true, io, state }, async (out) => {
        const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
        out.runId = ctx.runId;
        const noAi = options.ai === false;
        return journalReport(ctx, out, {
          day: options.day,
          noAi,
          runner: noAi ? null : createClaudeRunner({ env: io.env }),
          env: io.env,
        });
      });
    });
}
