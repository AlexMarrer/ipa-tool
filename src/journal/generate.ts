/**
 * `generateJournal` (spec.md §10, package 07 §4): builds the day input, lets Claude write the draft or
 * renders it without Claude, and creates `journal/drafts/<day>-<runId>.json` and `.md` exclusively.
 * No lock (D-16); existing drafts and `journal/final/` stay untouched (I-09).
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256Hex } from '../analysis/input.js';
import { ensureClaudeReady } from '../claude/doctor.js';
import type { AttemptOutcome, ClaudeErrorCode, ClaudeResult, ClaudeRunner, ValidationErrorCode } from '../claude/types.js';
import { outcomeForErrorCode } from '../claude/usage.js';
import type { WorkspaceContext } from '../core/context.js';
import { errnoCode, EXIT, IpaError } from '../core/errors.js';
import { createFileExclusive } from '../core/fs-write.js';
import { createJsonExclusive } from '../core/json.js';
import { loadSchema } from '../core/schemas.js';
import { formatZoned, isValidDay } from '../core/time.js';
import { TOOL_ROOT } from '../core/tool.js';
import { buildJournalInput, type JournalInputBuild } from './input.js';
import { draftBody, renderJournal } from './render.js';
import {
  type AiJournalProvenance,
  type JournalInput,
  type JournalOutput,
  type JournalRecord,
  type JournalSource,
  type NoAiReason,
  type OpenItems,
  OUTPUT_SCHEMA_VERSION,
  PROMPT_FILE,
  PROMPT_VERSION,
} from './types.js';
import { validateJournalOutput } from './validate.js';

export const JOURNAL_PROMPT_PATH = path.join(TOOL_ROOT, 'prompts', PROMPT_FILE);
export const JOURNAL_FOLDER = 'journal';
export const RUNS_FOLDER = `${JOURNAL_FOLDER}/runs`;
export const DRAFTS_FOLDER = `${JOURNAL_FOLDER}/drafts`;

const MAX_OUTCOME_MESSAGE = 2000;

export interface GenerateJournalOptions {
  day: string;
  noAi: boolean;
  /** Environment for the readiness check of Claude; default `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface JournalResult {
  exitCode: 0 | 6;
  /** Markdown draft; `null` if none was written. */
  draftPath: string | null;
  recordPath: string | null;
  mode: 'ai' | 'no_ai' | null;
  noAiReason: NoAiReason | null;
  /** `journal/runs/<runId>/` of a Claude run, `null` otherwise. */
  runDir: string | null;
  /** Why no draft was written (exit code 6); German, without content. */
  failure: { code: string; message: string } | null;
  /** Open analyses and gaps of the day, also without a draft. */
  openItems: OpenItems;
  warnings: string[];
}

export function serializeJournalInput(input: JournalInput): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

function now(ctx: WorkspaceContext): string {
  return formatZoned(ctx.clock.now(), ctx.config.timezone);
}

function limitMessage(text: string): string {
  return text.length > MAX_OUTCOME_MESSAGE ? `${text.slice(0, MAX_OUTCOME_MESSAGE)} …` : text;
}

function noAiHint(day: string): string {
  return `Es wurde kein Entwurf erstellt. Ohne KI: ipa journal --day ${day} --no-ai`;
}

function resolveSources(refs: readonly string[], known: ReadonlyMap<string, JournalSource>): JournalSource[] {
  return refs.map((ref) => {
    const source = known.get(ref);
    if (source === undefined) throw new IpaError('record_invalid', EXIT.internal, `Interner Fehler: Die Referenz ${ref} des Entwurfs lässt sich nicht auflösen.`);
    return source;
  });
}

export type RecordContent =
  | { mode: 'ai'; journal: JournalOutput; provenance: AiJournalProvenance }
  | { mode: 'no_ai'; journal: null; provenance: { deterministic: true; reason: NoAiReason } };

export interface RecordArgs {
  input: JournalInput;
  sources: ReadonlyMap<string, JournalSource>;
  runId: string;
  generatedAt: string;
  content: RecordContent;
}

