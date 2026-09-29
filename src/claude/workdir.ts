/**
 * Claude working directory (D-22, I-14, spec.md §13.1): a new folder below
 * `<os.tmpdir()>/ipa-assistant/claude/<repositoryId>/<runId>-<n>/` that contains only `prompt.md` and is
 * deleted after the call. The artefacts are stored by the caller in the workspace.
 */
import { lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WorkspaceContext } from '../core/context.js';
import { describeFsError } from '../core/data-root.js';
import { errnoCode, EXIT, IpaError } from '../core/errors.js';
import { createFileExclusive } from '../core/fs-write.js';
import { canonicalizePath, isSameOrInside, toPortablePath } from '../core/paths.js';

export const PROMPT_FILE_NAME = 'prompt.md';
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** Only folders named like `<runId>-<n>` are ever removed as orphans. */
const CALL_DIR = /^R[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}-[0-9]+$/;

// runId is unique per process, so a counter per process gives unique folder names.
let lastCallNumber = 0;

export interface ClaudeWorkdir {
  /** Absolute native path. */
  dir: string;
  promptFile: string;
  /** Never throws; a folder that cannot be removed now is an orphan for a later run. */
  remove(): Promise<void>;
}

/** `<os.tmpdir()>/ipa-assistant/claude/<repositoryId>`, canonical with `/`. */
export async function claudeTempBase(repositoryId: string): Promise<string> {
  return canonicalizePath(path.join(os.tmpdir(), 'ipa-assistant', 'claude', repositoryId));
}

function assertOutsideRepositoryAndWorkspace(ctx: WorkspaceContext, candidate: string): void {
  const places: [string, string][] = [
    ['im Repository', ctx.repoRoot],
    ['im Arbeitsbereich', ctx.workspaceDir],
  ];
  for (const [where, dir] of places) {
    // Also the other way round: orphan cleanup must never reach the repository or the workspace.
    if (isSameOrInside(candidate, dir) || isSameOrInside(dir, candidate)) {
      throw new IpaError(
        'claude_workdir_invalid',
        EXIT.usage,
        `Das Claude-Arbeitsverzeichnis ${candidate} läge ${where} (${dir}) oder umfasste es. Es muss ausserhalb von ` +
          'Repository und Arbeitsbereich liegen (I-14). Es folgt aus dem Temp-Verzeichnis (TEMP oder TMP unter Windows, ' +
          'sonst TMPDIR); bitte dieses auf einen Ordner ausserhalb zeigen lassen. Claude wurde nicht gestartet.',
      );
    }
  }
}

async function removeOrphans(base: string, now: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return;
  }
  for (const name of names.filter((candidate) => CALL_DIR.test(candidate))) {
    const dir = path.join(base, name);
    try {
      const info = await lstat(dir);
      if (info.isDirectory() && now - info.mtimeMs > ORPHAN_AGE_MS) {
        await rm(dir, { recursive: true, force: true, maxRetries: 3 });
      }
    } catch {
      // Still in use or already gone; a later run tries again.
    }
  }
}

/**
 * Creates the folder and writes `prompt.md`. If the folder would lie in the repository or in the
 * workspace, an `IpaError` with exit code 2 is raised before anything is created (spec.md §13.1).
 */
export async function createClaudeWorkdir(ctx: WorkspaceContext, promptText: string): Promise<ClaudeWorkdir> {
  const base = await claudeTempBase(ctx.repositoryId);
  assertOutsideRepositoryAndWorkspace(ctx, base);
  let realBase: string;
  try {
    await mkdir(base, { recursive: true });
    realBase = toPortablePath(await realpath(base));
  } catch (error) {
    throw new IpaError(
      'claude_workdir_unavailable',
      EXIT.usage,
      `Das Claude-Arbeitsverzeichnis ${base} lässt sich nicht anlegen (${describeFsError(error)}). Bitte das Temp-Verzeichnis prüfen.`,
      { cause: error },
    );
  }
  // Checked again after creation, in case a link on the way leads elsewhere.
  assertOutsideRepositoryAndWorkspace(ctx, realBase);
  // Age of files on disk, not a business timestamp.
  await removeOrphans(realBase, Date.now());

  for (;;) {
    lastCallNumber += 1;
    const dir = path.resolve(realBase, `${ctx.runId}-${lastCallNumber}`);
    try {
      await mkdir(dir);
    } catch (error) {
      if (errnoCode(error) === 'EEXIST') continue;
      throw error;
    }
    const promptFile = path.join(dir, PROMPT_FILE_NAME);
    const remove = async (): Promise<void> => {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    };
    try {
      await createFileExclusive(promptFile, promptText);
    } catch (error) {
      await remove();
      throw error;
    }
    return { dir, promptFile, remove };
  }
}
