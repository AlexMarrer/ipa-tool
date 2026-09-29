/**
 * `ClaudeRunner` (spec.md §10, §13): Claude Code without tools, without MCP and without a shell, in an
 * empty working directory outside repository and workspace, with the input only on stdin (I-11).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { WorkspaceContext } from '../core/context.js';
import { formatZoned } from '../core/time.js';
import { buildClaudeArgs, PRINT_PROMPTS } from './args.js';
import { readDoctorRecord, usesSafeMode, usesSettingSources } from './doctor-record.js';
import { claudeProcessEnv } from './env.js';
import { type Evaluation, evaluateEnvelope, evaluateStream, parseStreamJson, type StreamSummary } from './envelope.js';
import { prepareOutputSchema } from './output-schema.js';
import { type ProcessResult, runProcess } from './process.js';
import type { ClaudeMeta, ClaudePurpose, ClaudeRequest, ClaudeResult, ClaudeRunner } from './types.js';
import { appendAiUsage, outcomeForErrorCode } from './usage.js';
import { createClaudeWorkdir, PROMPT_FILE_NAME } from './workdir.js';

/** One model call; used by the runner and by the live check of `ipa doctor`. */
export interface CallSpec {
  purpose: ClaudePurpose;
  subjectId: string | null;
  promptText: string;
  /** Result of `prepareOutputSchema`. */
  schemaJson: string;
  stdin: string;
  outputFormat: 'json' | 'stream-json';
  settingSources: boolean;
  safeMode: boolean;
  timeoutSeconds: number;
  promptVersion: string | null;
  outputSchemaVersion: string | null;
  inputIds: string[];
  cliVersion: string | null;
  env: NodeJS.ProcessEnv;
  onStdoutLine?: (line: string) => 'continue' | 'abort';
}

export interface CallDetails {
  evaluation: Evaluation;
  process: ProcessResult;
  /** Only for `stream-json`. */
  stream: StreamSummary | null;
  meta: ClaudeMeta;
  /** Files in the working directory besides `prompt.md` right after the call. */
  unexpectedFiles: string[];
}

const SUBJECT_PATTERNS: Record<ClaudePurpose, RegExp | null> = {
  analysis: /^S[0-9]{6}$/,
  journal: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  doctor: null,
};

/** Checked before the start, so that no model call happens for a request that cannot be logged. */
function assertSubject(purpose: ClaudePurpose, subjectId: string | null): void {
  const pattern = SUBJECT_PATTERNS[purpose];
  const valid = pattern === null ? subjectId === null : subjectId !== null && pattern.test(subjectId);
  if (!valid) throw new Error(`Ungültige subjectId ${JSON.stringify(subjectId)} für den Zweck ${purpose}`);
}

/**
 * Creates the working directory, starts Claude, evaluates the answer (spec.md §13.3), removes the
 * directory again and writes exactly one line to `ai-usage.jsonl`.
 */
export async function callClaude(ctx: WorkspaceContext, spec: CallSpec): Promise<CallDetails> {
  assertSubject(spec.purpose, spec.subjectId);
  const { command, maxTurns, model } = ctx.config.claude;
  const workdir = await createClaudeWorkdir(ctx, spec.promptText);
  const startedAt = ctx.clock.now();
  let proc: ProcessResult;
  let unexpectedFiles: string[];
  try {
    const args = buildClaudeArgs({
      printPrompt: PRINT_PROMPTS[spec.purpose],
      outputFormat: spec.outputFormat,
      schemaJson: spec.schemaJson,
      maxTurns,
      promptFile: workdir.promptFile,
      settingSources: spec.settingSources,
      model,
      safeMode: spec.safeMode,
    });
    proc = await runProcess({
      command,
      args,
      cwd: workdir.dir,
      env: claudeProcessEnv(spec.env),
      input: spec.stdin,
      timeoutMs: spec.timeoutSeconds * 1000,
      ...(spec.onStdoutLine === undefined ? {} : { onStdoutLine: spec.onStdoutLine }),
    });
    unexpectedFiles = (await readdir(workdir.dir).catch(() => [])).filter((name) => name !== PROMPT_FILE_NAME).sort();
  } finally {
    await workdir.remove();
  }
  const endedAt = ctx.clock.now();

  const stream = spec.outputFormat === 'stream-json' ? parseStreamJson(proc.stdout) : null;
  const evaluation =
    stream === null ? evaluateEnvelope(proc, command, spec.timeoutSeconds) : evaluateStream(proc, stream, command, spec.timeoutSeconds);
  const timezone = ctx.config.timezone;
  const meta: ClaudeMeta = {
    cliVersion: spec.cliVersion,
    models: evaluation.figures.models,
    costUsd: evaluation.figures.costUsd,
    durationMs: evaluation.figures.durationMs ?? proc.durationMs,
    exitCode: proc.exitCode,
    startedAt: formatZoned(startedAt, timezone),
    endedAt: formatZoned(endedAt, timezone),
    rawStdout: proc.stdout,
    rawStderr: proc.stderr,
    stderrTruncated: proc.stderrTruncated,
  };
  const errorCode = evaluation.ok ? null : evaluation.errorCode;
  await appendAiUsage(ctx.workspaceDir, {
    schemaVersion: 1,
    runId: ctx.runId,
    purpose: spec.purpose,
    subjectId: spec.subjectId,
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    cliVersion: meta.cliVersion,
    models: meta.models,
    promptVersion: spec.promptVersion,
    outputSchemaVersion: spec.outputSchemaVersion,
    inputSha256: createHash('sha256').update(spec.stdin, 'utf8').digest('hex'),
    inputIds: spec.inputIds,
    outcome: outcomeForErrorCode(errorCode),
    errorCode,
    costUsd: meta.costUsd,
    durationMs: meta.durationMs,
  });
  return { evaluation, process: proc, stream, meta, unexpectedFiles };
}

export interface ClaudeRunnerOptions {
  /** Environment for `claude`; default `process.env`. Variables of a surrounding session are dropped. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Callers check readiness first with `ensureClaudeReady` (packages 06, 07). `--setting-sources` and
 * `--safe-mode` follow `doctor.json`; the CLI version for `meta` comes from there as well.
 */
export function createClaudeRunner(options: ClaudeRunnerOptions = {}): ClaudeRunner {
  const env = options.env ?? process.env;
  return {
    async run(ctx: WorkspaceContext, req: ClaudeRequest): Promise<ClaudeResult> {
      // An invalid schema is a programming error and stops before anything starts (package 05 §6).
      const schemaJson = prepareOutputSchema(req.outputSchema);
      const promptText = await readFile(req.promptFile, 'utf8');
      const doctor = await readDoctorRecord(ctx.workspaceDir);
      const call = await callClaude(ctx, {
        purpose: req.purpose,
        subjectId: req.subjectId,
        promptText,
        schemaJson,
        stdin: req.stdin,
        outputFormat: 'json',
        settingSources: usesSettingSources(doctor),
        safeMode: usesSafeMode(doctor),
        timeoutSeconds: ctx.config.claude.timeoutSeconds,
        promptVersion: req.promptVersion,
        outputSchemaVersion: req.outputSchemaVersion,
        inputIds: req.inputIds,
        cliVersion: doctor?.claude.version ?? null,
        env,
      });
      const { evaluation, meta } = call;
      return evaluation.ok
        ? { ok: true, structuredOutput: evaluation.structuredOutput, meta }
        : { ok: false, errorCode: evaluation.errorCode, message: evaluation.message, meta };
    },
  };
}
