import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cursorOf } from '../../src/analysis/cursor.js';
import { analysisStatus, deriveStatus, failedAttemptsSinceRetry, type StatusFacts } from '../../src/analysis/status.js';
import type { AnalysisStatus } from '../../src/analysis/types.js';
import type { AttemptOutcome } from '../../src/claude/types.js';
import { resolveContext } from '../../src/core/context.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { initRepo } from '../helpers/snapshots.js';
import { createTempDataRoot, runCli } from '../helpers/workspace.js';

function facts(attempts: AttemptOutcome[], extra: Partial<StatusFacts> = {}): StatusFacts {
  return {
    complete: false,
    skipped: false,
    analysisRequired: true,
    attempts: attempts.map((outcome, index) => ({ number: index + 1, outcome })),
    retries: [],
    maxAttempts: 3,
    ...extra,
  };
}

describe('Statusableitung (spec.md §12.1)', () => {
  it('prüft die Bedingungen in der Reihenfolge der Tabelle', () => {
    expect(deriveStatus(facts(['claude_error'], { complete: true, skipped: true }))).toBe('complete');
    expect(deriveStatus(facts(['claude_error'], { skipped: true }))).toBe('skipped');
    expect(deriveStatus(facts([], { analysisRequired: false }))).toBe('not_required');
    expect(deriveStatus(facts(['claude_error', 'input_too_large']))).toBe('blocked');
    expect(deriveStatus(facts(['claude_error', 'invalid_response', 'interrupted']))).toBe('exhausted');
    expect(deriveStatus(facts(['invalid_response']))).toBe('failed');
    expect(deriveStatus(facts([]))).toBe('pending');
  });

  it('zählt input_too_large nicht als Fehlversuch und blocked nur für den letzten Versuch', () => {
    expect(deriveStatus(facts(['input_too_large', 'claude_error']))).toBe('failed');
    expect(deriveStatus(facts(['input_too_large', 'input_too_large', 'claude_error', 'claude_error']))).toBe('failed');
    expect(failedAttemptsSinceRetry(facts(['input_too_large', 'claude_error']).attempts, [])).toBe(1);
  });

  it('setzt den Zähler mit retry-<n>.json zurück, frühere Fehler bleiben sichtbar (failed statt pending)', () => {
    const three: AttemptOutcome[] = ['claude_error', 'validation_failed', 'interrupted'];
    expect(deriveStatus(facts(three))).toBe('exhausted');
    expect(deriveStatus(facts(three, { retries: [3] }))).toBe('failed');
    expect(deriveStatus(facts([...three, 'claude_error', 'claude_error', 'claude_error'], { retries: [3] }))).toBe('exhausted');
    expect(deriveStatus(facts([...three, 'claude_error', 'claude_error'], { retries: [3] }))).toBe('failed');
    expect(deriveStatus(facts(three, { maxAttempts: 4 }))).toBe('failed');
  });

  it('leitet den Status aus konstruierten Ordnern im Arbeitsbereich ab', async () => {
    const repo = await createTempRepo({ files: { 'a.txt': 'eins\n' } });
    const dataDir = await createTempDataRoot();
    const workspace = await initRepo(repo, dataDir);
    await repo.write('a.txt', 'zwei\n');
    expect((await runCli(['capture', '--no-analysis'], { dataDir, repo: repo.root })).exitCode).toBe(0);
    const ctx = await resolveContext({ repo: repo.root, dataDir, requireInit: true });
    const dir = `${workspace}/analyses/S000002`;
    const outcome = (attempt: number, value: AttemptOutcome, errorCode: string | null) =>
      JSON.stringify({
        schemaVersion: 1,
        snapshotId: 'S000002',
        runId: 'R20261014T080312Z-a3f9',
        attempt,
        startedAt: '2026-10-14T10:03:12+02:00',
        endedAt: '2026-10-14T10:03:20+02:00',
        outcome: value,
        errorCode,
        message: null,
      });

    expect(await analysisStatus(ctx, 'S000001')).toBe('not_required');
    expect(await analysisStatus(ctx, 'S000002')).toBe('pending');
    await mkdir(`${dir}/attempt-1`, { recursive: true });
    await writeFile(`${dir}/attempt-1/outcome.json`, outcome(1, 'claude_error', 'timeout'));
    expect(await analysisStatus(ctx, 'S000002')).toBe('failed');
    // A folder without outcome.json counts as interrupted (spec.md §9.9).
    await mkdir(`${dir}/attempt-2`);
    await mkdir(`${dir}/attempt-3`);
    expect(await analysisStatus(ctx, 'S000002')).toBe('exhausted');
    await writeFile(`${dir}/retry-3.json`, JSON.stringify({ schemaVersion: 1, snapshotId: 'S000002', requestedAt: '2026-10-14T11:00:00+02:00' }));
    expect(await analysisStatus(ctx, 'S000002')).toBe('failed');
    await mkdir(`${dir}/attempt-4`);
    await writeFile(`${dir}/attempt-4/outcome.json`, outcome(4, 'input_too_large', null));
    expect(await analysisStatus(ctx, 'S000002')).toBe('blocked');
    await writeFile(`${dir}/skip.json`, JSON.stringify({ schemaVersion: 1, snapshotId: 'S000002', skippedAt: '2026-10-14T11:00:00+02:00', reason: 'Test' }));
    expect(await analysisStatus(ctx, 'S000002')).toBe('skipped');
    await writeFile(`${dir}/complete.json`, JSON.stringify({ schemaVersion: 1, snapshotId: 'S000002', completedAt: '2026-10-14T11:00:00+02:00', analysisSha256: 'a'.repeat(64), logSha256: 'b'.repeat(64) }));
    expect(await analysisStatus(ctx, 'S000002')).toBe('complete');

    // An invalid marker is an invalid single file: exit code 2 (spec.md §8.4).
    await writeFile(`${dir}/complete.json`, JSON.stringify({ schemaVersion: 1, snapshotId: 'S000003' }));
    await expect(analysisStatus(ctx, 'S000002')).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe('Cursor-Regel (spec.md §12.3)', () => {
  const statuses = (values: Record<string, AnalysisStatus>) => (id: string) => values[id] ?? 'pending';

  it('ist der letzte Snapshot des längsten lückenlosen Präfixes aus complete und skipped', () => {
    const ids = ['S000001', 'S000002', 'S000003', 'S000004'];
    expect(cursorOf(ids, statuses({ S000001: 'complete', S000002: 'skipped', S000003: 'failed', S000004: 'complete' }))).toBe('S000002');
    expect(cursorOf(ids, statuses({ S000001: 'complete', S000002: 'complete', S000003: 'complete', S000004: 'skipped' }))).toBe('S000004');
    expect(cursorOf(ids, statuses({ S000001: 'not_required', S000002: 'complete' }))).toBeNull();
    for (const open of ['pending', 'failed', 'blocked', 'exhausted', 'not_required'] as const) {
      expect(cursorOf(ids, statuses({ S000001: 'complete', S000002: open, S000003: 'complete' })), open).toBe('S000001');
    }
    expect(cursorOf([], statuses({}))).toBeNull();
  });
});
