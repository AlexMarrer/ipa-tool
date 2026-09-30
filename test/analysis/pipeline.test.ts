import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AI_NOTICE, BASELINE_HEADING, DETERMINISTIC_NOTICE } from '../../src/analysis/render.js';
import type { CompleteMarker } from '../../src/analysis/types.js';
import type { AiUsageRecord } from '../../src/claude/usage.js';
import { readJsonl } from '../../src/core/jsonl.js';
import { isSameOrInside } from '../../src/core/paths.js';
import { validate } from '../../src/core/schemas.js';
import {
  captureOnly,
  inputOf,
  ipa,
  lastRunOf,
  namesIn,
  outcomeOf,
  pipelineRepo,
  recordOf,
  stateOf,
  statusOf,
} from '../helpers/analysis.js';
import { readManifestFile } from '../helpers/snapshots.js';
import { listTree, readJsonFile, TOOL_ROOT } from '../helpers/workspace.js';

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

describe('Analyse nach ipa capture (Paket 06)', () => {
  it('erzeugt Snapshot, schemagültiges analysis.json, Work-Log mit Belegen und complete.json; der Cursor folgt (AK-06-01, AK-06-17)', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', 'eins\nzwei\n');
    const { result, modelCalls } = await ipa(env, ['capture']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('Analyse S000001 abgeschlossen (ohne KI), Work-Log: logs/S000001.md');
    expect(result.stdout).toContain('Analyse S000002 abgeschlossen (Claude), Work-Log: logs/S000002.md');
    expect(result.stdout).toContain('Analyse-Cursor: S000002; offene Analysen: keine');

    expect(modelCalls).toHaveLength(1);
    const input = inputOf(modelCalls[0]);
    expect(input).toMatchObject({ purpose: 'analysis', promptVersion: 'analyze-work@1', snapshotId: 'S000002', previousSnapshotId: 'S000001' });
    expect(validate('analysis-input', input)).toEqual({ ok: true });

    const record = await recordOf(env.workspace, 'S000002');
    expect(record.analysis?.implemented[0]?.evidence).toEqual([input.evidence.find((entry) => entry.kind === 'state_delta')?.id]);
    expect(record.provenance).toMatchObject({
      attempt: 1,
      cliVersion: '9.9.9',
      models: ['claude-fake-model'],
      promptVersion: 'analyze-work@1',
      outputSchemaVersion: 'analysis-output@1',
      inputSha256: modelCalls[0]?.stdinSha256,
      notesUsed: [],
      contextUsed: [],
    });

    const analysisText = await readFile(`${env.workspace}/analyses/S000002/analysis.json`);
    const log = await readFile(`${env.workspace}/logs/S000002.md`, 'utf8');
    expect(log).toContain(`> ${AI_NOTICE}`);
    expect(log).toMatch(/\[E\d{3}\]/);
    const complete = await readJsonFile<CompleteMarker>(`${env.workspace}/analyses/S000002/complete.json`);
    expect(validate('complete', complete)).toEqual({ ok: true });
    expect(complete).toMatchObject({ snapshotId: 'S000002', analysisSha256: sha256(analysisText), logSha256: sha256(log) });

    const manifest = await readManifestFile(env.workspace, 'S000002');
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002', lastCommit: manifest.git.head });
    expect(manifest.git.head).toBe((await env.repo.git('rev-parse', 'HEAD')).trim());

    const attempt = `${env.workspace}/analyses/S000002/attempt-1`;
    expect(await namesIn(attempt)).toEqual(['input.json', 'outcome.json', 'prompt.md', 'response.json', 'schema.json', 'stderr.txt']);
    expect(sha256(await readFile(`${attempt}/input.json`))).toBe(modelCalls[0]?.stdinSha256);
    expect(await readFile(`${attempt}/prompt.md`, 'utf8')).toBe(await readFile(`${TOOL_ROOT}/prompts/analyze-work.md`, 'utf8'));
    expect(await outcomeOf(env.workspace, 'S000002', 1)).toMatchObject({ outcome: 'success', errorCode: null, attempt: 1 });

    const usage = (await readJsonl<AiUsageRecord>(`${env.workspace}/ai-usage.jsonl`, 'ai-usage')).records;
    expect(usage.filter((line) => line.purpose === 'analysis')).toEqual([
      expect.objectContaining({ subjectId: 'S000002', promptVersion: 'analyze-work@1', outputSchemaVersion: 'analysis-output@1', outcome: 'success' }),
    ]);
    expect(await lastRunOf(env.workspace)).toMatchObject({
      command: 'capture',
      exitCode: 0,
      outcome: 'ok',
      snapshotCreated: 'S000002',
      analysesCompleted: ['S000001', 'S000002'],
      analysesFailed: [],
    });
  });

  it('ruft ohne Änderung und ohne offene Analysen die Fake-CLI nicht auf und schreibt keinen Log (AK-06-02)', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', 'eins\nzwei\n');
    expect((await ipa(env, ['capture'])).result.exitCode).toBe(0);
    const logsBefore = await listTree(`${env.workspace}/logs`);

    const again = await ipa(env, ['capture']);
    expect(again.result.exitCode, again.result.stderr).toBe(0);
    expect(again.calls).toEqual([]);
    expect(again.result.stdout).toContain('Keine neue Arbeit');
    expect(await listTree(`${env.workspace}/logs`)).toEqual(logsBefore);
    expect(await lastRunOf(env.workspace)).toMatchObject({ outcome: 'unchanged', analysesCompleted: [], snapshotCreated: null });
  });

  it('analysiert bei unverändertem Zustand genau den offenen Snapshot (AK-06-03)', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await captureOnly(env);
    expect(await namesIn(`${env.workspace}/analyses`)).toEqual([]);

    const { result, modelCalls } = await ipa(env, ['capture']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(modelCalls.map((call) => inputOf(call).snapshotId)).toEqual(['S000002']);
    expect(await lastRunOf(env.workspace)).toMatchObject({ outcome: 'unchanged', snapshotCreated: null, analysesCompleted: ['S000001', 'S000002'] });
    expect((await statusOf(env))['analyses']).toEqual({
      pending: 0,
      failed: 0,
      blocked: 0,
      exhausted: 0,
      complete: 2,
      skipped: 0,
      notRequired: 0,
      openIds: [],
    });
  });

  it('schliesst Ausgangs-Snapshot und reine Statusänderungen ohne Claude mit deterministischem Log ab (AK-06-12)', async () => {
    const env = await pipelineRepo();
    const first = await ipa(env, ['capture']);
    expect(first.result.exitCode, first.result.stderr).toBe(0);
    expect(first.calls).toEqual([]);
    const baseline = await recordOf(env.workspace, 'S000001');
    expect(baseline).toMatchObject({ analysis: null, provenance: { deterministic: true } });
    const baselineLog = await readFile(`${env.workspace}/logs/S000001.md`, 'utf8');
    expect(baselineLog.split('\n')[0]).toBe(`# Work-Log S000001: ${BASELINE_HEADING}`);
    expect(baselineLog).toContain(DETERMINISTIC_NOTICE);
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000001' });

    await env.repo.write('a.txt', 'eins\nzwei\n');
    expect((await ipa(env, ['capture'])).modelCalls).toHaveLength(1);
    // The documented state is committed unchanged: only a status change (AK-03-03).
    await env.repo.commit('Zwei');
    const status = await ipa(env, ['capture']);
    expect(status.result.exitCode, status.result.stderr).toBe(0);
    expect(status.calls).toEqual([]);
    const manifest = await readManifestFile(env.workspace, 'S000003');
    expect(manifest.analysisRequired).toBe(false);
    expect(await recordOf(env.workspace, 'S000003')).toMatchObject({ analysis: null, statusChanges: [{ path: 'a.txt', to: 'committed' }] });
    const log = await readFile(`${env.workspace}/logs/S000003.md`, 'utf8');
    expect(log).not.toContain(BASELINE_HEADING);
    expect(log).toMatch(/`a\.txt`: unstaged → committed \(Commit `[0-9a-f]{12}`\), bereits dokumentiert \[S000002:E\d{3}\]/);
    expect(log).toMatch(/- Commits:\n {2}- `[0-9a-f]{12}` Zwei \[E001\]/);
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000003' });
  });

  it('verarbeitet bei aktivem Halt offene Snapshots und endet mit Exit-Code 4, auch wenn die Analyse scheitert (AK-06-16)', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await captureOnly(env);
    await env.repo.git('checkout', '-q', '-b', 'anderer');

    const failing = await ipa(env, ['capture'], 'error-result');
    expect(failing.result.exitCode, failing.result.stderr).toBe(4);
    expect(failing.result.stderr).toContain('Angehalten');
    expect(failing.result.stderr).toContain('error_result');
    expect(await lastRunOf(env.workspace)).toMatchObject({ exitCode: 4, outcome: 'halted', analysesFailed: ['S000002'] });

    const halted = await ipa(env, ['capture']);
    expect(halted.result.exitCode, halted.result.stderr).toBe(4);
    expect(halted.modelCalls.map((call) => inputOf(call).snapshotId)).toEqual(['S000002']);
    expect(await namesIn(`${env.workspace}/snapshots`)).toEqual(['S000001', 'S000002']);
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002', halt: { reason: 'branch_changed' } });
    expect(await lastRunOf(env.workspace)).toMatchObject({ exitCode: 4, outcome: 'halted', analysesCompleted: ['S000002'] });
  });

  it('läuft mit Arbeitsbereich .ipa im Repository; Claude arbeitet ausserhalb, das Repository bleibt ausserhalb von .ipa unverändert (AK-06-21)', async () => {
    const env = await pipelineRepo({ init: ['--workspace', '.ipa'] });
    expect(env.workspace).toBe(`${env.repo.root}/.ipa`);
    await env.repo.write('a.txt', 'eins\nzwei\n');
    const { result, modelCalls } = await ipa(env, ['capture']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(modelCalls).toHaveLength(1);
    const cwd = modelCalls[0]!.cwd!;
    expect(isSameOrInside(cwd, env.repo.root)).toBe(false);
    expect(isSameOrInside(cwd, env.workspace)).toBe(false);
    expect(modelCalls[0]!.cwdFiles).toEqual(['prompt.md']);
    await recordOf(env.workspace, 'S000002');
    expect(await namesIn(`${env.workspace}/logs`)).toEqual(['S000001.md', 'S000002.md']);

    // Own outputs in .ipa/ are no work (AK-03-15): nothing new, no call.
    const again = await ipa(env, ['capture']);
    expect(again.result.exitCode, again.result.stderr).toBe(0);
    expect(again.calls).toEqual([]);
    expect(await namesIn(`${env.workspace}/snapshots`)).toEqual(['S000001', 'S000002']);
  });
});
