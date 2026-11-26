import { randomBytes } from 'node:crypto';
import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectCheck, SystemStatus } from '../shared/project';
import type { SchemaValidator } from './cli/validator';
import type { GitRunner } from './git';
import { workspaceInsideRepository } from './reader/config-view';
import { readJson } from './reader/files';
import type { RegistryEntry } from './reader/registry';

/** Paths compare equal regardless of case, separators and a trailing slash (CLI spec §5.4). */
export function normalizePath(value: string): string {
  const resolved = path.resolve(value).split(path.sep).join('/').replace(/\/+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** The nearest folder that exists, starting at `target` and going up. */
async function nearestExisting(target: string): Promise<string | null> {
  let current = path.resolve(target);
  for (;;) {
    try {
      if ((await stat(current)).isDirectory()) return current;
    } catch {
      // not there
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Write probe for the data root (spec §4.3): one file with a random name, deleted at once. If the data root does not
 * exist yet, the nearest existing parent is probed and nothing is created.
 */
export async function probeDataRoot(dataRoot: string | null): Promise<ProjectCheck['dataRoot']> {
  if (dataRoot === null) return { path: null, writable: false, exists: false, detail: 'Es gibt keinen Ort für die Daten (LOCALAPPDATA fehlt).' };
  let exists = false;
  try {
    exists = (await stat(dataRoot)).isDirectory();
  } catch {
    exists = false;
  }
  const folder = exists ? dataRoot : await nearestExisting(dataRoot);
  if (folder === null) return { path: dataRoot, writable: false, exists, detail: 'Kein übergeordneter Ordner vorhanden.' };
  const probe = path.join(folder, `.ipa-probe-${randomBytes(6).toString('hex')}`);
  try {
    await writeFile(probe, '');
    await rm(probe, { force: true });
    return { path: dataRoot, writable: true, exists, detail: null };
  } catch (error) {
    await rm(probe, { force: true }).catch(() => undefined);
    return { path: dataRoot, writable: false, exists, detail: `Nicht beschreibbar (${(error as NodeJS.ErrnoException).code ?? 'unbekannt'}).` };
  }
}

interface DoctorFile {
  checkedAt: string;
  ok: boolean;
  git: { found: boolean; version: string | null };
  claude: { found: boolean; version: string | null; loggedIn: boolean | null; authMethod: string | null };
  live: { checkedAt: string; ok: boolean } | null;
}

/** The newest `doctor.json` over all projects (AO-08: Claude can be checked only inside a project). */
export async function newestDoctor(entries: readonly RegistryEntry[], validator: SchemaValidator): Promise<DoctorFile | null> {
  let newest: DoctorFile | null = null;
  for (const entry of entries) {
    const read = await readJson<DoctorFile>(validator, 'doctor', path.join(entry.workspacePath, 'doctor.json'));
    if (read.state === 'ok' && (newest === null || Date.parse(read.value.checkedAt) > Date.parse(newest.checkedAt))) newest = read.value;
  }
  return newest;
}

export interface CheckInput {
  repoPath: string;
  dataRoot: string | null;
  entries: readonly RegistryEntry[];
  validator: SchemaValidator;
  git: GitRunner;
}

/** The checklist of step 1 (spec §8.12). Reads only; the one write is the probe file. */
export async function checkProjectFolder(input: CheckInput): Promise<ProjectCheck> {
  const { repoPath, git } = input;
  const [version, top, branch, head, dataRoot, doctor] = await Promise.all([
    git(null, ['--version']),
    git(repoPath, ['rev-parse', '--show-toplevel']),
    git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(repoPath, ['rev-parse', 'HEAD']),
    probeDataRoot(input.dataRoot),
    newestDoctor(input.entries, input.validator),
  ]);
  const insideRepository = top.ok && top.stdout !== '';
  const isMainFolder = insideRepository && normalizePath(top.stdout) === normalizePath(repoPath);
  const existing = input.entries.find((entry) => normalizePath(entry.repoPath) === normalizePath(repoPath));
  return {
    repoPath,
    dataRoot,
    repository: {
      isMainFolder,
      insideRepository: insideRepository && !isMainFolder,
      branch: isMainFolder && branch.ok && branch.stdout !== 'HEAD' ? branch.stdout : null,
      head: isMainFolder && head.ok ? head.stdout : null,
    },
    existing: existing === undefined ? null : { repositoryId: existing.repositoryId },
    gitVersion: version.ok ? version.stdout.replace(/^git version\s*/i, '') : null,
    claude: doctor === null ? null : { ok: doctor.ok, version: doctor.claude.version, authMethod: doctor.claude.authMethod, checkedAt: doctor.checkedAt },
  };
}

export async function systemCheck(entries: readonly RegistryEntry[], validator: SchemaValidator, dataRoot: string | null): Promise<SystemStatus> {
  const doctor = await newestDoctor(entries, validator);
  return {
    check: doctor === null ? null : { checkedAt: doctor.checkedAt, ok: doctor.ok, claude: doctor.claude, git: doctor.git, liveCheck: doctor.live === null ? null : { ok: doctor.live.ok, checkedAt: doctor.live.checkedAt } },
    dataRoot,
    workspacesInRepository: entries.filter((entry) => workspaceInsideRepository(entry.repoPath, entry.workspacePath) !== null).map((entry) => entry.repositoryId),
  };
}
