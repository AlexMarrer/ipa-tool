/**
 * Documented and baseline blobs of the current attribution sequence (spec.md §11.4). The search runs
 * backwards from the previous snapshot up to and including the last baseline snapshot; the index is
 * built per run and never stored.
 */
import type { FileState, Manifest } from './types.js';

export interface Lineage {
  /** Qualified `state_delta` references whose `toBlob` is `blob`, oldest first. */
  documented(path: string, blob: string | null): string[];
  /** The blob is an effective state or HEAD blob of a file captured in the last baseline snapshot. */
  isBaseline(path: string, blob: string | null): boolean;
}

// `worktreeBlob: null` together with these reasons means "not determined", not "deleted" (spec.md §9.3).
const UNDETERMINED = new Set(['symlink', 'unreadable']);

export function effectiveKnown(state: FileState): boolean {
  return !(state.worktreeBlob === null && state.copyOmitted !== null && UNDETERMINED.has(state.copyOmitted));
}

function pathKey(path: string, blob: string | null): string {
  return `${path}\0${blob ?? ''}`;
}

class LineageIndex implements Lineage {
  private readonly byPath = new Map<string, string[]>();
  private readonly byBlob = new Map<string, string[]>();
  private readonly baselinePaths = new Set<string>();
  private readonly baselineBlobs = new Set<string>();

  addDelta(ref: string, path: string | null, toBlob: string | null): void {
    if (path !== null) this.byPath.set(pathKey(path, toBlob), [...(this.byPath.get(pathKey(path, toBlob)) ?? []), ref]);
    if (toBlob !== null) this.byBlob.set(toBlob, [...(this.byBlob.get(toBlob) ?? []), ref]);
  }

  addBaseline(state: FileState): void {
    // A missing HEAD blob only means "not committed yet" and documents no deletion.
    const blobs = [...(effectiveKnown(state) ? [state.worktreeBlob] : []), ...(state.headBlob === null ? [] : [state.headBlob])];
    for (const blob of blobs) {
      this.baselinePaths.add(pathKey(state.path, blob));
      if (blob !== null) this.baselineBlobs.add(blob);
    }
  }

  // A deletion (blob null) only matches on the same path; content matches on any path, same path first.
  documented(path: string, blob: string | null): string[] {
    const samePath = this.byPath.get(pathKey(path, blob));
    if (samePath !== undefined) return [...samePath];
    return blob === null ? [] : [...(this.byBlob.get(blob) ?? [])];
  }

  isBaseline(path: string, blob: string | null): boolean {
    return this.baselinePaths.has(pathKey(path, blob)) || (blob !== null && this.baselineBlobs.has(blob));
  }
}

/**
 * Builds the index from manifests given newest first, starting with the previous snapshot. Manifests
 * after the first baseline in the list are ignored.
 */
export function buildLineage(newestFirst: readonly Manifest[]): Lineage {
  const index = new LineageIndex();
  const chain: Manifest[] = [];
  for (const manifest of newestFirst) {
    chain.push(manifest);
    if (manifest.kind === 'baseline') break;
  }
  for (const manifest of chain.reverse()) {
    if (manifest.kind === 'baseline') {
      for (const state of manifest.fileStates) index.addBaseline(state);
      continue;
    }
    for (const entry of manifest.evidence) {
      if (entry.kind === 'state_delta') index.addDelta(`${manifest.snapshotId}:${entry.id}`, entry.path, entry.toBlob);
    }
  }
  return index;
}

/** Reads the sequence backwards from `previous` until the last baseline snapshot. */
export async function loadLineage(previous: Manifest, read: (snapshotId: string) => Promise<Manifest>): Promise<Lineage> {
  const chain: Manifest[] = [previous];
  let current = previous;
  while (current.kind !== 'baseline' && current.previousSnapshotId !== null) {
    current = await read(current.previousSnapshotId);
    chain.push(current);
  }
  return buildLineage(chain);
}
