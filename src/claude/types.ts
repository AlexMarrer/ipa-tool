/**
 * Contracts of the Claude component (spec.md §9.9, §9.12, §9.13, §10, §13).
 */
import type { WorkspaceContext } from '../core/context.js';

export type ClaudePurpose = 'analysis' | 'journal' | 'doctor';

/** Error classes of spec.md §13.3 that the runner itself detects. */
export type ClaudeErrorCode =
  | 'not_found'
  | 'not_executable'
  | 'timeout'
  | 'nonzero_exit'
  | 'invalid_envelope'
  | 'error_result'
  | 'missing_structured_output';

/** Results of the caller's validation (spec.md §13.3 step 7, packages 06 and 07). */
export type ValidationErrorCode = 'schema_invalid' | 'evidence_invalid' | 'rule_violation';

/** `outcome` of an attempt (spec.md §9.9). */
export type AttemptOutcome = 'success' | 'claude_error' | 'invalid_response' | 'validation_failed' | 'input_too_large' | 'interrupted';

/** `outcome` of a model call in `ai-usage.jsonl`: only what the runner can judge. */
export type CallOutcome = Extract<AttemptOutcome, 'success' | 'claude_error' | 'invalid_response'>;

export interface ClaudeRequest {
  purpose: ClaudePurpose;
  /** Snapshot ID for analyses, day for journals, `null` for the doctor. */
  subjectId: string | null;
  /** System prompt; the runner copies it into the Claude working directory as `prompt.md`. */
  promptFile: string;
  /** JSON Schema draft-07 without `format`, `$schema` and `$id` (spec.md §8.4). */
  outputSchema: object;
  /** The input package; it reaches Claude only via stdin (I-11). */
  stdin: string;
  promptVersion: string | null;
  /** Version of the output schema, for example `analysis-output@1` (spec.md §9.8, §9.12). */
  outputSchemaVersion: string | null;
  /** Evidence and other IDs of the input package, for `ai-usage.jsonl`. */
  inputIds: string[];
}

export interface ClaudeMeta {
  /** From `doctor.json`, `null` without a doctor result. */
  cliVersion: string | null;
  /** Keys of `modelUsage` in the envelope. */
  models: string[];
  costUsd: number | null;
  /** `duration_ms` of the envelope, otherwise the measured process time. */
  durationMs: number;
  /** `null` if the process did not start or ended by a signal. */
  exitCode: number | null;
  startedAt: string;
  endedAt: string;
  /** Complete stdout for `response.json` of the caller. */
  rawStdout: string;
  /** stderr, at most 64 KiB (spec.md §13.1). */
  rawStderr: string;
  stderrTruncated: boolean;
}

export type ClaudeResult =
  | { ok: true; structuredOutput: unknown; meta: ClaudeMeta }
  | { ok: false; errorCode: ClaudeErrorCode; message: string; meta: ClaudeMeta };

export interface ClaudeRunner {
  run(ctx: WorkspaceContext, req: ClaudeRequest): Promise<ClaudeResult>;
}

/** Options probed by `ipa doctor`; keys of `doctor.json` → `claude.flags`. */
export type ProbedFlag =
  | '-p'
  | '--output-format'
  | '--json-schema'
  | '--tools'
  | '--disallowedTools'
  | '--strict-mcp-config'
  | '--permission-mode'
  | '--disable-slash-commands'
  | '--no-session-persistence'
  | '--max-turns'
  | '--append-system-prompt-file'
  | '--setting-sources'
  | '--model'
  | '--safe-mode'
  | '--verbose';

/** `doctor.json` (spec.md §9.13). No field holds an email address, an organisation or a token. */
export interface DoctorRecord {
  schemaVersion: 1;
  checkedAt: string;
  git: { found: boolean; version: string | null };
  claude: {
    found: boolean;
    version: string | null;
    /** `null` if not determined, for example because Claude was not found. */
    loggedIn: boolean | null;
    authMethod: string | null;
    flags: Partial<Record<ProbedFlag, boolean>>;
    /** A-08; only a live check determines it. */
    settingSourcesAuthOk: boolean | null;
  };
  live: null | { checkedAt: string; ok: boolean; toolsReported: string[]; mcpServersReported: string[] };
  ok: boolean;
}

/** Billing guard (spec.md §13.1): only names of variables, never their values. */
export interface BillingCheck {
  /** Set variables that bill per request through the Anthropic API, for example `ANTHROPIC_API_KEY`. */
  apiKeyVariables: string[];
  /** Set variables that route Claude Code to Bedrock, Vertex AI or Foundry. */
  providerVariables: string[];
  /** `claude auth status` reports `authMethod: third_party`, also for a provider set in the Claude Code settings. */
  thirdPartyLogin: boolean;
  /** Any of the three above. */
  detected: boolean;
  /** `claude.allowPaidUsage` is `true`; a missing field counts as `false`. */
  allowPaidUsage: boolean;
  /** Detected but not allowed: no model call. */
  blocked: boolean;
}

/** Result of `probeClaude`: the stored record plus findings for the output, which are not stored. */
export interface DoctorReport {
  record: DoctorRecord;
  /** German, without content, email addresses or tokens. */
  findings: string[];
  /** Required options that were not recognised. */
  missingFlags: ProbedFlag[];
  /** `live` and `settingSourcesAuthOk` were taken over from the previous check of the same version. */
  liveCarriedOver: boolean;
  /** Names of variables of a surrounding Claude Code session that were not passed on to `claude`. */
  droppedSessionVariables: string[];
  billing: BillingCheck;
}
