/**
 * Effective states before and after, and `state_delta` patches (spec.md §11.4). Patches come from
 * `git diff --no-index` on two helper files in `<workspace>/tmp/`; the header is written by the tool
 * so that it names the repository path instead of the helper files.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createFileExclusive } from '../core/fs-write.js';
import { randomHex } from '../core/ids.js';
import type { PathFilter } from '../filter/path-filter.js';
import { blobsAt, readObjects, type StoredObject } from '../git/objects.js';
import { quoteGitPath } from '../git/parse-diff.js';
import type { GitRunner } from '../git/runner.js';
import type { EffectiveState, PathTransition, PlannedDelta } from './attribution.js';
import { SUBMODULE_MODE, SYMLINK_MODE } from './diffs.js';
import { effectiveKnown } from './lineage.js';
import { mapLimit, type Observation, type ObservedFile } from './observe.js';
import type { FileState, Manifest, Omission, OmitReason } from './types.js';
import { isBinaryContent } from './worktree.js';

export interface DeltaUnit {
  path: string;
  fromBlob: string | null;
  toBlob: string | null;
  content: Buffer | null;
  size: number;
  binary: boolean;
  omitted: Omission | null;
  /** Detail of a `previous_state_unavailable` gap, or null. */
  gap: string | null;
}

export interface DeltaEnv {
  git: GitRunner;
  filter: PathFilter;
  maxFileBytes: number;
  /** Folder of the previous snapshot, for its copies. */
  previousDir: string;
  /** `<workspace>/tmp`. */
  tmpDir: string;
}

const DIFF_CONCURRENCY = 4;

function isUndetermined(file: ObservedFile): boolean {
  const read = file.read;
  if (file.submodule) return file.worktreeBlob === null && file.stage !== 'clean';
  return file.worktreeBlob === null && read !== null && (read.state === 'behind_link' || read.state === 'unreadable' || read.state === 'directory');
}

/** Candidate paths with their previous and current effective state (spec.md §11.4). */
export async function resolveTransitions(env: DeltaEnv, previous: Manifest, observation: Observation): Promise<PathTransition[]> {
  const previousStates = new Map(previous.fileStates.map((state) => [state.path, state]));
  const files = new Map(observation.files.map((file) => [file.path, file]));
  const committedIn = new Map<string, string>();
  const commitPaths = new Set<string>();
  for (const commit of observation.commits) {
    for (const unit of commit.units) {
      // The source of a rename was removed by the same commit.
      for (const changed of unit.oldPath === null ? [unit.path] : [unit.path, unit.oldPath]) {
        committedIn.set(changed, commit.meta.sha);
        commitPaths.add(changed);
      }
    }
  }
  const candidates = [...new Set([...previousStates.keys(), ...files.keys(), ...commitPaths])]
    .filter((candidate) => env.filter.decide(candidate).allowed)
    .sort();

  // Paths not listed in the previous file states were clean then: their state is the previous HEAD blob.
  // Unchanged by new commits and still in HEAD, the current HEAD blob is the same and already known.
  const previousHead = previous.git.head;
  const lookupList = candidates.filter((candidate) => {
    const file = files.get(candidate);
    return !previousStates.has(candidate) && previousHead !== null && (commitPaths.has(candidate) || file === undefined || file.headBlob === null);
  });
  const lookup = new Set(lookupList);
  const headBlobs = previousHead !== null && lookupList.length > 0 ? await blobsAt(env.git, previousHead, lookupList) : new Map<string, string | null>();

  return candidates.map((candidate): PathTransition => {
    const file = files.get(candidate);
    const current: EffectiveState =
      file === undefined
        ? { blob: observation.index.get(candidate)?.blob ?? null, known: true, stage: 'clean' }
        : { blob: file.worktreeBlob, known: !isUndetermined(file), stage: file.stage };

    const state = previousStates.get(candidate);
    let before: EffectiveState;
    if (state !== undefined) {
      before = { blob: state.worktreeBlob, known: effectiveKnown(state), stage: state.stage };
    } else if (previousHead === null) {
      before = { blob: null, known: true, stage: 'clean' };
    } else if (!lookup.has(candidate)) {
      before = { blob: file!.headBlob, known: true, stage: 'clean' };
    } else {
      before = { blob: headBlobs.get(candidate) ?? null, known: true, stage: 'clean' };
    }
    return { path: candidate, previous: before, current, committedIn: committedIn.get(candidate) ?? null };
  });
}

/** Git blob ID computed in memory, for SHA-1 and SHA-256 repositories. */
export function gitBlobId(content: Uint8Array, likeId: string): string {
  return createHash(likeId.length === 64 ? 'sha256' : 'sha1')
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest('hex');
}

