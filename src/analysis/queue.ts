/**
 * Analysis queue (spec.md §12.2–§12.4): processes snapshots in ascending order from the cursor, stops at
 * the first one that stays open and moves the cursor only after `complete.json` (I-03).
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureClaudeReady } from '../claude/doctor.js';
import type { AttemptOutcome, ClaudeErrorCode, ClaudeResult, ClaudeRunner, ValidationErrorCode } from '../claude/types.js';
import { outcomeForErrorCode } from '../claude/usage.js';
import { readManifest } from '../collector/snapshots.js';
import type { Manifest } from '../collector/types.js';
import type { WorkspaceContext } from '../core/context.js';
import { errnoCode, EXIT, IpaError } from '../core/errors.js';
import { createFileExclusive } from '../core/fs-write.js';
import { createJsonExclusive } from '../core/json.js';
import { loadSchema } from '../core/schemas.js';
import { formatZoned } from '../core/time.js';
import { TOOL_ROOT } from '../core/tool.js';
import { syncCursor, writeCursor } from './cursor.js';
import { analysisDir, attemptDir, OUTCOME_FILE } from './files.js';
import { buildInputFromManifest, serializeInput, sha256Hex } from './input.js';
import { aiRecord, deterministicRecord } from './record.js';
import { analysisDetails, analysisStatus, type StatusDetails } from './status.js';
import { storeCompletion } from './store.js';
import {
  type AnalysisInput,
  type AttemptOutcomeRecord,
  isDone,
  isOpen,
  OUTPUT_SCHEMA_VERSION,
  PROMPT_FILE,
  PROMPT_VERSION,
  type QueueHooks,
  type QueueResult,
} from './types.js';
import { validateAnalysisOutput } from './validate.js';

export const PROMPT_PATH = path.join(TOOL_ROOT, 'prompts', PROMPT_FILE);

const MAX_OUTCOME_MESSAGE = 2000;

export interface QueueOptions {
  /** No Claude call starts at or after this time (spec.md §12.2). */
  deadline: Date;
  hooks?: QueueHooks;
  /** Environment for the readiness check before the first Claude call; default `process.env`. */
  env?: NodeJS.ProcessEnv;
}

interface Run {
  ctx: WorkspaceContext;
  runner: ClaudeRunner;
  opts: QueueOptions;
  result: QueueResult;
  /** `ensureClaudeReady` passed in this run. */
  ready: boolean;
}

function now(ctx: WorkspaceContext): string {
  return formatZoned(ctx.clock.now(), ctx.config.timezone);
}

function deadlineReached(run: Run): boolean {
  return run.ctx.clock.now().getTime() >= run.opts.deadline.getTime();
}

function limitMessage(text: string): string {
  return text.length > MAX_OUTCOME_MESSAGE ? `${text.slice(0, MAX_OUTCOME_MESSAGE)} …` : text;
}

function exhaustedMessage(ctx: WorkspaceContext, snapshotId: string): string {
  return (
    `Die Analyse ist nach ${ctx.config.claude.maxAttemptsPerSnapshot} fehlgeschlagenen Versuchen erschöpft; ` +
    `kein weiterer Aufruf bis ipa capture --retry ${snapshotId} oder ipa skip ${snapshotId} --reason "<Grund>".`
  );
}

interface AttemptWriter {
  dir: string;
  number: number;
  startedAt: string;
  finish(outcome: AttemptOutcome, errorCode: ClaudeErrorCode | ValidationErrorCode | null, message: string | null): Promise<void>;
}

/** Creates `attempt-<n>/` exclusively; it holds the artefacts, not the Claude working directory (D-22). */
async function openAttempt(run: Run, snapshotId: string, number: number): Promise<AttemptWriter> {
  const { ctx } = run;
  await mkdir(analysisDir(ctx.workspaceDir, snapshotId), { recursive: true });
  const dir = attemptDir(ctx.workspaceDir, snapshotId, number);
  await mkdir(dir);
  const startedAt = now(ctx);
  return {
    dir,
    number,
    startedAt,
    async finish(outcome, errorCode, message) {
      const record: AttemptOutcomeRecord = {
        schemaVersion: 1,
        snapshotId,
        runId: ctx.runId,
        attempt: number,
        startedAt,
        endedAt: now(ctx),
        outcome,
        errorCode,
        message: message === null ? null : limitMessage(message),
      };
      await createJsonExclusive(path.join(dir, OUTCOME_FILE), record, 'attempt-outcome');
    },
  };
}

