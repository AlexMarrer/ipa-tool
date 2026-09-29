/**
 * Layout of `analyses/<snapshotId>/` and `logs/` (spec.md §8.1) and validated reading of its files.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AttemptOutcome } from '../claude/types.js';
import type { WorkspaceContext } from '../core/context.js';
import { errnoCode, EXIT, IpaError } from '../core/errors.js';
import { readJsonValidated } from '../core/json.js';
import type { SchemaId } from '../core/schemas.js';
import type { AttemptOutcomeRecord, CompleteMarker, SkipMarker } from './types.js';

export const ANALYSES_FOLDER = 'analyses';
export const LOGS_FOLDER = 'logs';
export const RECORD_FILE = 'analysis.json';
export const COMPLETE_FILE = 'complete.json';
export const SKIP_FILE = 'skip.json';
export const OUTCOME_FILE = 'outcome.json';

const ATTEMPT_DIR = /^attempt-([1-9][0-9]*)$/;
const RETRY_FILE = /^retry-([1-9][0-9]*)\.json$/;

export function analysisDir(workspaceDir: string, snapshotId: string): string {
  return path.join(workspaceDir, ANALYSES_FOLDER, snapshotId);
}

export function attemptDir(workspaceDir: string, snapshotId: string, attempt: number): string {
  return path.join(analysisDir(workspaceDir, snapshotId), `attempt-${attempt}`);
}

export function retryPath(workspaceDir: string, snapshotId: string, afterAttempt: number): string {
  return path.join(analysisDir(workspaceDir, snapshotId), `retry-${afterAttempt}.json`);
}

export function logsDir(workspaceDir: string): string {
  return path.join(workspaceDir, LOGS_FOLDER);
}

export function logPath(workspaceDir: string, snapshotId: string): string {
  return path.join(logsDir(workspaceDir), `${snapshotId}.md`);
}

/** Workspace-relative path with `/`, as shown in outputs and the evidence index. */
export function logRelativePath(snapshotId: string): string {
  return `${LOGS_FOLDER}/${snapshotId}.md`;
}

export interface AttemptInfo {
  number: number;
  /** `interrupted` for a folder without `outcome.json` (spec.md §9.9). */
  outcome: AttemptOutcome;
  record: AttemptOutcomeRecord | null;
}

async function namesIn(dir: string): Promise<{ name: string; isDirectory: boolean }[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return [];
    throw error;
  }
}

function mismatch(file: string, snapshotId: string): IpaError {
  return new IpaError('analysis_mismatch', EXIT.usage, `${file} gehört nicht zum Snapshot ${snapshotId}.`);
}

/** A missing file gives `null`; an invalid one exit code 2 (spec.md §8.4). */
async function readOptional<T extends { snapshotId: string | null }>(file: string, schemaId: SchemaId, snapshotId: string): Promise<T | null> {
  let value: T;
  try {
    value = await readJsonValidated<T>(file, schemaId);
  } catch (error) {
    if (error instanceof IpaError && error.code === 'file_not_found') return null;
    throw error;
  }
  if (value.snapshotId !== snapshotId) throw mismatch(file, snapshotId);
  return value;
}

export function readCompleteMarker(workspaceDir: string, snapshotId: string): Promise<CompleteMarker | null> {
  return readOptional<CompleteMarker>(path.join(analysisDir(workspaceDir, snapshotId), COMPLETE_FILE), 'complete', snapshotId);
}

export function readSkipMarker(workspaceDir: string, snapshotId: string): Promise<SkipMarker | null> {
  return readOptional<SkipMarker>(path.join(analysisDir(workspaceDir, snapshotId), SKIP_FILE), 'skip', snapshotId);
}

/** Attempts in ascending order of their number. */
export async function listAttempts(workspaceDir: string, snapshotId: string): Promise<AttemptInfo[]> {
  const dir = analysisDir(workspaceDir, snapshotId);
  const numbers = (await namesIn(dir))
    .filter((entry) => entry.isDirectory)
    .map((entry) => ATTEMPT_DIR.exec(entry.name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  const attempts: AttemptInfo[] = [];
  for (const number of numbers) {
    const file = path.join(dir, `attempt-${number}`, OUTCOME_FILE);
    const record = await readOptional<AttemptOutcomeRecord>(file, 'attempt-outcome', snapshotId);
    if (record !== null && record.attempt !== number) throw mismatch(file, snapshotId);
    attempts.push({ number, outcome: record?.outcome ?? 'interrupted', record });
  }
  return attempts;
}

/**
 * Numbers `n` of the files `retry-<n>.json`, ascending. `n` is the number of the last attempt at the
 * time of the release, so later attempts count again (spec.md §12.1, §18).
 */
export async function listRetries(workspaceDir: string, snapshotId: string): Promise<number[]> {
  const dir = analysisDir(workspaceDir, snapshotId);
  const numbers = (await namesIn(dir))
    .filter((entry) => !entry.isDirectory)
    .map((entry) => RETRY_FILE.exec(entry.name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  for (const number of numbers) {
    await readOptional(retryPath(workspaceDir, snapshotId, number), 'retry', snapshotId);
  }
  return numbers;
}
