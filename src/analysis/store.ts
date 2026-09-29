/**
 * Storage of a finished analysis in the order of spec.md §12.3: `analysis.json`, the work log, then
 * `complete.json`. The cursor follows only after that (queue).
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { snapshotDir } from '../collector/snapshots.js';
import type { Manifest } from '../collector/types.js';
import type { WorkspaceContext } from '../core/context.js';
import { EXIT, IpaError } from '../core/errors.js';
import { writeFileAtomic } from '../core/fs-write.js';
import { createJsonExclusive } from '../core/json.js';
import { formatIssues, validate } from '../core/schemas.js';
import { formatZoned } from '../core/time.js';
import { createSecretScanner } from '../filter/secret-scanner.js';
import { analysisDir, COMPLETE_FILE, logPath, logsDir, RECORD_FILE } from './files.js';
import { sha256Hex } from './input.js';
import { renderWorkLog, type WorkLogTexts } from './render.js';
import type { AnalysisRecord, CompleteMarker, QueueHooks } from './types.js';

/** Commit messages that passed the check at capture and pass it again now (I-05). */
export async function commitMessageTexts(ctx: WorkspaceContext, manifest: Manifest): Promise<WorkLogTexts> {
  const scanner = createSecretScanner(ctx.config.secrets);
  const commitMessages: Record<string, string> = {};
  for (const entry of manifest.evidence) {
    if (entry.kind !== 'commit_message' || entry.omitted !== null || entry.file === null) continue;
    const text = await readFile(path.join(snapshotDir(ctx.workspaceDir, manifest.snapshotId), entry.file), 'utf8').catch(() => null);
    if (text !== null && scanner.scan(text).length === 0) commitMessages[entry.id] = text;
  }
  return { commitMessages };
}

/**
 * Writes the stable paths; a rerun after an abort overwrites `analysis.json` and the log (spec.md
 * §12.4). `complete.json` is created exclusively and is the last step.
 */
export async function storeCompletion(ctx: WorkspaceContext, record: AnalysisRecord, manifest: Manifest, hooks: QueueHooks = {}): Promise<CompleteMarker> {
  const { snapshotId } = record;
  const checked = validate('analysis-record', record);
  if (!checked.ok) {
    throw new IpaError('record_invalid', EXIT.internal, `Interner Fehler: Der Analyse-Datensatz ${snapshotId} ist ungültig: ${formatIssues(checked.issues)}`);
  }
  const dir = analysisDir(ctx.workspaceDir, snapshotId);
  await mkdir(dir, { recursive: true });
  const recordText = `${JSON.stringify(record, null, 2)}\n`;
  await writeFileAtomic(path.join(dir, RECORD_FILE), recordText);
  await hooks.afterAnalysisWritten?.({ snapshotId });

  await mkdir(logsDir(ctx.workspaceDir), { recursive: true });
  const log = renderWorkLog(record, manifest, await commitMessageTexts(ctx, manifest));
  await writeFileAtomic(logPath(ctx.workspaceDir, snapshotId), log);
  await hooks.afterLogWritten?.({ snapshotId });

  const marker: CompleteMarker = {
    schemaVersion: 1,
    snapshotId,
    completedAt: formatZoned(ctx.clock.now(), ctx.config.timezone),
    analysisSha256: sha256Hex(recordText),
    logSha256: sha256Hex(log),
  };
  await createJsonExclusive(path.join(dir, COMPLETE_FILE), marker, 'complete');
  await hooks.afterCompleteMarker?.({ snapshotId });
  return marker;
}
