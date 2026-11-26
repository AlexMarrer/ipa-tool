import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ConfigFile, ConfigFinding, ConfigPreview, ConfigView, RunHistoryEntry, SchedulePlan, ScheduleView } from '../../shared/config';
import { clockOfTimestamp, dayOfTimestamp } from '../../shared/dates';
import type { SchemaValidator } from '../cli/validator';
import { readJson, readJsonl } from './files';

export interface ConfigReadOptions {
  workspacePath: string;
  repoPath: string;
  validator: SchemaValidator;
}

/** The workspace path relative to the repository (with `/`), if it lies inside it; `null` otherwise. */
export function workspaceInsideRepository(repoPath: string, workspacePath: string): string | null {
  const relative = path.relative(path.resolve(repoPath), path.resolve(workspacePath));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

async function signatureOf(file: string): Promise<string> {
  try {
    const info = await stat(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return 'absent';
  }
}

interface DoctorFile {
  checkedAt: string;
  ok: boolean;
  claude: { found: boolean; version: string | null; loggedIn: boolean | null; authMethod: string | null };
}

/**
 * `config.json` read directly with the schema `config` (spec §8.11). The findings of an invalid file come from
 * `ipa config check` and are added by the caller; the app writes the file never, only `ipa config set` does.
 */
export async function readConfigView(options: ConfigReadOptions): Promise<ConfigView> {
  const file = path.join(options.workspacePath, 'config.json');
  const [read, signature, doctor] = await Promise.all([
    readJson<ConfigFile>(options.validator, 'config', file),
    signatureOf(file),
    readJson<DoctorFile>(options.validator, 'doctor', path.join(options.workspacePath, 'doctor.json')),
  ]);
  const base = {
    signature,
    findings: [],
    workspaceInRepository: workspaceInsideRepository(options.repoPath, options.workspacePath),
    repoPath: options.repoPath,
    workspacePath: options.workspacePath,
    claude:
      doctor.state === 'ok'
        ? { checkedAt: doctor.value.checkedAt, ok: doctor.value.ok, found: doctor.value.claude.found, version: doctor.value.claude.version, loggedIn: doctor.value.claude.loggedIn, authMethod: doctor.value.claude.authMethod }
        : null,
  };
  if (read.state === 'ok') return { ...base, state: 'ok', config: read.value };
  if (read.state === 'unreadable') return { ...base, state: read.detail.startsWith('Schemafehler') ? 'invalid' : 'unreadable', config: null };
  return { ...base, state: read.state, config: null };
}

interface RunRecordFile {
  runId: string;
  command: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  outcome: string;
  snapshotCreated: string | null;
  analysesCompleted?: string[];
  analysesFailed?: string[];
}

/** The newest runs from `runs.jsonl`, newest first (spec §8.10). Damaged lines are skipped. */
export async function readRunHistory(options: ConfigReadOptions, timezone: string, limit = 100): Promise<RunHistoryEntry[]> {
  const file = path.join(options.workspacePath, 'runs.jsonl');
  const read = await readJsonl<RunRecordFile>(options.validator, 'run-record', file);
  return read.items
    .map((run) => ({
      runId: run.runId,
      command: run.command,
      startedAt: run.startedAt,
      time: (clockOfTimestamp(run.startedAt, timezone) ?? '').slice(0, 5),
      day: dayOfTimestamp(run.startedAt, timezone) ?? '',
      outcome: run.outcome,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      snapshotCreated: run.snapshotCreated,
      analysesCompleted: run.analysesCompleted?.length ?? 0,
      analysesFailed: run.analysesFailed?.length ?? 0,
    }))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, limit);
}

type Json = Record<string, unknown>;
const rec = (value: unknown): Json | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? (value as unknown[]).flatMap((item) => text(item) ?? []) : []);

function planOf(value: unknown): SchedulePlan | null {
  const plan = rec(value);
  if (plan === null) return null;
  const count = (key: string): number => (typeof plan[key] === 'number' ? (plan[key] as number) : 0);
  return {
    workdays: strings(plan['workdays']) as SchedulePlan['workdays'],
    runTimes: strings(plan['runTimes']),
    skippedRunTimes: strings(plan['skippedRunTimes']),
    runsPerDay: count('runsPerDay'),
    includesWindowEndRun: plan['includesWindowEndRun'] === true,
    maxAnalysesPerRun: count('maxAnalysesPerRun'),
    maxClaudeCallsPerDay: count('maxClaudeCallsPerDay'),
  };
}

/** Findings, validity and plan from the result of `config set --dry-run` or `config check`. */
export function configPreviewOf(result: Json | null, failure: string | null): ConfigPreview {
  const findings: ConfigFinding[] = [];
  for (const item of Array.isArray(result?.['findings']) ? (result['findings'] as unknown[]) : []) {
    const finding = rec(item);
    if (finding === null) continue;
    findings.push({
      severity: finding['severity'] === 'warning' ? 'warning' : 'error',
      code: text(finding['code']) ?? 'unbekannt',
      path: text(finding['path']) ?? '',
      message: text(finding['message']) ?? '',
    });
  }
  return { valid: typeof result?.['valid'] === 'boolean' ? result['valid'] : null, findings, schedulePlan: planOf(result?.['schedulePlan']), failure };
}

export function emptySchedule(problem: NonNullable<ScheduleView['problem']>): ScheduleView {
  return { state: null, taskName: null, enabled: null, differences: [], detail: null, nextRun: null, lastRun: null, lastResult: null, running: false, insideWindow: null, plan: null, problem };
}

/** `schedule status --json` result as the schedule page needs it. */
export function scheduleViewOf(result: Json): ScheduleView {
  const state = text(result['state']);
  return {
    state: state === 'not_installed' || state === 'active' || state === 'paused' || state === 'stale' || state === 'error' ? state : null,
    taskName: text(result['taskName']),
    enabled: typeof result['enabled'] === 'boolean' ? result['enabled'] : null,
    differences: strings(result['differences']),
    detail: text(result['detail']),
    nextRun: text(result['nextRun']),
    lastRun: text(result['lastRun']),
    lastResult: typeof result['lastResult'] === 'number' ? result['lastResult'] : null,
    running: result['running'] === true,
    insideWindow: typeof result['insideWindow'] === 'boolean' ? result['insideWindow'] : null,
    plan: planOf(result['plan']),
    problem: null,
  };
}
