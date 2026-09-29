/**
 * One read pass of a capture (spec.md §11.1 step 3) and its consistency check (§11.2).
 */
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { samePath } from '../core/paths.js';
import type { PathFilter } from '../filter/path-filter.js';
import { emptyTreeId, hashBlob, hashFileBlob, hashSymlinkBlob } from '../git/objects.js';
import { parseRawZ } from '../git/parse-diff.js';
import { COMMIT_LOG_FORMAT, type CommitMeta, parseCommitLogZ, parseRevList } from '../git/parse-log.js';
import { isNullObjectId, parseLsFilesStageZ, parseStatusV2Z, type StatusEntry } from '../git/parse-status.js';
import type { GitRunner } from '../git/runner.js';
import { describeDiff, type DiffUnit, SUBMODULE_MODE, SYMLINK_MODE } from './diffs.js';
import type { ChangeType, FileStage, Omission, SnapshotKind } from './types.js';
import { sameRead, sha256Hex, WorktreeReader, type WorktreeRead } from './worktree.js';

export interface ObservedCommit {
  meta: CommitMeta;
  units: DiffUnit[];
}

export interface ObservedFile {
  path: string;
  stage: FileStage;
  headBlob: string | null;
  indexBlob: string | null;
  /** Null if the file does not exist or its state could not be determined (see `read`). */
  worktreeBlob: string | null;
  symlink: boolean;
  submodule: boolean;
  /** Worktree read of this pass, or null when nothing was read (clean, deleted, submodule). */
  read: WorktreeRead | null;
}

export interface Observation {
  capturedAt: Date;
  head: string | null;
  branch: string | null;
  indexFingerprint: string;
  statusFingerprint: string;
  commits: ObservedCommit[];
  staged: DiffUnit[];
  unstaged: DiffUnit[];
  files: ObservedFile[];
  /** Paths removed by the path filter, with the matching rule. */
  excluded: Map<string, string>;
  /** Untracked nested repositories; Git reports them as folders. */
  nestedRepositories: string[];
  configuredEmail: string | null;
}

export interface ObserveEnv {
  git: GitRunner;
  filter: PathFilter;
  repoRoot: string;
  maxFileBytes: number;
  now: () => Date;
}

const READ_CONCURRENCY = 8;
const HASH_CONCURRENCY = 4;
const COMMIT_CONCURRENCY = 3;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Thrown inside a pass when the worktree changed under our feet; the capture then starts over. */
export class UnstableObservation extends Error {}

export async function readHead(git: GitRunner): Promise<string | null> {
  const result = await git.run(['rev-parse', '--verify', '-q', 'HEAD'], { okExitCodes: [0, 1] });
  return result.exitCode === 0 ? result.stdout.toString('utf8').trim() : null;
}

export async function readBranch(git: GitRunner): Promise<string | null> {
  const result = await git.run(['symbolic-ref', '-q', '--short', 'HEAD'], { okExitCodes: [0, 1] });
  return result.exitCode === 0 ? result.stdout.toString('utf8').trim() : null;
}

async function readConfiguredEmail(git: GitRunner): Promise<string | null> {
  const result = await git.run(['config', '--get', 'user.email'], { okExitCodes: [0, 1] });
  const email = result.stdout.toString('utf8').trim();
  return result.exitCode === 0 && email !== '' ? email : null;
}

interface Listings {
  head: string | null;
  branch: string | null;
  index: Buffer;
  status: Buffer;
  indexFingerprint: string;
  statusFingerprint: string;
}

async function readListings(git: GitRunner): Promise<Listings> {
  const [head, branch, index, status] = await Promise.all([
    readHead(git),
    readBranch(git),
    git.run(['ls-files', '-s', '-z']),
    // --no-renames: a staged rename appears as deletion plus addition, fileStates are per path.
    git.run(['status', '--porcelain=v2', '-z', '--untracked-files=all', '--no-renames']),
  ]);
  return {
    head,
    branch,
    index: index.stdout,
    status: status.stdout,
    indexFingerprint: sha256Hex(index.stdout),
    statusFingerprint: sha256Hex(status.stdout),
  };
}

