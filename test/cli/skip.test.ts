import { describe, expect, it } from 'vitest';
import type { SkipMarker } from '../../src/analysis/types.js';
import { validate } from '../../src/core/schemas.js';
import { captureOnly, ipa, lastRunOf, namesIn, pipelineRepo, stateOf, statusOf } from '../helpers/analysis.js';
import { createSecretMarker, secretAssignment } from '../helpers/secrets.js';
import { readJsonFile } from '../helpers/workspace.js';

describe('ipa skip (AK-06-13)', () => {
  it('setzt den Status skipped, führt den Cursor weiter und protokolliert den Lauf', async () => {
    const env = await pipelineRepo();
    // The first capture closes the baseline, so that the cursor can pass it.
    expect((await ipa(env, ['capture'])).result.exitCode).toBe(0);
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await captureOnly(env);
    expect(((await statusOf(env))['analyses'] as { openIds: string[] }).openIds).toEqual(['S000002']);

    const skip = await ipa(env, ['skip', 'S000002', '--reason', '  Nur Formatierung, keine eigene Leistung  ']);
    expect(skip.result.exitCode, skip.result.stderr).toBe(0);
    expect(skip.calls).toEqual([]);
    expect(skip.result.stdout).toContain('Analyse S000002 übersprungen (vorher pending)');
    expect(skip.result.stdout).toContain('Analyse-Cursor: S000002');
    const marker = await readJsonFile<SkipMarker>(`${env.workspace}/analyses/S000002/skip.json`);
    expect(validate('skip', marker)).toEqual({ ok: true });
    expect(marker).toMatchObject({ snapshotId: 'S000002', reason: 'Nur Formatierung, keine eigene Leistung' });
    const head = (await env.repo.git('rev-parse', 'HEAD')).trim();
    expect(await stateOf(env.workspace)).toMatchObject({ lastAnalysedSnapshotId: 'S000002', lastCommit: head });
    expect(await lastRunOf(env.workspace)).toMatchObject({ command: 'skip', exitCode: 0, outcome: 'ok' });
    expect((await statusOf(env))['analyses']).toMatchObject({ skipped: 1, complete: 1, openIds: [] });
    const human = await ipa(env, ['status']);
    expect(human.result.stdout).toMatch(/Analysen:\s+1 abgeschlossen, 1 übersprungen/);

    // Skipped snapshots are not analysed later.
    const next = await ipa(env, ['capture']);
    expect(next.result.exitCode).toBe(0);
    expect(next.calls).toEqual([]);
    expect(await namesIn(`${env.workspace}/logs`)).toEqual(['S000001.md']);
  });

  it('lehnt abgeschlossene, unbekannte und nicht offene Snapshots sowie leere oder geheime Gründe mit Exit-Code 2 ab', async () => {
    const env = await pipelineRepo();
    await env.repo.write('a.txt', 'eins\nzwei\n');
    expect((await ipa(env, ['capture'])).result.exitCode).toBe(0);
    await env.repo.write('b.txt', 'b\n');
    await captureOnly(env);

    const cases: [string[], string][] = [
      [['skip', 'S000002', '--reason', 'Schon analysiert'], 'complete'],
      [['skip', 'S000001', '--reason', 'Ausgangslage'], 'complete'],
      [['skip', 'S000009', '--reason', 'Gibt es nicht'], 'gibt es in diesem Arbeitsbereich nicht'],
      [['skip', 'S9', '--reason', 'Falsches Format'], 'Ungültige Snapshot-ID'],
      [['skip', 'S000003', '--reason', '   '], 'nicht leeren Grund'],
    ];
    for (const [args, expected] of cases) {
      const { result } = await ipa(env, args);
      expect(result.exitCode, args.join(' ')).toBe(2);
      expect(result.stderr, args.join(' ')).toContain(expected);
    }
    const secret = createSecretMarker();
    const withSecret = await ipa(env, ['skip', 'S000003', '--reason', secretAssignment(secret)]);
    expect(withSecret.result.exitCode).toBe(2);
    expect(`${withSecret.result.stdout}${withSecret.result.stderr}`).not.toContain(secret);
    expect(await namesIn(`${env.workspace}/analyses/S000003`)).toEqual([]);
    expect((await ipa(env, ['skip', 'S000003'])).result.exitCode).toBe(2);
    expect(await lastRunOf(env.workspace)).toMatchObject({ command: 'skip', exitCode: 2, outcome: 'usage_error' });

    // Committing the documented states unchanged gives a snapshot that the queue closes without Claude.
    await env.repo.commit('Alles');
    await captureOnly(env);
    expect((await statusOf(env))['analyses']).toMatchObject({ notRequired: 1, openIds: ['S000003'] });
    const notRequired = await ipa(env, ['skip', 'S000004', '--reason', 'Nur Statusänderung']);
    expect(notRequired.result.exitCode).toBe(2);
    expect(notRequired.result.stderr).toContain('not_required');
  });
});
