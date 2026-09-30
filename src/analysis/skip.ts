/**
 * Deliberate gaps and new attempts (spec.md §6.3, §12.1): `ipa skip` writes `skip.json`,
 * `ipa capture --retry` writes `retry-<n>.json`. Both run under the lock of their command.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { listSnapshots } from '../collector/snapshots.js';
import type { WorkspaceContext } from '../core/context.js';
import { EXIT, IpaError } from '../core/errors.js';
import { ID_PATTERNS } from '../core/ids.js';
import { createJsonExclusive } from '../core/json.js';
import { formatZoned } from '../core/time.js';
import { createSecretScanner } from '../filter/secret-scanner.js';
import { syncCursor } from './cursor.js';
import { analysisDir, retryPath, SKIP_FILE } from './files.js';
import { analysisDetails, type StatusDetails } from './status.js';
import { isOpen, type RetryMarker, type SkipMarker } from './types.js';

async function existingSnapshot(ctx: WorkspaceContext, snapshotId: string): Promise<void> {
  if (!ID_PATTERNS.snapshotId.test(snapshotId)) {
    throw new IpaError('snapshot_id_invalid', EXIT.usage, `Ungültige Snapshot-ID ${JSON.stringify(snapshotId)}; erwartet wird zum Beispiel S000002.`);
  }
  if (!(await listSnapshots(ctx)).includes(snapshotId)) {
    throw new IpaError('snapshot_unknown', EXIT.usage, `Den Snapshot ${snapshotId} gibt es in diesem Arbeitsbereich nicht.`);
  }
}

/** The reason is stored in `skip.json`; a secret must not get there (I-12). */
function checkReason(ctx: WorkspaceContext, reason: string): string {
  const trimmed = reason.trim();
  if (trimmed === '') throw new IpaError('reason_missing', EXIT.usage, 'Die Option --reason braucht einen nicht leeren Grund.');
  if (createSecretScanner(ctx.config.secrets).scan(trimmed).length > 0) {
    throw new IpaError('reason_secret', EXIT.usage, 'Der Grund sieht aus wie ein Zugangsdatum und wird nicht gespeichert. Bitte anders formulieren.');
  }
  return trimmed;
}

export interface SkipResult {
  marker: SkipMarker;
  /** Cursor after the skip. */
  cursor: string | null;
  previousStatus: StatusDetails['status'];
}

/** Only for open snapshots (`pending`, `failed`, `blocked`, `exhausted`), otherwise exit code 2. */
export async function skipSnapshot(ctx: WorkspaceContext, snapshotId: string, reason: string): Promise<SkipResult> {
  await existingSnapshot(ctx, snapshotId);
  const checked = checkReason(ctx, reason);
  const { status } = await analysisDetails(ctx, snapshotId);
  if (!isOpen(status)) {
    throw new IpaError(
      'snapshot_not_open',
      EXIT.usage,
      `Snapshot ${snapshotId} hat den Status ${status}. Übersprungen werden nur offene Analysen (pending, failed, blocked, exhausted).`,
    );
  }
  const marker: SkipMarker = {
    schemaVersion: 1,
    snapshotId,
    skippedAt: formatZoned(ctx.clock.now(), ctx.config.timezone),
    reason: checked,
  };
  const dir = analysisDir(ctx.workspaceDir, snapshotId);
  await mkdir(dir, { recursive: true });
  await createJsonExclusive(path.join(dir, SKIP_FILE), marker, 'skip');
  const { cursor } = await syncCursor(ctx);
  return { marker, cursor, previousStatus: status };
}

/** `retry-<n>.json` with `n` = number of the last attempt; only for `exhausted`, otherwise exit code 2. */
export async function requestRetry(ctx: WorkspaceContext, snapshotId: string): Promise<{ afterAttempt: number }> {
  await existingSnapshot(ctx, snapshotId);
  const details = await analysisDetails(ctx, snapshotId);
  const last = details.attempts.at(-1);
  if (details.status !== 'exhausted' || last === undefined) {
    throw new IpaError(
      'snapshot_not_exhausted',
      EXIT.usage,
      `Snapshot ${snapshotId} hat den Status ${details.status}. --retry gibt nur Analysen im Status exhausted wieder frei.`,
    );
  }
  const marker: RetryMarker = { schemaVersion: 1, snapshotId, requestedAt: formatZoned(ctx.clock.now(), ctx.config.timezone) };
  await createJsonExclusive(retryPath(ctx.workspaceDir, snapshotId, last.number), marker, 'retry');
  return { afterAttempt: last.number };
}