/** Deterministic `analysis.json` and log without Claude (D-08). */
async function completeWithoutClaude(run: Run, snapshotId: string): Promise<boolean> {
  const { ctx } = run;
  const manifest = await readManifest(ctx, snapshotId);
  try {
    await storeCompletion(ctx, deterministicRecord(manifest, now(ctx)), manifest, run.opts.hooks);
  } catch (error) {
    if (error instanceof IpaError || errnoCode(error) === undefined) throw error;
    run.result.failed.push({ snapshotId, code: 'analysis_store_failed', message: `Ablage fehlgeschlagen (${errnoCode(error)}).` });
    return false;
  }
  run.result.completed.push({ snapshotId, mode: 'deterministic' });
  return true;
}

async function callAndStore(run: Run, manifest: Manifest, details: StatusDetails, input: AnalysisInput, inputText: string): Promise<boolean> {
  const { ctx, result } = run;
  const { snapshotId } = manifest;
  const attempt = await openAttempt(run, snapshotId, details.nextAttempt);
  const schema = loadSchema('analysis-output');
  const promptFile = path.join(attempt.dir, 'prompt.md');
  await createFileExclusive(path.join(attempt.dir, 'input.json'), inputText);
  await createFileExclusive(promptFile, await readFile(PROMPT_PATH, 'utf8'));
  await createFileExclusive(path.join(attempt.dir, 'schema.json'), `${JSON.stringify(schema, null, 2)}\n`);

  result.claudeCalls += 1;
  let answer: ClaudeResult;
  try {
    answer = await run.runner.run(ctx, {
      purpose: 'analysis',
      subjectId: snapshotId,
      promptFile,
      outputSchema: schema,
      stdin: inputText,
      promptVersion: PROMPT_VERSION,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      inputIds: input.allowedEvidenceIds,
    });
  } catch (error) {
    const code = error instanceof IpaError ? error.code : (errnoCode(error) ?? 'intern');
    await attempt.finish('interrupted', null, `Abbruch vor der Auswertung der Antwort (${code}).`).catch(() => undefined);
    throw error;
  }
  // The raw answer is kept in every case (spec.md §13.3).
  await createFileExclusive(path.join(attempt.dir, 'response.json'), answer.meta.rawStdout);
  await createFileExclusive(path.join(attempt.dir, 'stderr.txt'), answer.meta.rawStderr);

  if (!answer.ok) {
    await attempt.finish(outcomeForErrorCode(answer.errorCode), answer.errorCode, answer.message);
    result.failed.push({ snapshotId, code: answer.errorCode, message: answer.message });
    return false;
  }
  const check = validateAnalysisOutput(input, answer.structuredOutput);
  if (!check.ok) {
    const message = `Antwort abgelehnt (${check.errorCode}): ${check.errors.slice(0, 10).join('; ')}`;
    await attempt.finish('validation_failed', check.errorCode, message);
    result.failed.push({ snapshotId, code: check.errorCode, message: limitMessage(message) });
    return false;
  }

  const record = aiRecord({
    manifest,
    input,
    output: check.value,
    attempt: attempt.number,
    analysedAt: now(ctx),
    meta: answer.meta,
    inputSha256: sha256Hex(inputText),
  });
  try {
    await storeCompletion(ctx, record, manifest, run.opts.hooks);
  } catch (error) {
    // Only I/O failures such as a full disk; programming errors and aborts stay errors (spec.md §12.5).
    if (error instanceof IpaError || errnoCode(error) === undefined) throw error;
    const message = `Ablage der Analyse fehlgeschlagen (${errnoCode(error)}). Der Snapshot bleibt offen.`;
    await attempt.finish('interrupted', null, message);
    result.failed.push({ snapshotId, code: 'analysis_store_failed', message });
    return false;
  }
  // Written last, so that `success` always comes with `complete.json` (spec.md §18).
  await attempt.finish('success', null, null);
  result.completed.push({ snapshotId, mode: 'ai' });
  return true;
}

/**
 * `pending`, `failed` or `blocked`: builds the package and, if possible, makes one attempt. `deadline`
 * means that the run limit passed before the call and the snapshot stays as it was.
 */