/**
 * Worktree bytes in the form Git stores them, so that both sides of a delta compare like with like.
 * With `core.autocrlf` the worktree has CRLF where the blob has LF; other clean filters stay as read.
 */
export function toBlobForm(content: Buffer, blob: string | null): Buffer {
  if (blob === null || gitBlobId(content, blob) === blob || !content.includes(0x0d)) return content;
  const normalized = Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return gitBlobId(normalized, blob) === blob ? normalized : content;
}

type Side =
  | { kind: 'none' }
  | { kind: 'bytes'; content: Buffer }
  | { kind: 'object'; id: string }
  | { kind: 'symlink' }
  | { kind: 'large'; binary: boolean; size: number }
  | { kind: 'unavailable'; reason: OmitReason };

function submoduleText(id: string): Side {
  return { kind: 'bytes', content: Buffer.from(`Subproject commit ${id}\n`, 'utf8') };
}

function currentSide(delta: PlannedDelta, file: ObservedFile | undefined, observation: Observation): Side {
  const blob = delta.toBlob;
  if (blob === null) return { kind: 'none' };
  const mode = observation.index.get(delta.path)?.mode;
  if (file?.submodule === true || (file === undefined && mode === SUBMODULE_MODE)) return submoduleText(blob);
  if (file?.symlink === true || (file === undefined && mode === SYMLINK_MODE)) return { kind: 'symlink' };
  const read = file?.read ?? null;
  if (read?.state === 'file') return { kind: 'bytes', content: toBlobForm(read.content, blob) };
  if (read?.state === 'symlink') return { kind: 'symlink' };
  if (read?.state === 'large') return { kind: 'large', binary: read.binary, size: read.size };
  return { kind: 'object', id: blob };
}

async function previousSide(env: DeltaEnv, delta: PlannedDelta, state: FileState | undefined, current: ObservedFile | undefined): Promise<Side> {
  const blob = delta.fromBlob;
  if (!delta.previousKnown) return { kind: 'unavailable', reason: state?.copyOmitted ?? 'unreadable' };
  if (blob === null) return { kind: 'none' };
  if (state?.symlink === true) return { kind: 'symlink' };
  if (state?.copy != null) return { kind: 'bytes', content: toBlobForm(await readFile(path.join(env.previousDir, state.copy)), blob) };
  if (state?.copyOmitted != null) return { kind: 'unavailable', reason: state.copyOmitted };
  // No copy, no omission, yet different from HEAD: only a submodule is stored like that.
  const submodule = (state !== undefined && state.worktreeBlob !== state.headBlob) || current?.submodule === true;
  if (submodule) return submoduleText(blob);
  if (current?.symlink === true) return { kind: 'symlink' };
  return { kind: 'object', id: blob };
}

function resolveObject(side: Side, objects: Map<string, StoredObject>): Side {
  if (side.kind !== 'object') return side;
  const object = objects.get(side.id);
  if (object === null || object === undefined || object.type !== 'blob') return { kind: 'unavailable', reason: 'unreadable' };
  if (object.content === null) return { kind: 'large', binary: false, size: object.size };
  return { kind: 'bytes', content: object.content };
}

const NULL_ID = (like: string | null): string => '0'.repeat(like?.length ?? 40);

/** Git-style header; Git appends a tab to `---`/`+++` names that contain a space. */
function patchHeader(file: string, fromBlob: string | null, toBlob: string | null): string {
  const a = quoteGitPath(`a/${file}`);
  const b = quoteGitPath(`b/${file}`);
  const tab = file.includes(' ') ? '\t' : '';
  const lines = [`diff --git ${a} ${b}`];
  if (fromBlob === null) lines.push('new file mode 100644');
  if (toBlob === null) lines.push('deleted file mode 100644');
  lines.push(`index ${fromBlob ?? NULL_ID(toBlob)}..${toBlob ?? NULL_ID(fromBlob)}`);
  lines.push(`--- ${fromBlob === null ? '/dev/null' : `${a}${tab}`}`);
  lines.push(`+++ ${toBlob === null ? '/dev/null' : `${b}${tab}`}`);
  return `${lines.join('\n')}\n`;
}

/** Hunks of a `git diff --no-index` output, or `binary` if Git calls the files binary. */
function hunksOf(output: Buffer): Buffer | 'binary' {
  const start = output.indexOf('\n@@ ');
  if (start >= 0) return output.subarray(start + 1);
  if (output.subarray(0, 4).toString('latin1') === '@@ ') return output;
  return output.includes('Binary files') ? 'binary' : Buffer.alloc(0);
}

