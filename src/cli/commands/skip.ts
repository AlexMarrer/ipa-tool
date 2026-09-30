/**
 * `ipa skip <snapshotId> --reason <text>` (spec.md §6.2, §12.1): leaves an open analysis out on purpose
 * and keeps it visible as a gap.
 */
import type { Command } from 'commander';
import { type SkipResult, skipSnapshot } from '../../analysis/skip.js';
import { recoverWorkspace } from '../../collector/recovery.js';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT, exitCodeOf, LockHeldError } from '../../core/errors.js';
import { withLock } from '../../core/lock.js';
import { appendLockHeldRecord, appendRunRecord, createRunRecord, runErrorOf } from '../../core/run-log.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';

export interface SkipRunResult extends SkipResult {
  recovered: string[];
}

/** Lock, recovery (spec.md §11.6), `skip.json`, cursor and run log. Errors are logged and rethrown. */
export async function runSkip(ctx: WorkspaceContext, snapshotId: string, reason: string): Promise<SkipRunResult> {
  const startedAt = ctx.clock.now();
  try {
    return await withLock(ctx, 'skip', async ({ lockBroken }) => {
      let recovered: string[] = [];
      let result: SkipResult | null = null;
      let failure: unknown = null;
      try {
        ({ recovered } = await recoverWorkspace(ctx));
        result = await skipSnapshot(ctx, snapshotId, reason);
      } catch (error) {
        failure = error;
      }
      await appendRunRecord(
        ctx.workspaceDir,
        createRunRecord({
          runId: ctx.runId,
          command: 'skip',
          startedAt,
          endedAt: ctx.clock.now(),
          timezone: ctx.config.timezone,
          exitCode: failure === null ? EXIT.ok : exitCodeOf(failure),
          lockBroken,
          recovered,
          errors: failure === null ? [] : [runErrorOf(failure)],
        }),
      );
      if (failure !== null || result === null) throw failure;
      return { ...result, recovered };
    });
  } catch (error) {
    if (error instanceof LockHeldError) await appendLockHeldRecord(ctx, 'skip', startedAt, error);
    throw error;
  }
}

interface SkipCommandOptions extends GlobalOptions {
  reason: string;
}

export function registerSkipCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('skip')
    .usage('<snapshotId> --reason <text>')
    .description('Analyse eines offenen Snapshots bewusst auslassen und als Lücke sichtbar machen')
    .argument('<snapshotId>', 'Snapshot mit offener Analyse, zum Beispiel S000003')
    .requiredOption('--reason <text>', 'Grund für das Auslassen (Pflicht, wird gespeichert)')
    .action(async (snapshotId: string, _options: unknown, command: Command) => {
      const options = command.optsWithGlobals<SkipCommandOptions>();
      const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
      const result = await runSkip(ctx, snapshotId, options.reason);
      for (const id of result.recovered) io.stderr(`Hinweis: Snapshot ${id} aus einem abgebrochenen Lauf übernommen.\n`);
      io.stdout(
        `Analyse ${snapshotId} übersprungen (vorher ${result.previousStatus}). Die Lücke bleibt in status und im Journal sichtbar.\n` +
          `Analyse-Cursor: ${result.cursor ?? 'keiner'}\n`,
      );
      state.exitCode = EXIT.ok;
    });
}
