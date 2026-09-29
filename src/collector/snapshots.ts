import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceContext } from '../core/context.js';
import { errnoCode, EXIT, IpaError } from '../core/errors.js';
import { ID_PATTERNS } from '../core/ids.js';
import { readJsonValidated } from '../core/json.js';
import type { Manifest } from './types.js';

export const SNAPSHOTS_FOLDER = 'snapshots';
export const MANIFEST_FILE = 'manifest.json';
export const TEMP_PREFIX = '.tmp-';

export function snapshotsDir(workspaceDir: string): string {
  return path.join(workspaceDir, SNAPSHOTS_FOLDER);
}

export function snapshotDir(workspaceDir: string, snapshotId: string): string {
  return path.join(snapshotsDir(workspaceDir), snapshotId);
}

/** Finished snapshots in ascending order; temporary folders are ignored. */
export async function listSnapshots(ctx: WorkspaceContext): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(snapshotsDir(ctx.workspaceDir), { withFileTypes: true });
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && ID_PATTERNS.snapshotId.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function readManifest(ctx: WorkspaceContext, snapshotId: string): Promise<Manifest> {
  const file = path.join(snapshotDir(ctx.workspaceDir, snapshotId), MANIFEST_FILE);
  const manifest = await readJsonValidated<Manifest>(file, 'manifest');
  if (manifest.snapshotId !== snapshotId || manifest.repositoryId !== ctx.repositoryId) {
    throw new IpaError(
      'manifest_mismatch',
      EXIT.usage,
      `Das Manifest ${file} gehört zu ${manifest.repositoryId}/${manifest.snapshotId}, erwartet wird ${ctx.repositoryId}/${snapshotId}.`,
    );
  }
  return manifest;
}