function stageOf(entry: StatusEntry): FileStage {
  if (entry.type === 'untracked' || entry.type === 'ignored') return 'untracked';
  if (entry.type === 'unmerged') return 'mixed';
  const [x, y] = entry.xy;
  if (x !== '.' && y !== '.') return 'mixed';
  if (x !== '.') return 'staged';
  if (y !== '.') return 'unstaged';
  return 'clean';
}

function blobOrNull(id: string): string | null {
  return isNullObjectId(id) ? null : id;
}

/** Status entry of a tracked file whose worktree copy exists and holds file content. */
function worktreeExists(entry: StatusEntry): boolean {
  if (entry.type === 'untracked') return true;
  if (entry.type === 'ignored') return false;
  return entry.modes.worktree !== '000000';
}

function modesOf(entry: StatusEntry | undefined, indexMode: string | undefined): string[] {
  const modes = indexMode === undefined ? [] : [indexMode];
  if (entry === undefined || entry.type === 'untracked' || entry.type === 'ignored') return modes;
  if (entry.type === 'unmerged') return [...modes, entry.modes.stage2, entry.modes.worktree];
  return [...modes, entry.modes.head, entry.modes.index, entry.modes.worktree];
}

async function observeCommits(
  env: ObserveEnv,
  previousHead: string | null,
  head: string,
  emptyTree: string,
  allowed: (path: string) => boolean,
): Promise<ObservedCommit[]> {
  const range = previousHead === null ? [head] : [`${previousHead}..${head}`];
  const [revList, log] = await Promise.all([
    env.git.run(['rev-list', '--reverse', '--topo-order', ...range]),
    env.git.run(['log', '-z', `--format=${COMMIT_LOG_FORMAT}`, '--no-show-signature', '--encoding=UTF-8', '--reverse', '--topo-order', ...range]),
  ]);
  const metas = new Map(parseCommitLogZ(log.stdout).map((meta) => [meta.sha, meta]));

  return mapLimit(parseRevList(revList.stdout), COMMIT_CONCURRENCY, async (sha) => {
    const meta = metas.get(sha);
    if (meta === undefined) throw new Error(`git log lieferte keine Angaben zu Commit ${sha}`);
    // `show` instead of `diff`: files of a workspace inside the repository must still reach filterDecisions.
    const listing = await env.git.run([
      'show',
      '--raw',
      '-z',
      '--no-abbrev',
      '--no-renames',
      '--format=',
      '--diff-merges=first-parent',
      '--root',
      '--no-show-signature',
      sha,
    ]);
    const paths = [...new Set(parseRawZ(listing.stdout).map((entry) => entry.path))].filter(allowed);
    const base = meta.parents[0] ?? emptyTree;
    return { meta, units: await describeDiff(env.git, [base, sha], paths, { renames: true }) };
  });
}

/** Commit checked out in a submodule; null if the submodule has no repository of its own. */
async function submoduleHead(env: ObserveEnv, relativePath: string): Promise<string | null> {
  const dir = path.join(env.repoRoot, relativePath);
  try {
    await lstat(path.join(dir, '.git'));
  } catch {
    return null;
  }
  const result = await env.git.run(['rev-parse', '--show-toplevel', 'HEAD'], { cwd: dir, okExitCodes: [0, 1, 128] });
  const [top, sha] = result.stdout.toString('utf8').split(/\r?\n/);
  if (result.exitCode !== 0 || top === undefined || sha === undefined) return null;
  // Guards against Git answering for the superproject.
  return samePath(await realpath(top), await realpath(dir)) ? sha.trim() : null;
}

