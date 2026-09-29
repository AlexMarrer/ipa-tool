/**
 * `ipa capture [--no-analysis]` (spec.md §4.4, §6.3). Until package 06 exists, capture never analyses.
 */
import type { Command } from 'commander';
import { captureSnapshot } from '../../collector/capture.js';
import { BASELINE_HINT, describeHalt } from '../../collector/halt.js';
import { recoverWorkspace } from '../../collector/recovery.js';
import { readManifest } from '../../collector/snapshots.js';
import type { CaptureHooks, CaptureOutcome, Manifest } from '../../collector/types.js';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT, type ExitCode, exitCodeOf, IpaError, LockHeldError } from '../../core/errors.js';
import { withLock } from '../../core/lock.js';
import { appendLockHeldRecord, appendRunRecord, createRunRecord, runErrorOf } from '../../core/run-log.js';
import { readState, writeState } from '../../core/state.js';
import { formatZoned } from '../../core/time.js';
import { formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

export interface CaptureRunOptions {
  hooks?: CaptureHooks;
  onWarning?: (message: string) => void;
}

export interface CaptureRunResult {
  exitCode: ExitCode;
  snapshotId: string | null;
  outcome: CaptureOutcome;
  recovered: string[];
}

/**
 * Lock, recovery (spec.md §11.6), capture and run log for one `capture` run. Errors are logged in
 * `runs.jsonl` and then rethrown.
 */
export async function runCapture(ctx: WorkspaceContext, options: CaptureRunOptions = {}): Promise<CaptureRunResult> {
  const startedAt = ctx.clock.now();
  try {
    return await withLock(ctx, 'capture', async ({ lockBroken }) => {
      let recovered: string[] = [];
      let snapshotId: string | null = null;
      let outcome: CaptureOutcome | null = null;
      let failure: unknown = null;
      try {
        ({ recovered } = await recoverWorkspace(ctx));
        const state = await readState(ctx.workspaceDir);
        if (state.baselineSnapshotId === null) {
          throw new IpaError(
            'baseline_missing',
            EXIT.usage,
            'Es gibt noch keinen Ausgangs-Snapshot. Bitte zuerst ipa init ausführen; bei einem bereits angelegten Arbeitsbereich holt es den Ausgangs-Snapshot nach.',
          );
        }
        outcome = await captureSnapshot(ctx, { kind: 'work', hooks: options.hooks, onWarning: options.onWarning });
        if (outcome.type === 'created') snapshotId = outcome.snapshotId;
      } catch (error) {
        failure = error;
      }
      const endedAt = ctx.clock.now();
      const exitCode = failure !== null ? exitCodeOf(failure) : outcome?.type === 'halted' ? EXIT.halted : EXIT.ok;
      if (exitCode === EXIT.ok) {
        const state = await readState(ctx.workspaceDir);
        await writeState(ctx.workspaceDir, { ...state, lastSuccessfulRun: formatZoned(endedAt, ctx.config.timezone) });
      }
      await appendRunRecord(
        ctx.workspaceDir,
        createRunRecord({
          runId: ctx.runId,
          command: 'capture',
          startedAt,
          endedAt,
          timezone: ctx.config.timezone,
          exitCode,
          outcome: failure === null && outcome?.type === 'unchanged' ? 'unchanged' : undefined,
          lockBroken,
          snapshotCreated: snapshotId,
          recovered,
          errors: failure === null ? [] : [runErrorOf(failure)],
        }),
      );
      if (failure !== null) throw failure;
      return { exitCode, snapshotId, outcome: outcome!, recovered };
    });
  } catch (error) {
    if (error instanceof LockHeldError) await appendLockHeldRecord(ctx, 'capture', startedAt, error);
    throw error;
  }
}

function summarize(manifest: Manifest): string {
  const count = (decision: string) => manifest.filterDecisions.filter((entry) => entry.decision === decision).length;
  const kinds = (kind: string) => manifest.evidence.filter((entry) => entry.kind === kind).length;
  return (
    `Snapshot ${manifest.snapshotId} gespeichert (Arbeits-Snapshot, ohne Analyse).\n` +
    formatFields([
      ['Commits', String(manifest.commits.length)],
      ['Dateizustände', String(manifest.fileStates.length)],
      ['Belege', String(manifest.evidence.length)],
      ['Zustandsdeltas', String(kinds('state_delta'))],
      ['Statusänderungen', String(manifest.statusChanges.length)],
      ['Testberichte', String(kinds('test_report'))],
      ['Lücken', String(manifest.gaps.length)],
      ['Analyse nötig', manifest.analysisRequired ? 'ja' : 'nein'],
      ['Ausgeschlossen', String(count('excluded'))],
      ['Zurückgehalten', String(count('withheld'))],
      ['Ausgelassen', String(count('omitted'))],
    ])
  );
}

export function withheldNotice(manifest: Manifest): string | null {
  const withheld = manifest.filterDecisions.filter((entry) => entry.decision === 'withheld').length;
  if (withheld === 0) return null;
  return (
    `Hinweis: ${withheld} Einheit(en) wegen Secret-Verdacht zurückgehalten. Offene Prüfung: filterDecisions ` +
    `im Manifest von ${manifest.snapshotId} nennt Pfad, Detektor und Zeile, nie den Wert.`
  );
}

interface CaptureCommandOptions extends GlobalOptions {
  analysis?: boolean;
}

export function registerCaptureCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('capture')
    .usage('[optionen]')
    .description('Snapshot des Arbeitsstands aufnehmen')
    .option('--no-analysis', 'nur aufnehmen, keine Analyse (bis Paket 06 immer der Fall)')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<CaptureCommandOptions>();
      const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
      const result = await runCapture(ctx, { onWarning: (message) => io.stderr(`${message}\n`) });
      for (const id of result.recovered) {
        io.stderr(`Hinweis: Snapshot ${id} aus einem abgebrochenen Lauf übernommen.\n`);
      }
      if (result.snapshotId !== null) {
        const manifest = await readManifest(ctx, result.snapshotId);
        io.stdout(summarize(manifest));
        const notice = withheldNotice(manifest);
        if (notice !== null) io.stderr(`${notice}\n`);
      } else if (result.outcome.type === 'unchanged') {
        const { lastSnapshotId } = await readState(ctx.workspaceDir);
        io.stdout(`Keine neue Arbeit seit Snapshot ${lastSnapshotId ?? '–'}. Es wurde kein Snapshot gespeichert.\n`);
      } else if (result.outcome.type === 'halted') {
        io.stderr(`Angehalten: ${describeHalt(result.outcome.halt)}\n${BASELINE_HINT}\n`);
      }
      state.exitCode = result.exitCode;
    });
}
