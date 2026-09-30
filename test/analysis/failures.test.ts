import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { AnalysisInput, AnalysisOutput } from '../../src/analysis/types.js';
import { useFakeClaude } from '../helpers/claude.js';
import {
  captureOnly,
  inputOf,
  ipa,
  lastRunOf,
  namesIn,
  outcomeOf,
  type PipelineEnv,
  pipelineRepo,
  stateOf,
  statusOf,
} from '../helpers/analysis.js';
import { evidenceFor, readManifestFile, setLimits } from '../helpers/snapshots.js';
import { createTempDir, readJsonFile } from '../helpers/workspace.js';

async function expectOpen(env: PipelineEnv, snapshotId: string, status: string): Promise<void> {
  const analyses = (await statusOf(env))['analyses'] as { openIds: string[] } & Record<string, unknown>;
  expect(analyses.openIds).toContain(snapshotId);
  expect(analyses[status]).toBe(1);
  expect(await namesIn(`${env.workspace}/analyses/${snapshotId}`)).not.toContain('complete.json');
  expect(await namesIn(`${env.workspace}/logs`)).not.toContain(`${snapshotId}.md`);
  // The baseline is closed deterministically; the cursor stays there (I-03).
  expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000001' });
}

describe('Fehlerfälle der Analyse (spec.md §12.5)', () => {
  it('lässt den Snapshot bei jeder Fehlerklasse offen, bis zum Status exhausted; --retry erlaubt einen neuen Versuch (AK-06-04)', async () => {
    const env = await pipelineRepo({ claude: { maxAttemptsPerSnapshot: 20 } });
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await captureOnly(env);
    const commands = await createTempDir('befehle');
    const notExecutable = process.platform === 'win32' ? `${commands}/claude.cmd` : `${commands}/claude-ohne-rechte`;
    await writeFile(notExecutable, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\necho 1\n');
    if (process.platform !== 'win32') await chmod(notExecutable, 0o644);

    const classes: { mode: string; outcome: string; errorCode: string; claude?: Record<string, unknown> }[] = [
      { mode: 'error-result', outcome: 'claude_error', errorCode: 'error_result' },
      { mode: 'invalid-json', outcome: 'invalid_response', errorCode: 'invalid_envelope' },
      { mode: 'no-structured', outcome: 'invalid_response', errorCode: 'missing_structured_output' },
      { mode: 'exit-nonzero', outcome: 'claude_error', errorCode: 'nonzero_exit' },
      { mode: 'hang', outcome: 'claude_error', errorCode: 'timeout', claude: { timeoutSeconds: 1 } },
      // doctor.json already reports a usable Claude, so the runner itself hits the start error.
      { mode: 'analysis', outcome: 'claude_error', errorCode: 'not_found', claude: { command: [`${commands}/claude-gibt-es-nicht`] } },
      { mode: 'analysis', outcome: 'claude_error', errorCode: 'not_executable', claude: { command: [notExecutable] } },
    ];
    for (const [index, entry] of classes.entries()) {
      const attempt = index + 1;
      await useFakeClaude(env.workspace, { maxAttemptsPerSnapshot: 20, timeoutSeconds: 600, ...entry.claude });
      const { result } = await ipa(env, ['capture'], entry.mode);
      expect(result.exitCode, `${entry.errorCode}: ${result.stderr}`).toBe(6);
      expect(result.stderr).toContain(`Analyse S000002 nicht abgeschlossen (${entry.errorCode})`);
      expect(await outcomeOf(env.workspace, 'S000002', attempt)).toMatchObject({ attempt, outcome: entry.outcome, errorCode: entry.errorCode });
      await stat(`${env.workspace}/analyses/S000002/attempt-${attempt}/response.json`);
      await expectOpen(env, 'S000002', 'failed');
      expect(await lastRunOf(env.workspace)).toMatchObject({ exitCode: 6, outcome: 'analysis_failed', analysesFailed: ['S000002'] });
    }

    // Seven failed attempts reach a limit of seven: no further call.
    await useFakeClaude(env.workspace, { maxAttemptsPerSnapshot: classes.length });
    const exhausted = await ipa(env, ['capture']);
    expect(exhausted.result.exitCode).toBe(6);
    expect(exhausted.modelCalls).toEqual([]);
    expect(exhausted.result.stderr).toContain('ipa capture --retry S000002');
    await expectOpen(env, 'S000002', 'exhausted');
    expect(await namesIn(`${env.workspace}/analyses/S000002`)).not.toContain(`attempt-${classes.length + 1}`);

    const retried = await ipa(env, ['capture', '--retry', 'S000002']);
    expect(retried.result.exitCode, retried.result.stderr).toBe(0);
    expect(retried.result.stdout).toContain(`Weitere Versuche für S000002 freigegeben (retry-${classes.length}.json)`);
    expect(retried.modelCalls).toHaveLength(1);
    expect(await outcomeOf(env.workspace, 'S000002', classes.length + 1)).toMatchObject({ outcome: 'success' });
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002' });

    const again = await ipa(env, ['capture', '--retry', 'S000002']);
    expect(again.result.exitCode).toBe(2);
    expect(again.result.stderr).toContain('exhausted');
    expect((await ipa(env, ['capture', '--retry', 'S000099'])).result.exitCode).toBe(2);
  });

  it('lehnt Antworten mit Schemafehler, unbekannter ID oder Regelverstoss ab und übernimmt sie nicht (AK-06-05)', async () => {
    const env = await pipelineRepo({ claude: { maxAttemptsPerSnapshot: 20 } });
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await env.repo.commit('Zwei');
    await captureOnly(env);
    const manifest = await readManifestFile(env.workspace, 'S000002');
    const message = evidenceFor(manifest, 'commit_message', null).id;
    const delta = evidenceFor(manifest, 'state_delta', 'a.txt').id;
    const base: AnalysisOutput = {
      summary: { text: 'Zweite Zeile ergänzt.', evidence: [delta] },
      implemented: [{ title: 'Zeile', description: 'Zweite Zeile.', evidence: [delta] }],
      decisions: [],
      problems: [],
      tests: [],
      contradictions: [],
      unknowns: [],
    };
    const answers: [string, unknown][] = [
      ['schema_invalid', { summary: base.summary }],
      ['evidence_invalid', { ...base, implemented: [{ ...base.implemented[0]!, evidence: ['E999'] }] }],
      ['rule_violation', { ...base, implemented: [{ ...base.implemented[0]!, evidence: [message] }] }],
      ['rule_violation', { ...base, tests: [{ description: 'Tests', result: 'passed', evidence: [delta] }] }],
      ['rule_violation', { ...base, decisions: [{ title: 'T', description: 'D', rationale: 'Grund', alternatives: [], evidence: [delta] }] }],
      ['rule_violation', { ...base, contradictions: [{ description: 'W', evidence: [delta, delta] }] }],
      ['rule_violation', { ...base, implemented: [{ ...base.implemented[0]!, minutes: 30 }] }],
    ];
    for (const [index, [errorCode, answer]] of answers.entries()) {
      const { result } = await ipa(env, ['capture'], 'ok', { FAKE_CLAUDE_OUTPUT: JSON.stringify(answer) });
      expect(result.exitCode, `${index}: ${result.stderr}`).toBe(6);
      expect(await outcomeOf(env.workspace, 'S000002', index + 1)).toMatchObject({ outcome: 'validation_failed', errorCode });
      expect(await readFile(`${env.workspace}/analyses/S000002/attempt-${index + 1}/response.json`, 'utf8')).toContain('structured_output');
      expect(await namesIn(`${env.workspace}/analyses/S000002`)).not.toContain('analysis.json');
      await expectOpen(env, 'S000002', 'failed');
    }
    const valid = await ipa(env, ['capture'], 'ok', { FAKE_CLAUDE_OUTPUT: JSON.stringify(base) });
    expect(valid.result.exitCode, valid.result.stderr).toBe(0);
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002' });
  });

  it('verarbeitet zwei offene Snapshots aufsteigend; scheitert der erste, wird der zweite nicht aufgerufen (AK-06-08)', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await captureOnly(env);
    await env.repo.write('b.txt', 'b\n');
    await captureOnly(env);

    const failing = await ipa(env, ['capture'], 'error-result');
    expect(failing.result.exitCode).toBe(6);
    expect(failing.modelCalls.map((call) => inputOf(call).snapshotId)).toEqual(['S000002']);
    expect(await namesIn(`${env.workspace}/analyses`)).toEqual(['S000001', 'S000002']);
    expect(((await statusOf(env))['analyses'] as { openIds: string[] }).openIds).toEqual(['S000002', 'S000003']);

    const ok = await ipa(env, ['capture']);
    expect(ok.result.exitCode, ok.result.stderr).toBe(0);
    expect(ok.modelCalls.map((call) => inputOf(call).snapshotId)).toEqual(['S000002', 'S000003']);
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000003' });
  });

  it('hält eine Analyse über claude.maxAnalysesPerRun für den nächsten Lauf zurück, ohne Fehler', async () => {
    const env = await pipelineRepo({ claude: { maxAnalysesPerRun: 1 } });
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await captureOnly(env);
    await env.repo.write('b.txt', 'b\n');
    const { result, modelCalls } = await ipa(env, ['capture']);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(modelCalls).toHaveLength(1);
    expect(result.stderr).toContain('claude.maxAnalysesPerRun');
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002' });
    expect(((await statusOf(env))['analyses'] as { pending: number }).pending).toBe(1);
  });

  it('blockiert ein zu grosses Eingabepaket ohne Aufruf und ohne Kürzung; nach Erhöhung der Grenze folgt die Analyse (AK-06-09)', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', `eins\n${'Zeile mit Inhalt\n'.repeat(100)}`);
    await captureOnly(env);
    await setLimits(env.workspace, { maxAnalysisInputBytes: 1000 });

    const blocked = await ipa(env, ['capture']);
    expect(blocked.result.exitCode).toBe(6);
    expect(blocked.calls).toEqual([]);
    expect(blocked.result.stderr).toContain('limits.maxAnalysisInputBytes beträgt 1000 Bytes');
    const outcome = await outcomeOf(env.workspace, 'S000002', 1);
    expect(outcome).toMatchObject({ outcome: 'input_too_large', errorCode: null });
    const inputFile = `${env.workspace}/analyses/S000002/attempt-1/input.json`;
    const bytes = (await stat(inputFile)).size;
    expect(outcome.message).toContain(`${bytes} Bytes`);
    const input = await readJsonFile<AnalysisInput>(inputFile);
    const manifest = await readManifestFile(env.workspace, 'S000002');
    const delta = evidenceFor(manifest, 'state_delta', 'a.txt');
    expect(input.evidence.find((entry) => entry.id === delta.id)?.content).toBe(
      await readFile(`${env.workspace}/snapshots/S000002/${delta.file!}`, 'utf8'),
    );
    expect(await namesIn(`${env.workspace}/analyses/S000002`)).toEqual(['attempt-1']);
    await expectOpen(env, 'S000002', 'blocked');

    // Re-evaluated in every run, without a new attempt folder while still too large.
    expect((await ipa(env, ['capture'])).result.exitCode).toBe(6);
    expect(await namesIn(`${env.workspace}/analyses/S000002`)).toEqual(['attempt-1']);

    await setLimits(env.workspace, { maxAnalysisInputBytes: 524288 });
    const raised = await ipa(env, ['capture']);
    expect(raised.result.exitCode, raised.result.stderr).toBe(0);
    expect(raised.modelCalls).toHaveLength(1);
    expect(await outcomeOf(env.workspace, 'S000002', 2)).toMatchObject({ outcome: 'success' });
  });

  it('lässt den Snapshot offen, wenn das Schreiben von analysis.json scheitert (spec.md §12.5)', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await captureOnly(env);
    // A folder in place of the file makes the atomic rename fail like a full disk.
    await mkdir(`${env.workspace}/analyses/S000002/analysis.json`, { recursive: true });

    const failed = await ipa(env, ['capture']);
    expect(failed.result.exitCode).toBe(6);
    expect(failed.result.stderr).toContain('analysis_store_failed');
    const outcome = await outcomeOf(env.workspace, 'S000002', 1);
    expect(outcome).toMatchObject({ outcome: 'interrupted', errorCode: null });
    expect(outcome.message).toContain('Ablage der Analyse fehlgeschlagen');
    await expectOpen(env, 'S000002', 'failed');

    await rm(`${env.workspace}/analyses/S000002/analysis.json`, { recursive: true });
    const retried = await ipa(env, ['capture']);
    expect(retried.result.exitCode, retried.result.stderr).toBe(0);
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002' });
  });

  it('endet ohne einsatzbereites Claude mit Exit-Code 6, ohne Versuch; der Ausgangs-Snapshot wird trotzdem abgeschlossen', async () => {
    const env = await pipelineRepo();
    await useFakeClaude(env.workspace, { command: ['claude'] });
    await env.repo.write('a.txt', 'eins\nzwei\n');
    const { result } = await ipa(env, ['capture']);
    expect(result.exitCode).toBe(6);
    expect(result.stderr).toContain('Claude ist nicht einsatzbereit');
    expect(await namesIn(`${env.workspace}/analyses`)).toEqual(['S000001']);
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000001' });
    expect(await lastRunOf(env.workspace)).toMatchObject({ exitCode: 6, errors: [{ code: 'claude_not_ready' }] });
  });
});
