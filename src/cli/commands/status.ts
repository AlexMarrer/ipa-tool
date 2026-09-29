/**
 * `ipa status [--json]`: nur lesend, ohne Lock und ohne Laufprotokoll (spec.md §6.6).
 */
import type { Command } from 'commander';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT, IpaError } from '../../core/errors.js';
import { isStrictlyInside } from '../../core/paths.js';
import { findRegistryEntry, readRegistry, type WorkspaceMode } from '../../core/registry.js';
import { readRunRecords, type RunRecord } from '../../core/run-log.js';
import { readState } from '../../core/state.js';
import { describeWorkspaceMode, formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

interface StatusCommandOptions extends GlobalOptions {
  json?: boolean;
}

/** Letzter Lauf ohne Details in `errors`: nur die Fehlercodes bleiben (spec.md §6.6). */
export type StatusRun = Omit<RunRecord, 'errors'> & { errors: { code: string }[] };

/** Felder von Paket 01 aus spec.md §6.6, in dieser Reihenfolge. */
export interface StatusReport {
  repositoryId: string;
  repoPath: string;
  workspacePath: string;
  dataRoot: string;
  timezone: string;
  workspaceMode: WorkspaceMode;
  baselineSnapshotId: string | null;
  lastSnapshotId: string | null;
  lastAnalysedSnapshotId: string | null;
  lastSuccessfulRun: string | null;
  lastRun: StatusRun | null;
}

export interface StatusResult {
  report: StatusReport;
  warnings: string[];
}

export async function collectStatus(ctx: WorkspaceContext): Promise<StatusResult> {
  const entry = findRegistryEntry(await readRegistry(ctx.dataRoot), ctx.repoRoot);
  if (entry === null) {
    throw new IpaError('not_initialized', EXIT.usage, `Das Repository ${ctx.repoRoot} ist nicht initialisiert. Zuerst ipa init ausführen.`);
  }
  const state = await readState(ctx.workspaceDir);
  if (state.repositoryId !== ctx.repositoryId) {
    throw new IpaError(
      'state_mismatch',
      EXIT.usage,
      `state.json in ${ctx.workspaceDir} gehört zu ${state.repositoryId}, erwartet wird ${ctx.repositoryId}.`,
    );
  }
  const runs = await readRunRecords(ctx.workspaceDir);
  const warnings = runs.invalid.map(
    (line) => `Warnung: runs.jsonl, Zeile ${line.line} wird übersprungen (${line.error}).`,
  );
  const last = runs.records.at(-1);
  const lastRun: StatusRun | null =
    last === undefined ? null : { ...last, errors: last.errors.map((error) => ({ code: error.code })) };

  return {
    report: {
      repositoryId: ctx.repositoryId,
      repoPath: ctx.repoRoot,
      workspacePath: ctx.workspaceDir,
      dataRoot: ctx.dataRoot,
      timezone: ctx.config.timezone,
      workspaceMode: entry.workspaceMode,
      baselineSnapshotId: state.baselineSnapshotId,
      lastSnapshotId: state.lastSnapshotId,
      lastAnalysedSnapshotId: state.lastAnalysedSnapshotId,
      lastSuccessfulRun: state.lastSuccessfulRun,
      lastRun,
    },
    warnings,
  };
}

const NONE = 'keiner';

function describeRun(run: StatusRun | null): string {
  if (run === null) return NONE;
  const errors = run.errors.length > 0 ? `, Fehler: ${run.errors.map((error) => error.code).join(', ')}` : '';
  return `${run.command} am ${run.startedAt}, Ergebnis ${run.outcome}, Exit-Code ${run.exitCode}${errors}`;
}

export function formatStatus(report: StatusReport): string {
  const insideRepo = isStrictlyInside(report.workspacePath, report.repoPath);
  return formatFields([
    ['Repository-ID', report.repositoryId],
    ['Repository', report.repoPath],
    ['Arbeitsbereich', report.workspacePath],
    ['Speichermodus', describeWorkspaceMode(report.workspaceMode, insideRepo)],
    ['Datenwurzel', report.dataRoot],
    ['Zeitzone', report.timezone],
    ['Ausgangs-Snapshot', report.baselineSnapshotId ?? NONE],
    ['Letzter Snapshot', report.lastSnapshotId ?? NONE],
    ['Analyse-Cursor', report.lastAnalysedSnapshotId ?? NONE],
    ['Letzter erfolgreicher Lauf', report.lastSuccessfulRun ?? NONE],
    ['Letzter Lauf', describeRun(report.lastRun)],
  ]);
}

export function registerStatusCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('status')
    .usage('[optionen]')
    .description('Zustand des Arbeitsbereichs anzeigen (nur lesend)')
    .option('--json', 'Ausgabe als JSON-Objekt')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<StatusCommandOptions>();
      const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
      const { report, warnings } = await collectStatus(ctx);
      for (const warning of warnings) io.stderr(`${warning}\n`);
      io.stdout(options.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatStatus(report));
      state.exitCode = EXIT.ok;
    });
}
