/**
 * `ipa status [--json]`: read-only, without lock and without run log entry (spec.md §6.6).
 */
import type { Command } from 'commander';
import { readDoctorRecord } from '../../claude/doctor-record.js';
import { describeHalt } from '../../collector/halt.js';
import { listSnapshots, readManifest } from '../../collector/snapshots.js';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT, IpaError } from '../../core/errors.js';
import { isStrictlyInside } from '../../core/paths.js';
import { findRegistryEntry, readRegistry, type WorkspaceMode } from '../../core/registry.js';
import { readRunRecords, type RunRecord } from '../../core/run-log.js';
import { type Halt, readState } from '../../core/state.js';
import { dayOf } from '../../core/time.js';
import { readNotes } from '../../notes/store.js';
import { describeWorkspaceMode, formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

interface StatusCommandOptions extends GlobalOptions {
  json?: boolean;
}

/** spec.md §6.6: `errors` of the last run keep only their codes. */
export type StatusRun = Omit<RunRecord, 'errors'> & { errors: { code: string }[] };

export interface SnapshotCounts {
  total: number;
  baseline: number;
  work: number;
}

/** Summary of `doctor.json` (spec.md §6.6). */
export interface ClaudeStatus {
  checkedAt: string;
  ok: boolean;
  cliVersion: string | null;
}

/** Fields in the order of spec.md §6.6. */
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
  snapshots: SnapshotCounts;
  halt: Halt | null;
  /** Valid notes whose activity day is today in the configured time zone. */
  notesToday: number;
  /** `null` until `ipa doctor` (or `init`) has written `doctor.json`. */
  claude: ClaudeStatus | null;
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

  const snapshots: SnapshotCounts = { total: 0, baseline: 0, work: 0 };
  for (const snapshotId of await listSnapshots(ctx)) {
    const manifest = await readManifest(ctx, snapshotId);
    snapshots.total += 1;
    snapshots[manifest.kind] += 1;
  }

  const notes = await readNotes(ctx, { day: dayOf(ctx.clock.now(), ctx.config.timezone) });
  for (const line of notes.invalid) {
    warnings.push(`Warnung: ${line.file}, Zeile ${line.line} wird übersprungen (${line.error}).`);
  }
  const doctor = await readDoctorRecord(ctx.workspaceDir);

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
      snapshots,
      halt: state.halt,
      notesToday: notes.notes.length,
      claude: doctor === null ? null : { checkedAt: doctor.checkedAt, ok: doctor.ok, cliVersion: doctor.claude.version },
    },
    warnings,
  };
}

function describeClaude(claude: ClaudeStatus | null): string {
  if (claude === null) return 'noch nicht geprüft (ipa doctor)';
  const version = claude.cliVersion === null ? '' : `Claude Code ${claude.cliVersion}, `;
  return claude.ok ? `bereit (${version}geprüft am ${claude.checkedAt})` : `nicht bereit (${version}geprüft am ${claude.checkedAt}), Details mit ipa doctor`;
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
    [
      'Snapshots',
      `${report.snapshots.total} (Ausgangs-Snapshots: ${report.snapshots.baseline}, Arbeits-Snapshots: ${report.snapshots.work})`,
    ],
    ['Halt', report.halt === null ? NONE : `${describeHalt(report.halt)} ipa baseline --reason "<Grund>" erforderlich.`],
    ['Notizen heute', String(report.notesToday)],
    ['Claude-Prüfung', describeClaude(report.claude)],
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
