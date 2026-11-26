import path from 'node:path';
import type { UsageRange, UsageRow } from '../../shared/project';
import { clockOfTimestamp, dayOfTimestamp } from '../../shared/dates';
import type { SchemaValidator } from '../cli/validator';
import { readJson, readJsonl } from './files';
import type { RegistryEntry } from './registry';

interface UsageRecord {
  runId: string;
  purpose: UsageRow['purpose'];
  startedAt: string;
  durationMs: number;
  models: string[];
  outcome: UsageRow['outcome'];
  costUsd?: number | null;
}

/**
 * Claude calls of all projects from `ai-usage.jsonl` (spec §8.13). The file never contains a prompt or an answer, and
 * the rows carry none either. Newest first; damaged lines are skipped.
 */
export async function readUsage(entries: readonly RegistryEntry[], validator: SchemaValidator, range: UsageRange, now: Date = new Date()): Promise<UsageRow[]> {
  const since = range === 'all' ? 0 : now.getTime() - Number(range) * 86_400_000;
  const rows: UsageRow[] = [];
  for (const entry of entries) {
    const config = await readJson<{ timezone: string }>(validator, 'config', path.join(entry.workspacePath, 'config.json'));
    const timezone = config.state === 'ok' ? config.value.timezone : 'UTC';
    const read = await readJsonl<UsageRecord>(validator, 'ai-usage', path.join(entry.workspacePath, 'ai-usage.jsonl'));
    for (const record of read.items) {
      if (Date.parse(record.startedAt) < since) continue;
      rows.push({
        repositoryId: entry.repositoryId,
        runId: record.runId,
        day: dayOfTimestamp(record.startedAt, timezone) ?? '',
        time: (clockOfTimestamp(record.startedAt, timezone) ?? '').slice(0, 5),
        startedAt: record.startedAt,
        purpose: record.purpose,
        durationMs: record.durationMs,
        models: record.models,
        outcome: record.outcome,
        costUsd: typeof record.costUsd === 'number' ? record.costUsd : null,
      });
    }
  }
  return rows.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
