/**
 * Journal scenarios on fixed days (package 07 §8): init, captures, notes and journal runs happen in
 * process with an injected clock, so snapshots, notes and runs land on the intended days. Claude is
 * always the fake CLI; every step checks the repository fingerprint.
 */
import { readdir, readFile } from 'node:fs/promises';
import { expect } from 'vitest';
import { FLAG_SPECS } from '../../src/claude/args.js';
import { writeDoctorRecord } from '../../src/claude/doctor-record.js';
import { createClaudeRunner } from '../../src/claude/runner.js';
import { type CaptureRunResult, runCapture } from '../../src/cli/commands/capture.js';
import { runJournalCommand } from '../../src/cli/commands/journal.js';
import type { CliIo } from '../../src/cli/io.js';
import { takeInitialBaseline } from '../../src/collector/baseline.js';
import type { Config } from '../../src/core/config.js';
import { resolveContext, type WorkspaceContext } from '../../src/core/context.js';
import { initializeWorkspace } from '../../src/core/init.js';
import { validate } from '../../src/core/schemas.js';
import type { JournalInput, JournalRecord } from '../../src/journal/types.js';
import { addNote } from '../../src/notes/store.js';
import type { Note, NoteInput } from '../../src/notes/types.js';
import type { PipelineEnv } from './analysis.js';
import { type FakeCall, fakeClaudeEnv, mergedEnv, useFakeClaude } from './claude.js';
import { createTempRepo, type TempRepo } from './git-repo.js';
import { unchanged } from './snapshots.js';
import { createTempDataRoot, portable, readJsonFile } from './workspace.js';

export function clockAt(at: string): { now: () => Date } {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) throw new Error(`Ungültige Testzeit ${at}`);
  return { now: () => new Date(date) };
}

export interface JournalRepoOptions {
  files?: Record<string, string>;
  /** `--workspace` of `init`. */
  workspace?: string;
  claude?: Partial<Config['claude']>;
  /** Runs before `init`, for example to leave existing work uncommitted in the baseline. */
  prepare?: (repo: TempRepo) => Promise<void>;
  /**
   * Default `true`: `doctor.json` reports the fake CLI as ready, so the readiness check starts no probe
   * processes. The probe itself is covered by package 05; `false` keeps the real check.
   */
  ready?: boolean;
}

/** `doctor.json` as `ipa doctor` writes it for the fake CLI (version 9.9.9, every option recognised). */
async function markFakeClaudeReady(workspace: string): Promise<void> {
  const flags = Object.fromEntries(FLAG_SPECS.map((spec) => [spec.flag, true]));
  await writeDoctorRecord(workspace, {
    schemaVersion: 1,
    checkedAt: '2026-10-13T08:00:00+02:00',
    git: { found: true, version: '2.51.0' },
    claude: { found: true, version: '9.9.9', loggedIn: true, authMethod: 'claude.ai', flags, settingSourcesAuthOk: null },
    live: null,
    ok: true,
  });
}

/** Initialised repository whose baseline was captured at `at`; Claude is the fake CLI. */
export async function journalRepo(at: string, options: JournalRepoOptions = {}): Promise<PipelineEnv> {
  const repo = await createTempRepo({ files: options.files ?? { 'a.txt': 'eins\n' } });
  const dataDir = await createTempDataRoot();
  await options.prepare?.(repo);
  const result = await initializeWorkspace({
    repo: repo.root,
    dataDir,
    clock: clockAt(at),
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
    baseline: (ctx) => takeInitialBaseline(ctx),
  });
  const workspace = portable(result.entry.workspacePath);
  await useFakeClaude(workspace, options.claude ?? {});
  if (options.ready ?? true) await markFakeClaudeReady(workspace);
  return { repo, dataDir, workspace, ...(options.workspace === undefined ? {} : { inRepo: workspace }) };
}

export function contextAt(env: PipelineEnv, at: string): Promise<WorkspaceContext> {
  return resolveContext({ repo: env.repo.root, dataDir: env.dataDir, requireInit: true, clock: clockAt(at) });
}

/** `capture` at `at`; without `mode` the analysis queue is not processed (`--no-analysis`). */
export async function captureAt(env: PipelineEnv, at: string, mode?: string): Promise<CaptureRunResult> {
  const ctx = await contextAt(env, at);
  if (mode === undefined) return unchanged(env.repo, () => runCapture(ctx), env.inRepo);
  const fake = await fakeClaudeEnv(mode);
  const processEnv = mergedEnv(fake.env);
  return unchanged(env.repo, () => runCapture(ctx, { analysis: { runner: createClaudeRunner({ env: processEnv }), env: processEnv } }), env.inRepo);
}

/** A note recorded at `at`; its default day is the day of `at` in the configured time zone. */
export async function noteAt(env: PipelineEnv, at: string, input: Partial<NoteInput> & { text: string }): Promise<Note> {
  return addNote(await contextAt(env, at), { type: 'general', ...input });
}

export interface JournalRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  runId: string;
  modelCalls: FakeCall[];
  calls: FakeCall[];
}

export interface JournalRunOptions {
  day?: string;
  noAi?: boolean;
  /** Mode of the fake CLI, default `journal`. */
  mode?: string;
  extra?: Record<string, string | undefined>;
}

/** `ipa journal` through the command function with an injected clock at `at` (AK-07-11). */
export async function journalAt(env: PipelineEnv, at: string, options: JournalRunOptions = {}): Promise<JournalRun> {
  const ctx = await contextAt(env, at);
  const fake = await fakeClaudeEnv(options.mode ?? 'journal', options.extra ?? {});
  const processEnv = mergedEnv(fake.env);
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    env: processEnv,
  };
  const noAi = options.noAi ?? false;
  const exitCode = await unchanged(
    env.repo,
    () =>
      runJournalCommand(ctx, io, {
        day: options.day,
        noAi,
        runner: noAi ? null : createClaudeRunner({ env: processEnv }),
        env: processEnv,
      }),
    env.inRepo,
  );
  const calls = await fake.calls();
  return { exitCode, stdout, stderr, runId: ctx.runId, calls, modelCalls: calls.filter((call) => call.kind === 'model-call') };
}

export interface Draft {
  markdown: string;
  record: JournalRecord;
  mdFile: string;
}

export async function draftsOf(workspace: string): Promise<string[]> {
  return (await readdir(`${workspace}/journal/drafts`).catch(() => [] as string[])).sort();
}

/** The draft of a journal run, checked against the record schema. */
export async function draftOf(env: PipelineEnv, day: string, runId: string): Promise<Draft> {
  const base = `${env.workspace}/journal/drafts/${day}-${runId}`;
  const record = await readJsonFile<JournalRecord>(`${base}.json`);
  expect(validate('journal-record', record)).toEqual({ ok: true });
  return { markdown: await readFile(`${base}.md`, 'utf8'), record, mdFile: `${base}.md` };
}

/** `input.json` of a Claude run, checked against the input schema. */
export async function journalInputOf(env: PipelineEnv, runId: string): Promise<JournalInput> {
  const input = await readJsonFile<JournalInput>(`${env.workspace}/journal/runs/${runId}/input.json`);
  expect(validate('journal-input', input)).toEqual({ ok: true });
  return input;
}

export function inputOfCall(call: FakeCall | undefined): JournalInput {
  if (call?.stdin === undefined || call.stdin === null) throw new Error('Kein protokolliertes stdin');
  return JSON.parse(call.stdin) as JournalInput;
}
