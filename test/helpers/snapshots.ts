/**
 * Access to snapshots written by the CLI under test.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect } from 'vitest';
import type { Evidence, Manifest } from '../../src/collector/types.js';
import type { Config } from '../../src/core/config.js';
import type { Registry } from '../../src/core/registry.js';
import { validate } from '../../src/core/schemas.js';
import type { TempRepo } from './git-repo.js';
import { expectRepoUnchanged, fingerprintRepo } from './repo-fingerprint.js';
import { type CliResult, readJsonFile, runCli } from './workspace.js';

const execFileAsync = promisify(execFile);

/** Raw stdout of a Git call in a test repository. */
export async function gitOutput(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'buffer', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export async function setLimits(workspace: string, limits: Partial<Config['limits']>): Promise<void> {
  const config = await readJsonFile<Config>(`${workspace}/config.json`);
  await writeFile(`${workspace}/config.json`, JSON.stringify({ ...config, limits: { ...config.limits, ...limits } }, null, 2));
}

/** Runs a tool action and checks the repository fingerprint around it (AK-02-11). */
export async function unchanged<T>(repo: TempRepo, action: () => Promise<T>, workspace?: string): Promise<T> {
  const options = workspace === undefined ? {} : { workspace };
  const before = await fingerprintRepo(repo.root, options);
  const result = await action();
  expectRepoUnchanged(before, await fingerprintRepo(repo.root, options));
  return result;
}

export async function workspaceOf(dataDir: string, repoRoot: string): Promise<string> {
  const registry = await readJsonFile<Registry>(`${dataDir}/registry.json`);
  const entry = registry.repositories.find((candidate) => candidate.repoPath === repoRoot);
  if (entry === undefined) throw new Error(`Kein Registry-Eintrag für ${repoRoot}`);
  return entry.workspacePath;
}

/** `ipa init` that must succeed; returns the workspace path. */
export async function initRepo(repo: TempRepo, dataDir: string, args: string[] = []): Promise<string> {
  const result = await runCli(['init', ...args], { dataDir, repo: repo.root });
  expect(result.exitCode, result.stderr).toBe(0);
  return workspaceOf(dataDir, repo.root);
}

/** `ipa capture` that must succeed. */
export async function captureRepo(repo: TempRepo, dataDir: string): Promise<CliResult> {
  const result = await runCli(['capture', '--no-analysis'], { dataDir, repo: repo.root });
  expect(result.exitCode, result.stderr).toBe(0);
  return result;
}

/** Reads a manifest and checks it against the schema. */
export async function readManifestFile(workspace: string, snapshotId: string): Promise<Manifest> {
  const manifest = await readJsonFile<Manifest>(`${workspace}/snapshots/${snapshotId}/manifest.json`);
  expect(validate('manifest', manifest)).toEqual({ ok: true });
  return manifest;
}

export async function snapshotText(workspace: string, snapshotId: string, file: string | null): Promise<string> {
  if (file === null) throw new Error('Einheit ohne Datei');
  return readFile(`${workspace}/snapshots/${snapshotId}/${file}`, 'utf8');
}

export function evidenceFor(manifest: Manifest, kind: Evidence['kind'], path: string | null): Evidence {
  const found = manifest.evidence.find((entry) => entry.kind === kind && entry.path === path);
  if (found === undefined) throw new Error(`Kein Beleg ${kind} für ${String(path)} in ${manifest.snapshotId}`);
  return found;
}

export function stagesOf(manifest: Manifest): Record<string, string> {
  return Object.fromEntries(manifest.fileStates.map((state) => [state.path, state.stage]));
}