function unstagedChange(letter: string): ChangeType | null {
  return letter === 'M' || letter === 'D' || letter === 'T' || letter === 'A' ? letter : null;
}

/** Reason for not reading a worktree path, or null if its content may be read. */
export function unreadableReason(read: WorktreeRead | null): Omission | null {
  if (read === null) return null;
  if (read.state === 'behind_link') return { reason: 'symlink' };
  if (read.state === 'unreadable' || read.state === 'directory') return { reason: 'unreadable' };
  return null;
}

async function worktreeBlobOf(
  env: ObserveEnv,
  file: string,
  entry: StatusEntry,
  indexBlob: string | null,
  read: WorktreeRead | null,
  flags: { symlink: boolean; submodule: boolean },
): Promise<string | null> {
  if (flags.submodule) {
    const commitChanged = entry.type === 'ordinary' && entry.sub[1] === 'C';
    return commitChanged ? submoduleHead(env, file) : indexBlob;
  }
  if (read?.state === 'symlink') return hashSymlinkBlob(env.git, read.target);
  // With core.symlinks=false a link is checked out as a plain file holding the target.
  if (read?.state === 'file') return flags.symlink ? hashSymlinkBlob(env.git, read.content) : hashBlob(env.git, read.content, file);
  if (read?.state === 'large') return hashFileBlob(env.git, file, path.join(env.repoRoot, file));
  return null;
}

async function describeFile(
  env: ObserveEnv,
  file: string,
  entry: StatusEntry | undefined,
  indexEntry: { mode: string; blob: string } | undefined,
  read: WorktreeRead | null,
): Promise<ObservedFile> {
  const modes = modesOf(entry, indexEntry?.mode);
  const submodule = modes.includes(SUBMODULE_MODE);
  const indexBlob = indexEntry?.blob ?? null;
  if (entry === undefined) {
    // Changed by a new commit and clean now: worktree, index and HEAD agree.
    return { path: file, stage: 'clean', headBlob: indexBlob, indexBlob, worktreeBlob: indexBlob, symlink: modes.includes(SYMLINK_MODE), submodule, read: null };
  }
  let headBlob: string | null = null;
  if (entry.type === 'ordinary' || entry.type === 'renamed') headBlob = blobOrNull(entry.blobs.head);
  else if (entry.type === 'unmerged') headBlob = blobOrNull(entry.blobs.stage2);
  const symlink = modes.includes(SYMLINK_MODE) || read?.state === 'symlink' || read?.state === 'behind_link';
  const worktreeBlob = await worktreeBlobOf(env, file, entry, indexBlob, read, { symlink, submodule });
  return { path: file, stage: stageOf(entry), headBlob, indexBlob, worktreeBlob, symlink, submodule, read };
}

/**
 * First read pass (spec.md §11.1 step 3). Worktree contents are read before Git diffs the worktree,
 * so that a change in between is caught by the consistency check.
 */
