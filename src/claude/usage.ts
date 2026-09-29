/**
 * `ai-usage.jsonl` (spec.md §9.12): one line per model call, without prompt, input or answer.
 */
import path from 'node:path';
import { appendJsonl, type JsonlReadResult, readJsonl } from '../core/jsonl.js';
import type { AttemptOutcome, CallOutcome, ClaudeErrorCode, ClaudePurpose, ValidationErrorCode } from './types.js';

export const AI_USAGE_FILE = 'ai-usage.jsonl';

export interface AiUsageRecord {
  schemaVersion: 1;
  runId: string;
  purpose: ClaudePurpose;
  subjectId: string | null;
  startedAt: string;
  endedAt: string;
  cliVersion: string | null;
  models: string[];
  promptVersion: string | null;
  outputSchemaVersion: string | null;
  inputSha256: string | null;
  inputIds: string[];
  outcome: CallOutcome;
  errorCode: ClaudeErrorCode | null;
  costUsd: number | null;
  durationMs: number;
}

/** Outcome of an attempt for an error class (spec.md §9.9); `null` means success. */
export function outcomeForErrorCode(errorCode: ClaudeErrorCode | null): CallOutcome;
export function outcomeForErrorCode(errorCode: ClaudeErrorCode | ValidationErrorCode | null): AttemptOutcome;
export function outcomeForErrorCode(errorCode: ClaudeErrorCode | ValidationErrorCode | null): AttemptOutcome {
  switch (errorCode) {
    case null:
      return 'success';
    case 'invalid_envelope':
    case 'missing_structured_output':
      return 'invalid_response';
    case 'schema_invalid':
    case 'evidence_invalid':
    case 'rule_violation':
      return 'validation_failed';
    case 'not_found':
    case 'not_executable':
    case 'timeout':
    case 'nonzero_exit':
    case 'error_result':
      return 'claude_error';
  }
}

export function aiUsagePath(workspaceDir: string): string {
  return path.join(workspaceDir, AI_USAGE_FILE);
}

export async function appendAiUsage(workspaceDir: string, record: AiUsageRecord): Promise<void> {
  await appendJsonl(aiUsagePath(workspaceDir), record, 'ai-usage');
}

export async function readAiUsage(workspaceDir: string): Promise<JsonlReadResult<AiUsageRecord>> {
  return readJsonl<AiUsageRecord>(aiUsagePath(workspaceDir), 'ai-usage');
}
