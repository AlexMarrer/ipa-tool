import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type SchemaId, validate } from '../../src/core/schemas.js';
import { captureOnly, ipa, namesIn, type PipelineEnv, pipelineRepo, startLockHolder, stopLockHolder } from '../helpers/analysis.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { createSecretMarker, secretAssignment } from '../helpers/secrets.js';
import { initRepo } from '../helpers/snapshots.js';
import { type CliResult, createTempDataRoot, readJsonFile, runCli } from '../helpers/workspace.js';

interface Envelope {
  schemaVersion: number;
  command: string;
  runId: string | null;
  ok: boolean;
  exitCode: number;
  outcome: string;
  errors: { code: string; message: string }[];
  warnings: string[];
  result: Record<string, unknown> | null;
}

/** stdout holds exactly one JSON object that matches the schema of the command (AK-09-01). */
function envelopeOf(command: string, result: CliResult, exitCode: number): Envelope {
  expect(result.exitCode, result.stderr).toBe(exitCode);
  expect(result.stdout.endsWith('}\n')).toBe(true);
  const value = JSON.parse(result.stdout) as Envelope;
  expect(validate(`cli-${command}` as SchemaId, value)).toEqual({ ok: true });
  expect(value).toMatchObject({ schemaVersion: 1, command, ok: exitCode === 0, exitCode });
  return value;
}

async function withChange(env: PipelineEnv, file = 'b.txt'): Promise<void> {
  await env.repo.write(file, `${file}\n`);
}