async function analyse(run: Run, snapshotId: string, details: StatusDetails): Promise<boolean | 'deadline'> {
  const { ctx, result } = run;
  const manifest = await readManifest(ctx, snapshotId);
  const input = await buildInputFromManifest(ctx, manifest, { onWarning: (message) => result.warnings.push(message) });
  const inputText = serializeInput(input);
  const bytes = Buffer.byteLength(inputText, 'utf8');
  const limit = ctx.config.limits.maxAnalysisInputBytes;
  if (bytes > limit) {
    const message =
      `Das Eingabepaket ist ${bytes} Bytes gross, die Grenze limits.maxAnalysisInputBytes beträgt ${limit} Bytes. ` +
      'Es wird nicht gekürzt und nicht an Claude übermittelt.';
    // A snapshot that is still blocked gets no further attempt folder in every run.
    if (details.status !== 'blocked') {
      const attempt = await openAttempt(run, snapshotId, details.nextAttempt);
      await createFileExclusive(path.join(attempt.dir, 'input.json'), inputText);
      await attempt.finish('input_too_large', null, message);
    }
    result.failed.push({ snapshotId, code: 'input_too_large', message });
    return false;
  }
  // A formerly blocked snapshot may already have used up its attempts.
  if (details.failedSinceRetry >= ctx.config.claude.maxAttemptsPerSnapshot) {
    result.failed.push({ snapshotId, code: 'analysis_exhausted', message: exhaustedMessage(ctx, snapshotId) });
    return false;
  }
  if (!run.ready) {
    try {
      await ensureClaudeReady(ctx, run.opts.env === undefined ? {} : { env: run.opts.env });
    } catch (error) {
      if (error instanceof IpaError && error.exitCode === EXIT.analysisIncomplete) {
        result.failed.push({ snapshotId, code: error.code, message: error.message });
        return false;
      }
      throw error;
    }
    run.ready = true;
  }
  // The readiness check may take up to 20 s; the limit applies to the start of the call itself.
  if (deadlineReached(run)) return 'deadline';
  return callAndStore(run, manifest, details, input, inputText);
}

/** spec.md §10. */
export async function processQueue(ctx: WorkspaceContext, runner: ClaudeRunner, opts: QueueOptions): Promise<QueueResult> {
  const result: QueueResult = {
    completed: [],
    failed: [],
    caughtUp: [],
    claudeCalls: 0,
    stoppedBy: null,
    cursor: null,
    open: [],
    exitCode: 0,
    warnings: [],
  };
  const run: Run = { ctx, runner, opts, result, ready: false };

  // spec.md §12.4: a `complete.json` behind the cursor moves it without a call and without a new log.
  const sync = await syncCursor(ctx);
  const before = sync.previous === null ? -1 : sync.ids.indexOf(sync.previous);
  result.caughtUp = sync.ids.slice(before + 1, sync.nextIndex);
  let cursor = sync.cursor;

  let index = sync.nextIndex;
  for (; index < sync.ids.length; index += 1) {
    const snapshotId = sync.ids[index]!;
    const details = await analysisDetails(ctx, snapshotId);
    let done = isDone(details.status);
    if (details.status === 'not_required') {
      done = await completeWithoutClaude(run, snapshotId);
    } else if (details.status === 'exhausted') {
      result.failed.push({ snapshotId, code: 'analysis_exhausted', message: exhaustedMessage(ctx, snapshotId) });
    } else if (!done) {
      if (result.claudeCalls >= ctx.config.claude.maxAnalysesPerRun) {
        result.stoppedBy = { reason: 'run_limit', snapshotId };
        break;
      }
      const analysed = deadlineReached(run) ? 'deadline' : await analyse(run, snapshotId, details);
      if (analysed === 'deadline') {
        // No new Claude call after the limit; the snapshot stays open for the next run (spec.md §12.2).
        result.stoppedBy = { reason: 'deadline', snapshotId };
        break;
      }
      done = analysed;
    }
    if (!done) {
      // The cursor must not jump over an open snapshot (I-03).
      result.stoppedBy = { reason: 'open', snapshotId };
      break;
    }
    cursor = snapshotId;
    await writeCursor(ctx, cursor);
  }
  result.cursor = cursor;

  for (const snapshotId of sync.ids.slice(index)) {
    const status = await analysisStatus(ctx, snapshotId);
    if (isOpen(status)) result.open.push({ snapshotId, status });
  }
  result.exitCode = result.failed.length > 0 || result.open.some((entry) => entry.status !== 'pending') ? 6 : 0;
  return result;
}
