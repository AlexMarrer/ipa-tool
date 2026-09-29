import type { WorkspaceContext } from '../core/context.js';
import type { BaselineOutcome } from '../core/init.js';
import { readState } from '../core/state.js';
import { captureSnapshot } from './capture.js';
import { recoverWorkspace } from './recovery.js';
import type { CaptureHooks } from './types.js';

/**
 * Baseline snapshot for `ipa init` (spec.md §6.3). A baseline that an aborted init already stored
 * is taken over instead of captured a second time.
 */
export async function takeInitialBaseline(
  ctx: WorkspaceContext,
  options: { hooks?: CaptureHooks; onWarning?: (message: string) => void } = {},
): Promise<BaselineOutcome> {
  const { recovered } = await recoverWorkspace(ctx);
  const state = await readState(ctx.workspaceDir);
  if (state.baselineSnapshotId !== null) return { snapshotId: state.baselineSnapshotId, recovered, adopted: true };
  const outcome = await captureSnapshot(ctx, { kind: 'baseline', ...options });
  if (outcome.type !== 'created') throw new Error('Ein Ausgangs-Snapshot wird immer gespeichert.');
  return { snapshotId: outcome.snapshotId, recovered, adopted: false };
}