describe('--json der Aktionsbefehle (Paket 09 §4.1)', () => {
  it('init liefert IDs und Pfade und lässt stderr unverändert (AK-09-01, AK-09-02, AK-09-03)', async () => {
    const dataDir = await createTempDataRoot();
    const plain = await createTempRepo({ name: 'gleich' });
    const json = await createTempRepo({ name: 'gleich' });
    const dataDirPlain = await createTempDataRoot();
    const before = await runCli(['init'], { dataDir: dataDirPlain, repo: plain.root });
    const after = await runCli(['init', '--json'], { dataDir, repo: json.root });
    const envelope = envelopeOf('init', after, 0);
    expect(after.stderr).toBe(before.stderr);
    expect(envelope).toMatchObject({ outcome: 'ok', errors: [], result: { created: true, workspaceMode: 'default', timezone: 'Europe/Zurich', baselineSnapshotId: 'S000001', baselineAdopted: false, recovered: [] } });
    expect(envelope.runId).toMatch(/^R\d{8}T\d{6}Z-[0-9a-f]{4}$/);
    expect(envelope.warnings).toEqual(before.stderr.trimEnd().split('\n').filter((line) => line !== ''));

    const status = JSON.parse((await runCli(['status', '--json'], { dataDir, repo: json.root })).stdout) as Record<string, unknown>;
    expect(envelope.result).toMatchObject({ repositoryId: status['repositoryId'], workspacePath: status['workspacePath'], repoPath: status['repoPath'], dataRoot: status['dataRoot'] });
    // `status --json` keeps its own contract without the envelope.
    expect(Object.keys(status).slice(0, 2)).toEqual(['repositoryId', 'repoPath']);
    expect(status).not.toHaveProperty('schemaVersion');
  });

  it('capture liefert Snapshot, Pfade, Zähler, Analyse und offene Analysen (AK-09-02)', async () => {
    const env = await pipelineRepo();
    await withChange(env);
    const { result } = await ipa(env, ['capture', '--json']);
    const envelope = envelopeOf('capture', result, 0);
    expect(envelope).toMatchObject({ outcome: 'ok', errors: [] });
    const data = envelope.result as Record<string, any>; // JSON of the test, shape checked by the schema above
    expect(data['capture']).toBe('created');
    expect(data['snapshot']).toMatchObject({ id: 'S000002', kind: 'work', commits: 0, fileStates: 1, evidence: 2, stateDeltas: 1, analysisRequired: true });
    expect(existsSync(data['snapshot'].manifestPath)).toBe(true);
    expect(data['analysis']).toMatchObject({ claudeCalls: 1, failed: [], open: [], cursor: 'S000002', stoppedBy: null });
    // The first run also closes the baseline without Claude (D-08).
    expect(data['analysis'].completed).toEqual([
      { snapshotId: 'S000001', mode: 'deterministic', workLogPath: expect.stringMatching(/logs\/S000001\.md$/) },
      { snapshotId: 'S000002', mode: 'ai', workLogPath: expect.stringMatching(/logs\/S000002\.md$/) },
    ]);
    expect(existsSync(data['analysis'].completed[1].workLogPath)).toBe(true);
    expect(data['analyses']).toMatchObject({ pending: 0, failed: 0, openIds: [] });
    expect(data['outsideWindow']).toBeNull();
  });

  it('capture --no-analysis meldet die offenen Analysen, ohne analysis (AK-09-02)', async () => {
    const env = await pipelineRepo();
    await withChange(env);
    const envelope = envelopeOf('capture', await captureOnly(env).then(() => ipa(env, ['capture', '--no-analysis', '--json']).then((run) => run.result)), 0);
    // The first run stored S000002 already; the second finds nothing new.
    expect(envelope).toMatchObject({ outcome: 'unchanged', result: { capture: 'unchanged', snapshot: null, analysis: null, analyses: { pending: 1, openIds: ['S000002'] } } });
  });

  it('capture ohne neue Arbeit meldet unchanged', async () => {
    const env = await pipelineRepo();
    const envelope = envelopeOf('capture', (await ipa(env, ['capture', '--json'])).result, 0);
    expect(envelope).toMatchObject({ outcome: 'unchanged', result: { capture: 'unchanged', snapshot: null, analysis: { claudeCalls: 0, failed: [], open: [] } } });
  });

  it('capture --scheduled ausserhalb des Fensters meldet outside_window ohne Snapshot und ohne Analyse (AK-09-04)', async () => {
    const env = await pipelineRepo();
    const config = await readJsonFile<{ schedule: Record<string, unknown> }>(`${env.workspace}/config.json`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${env.workspace}/config.json`, JSON.stringify({ ...config, schedule: { ...config.schedule, workdays: [] } }));
    const run = await ipa(env, ['capture', '--scheduled', '--json']);
    const envelope = envelopeOf('capture', run.result, 0);
    expect(envelope).toMatchObject({
      outcome: 'outside_window',
      result: { scheduled: true, capture: 'skipped', outsideWindow: { reason: 'weekday' }, snapshot: null, analysis: null, analyses: null },
    });
    expect(run.modelCalls).toEqual([]);
    // Nothing on stdout without --json (package 08 §4), the JSON object only with it.
    expect((await ipa(env, ['capture', '--scheduled'])).result.stdout).toBe('');
  });

  it('capture bei einem Halt liefert das Halt-Objekt und Exit-Code 4 (AK-09-04)', async () => {
    const env = await pipelineRepo();
    await env.repo.git('checkout', '-q', '-b', 'anderer');
    const envelope = envelopeOf('capture', (await ipa(env, ['capture', '--no-analysis', '--json'])).result, 4);
    expect(envelope).toMatchObject({ ok: false, outcome: 'halted', errors: [], result: { capture: 'halted', halt: { reason: 'branch_changed' }, snapshot: null } });
  });

  it('capture mit ungültiger KI-Antwort liefert Exit-Code 6, das Ergebnis und die Fehler (AK-09-04)', async () => {
    const env = await pipelineRepo();
    await withChange(env);
    const run = await ipa(env, ['capture', '--json'], 'invalid-json');
    const envelope = envelopeOf('capture', run.result, 6);
    expect(envelope).toMatchObject({ ok: false, outcome: 'analysis_failed', result: { capture: 'created', analysis: { claudeCalls: 1, cursor: 'S000001' } } });
    expect(envelope.errors).toHaveLength(1);
    expect(envelope.errors[0]).toMatchObject({ code: expect.any(String) });
    const analysis = (envelope.result as Record<string, any>)['analysis']; // JSON of the test
    expect(analysis.failed).toHaveLength(1);
    expect(analysis.open).toEqual([{ snapshotId: 'S000002', status: 'failed' }]);
  });

  it('capture bei gehaltenem Lock liefert Exit-Code 3 ohne Ergebnis (AK-09-04)', async () => {
    const env = await pipelineRepo();
    const holder = await startLockHolder(env.workspace);
    try {
      const envelope = envelopeOf('capture', (await ipa(env, ['capture', '--json'])).result, 3);
      expect(envelope).toMatchObject({ ok: false, outcome: 'lock_held', result: null, errors: [{ code: 'lock_held' }] });
      expect(envelope.runId).not.toBeNull();
    } finally {
      await stopLockHolder(holder);
    }
  });

  it('ein Bedienungsfehler liefert die Hülle ohne Ergebnis, ein Commander-Fehler nur stderr (AK-09-04)', async () => {
    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    const notInitialised = await runCli(['capture', '--json'], { dataDir, repo: repo.root });
    const envelope = envelopeOf('capture', notInitialised, 2);
    expect(envelope).toMatchObject({ outcome: 'usage_error', runId: null, result: null, errors: [{ code: 'not_initialized' }] });
    expect(notInitialised.stderr).toContain('nicht initialisiert');

    const unknown = await runCli(['capture', '--json', '--gibt-es-nicht'], { dataDir, repo: repo.root });
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stdout).toBe('');
    expect(unknown.stderr).toContain('unbekannte Option');
  });

  it('note liefert ID, Tag und Pfad, nie den Text; Treffer der Secret-Prüfung stehen als Detektor (AK-09-02, AK-09-05)', async () => {
    const env = await pipelineRepo();
    await withChange(env);
    await captureOnly(env);
    const plain = await runCli(['note', 'Recherche zur Testkonfiguration', '--type', 'activity', '--minutes', '45', '--measured'], { dataDir: env.dataDir, repo: env.repo.root });
    const json = await runCli(['note', '--json', '--type', 'activity', '--minutes', '45', '--measured', '--ref', 'S000002:E001', '--', '- Recherche zur Testkonfiguration'], { dataDir: env.dataDir, repo: env.repo.root });
    expect(plain.exitCode).toBe(0);
    const envelope = envelopeOf('note', json, 0);
    expect(envelope.result).toMatchObject({
      type: 'activity',
      time: { minutes: 45, basis: 'measured', start: null, end: null },
      delay: null,
      refs: ['S000002:E001'],
      secretFindings: [],
    });
    const data = envelope.result as Record<string, any>; // JSON of the test
    expect(existsSync(data['notePath'])).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('Recherche');

    const marker = createSecretMarker();
    const secret = await runCli(['note', '--json', secretAssignment(marker)], { dataDir: env.dataDir, repo: env.repo.root });
    const withSecret = envelopeOf('note', secret, 0);
    expect(withSecret.result).toMatchObject({ secretFindings: [{ field: 'text' }] });
    expect(secret.stdout).not.toContain(marker);
    expect(secret.stderr).not.toContain(marker);
    expect(withSecret.warnings).toHaveLength(1);
    expect(secret.stderr.trim()).toBe(withSecret.warnings[0]);
  });

  it('note --json ohne Text endet mit Exit-Code 2 und legt keine Notiz an (AK-09-05)', async () => {
    const env = await pipelineRepo();
    const run = await runCli(['note', '--json', '--type', 'plan'], { dataDir: env.dataDir, repo: env.repo.root });
    expect(envelopeOf('note', run, 2)).toMatchObject({ outcome: 'usage_error', result: null, errors: [{ code: 'note_needs_text' }] });
    expect(await namesIn(`${env.workspace}/notes`)).toEqual([]);
  });

  it('skip und baseline liefern Pfade und Cursor (AK-09-02)', async () => {
    const env = await pipelineRepo();
    await withChange(env);
    await captureOnly(env);
    const skipRun = (await ipa(env, ['skip', 'S000002', '--reason', 'GRUND-NICHT-IM-JSON-1', '--json'])).result;
    const skipped = envelopeOf('skip', skipRun, 0);
    expect(skipRun.stdout).not.toContain('GRUND-NICHT-IM-JSON-1');
    expect(skipped.result).toMatchObject({ snapshotId: 'S000002', previousStatus: 'pending', cursor: null, recovered: [] });
    expect(existsSync((skipped.result as Record<string, string>)['skipPath']!)).toBe(true);

    const missing = envelopeOf('skip', (await ipa(env, ['skip', 'S000009', '--reason', 'Test', '--json'])).result, 2);
    expect(missing).toMatchObject({ outcome: 'usage_error', result: null });

    await env.repo.git('checkout', '-q', '-b', 'anderer');
    const halted = envelopeOf('capture', (await ipa(env, ['capture', '--no-analysis', '--json'])).result, 4);
    expect(halted.outcome).toBe('halted');
    const baselineRun = (await ipa(env, ['baseline', '--reason', 'GRUND-NICHT-IM-JSON-2', '--json'])).result;
    const baseline = envelopeOf('baseline', baselineRun, 0);
    expect(baselineRun.stdout).not.toContain('GRUND-NICHT-IM-JSON-2');
    expect(baseline.result).toMatchObject({ snapshotId: 'S000003', forced: false, endedHalt: { reason: 'branch_changed' }, recovered: [] });
    expect(existsSync((baseline.result as Record<string, string>)['manifestPath']!)).toBe(true);
    const forced = envelopeOf('baseline', (await ipa(env, ['baseline', '--reason', 'Nach einer Pause', '--force', '--json'])).result, 0);
    expect(forced.result).toMatchObject({ snapshotId: 'S000004', forced: true, endedHalt: null });
    const refused = envelopeOf('baseline', (await ipa(env, ['baseline', '--reason', 'Ohne Halt', '--json'])).result, 2);
    expect(refused).toMatchObject({ result: null, errors: [{ code: 'no_halt' }] });
  });

  it('journal liefert Pfade des Entwurfs mit und ohne KI und bei Exit-Code 6 den Fehler (AK-09-02, AK-09-04)', async () => {
    const env = await pipelineRepo();
    await withChange(env);
    await ipa(env, ['capture']);
    await runCli(['note', 'Besprechung mit der Fachperson'], { dataDir: env.dataDir, repo: env.repo.root });

    const noAi = envelopeOf('journal', (await ipa(env, ['journal', '--no-ai', '--json'], 'journal')).result, 0);
    expect(noAi.result).toMatchObject({ mode: 'no_ai', noAiReason: 'requested', failure: null, openItems: { analyses: [] } });
    const data = noAi.result as Record<string, any>; // JSON of the test
    expect(data['draftPath']).toMatch(/journal\/drafts\/\d{4}-\d{2}-\d{2}-R.*\.md$/);
    expect(existsSync(data['draftPath'])).toBe(true);
    expect(existsSync(data['recordPath'])).toBe(true);
    expect(data['runDir']).toBeNull();

    const ai = await ipa(env, ['journal', '--json'], 'journal');
    const aiEnvelope = envelopeOf('journal', ai.result, 0);
    expect(aiEnvelope.result).toMatchObject({ mode: 'ai', noAiReason: null });
    expect(ai.modelCalls).toHaveLength(1);
    expect(existsSync((aiEnvelope.result as Record<string, string>)['runDir']!)).toBe(true);

    const failed = envelopeOf('journal', (await ipa(env, ['journal', '--json'], 'invalid-json')).result, 6);
    expect(failed).toMatchObject({ ok: false, outcome: 'analysis_failed', result: { mode: null, draftPath: null, recordPath: null, failure: { code: expect.any(String) } } });
    expect(failed.errors).toHaveLength(1);

    const badDay = envelopeOf('journal', (await ipa(env, ['journal', '--day', 'gestern', '--json'])).result, 2);
    expect(badDay).toMatchObject({ result: null, errors: [{ code: 'day_invalid' }] });
  });

  it('doctor liefert Version, Anmeldeart, Optionen und Kostenschutz, bei fehlendem Claude Exit-Code 7 (AK-09-02, AK-09-04)', async () => {
    const env = await pipelineRepo();
    const ready = envelopeOf('doctor', (await ipa(env, ['doctor', '--json'], 'ok')).result, 0);
    expect(ready.result).toMatchObject({
      live: false,
      ok: true,
      git: { found: true },
      claude: { found: true, loggedIn: true },
      liveCheck: null,
      missingFlags: [],
      billing: { detected: false, allowPaidUsage: false, blocked: false },
      findings: [],
    });

    const repo = await createTempRepo();
    const dataDir = await createTempDataRoot();
    await initRepo(repo, dataDir);
    // `claude` is hidden from the PATH of the tests, so the check fails.
    const failed = envelopeOf('doctor', await runCli(['doctor', '--json'], { dataDir, repo: repo.root }), 7);
    expect(failed).toMatchObject({ ok: false, outcome: 'error', errors: [{ code: 'doctor_failed' }], result: { ok: false, claude: { found: false } } });
    expect((failed.result as Record<string, string[]>)['findings']!.length).toBeGreaterThan(0);
  });

  it('weist ein Ergebnis ab, das nicht zum Schema passt', () => {
    const value = { schemaVersion: 1, command: 'note', runId: null, ok: true, exitCode: 0, outcome: 'ok', errors: [], warnings: [], result: { noteId: 'x' } };
    expect(validate('cli-note', value).ok).toBe(false);
    expect(validate('cli-skip', value).ok).toBe(false);
    expect(validate('cli-note', { ...value, extra: 1, result: null }).ok).toBe(false);
  });
});
