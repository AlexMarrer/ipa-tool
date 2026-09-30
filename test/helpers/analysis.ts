/**
 * Integration tests of the analysis pipeline (package 06) with the fake Claude CLI.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from 'vitest';
import type { AnalysisInput, AnalysisRecord, AttemptOutcomeRecord } from '../../src/analysis/types.js';
import type { Config } from '../../src/core/config.js';
import { readJsonl } from '../../src/core/jsonl.js';
import type { RunRecord } from '../../src/core/run-log.js';
import { validate } from '../../src/core/schemas.js';
import type { State } from '../../src/core/state.js';
import { type FakeCall, fakeClaudeEnv, useFakeClaude } from './claude.js';
import { createTempRepo, type TempRepo } from './git-repo.js';
import { initRepo, unchanged } from './snapshots.js';
import { type CliResult, createTempDataRoot, readJsonFile, runCli, TOOL_ROOT } from './workspace.js';

export interface PipelineEnv {
  repo: TempRepo;
  dataDir: string;
  workspace: string;
  /** Set if the workspace lies inside the repository; the fingerprint then leaves it out. */
  inRepo?: string;
}

export interface PipelineOptions {
  files?: Record<string, string>;
  /** Extra arguments of `ipa init`, for example `['--workspace', '.ipa']`. */
  init?: string[];
  claude?: Partial<Config['claude']>;
}

/** Initialised repository whose workspace calls the fake CLI. */
export async function pipelineRepo(options: PipelineOptions = {}): Promise<PipelineEnv> {
  const repo = await createTempRepo({ files: options.files ?? { 'a.txt': 'eins\n' } });
  const dataDir = await createTempDataRoot();
  const workspace = await initRepo(repo, dataDir, options.init ?? []);
  await useFakeClaude(workspace, options.claude ?? {});
  return { repo, dataDir, workspace, ...(options.init?.includes('--workspace') ? { inRepo: workspace } : {}) };
}

export interface IpaRun {
  result: CliResult;
  /** Every process start of the fake CLI, including version, login and option probes. */
  calls: FakeCall[];
  modelCalls: FakeCall[];
}

/** `ipa <args>` with the fake CLI in `mode`; the repository fingerprint must stay unchanged (AK-06-18). */
export async function ipa(env: PipelineEnv, args: string[], mode = 'analysis', extra: Record<string, string | undefined> = {}): Promise<IpaRun> {
  const fake = await fakeClaudeEnv(mode, extra);
  const result = await unchanged(env.repo, () => runCli(args, { dataDir: env.dataDir, repo: env.repo.root, env: fake.env }), env.inRepo);
  const calls = await fake.calls();
  return { result, calls, modelCalls: calls.filter((call) => call.kind === 'model-call') };
}

/** `ipa capture` without analysis, which must store a snapshot or find nothing new. */
export async function captureOnly(env: PipelineEnv): Promise<CliResult> {
  const { result } = await ipa(env, ['capture', '--no-analysis']);
  expect(result.exitCode, result.stderr).toBe(0);
  return result;
}

export function inputOf(call: FakeCall | undefined): AnalysisInput {
  if (call?.stdin === undefined || call.stdin === null) throw new Error('Kein protokolliertes stdin');
  return JSON.parse(call.stdin) as AnalysisInput;
}

export async function stateOf(workspace: string): Promise<State> {
  return readJsonFile<State>(`${workspace}/state.json`);
}

export async function runsOf(workspace: string): Promise<RunRecord[]> {
  const { records, invalid } = await readJsonl<RunRecord>(`${workspace}/runs.jsonl`, 'run-record');
  expect(invalid).toEqual([]);
  return records;
}

export async function lastRunOf(workspace: string): Promise<RunRecord> {
  return (await runsOf(workspace)).at(-1)!;
}

export async function recordOf(workspace: string, snapshotId: string): Promise<AnalysisRecord> {
  const record = await readJsonFile<AnalysisRecord>(`${workspace}/analyses/${snapshotId}/analysis.json`);
  expect(validate('analysis-record', record)).toEqual({ ok: true });
  return record;
}

export async function outcomeOf(workspace: string, snapshotId: string, attempt: number): Promise<AttemptOutcomeRecord> {
  const outcome = await readJsonFile<AttemptOutcomeRecord>(`${workspace}/analyses/${snapshotId}/attempt-${attempt}/outcome.json`);
  expect(validate('attempt-outcome', outcome)).toEqual({ ok: true });
  return outcome;
}

export async function namesIn(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).sort();
}

export async function statusOf(env: PipelineEnv): Promise<Record<string, unknown>> {
  const status = await runCli(['status', '--json'], { dataDir: env.dataDir, repo: env.repo.root });
  expect(status.exitCode, status.stderr).toBe(0);
  return JSON.parse(status.stdout) as Record<string, unknown>;
}

/** All files below every `attempt-*` folder of the workspace. */
export async function attemptFiles(workspace: string): Promise<string[]> {
  const files: string[] = [];
  for (const snapshotId of await namesIn(`${workspace}/analyses`)) {
    for (const attempt of (await namesIn(`${workspace}/analyses/${snapshotId}`)).filter((name) => name.startsWith('attempt-'))) {
      for (const file of await namesIn(`${workspace}/analyses/${snapshotId}/${attempt}`)) {
        files.push(`${workspace}/analyses/${snapshotId}/${attempt}/${file}`);
      }
    }
  }
  return files;
}

export async function filesWith(files: readonly string[], needle: string): Promise<string[]> {
  const hits: string[] = [];
  for (const file of files) if ((await readFile(file)).includes(Buffer.from(needle, 'utf8'))) hits.push(file);
  return hits;
}

/** Holds the lock of a workspace in a separate process until `stopLockHolder`. */
export function startLockHolder(workspace: string): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, [path.join(TOOL_ROOT, 'test', 'helpers', 'lock-holder.mjs'), workspace], { stdio: ['pipe', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.includes('LOCKED')) resolve(child);
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Lock-Halter beendet (${String(code)})`)));
  });
}

export async function stopLockHolder(child: ChildProcessWithoutNullStreams): Promise<void> {
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.stdin.end();
  await exited;
}