/** `sources` holds exactly the references the draft shows, in order of first appearance. */
export function buildJournalRecord(args: RecordArgs): JournalRecord {
  const { input } = args;
  return {
    schemaVersion: 1,
    day: input.day,
    runId: args.runId,
    generatedAt: args.generatedAt,
    ...args.content,
    timeSummary: input.timeSummary,
    openItems: input.openItems,
    sources: resolveSources(draftBody(input, args.content.journal).refs, args.sources),
  };
}

/** JSON record first, then the Markdown draft; both exclusively, so no existing draft is ever replaced. */
async function writeDraft(ctx: WorkspaceContext, build: JournalInputBuild, content: RecordContent): Promise<{ draftPath: string; recordPath: string }> {
  const { input } = build;
  const record = buildJournalRecord({ input, sources: build.sources, runId: ctx.runId, generatedAt: now(ctx), content });
  const dir = path.join(ctx.workspaceDir, DRAFTS_FOLDER);
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, `${input.day}-${ctx.runId}`);
  await createJsonExclusive(`${base}.json`, record, 'journal-record');
  await createFileExclusive(`${base}.md`, renderJournal(input, record));
  return { draftPath: `${base}.md`, recordPath: `${base}.json` };
}

interface RunFolder {
  dir: string;
  startedAt: string;
  finish(outcome: AttemptOutcome, errorCode: ClaudeErrorCode | ValidationErrorCode | null, message: string | null): Promise<void>;
}

/** `journal/runs/<runId>/` holds the artefacts; Claude itself runs in its own temporary folder (D-22). */
async function openRunFolder(ctx: WorkspaceContext): Promise<RunFolder> {
  await mkdir(path.join(ctx.workspaceDir, RUNS_FOLDER), { recursive: true });
  const dir = path.join(ctx.workspaceDir, RUNS_FOLDER, ctx.runId);
  await mkdir(dir);
  const startedAt = now(ctx);
  return {
    dir,
    startedAt,
    async finish(outcome, errorCode, message) {
      await createJsonExclusive(
        path.join(dir, 'outcome.json'),
        {
          schemaVersion: 1,
          snapshotId: null,
          runId: ctx.runId,
          attempt: 1,
          startedAt,
          endedAt: now(ctx),
          outcome,
          errorCode,
          message: message === null ? null : limitMessage(message),
        },
        'attempt-outcome',
      );
    },
  };
}

function emptyResult(build: JournalInputBuild): JournalResult {
  return {
    exitCode: 0,
    draftPath: null,
    recordPath: null,
    mode: null,
    noAiReason: null,
    runDir: null,
    failure: null,
    openItems: build.input.openItems,
    warnings: build.warnings,
  };
}