export async function observe(env: ObserveEnv, kind: SnapshotKind, previousHead: string | null): Promise<Observation> {
  const capturedAt = env.now();
  const [listings, emptyTree] = await Promise.all([readListings(env.git), emptyTreeId(env.git)]);
  const { head } = listings;

  const excluded = new Map<string, string>();
  const allowed = (candidate: string): boolean => {
    const decision = env.filter.decide(candidate);
    if (decision.allowed) return true;
    if (!excluded.has(candidate)) excluded.set(candidate, decision.rule);
    return false;
  };

  const index = new Map<string, { mode: string; blob: string }>();
  for (const entry of parseLsFilesStageZ(listings.index)) {
    if (entry.stage === 0) index.set(entry.path, { mode: entry.mode, blob: entry.blob });
  }

  const status = new Map<string, StatusEntry>();
  const nestedRepositories: string[] = [];
  for (const entry of parseStatusV2Z(listings.status)) {
    if (entry.type === 'ignored') continue;
    if (entry.type === 'untracked' && entry.path.endsWith('/')) {
      if (allowed(entry.path.slice(0, -1))) nestedRepositories.push(entry.path);
      continue;
    }
    if (allowed(entry.path)) status.set(entry.path, entry);
  }

  const reader = new WorktreeReader(env.repoRoot, env.maxFileBytes);
  const toRead = [...status.values()].filter((entry) => worktreeExists(entry) && !modesOf(entry, undefined).includes(SUBMODULE_MODE));
  const stagedPaths = [...status.values()].filter((entry) => entry.type === 'ordinary' && entry.xy[0] !== '.').map((entry) => entry.path);

  // Commits and the index are not affected by worktree changes and run alongside the reads.
  const [commits, staged, readResults] = await Promise.all([
    kind === 'work' && head !== null ? observeCommits(env, previousHead, head, emptyTree, allowed) : Promise.resolve([]),
    describeDiff(env.git, ['--cached', head ?? emptyTree], stagedPaths, { renames: true }),
    mapLimit(toRead, READ_CONCURRENCY, async (entry) => [entry.path, await reader.read(entry.path)] as const),
  ]);
  const reads = new Map(readResults);
  for (const read of reads.values()) {
    if (read.state === 'missing') throw new UnstableObservation('Datei zwischen Status und Lesen verschwunden');
  }

  // Paths behind links and unreadable ones never reach Git's worktree diff, which would read them.
  const unstagedEntries = [...status.values()].filter((entry) => entry.type === 'ordinary' && entry.xy[1] !== '.');
  const blocked = new Set(unstagedEntries.filter((entry) => unreadableReason(reads.get(entry.path) ?? null) !== null));

  const commitPaths = new Set<string>();
  for (const commit of commits) {
    for (const unit of commit.units) {
      commitPaths.add(unit.path);
      if (unit.oldPath !== null) commitPaths.add(unit.oldPath);
    }
  }
  const filePaths = [...new Set([...status.keys(), ...commitPaths])];

  const [unstaged, files, configuredEmail] = await Promise.all([
    describeDiff(env.git, [], unstagedEntries.filter((entry) => !blocked.has(entry)).map((entry) => entry.path), { renames: false }),
    mapLimit(filePaths, HASH_CONCURRENCY, (file) => describeFile(env, file, status.get(file), index.get(file), reads.get(file) ?? null)),
    commits.length > 0 ? readConfiguredEmail(env.git) : Promise.resolve(null),
  ]);
  for (const entry of blocked) {
    const change = entry.type === 'ordinary' ? unstagedChange(entry.xy[1] ?? '') : null;
    if (change === null) continue;
    unstaged.push({ path: entry.path, oldPath: null, change, dstBlob: null, binary: false, content: null, omitted: unreadableReason(reads.get(entry.path) ?? null) });
  }

  return {
    capturedAt,
    head,
    branch: listings.branch,
    indexFingerprint: listings.indexFingerprint,
    statusFingerprint: listings.statusFingerprint,
    commits,
    staged,
    unstaged,
    files,
    excluded,
    nestedRepositories,
    configuredEmail,
  };
}

/** Second pass of spec.md §11.2: HEAD, branch, both fingerprints and every content read must be unchanged. */
export async function isConsistent(env: ObserveEnv, observation: Observation): Promise<boolean> {
  const reader = new WorktreeReader(env.repoRoot, env.maxFileBytes);
  const reread = observation.files.filter((file) => file.read !== null);
  const [listings, same] = await Promise.all([
    readListings(env.git),
    mapLimit(reread, READ_CONCURRENCY, async (file) => sameRead(file.read!, await reader.read(file.path))),
  ]);
  return (
    listings.head === observation.head &&
    listings.branch === observation.branch &&
    listings.indexFingerprint === observation.indexFingerprint &&
    listings.statusFingerprint === observation.statusFingerprint &&
    same.every(Boolean)
  );
}