async function diffFiles(env: DeltaEnv, workDir: string, index: number, from: Buffer | null, to: Buffer | null): Promise<Buffer | 'binary'> {
  const names: string[] = [];
  for (const [suffix, content] of [['a', from], ['b', to]] as const) {
    if (content === null) {
      names.push('/dev/null');
      continue;
    }
    const name = `${index}-${suffix}`;
    await createFileExclusive(path.join(workDir, name), content);
    names.push(name);
  }
  // Options pinned so that user configuration does not change the patch text (AK-03-13).
  const result = await env.git.run(
    ['diff', '--no-index', '--no-color', '--no-renames', '-U3', '--diff-algorithm=myers', '--indent-heuristic', '--', names[0]!, names[1]!],
    { cwd: workDir, okExitCodes: [0, 1] },
  );
  return hunksOf(result.stdout);
}

function omittedUnit(delta: PlannedDelta, reason: OmitReason, size: number, gap: string | null = null): DeltaUnit {
  return { path: delta.path, fromBlob: delta.fromBlob, toBlob: delta.toBlob, content: null, size, binary: reason === 'binary', omitted: { reason }, gap };
}

function gapDetail(file: string, reason: OmitReason): string {
  return `Voriger Stand von ${file} nicht verfügbar (${reason}); state_delta ohne Vorgänger.`;
}

/** Builds the patch of every planned delta; content checks follow when the manifest is built. */
export async function materializeDeltas(
  env: DeltaEnv,
  previous: Manifest,
  observation: Observation,
  deltas: readonly PlannedDelta[],
): Promise<DeltaUnit[]> {
  if (deltas.length === 0) return [];
  const previousStates = new Map(previous.fileStates.map((state) => [state.path, state]));
  const files = new Map(observation.files.map((file) => [file.path, file]));

  const sides = await Promise.all(
    deltas.map(async (delta) => {
      const file = files.get(delta.path);
      return [await previousSide(env, delta, previousStates.get(delta.path), file), currentSide(delta, file, observation)] as const;
    }),
  );
  const ids = sides.flatMap((pair) => pair.flatMap((side) => (side.kind === 'object' ? [side.id] : [])));
  const objects = await readObjects(env.git, ids, env.maxFileBytes);

  const workDir = path.join(env.tmpDir, `delta-${randomHex(8)}`);
  await mkdir(workDir, { recursive: true });
  try {
    return await mapLimit(deltas.map((delta, index) => ({ delta, index })), DIFF_CONCURRENCY, async ({ delta, index }): Promise<DeltaUnit> => {
      const before = resolveObject(sides[index]![0], objects);
      const after = resolveObject(sides[index]![1], objects);
      const afterSize = after.kind === 'bytes' ? after.content.length : after.kind === 'large' ? after.size : 0;

      if (before.kind === 'symlink' || after.kind === 'symlink') return omittedUnit(delta, 'symlink', 0);
      if (after.kind === 'large') return omittedUnit(delta, after.binary ? 'binary' : 'file_too_large', after.size);
      const beforeBinary = (before.kind === 'unavailable' && before.reason === 'binary') || (before.kind === 'bytes' && isBinaryContent(before.content));
      if (beforeBinary || (after.kind === 'bytes' && isBinaryContent(after.content))) return omittedUnit(delta, 'binary', afterSize);
      if (after.kind === 'unavailable') return omittedUnit(delta, after.reason, 0);

      const afterBytes = after.kind === 'bytes' ? after.content : null;
      let fromBlob = delta.fromBlob;
      let beforeBytes: Buffer | null = before.kind === 'bytes' ? before.content : null;
      let gap: string | null = null;
      if (before.kind === 'unavailable' || before.kind === 'large') {
        gap = gapDetail(delta.path, before.kind === 'large' ? 'file_too_large' : before.reason);
        // Without the previous content the delta shows the current state only (spec.md §11.4).
        if (afterBytes !== null) fromBlob = null;
        beforeBytes = null;
      }
      const header = patchHeader(delta.path, fromBlob, delta.toBlob);
      if (beforeBytes === null && afterBytes === null) {
        const content = Buffer.from(header, 'utf8');
        return { path: delta.path, fromBlob, toBlob: delta.toBlob, content, size: content.length, binary: false, omitted: null, gap };
      }
      const hunks = await diffFiles(env, workDir, index, beforeBytes, afterBytes);
      if (hunks === 'binary') return { ...omittedUnit(delta, 'binary', afterSize, gap), fromBlob };
      const content = Buffer.concat([Buffer.from(header, 'utf8'), hunks]);
      return { path: delta.path, fromBlob, toBlob: delta.toBlob, content, size: content.length, binary: false, omitted: null, gap };
    });
  } finally {
    await rm(workDir, { recursive: true, force: true, maxRetries: 3 });
  }
}