async function withClaude(ctx: WorkspaceContext, runner: ClaudeRunner, build: JournalInputBuild, opts: GenerateJournalOptions): Promise<JournalResult> {
  const { input } = build;
  const result = emptyResult(build);
  const fail = (code: string, message: string): JournalResult => ({ ...result, exitCode: 6, failure: { code, message } });

  const inputText = serializeJournalInput(input);
  const bytes = Buffer.byteLength(inputText, 'utf8');
  const limit = ctx.config.limits.maxJournalInputBytes;
  if (bytes > limit) {
    const message =
      `Die Journal-Eingabe ist ${bytes} Bytes gross, die Grenze limits.maxJournalInputBytes beträgt ${limit} Bytes. ` +
      'Sie wird nicht gekürzt und nicht an Claude übermittelt.';
    const run = await openRunFolder(ctx);
    await createFileExclusive(path.join(run.dir, 'input.json'), inputText);
    await run.finish('input_too_large', null, message);
    result.runDir = run.dir;
    return fail('input_too_large', `${message} ${noAiHint(input.day)}`);
  }

  try {
    await ensureClaudeReady(ctx, opts.env === undefined ? {} : { env: opts.env });
  } catch (error) {
    if (error instanceof IpaError && error.exitCode === EXIT.analysisIncomplete) return fail(error.code, `${error.message} ${noAiHint(input.day)}`);
    throw error;
  }

  const run = await openRunFolder(ctx);
  result.runDir = run.dir;
  const schema = loadSchema('journal-output');
  const promptFile = path.join(run.dir, 'prompt.md');
  await createFileExclusive(path.join(run.dir, 'input.json'), inputText);
  await createFileExclusive(promptFile, await readFile(JOURNAL_PROMPT_PATH, 'utf8'));
  await createFileExclusive(path.join(run.dir, 'schema.json'), `${JSON.stringify(schema, null, 2)}\n`);

  let answer: ClaudeResult;
  try {
    answer = await runner.run(ctx, {
      purpose: 'journal',
      subjectId: input.day,
      promptFile,
      outputSchema: schema,
      stdin: inputText,
      promptVersion: PROMPT_VERSION,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      inputIds: input.allowedEvidenceIds,
    });
  } catch (error) {
    const code = error instanceof IpaError ? error.code : (errnoCode(error) ?? 'intern');
    await run.finish('interrupted', null, `Abbruch vor der Auswertung der Antwort (${code}).`).catch(() => undefined);
    throw error;
  }
  // The raw answer is kept in every case (spec.md §13.3).
  await createFileExclusive(path.join(run.dir, 'response.json'), answer.meta.rawStdout);
  await createFileExclusive(path.join(run.dir, 'stderr.txt'), answer.meta.rawStderr);

  if (!answer.ok) {
    await run.finish(outcomeForErrorCode(answer.errorCode), answer.errorCode, answer.message);
    return fail(answer.errorCode, `${answer.message} ${noAiHint(input.day)}`);
  }
  const check = validateJournalOutput(input, answer.structuredOutput);
  if (!check.ok) {
    const message = `Antwort abgelehnt (${check.errorCode}): ${check.errors.slice(0, 10).join('; ')}`;
    await run.finish('validation_failed', check.errorCode, message);
    return fail(check.errorCode, `${limitMessage(message)} ${noAiHint(input.day)}`);
  }

  let written: { draftPath: string; recordPath: string };
  try {
    written = await writeDraft(ctx, build, {
      mode: 'ai',
      journal: check.value,
      provenance: {
        promptVersion: PROMPT_VERSION,
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        cliVersion: answer.meta.cliVersion,
        models: answer.meta.models,
        inputSha256: sha256Hex(inputText),
        runDir: `${RUNS_FOLDER}/${ctx.runId}`,
      },
    });
  } catch (error) {
    // Only I/O failures such as a full disk; programming errors stay errors.
    if (error instanceof IpaError || errnoCode(error) === undefined) throw error;
    const message = `Ablage des Entwurfs fehlgeschlagen (${errnoCode(error)}).`;
    await run.finish('interrupted', null, message);
    return fail('journal_store_failed', `${message} ${noAiHint(input.day)}`);
  }
  // Written last, so that `success` always comes with a draft.
  await run.finish('success', null, null);
  return { ...result, ...written, mode: 'ai' };
}

/** spec.md §10. `runner` may be `null` only with `noAi`. */
export async function generateJournal(ctx: WorkspaceContext, runner: ClaudeRunner | null, opts: GenerateJournalOptions): Promise<JournalResult> {
  if (!isValidDay(opts.day)) {
    throw new IpaError('day_invalid', EXIT.usage, `Ungültiger Tag "${opts.day}". Erwartet wird ein Kalendertag im Format YYYY-MM-DD, zum Beispiel 2026-10-14.`);
  }
  const build = await buildJournalInput(ctx, opts.day);
  const { input } = build;
  const noAiReason: NoAiReason | null = opts.noAi ? 'requested' : input.analyses.length === 0 && input.notes.length === 0 ? 'no_data' : null;
  if (noAiReason !== null) {
    const written = await writeDraft(ctx, build, { mode: 'no_ai', journal: null, provenance: { deterministic: true, reason: noAiReason } });
    return { ...emptyResult(build), ...written, mode: 'no_ai', noAiReason };
  }
  if (runner === null) throw new Error('generateJournal braucht ohne noAi einen ClaudeRunner.');
  return withClaude(ctx, runner, build, opts);
}
