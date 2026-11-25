/**
 * `ipa baseline --reason <text> [--force]`: new starting point after a halt (spec.md §6.3, §11.5).
 */
import path from 'node:path';
import type { Command } from 'commander';
import { captureSnapshot } from '../../collector/capture.js';
import { describeHalt } from '../../collector/halt.js';
import { recoverWorkspace } from '../../collector/recovery.js';
import { MANIFEST_FILE, snapshotDir } from '../../collector/snapshots.js';
import type { CaptureHooks } from '../../collector/types.js';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT, type ExitCode, exitCodeOf, IpaError, LockHeldError } from '../../core/errors.js';
import { withLock } from '../../core/lock.js';
import { appendLockHeldRecord, appendRunRecord, createRunRecord, runErrorOf } from '../../core/run-log.js';
import { type Halt, readState } from '../../core/state.js';
import { createSecretScanner } from '../../filter/secret-scanner.js';
import { jsonPath, runAction } from '../action.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

export interface BaselineRunOptions {
  reason: string;
  force?: boolean;
  hooks?: CaptureHooks;
  onWarning?: (message: string) => void;
}

export interface BaselineRunResult {
  exitCode: ExitCode;
  snapshotId: string;
  /** The halt that this baseline ended, or null with `--force`. */
  endedHalt: Halt | null;
  recovered: string[];
}

function checkReason(ctx: WorkspaceContext, reason: string): string {
  const trimmed = reason.trim();
  if (trimmed === '') throw new IpaError('reason_missing', EXIT.usage, 'Die Option --reason braucht einen nicht leeren Grund.');
  // The reason is stored in the manifest; a secret must not get there (I-12).
  if (createSecretScanner(ctx.config.secrets).scan(trimmed).length > 0) {
    throw new IpaError('reason_secret', EXIT.usage, 'Der Grund sieht aus wie ein Zugangsdatum und wird nicht gespeichert. Bitte anders formulieren.');
  }
  return trimmed;
}

/** Lock, recovery (spec.md §11.6), baseline capture and run log. Errors are logged and rethrown. */
export async function runBaseline(ctx: WorkspaceContext, options: BaselineRunOptions): Promise<BaselineRunResult> {
  const startedAt = ctx.clock.now();
  try {
    return await withLock(ctx, 'baseline', async ({ lockBroken }) => {
      let recovered: string[] = [];
      let snapshotId: string | null = null;
      let endedHalt: Halt | null = null;
      let failure: unknown = null;
      try {
        ({ recovered } = await recoverWorkspace(ctx));
        const reason = checkReason(ctx, options.reason);
        const state = await readState(ctx.workspaceDir);
        if (state.baselineSnapshotId === null) {
          throw new IpaError('baseline_missing', EXIT.usage, 'Es gibt noch keinen Ausgangs-Snapshot. Bitte zuerst ipa init ausführen.');
        }
        if (state.halt === null && options.force !== true) {
          throw new IpaError(
            'no_halt',
            EXIT.usage,
            'Die Zuordnung ist nicht angehalten; ein neuer Ausgangspunkt ist nicht nötig. ' +
              'Mit --force wird er trotzdem gesetzt, zum Beispiel nach einer langen Pause.',
          );
        }
        endedHalt = state.halt;
        const outcome = await captureSnapshot(ctx, { kind: 'baseline', reason, hooks: options.hooks, onWarning: options.onWarning });
        if (outcome.type !== 'created') throw new Error('Ein Ausgangs-Snapshot wird immer gespeichert.');
        snapshotId = outcome.snapshotId;
      } catch (error) {
        failure = error;
      }
      const exitCode = failure === null ? EXIT.ok : exitCodeOf(failure);
      await appendRunRecord(
        ctx.workspaceDir,
        createRunRecord({
          runId: ctx.runId,
          command: 'baseline',
          startedAt,
          endedAt: ctx.clock.now(),
          timezone: ctx.config.timezone,
          exitCode,
          lockBroken,
          snapshotCreated: snapshotId,
          recovered,
          errors: failure === null ? [] : [runErrorOf(failure)],
        }),
      );
      if (failure !== null) throw failure;
      return { exitCode, snapshotId: snapshotId!, endedHalt, recovered };
    });
  } catch (error) {
    if (error instanceof LockHeldError) await appendLockHeldRecord(ctx, 'baseline', startedAt, error);
    throw error;
  }
}

interface BaselineCommandOptions extends GlobalOptions {
  reason: string;
  force?: boolean;
  json?: boolean;
}

export function registerBaselineCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('baseline')
    .usage('--reason <text> [optionen]')
    .description('Neuen Ausgangspunkt nach einem Halt setzen (Branchwechsel, umgeschriebene Historie)')
    .requiredOption('--reason <text>', 'Grund für den neuen Ausgangspunkt (Pflicht)')
    .option('--force', 'auch ohne Halt einen neuen Ausgangspunkt setzen, zum Beispiel nach einer langen Pause')
    .option('--json', 'Ergebnis als JSON-Objekt auf stdout')
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<BaselineCommandOptions>();
      await runAction({ command: 'baseline', json: options.json === true, io, state }, async (out) => {
        const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
        out.runId = ctx.runId;
        const result = await runBaseline(ctx, { reason: options.reason, force: options.force, onWarning: (message) => out.warn(message) });
        return {
          exitCode: result.exitCode,
          result: {
            snapshotId: result.snapshotId,
            manifestPath: jsonPath(path.join(snapshotDir(ctx.workspaceDir, result.snapshotId), MANIFEST_FILE)),
            forced: options.force === true,
            endedHalt: result.endedHalt,
            recovered: result.recovered,
          },
          print: () => {
            for (const id of result.recovered) out.warn(`Hinweis: Snapshot ${id} aus einem abgebrochenen Lauf übernommen.`);
            out.stdout(`Ausgangs-Snapshot ${result.snapshotId} gespeichert. Die Zuordnung beginnt dort neu.\n`);
            if (result.endedHalt !== null) out.stdout(`Aufgehobener Halt: ${describeHalt(result.endedHalt)}\n`);
            out.stdout('Arbeit zwischen dem letzten Snapshot und diesem Ausgangspunkt bleibt als Lücke sichtbar.\n');
          },
        };
      });
    });
}
