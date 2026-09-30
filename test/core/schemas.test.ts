import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/core/config.js';
import { SCHEMA_IDS, type SchemaIssue, validate } from '../../src/core/schemas.js';
import { createInitialState } from '../../src/core/state.js';

function issues(result: ReturnType<typeof validate>): SchemaIssue[] {
  return result.ok ? [] : result.issues;
}

const config = () => createDefaultConfig({ repositoryId: 'projekt-3fa9c1', repoPath: 'C:/GIT/projekt', timezone: 'Europe/Zurich' });

const runRecord = () => ({
  schemaVersion: 1,
  runId: 'R20261014T080312Z-a3f9',
  command: 'init',
  startedAt: '2026-10-14T10:03:12+02:00',
  endedAt: '2026-10-14T10:03:13+02:00',
  durationMs: 1000,
  exitCode: 0,
  outcome: 'ok',
  snapshotCreated: null,
  analysesCompleted: [],
  analysesFailed: [],
  lockBroken: false,
  errors: [],
});

const registry = () => ({
  schemaVersion: 1,
  repositories: [
    {
      repositoryId: 'projekt-3fa9c1',
      repoPath: 'C:/GIT/projekt',
      workspacePath: 'C:/Daten/ipa-assistant/workspaces/projekt-3fa9c1',
      workspaceMode: 'default',
      createdAt: '2026-10-14T10:03:12+02:00',
    },
  ],
});

describe('Schemaregister (spec.md §8.4)', () => {
  it('kompiliert alle Schemas im strikten draft-07-Modus', () => {
    expect(SCHEMA_IDS).toEqual([
      'config',
      'state',
      'registry',
      'run-record',
      'manifest',
      'note',
      'ai-usage',
      'doctor',
      'attempt-outcome',
      'analysis-input',
      'analysis-output',
      'analysis-record',
      'complete',
      'skip',
      'retry',
    ]);
    for (const id of SCHEMA_IDS) {
      expect(() => validate(id, {})).not.toThrow();
    }
  });

  describe('config', () => {
    it('akzeptiert die Standardkonfiguration', () => {
      expect(validate('config', config())).toEqual({ ok: true });
    });

    it('meldet fehlende, unbekannte und falsch typisierte Felder mit JSON-Pfad', () => {
      const missing: Record<string, unknown> = { ...config() };
      delete missing['limits'];
      expect(issues(validate('config', missing))).toContainEqual({ path: '/limits', message: 'Pflichtfeld fehlt' });

      const extra = { ...config(), paths: { ...config().paths, foo: 1 } };
      expect(issues(validate('config', extra))).toContainEqual({ path: '/paths/foo', message: 'unbekanntes Feld' });

      const wrongType = { ...config(), limits: { ...config().limits, maxFileBytes: '10' } };
      expect(issues(validate('config', wrongType))).toContainEqual({ path: '/limits/maxFileBytes', message: 'muss vom Typ integer sein' });

      const badTime = { ...config(), schedule: { ...config().schedule, windowStart: '8:00' } };
      expect(issues(validate('config', badTime))).toContainEqual({ path: '/schedule/windowStart', message: 'hat nicht das erwartete Format' });

      const badDetector = { ...config(), secrets: { extraPatterns: [], disabledDetectors: ['gibt_es_nicht'] } };
      expect(issues(validate('config', badDetector))[0]?.path).toBe('/secrets/disabledDetectors/0');

      expect(issues(validate('config', { ...config(), schemaVersion: 2 }))[0]?.path).toBe('/schemaVersion');
    });
  });

  describe('state', () => {
    it('akzeptiert den Anfangszustand und einen Halt', () => {
      expect(validate('state', createInitialState('projekt-3fa9c1'))).toEqual({ ok: true });
      const halted = {
        ...createInitialState('projekt-3fa9c1'),
        halt: {
          reason: 'branch_changed',
          detectedAt: '2026-10-14T10:03:12+02:00',
          expected: { branch: 'main', head: 'a'.repeat(40) },
          observed: { branch: null, head: 'b'.repeat(40) },
        },
      };
      expect(validate('state', halted)).toEqual({ ok: true });
    });

    it('lehnt ungültige IDs, Commits und Halt-Gründe ab', () => {
      const base = createInitialState('projekt-3fa9c1');
      expect(issues(validate('state', { ...base, lastSnapshotId: 'S12' }))[0]?.path).toBe('/lastSnapshotId');
      expect(issues(validate('state', { ...base, lastCommit: 'xyz' }))[0]?.path).toBe('/lastCommit');
      expect(issues(validate('state', { ...base, nextSnapshotSeq: 0 }))[0]?.path).toBe('/nextSnapshotSeq');
      const badHalt = { ...base, halt: { reason: 'weil', detectedAt: 'gestern', expected: { branch: 'main', head: null }, observed: { branch: 'x', head: null } } };
      const paths = issues(validate('state', badHalt)).map((issue) => issue.path);
      expect(paths).toEqual(expect.arrayContaining(['/halt/reason', '/halt/detectedAt']));
    });
  });

  describe('registry', () => {
    it('akzeptiert einen gültigen Eintrag', () => {
      expect(validate('registry', registry())).toEqual({ ok: true });
    });

    it('lehnt unbekannten Speichermodus, fehlende Felder und ungültige Zeit ab', () => {
      const bad = registry();
      bad.repositories[0]!.workspaceMode = 'irgendwo';
      bad.repositories[0]!.createdAt = '14.10.2026';
      const paths = issues(validate('registry', bad)).map((issue) => issue.path);
      expect(paths).toEqual(expect.arrayContaining(['/repositories/0/workspaceMode', '/repositories/0/createdAt']));
      const missing: Record<string, unknown> = { ...registry().repositories[0] };
      delete missing['repoPath'];
      expect(issues(validate('registry', { schemaVersion: 1, repositories: [missing] }))).toContainEqual({
        path: '/repositories/0/repoPath',
        message: 'Pflichtfeld fehlt',
      });
    });
  });

  describe('run-record', () => {
    it('akzeptiert einen gültigen Laufeintrag', () => {
      expect(validate('run-record', runRecord())).toEqual({ ok: true });
      expect(validate('run-record', { ...runRecord(), errors: [{ code: 'x', message: 'y' }], lockBroken: true })).toEqual({ ok: true });
    });

    it('lehnt ungültiges Ergebnis, Exit-Code, runId und Fehlerobjekte ab', () => {
      const paths = issues(
        validate('run-record', { ...runRecord(), outcome: 'super', exitCode: 9, runId: 'R1', errors: [{ code: 'x' }] }),
      ).map((issue) => issue.path);
      expect(paths).toEqual(expect.arrayContaining(['/outcome', '/exitCode', '/runId', '/errors/0/message']));
    });
  });

  describe('note (spec.md §9.5)', () => {
    const note = (patch: Record<string, unknown> = {}) => ({
      schemaVersion: 1,
      id: 'N20261014T081500Z-0c1d',
      type: 'general',
      text: 'Recherche zur Testkonfiguration',
      activityDay: '2026-10-14',
      recordedAt: '2026-10-14T10:15:00+02:00',
      time: null,
      delay: null,
      reason: null,
      alternatives: [],
      cause: null,
      solution: null,
      refs: [],
      ...patch,
    });

    it('akzeptiert Notizen aller Typen mit Zeit, Verzögerung und Verweisen', () => {
      expect(validate('note', note())).toEqual({ ok: true });
      expect(
        validate('note', note({ type: 'decision', reason: 'Wiederverwendung', alternatives: ['A', 'B'], refs: ['S000001:E001', 'S000002:E0123'] })),
      ).toEqual({ ok: true });
      expect(validate('note', note({ type: 'decision' }))).toEqual({ ok: true });
      expect(validate('note', note({ type: 'problem', cause: 'Falscher Typ', solution: 'Testdaten angepasst' }))).toEqual({ ok: true });
      expect(
        validate(
          'note',
          note({
            type: 'activity',
            time: { minutes: 45, basis: 'estimated', start: '09:10', end: '09:55' },
            delay: { minutes: 20, basis: 'measured' },
          }),
        ),
      ).toEqual({ ok: true });
      expect(validate('note', note({ type: 'plan', time: { minutes: 45, basis: 'measured', start: null, end: null } }))).toEqual({ ok: true });
    });

    it('lehnt ungültige IDs, Typen, Tage, Zeitstempel, Minuten, Basen und Verweise ab', () => {
      const paths = (patch: Record<string, unknown>) => issues(validate('note', note(patch))).map((issue) => issue.path);
      expect(paths({ id: 'R20261014T081500Z-0c1d' })).toEqual(['/id']);
      expect(paths({ type: 'notiz' })).toContain('/type');
      expect(paths({ text: '' })).toEqual(['/text']);
      expect(paths({ activityDay: '2026-13-01' })).toEqual(['/activityDay']);
      expect(paths({ recordedAt: '14.10.2026 10:15' })).toEqual(['/recordedAt']);
      expect(paths({ time: { minutes: 0, basis: 'measured', start: null, end: null } })).toEqual(['/time/minutes']);
      expect(paths({ time: { minutes: 45, basis: 'gefühlt', start: null, end: null } })).toEqual(['/time/basis']);
      expect(paths({ time: { minutes: 45, start: null, end: null } })).toEqual(['/time/basis']);
      expect(paths({ delay: { minutes: 1.5, basis: 'measured' } })).toEqual(['/delay/minutes']);
      expect(paths({ refs: ['S1:E1'] })).toEqual(['/refs/0']);
      expect(paths({ secretSuspected: true })).toEqual(['/secretSuspected']);
    });

    it('verlangt Beginn und Ende gemeinsam', () => {
      expect(issues(validate('note', note({ time: { minutes: 45, basis: 'measured', start: '09:10', end: null } })))).toEqual([
        { path: '/time/end', message: 'muss vom Typ string sein' },
        { path: '/time', message: 'verletzt eine bedingte Regel' },
      ]);
      const onlyEnd = issues(validate('note', note({ time: { minutes: 45, basis: 'measured', start: null, end: '09:55' } })));
      expect(onlyEnd.map((issue) => issue.path)).toEqual(['/time/end', '/time']);
      expect(issues(validate('note', note({ time: { minutes: 45, basis: 'measured', start: '9:10', end: '09:55' } })))[0]?.path).toBe('/time/start');
    });

    it('erlaubt Grund und Alternativen nur bei decision, Ursache und Lösung nur bei problem', () => {
      const paths = (patch: Record<string, unknown>) => issues(validate('note', note(patch))).map((issue) => issue.path);
      expect(paths({ reason: 'weil' })).toEqual(['/reason', '/']);
      expect(paths({ type: 'activity', alternatives: ['A'] })).toEqual(['/alternatives', '/']);
      expect(paths({ type: 'decision', cause: 'x', solution: 'y' })).toEqual(['/cause', '/solution', '/']);
      expect(paths({ type: 'decision', reason: '' })).toEqual(['/reason']);
      expect(paths({ type: 'decision', alternatives: [''] })).toEqual(['/alternatives/0']);
    });
  });
  describe('ai-usage (spec.md §9.12)', () => {
    const usage = (patch: Record<string, unknown> = {}) => ({
      schemaVersion: 1,
      runId: 'R20261014T080312Z-a3f9',
      purpose: 'analysis',
      subjectId: 'S000002',
      startedAt: '2026-10-14T10:03:12+02:00',
      endedAt: '2026-10-14T10:04:01+02:00',
      cliVersion: '2.1.114',
      models: ['claude-opus-4-7'],
      promptVersion: 'analyze-work@1',
      outputSchemaVersion: 'analysis-output@1',
      inputSha256: 'a'.repeat(64),
      inputIds: ['E001', 'N20261014T081500Z-0c1d'],
      outcome: 'success',
      errorCode: null,
      costUsd: 0.12,
      durationMs: 48000,
      ...patch,
    });

    it('akzeptiert Analyse, Journal, Doctor und Fehlschläge', () => {
      expect(validate('ai-usage', usage())).toEqual({ ok: true });
      expect(validate('ai-usage', usage({ purpose: 'journal', subjectId: '2026-10-14' }))).toEqual({ ok: true });
      expect(validate('ai-usage', usage({ purpose: 'doctor', subjectId: null, promptVersion: null, inputSha256: null, inputIds: [] }))).toEqual({ ok: true });
      expect(validate('ai-usage', usage({ outcome: 'claude_error', errorCode: 'timeout', costUsd: null, models: [] }))).toEqual({ ok: true });
      expect(validate('ai-usage', usage({ outcome: 'invalid_response', errorCode: 'missing_structured_output' }))).toEqual({ ok: true });
    });

    it('lehnt unpassende Subjekte, Ergebnisse, Fehlerklassen und Zusatzfelder ab', () => {
      const paths = (patch: Record<string, unknown>) => issues(validate('ai-usage', usage(patch))).map((issue) => issue.path);
      expect(paths({ subjectId: '2026-10-14' })).toContain('/subjectId');
      expect(paths({ purpose: 'doctor' })).toContain('/subjectId');
      expect(paths({ outcome: 'validation_failed', errorCode: 'schema_invalid' })).toContain('/outcome');
      expect(paths({ errorCode: 'timeout' })).toContain('/errorCode');
      expect(paths({ outcome: 'claude_error', errorCode: 'invalid_envelope' })).toContain('/errorCode');
      expect(paths({ inputSha256: 'xyz' })).toEqual(['/inputSha256']);
      expect(paths({ prompt: 'Text' })).toEqual(['/prompt']);
    });
  });

  describe('doctor (spec.md §9.13)', () => {
    const record = (patch: Record<string, unknown> = {}) => ({
      schemaVersion: 1,
      checkedAt: '2026-10-14T10:03:12+02:00',
      git: { found: true, version: '2.51.0.windows.1' },
      claude: {
        found: true,
        version: '2.1.114',
        loggedIn: true,
        authMethod: 'claude.ai',
        flags: { '-p': true, '--tools': true, '--safe-mode': false },
        settingSourcesAuthOk: null,
      },
      live: { checkedAt: '2026-10-14T10:03:40+02:00', ok: true, toolsReported: ['StructuredOutput'], mcpServersReported: [] },
      ok: true,
      ...patch,
    });

    it('akzeptiert Ergebnisse mit und ohne Live-Prüfung', () => {
      expect(validate('doctor', record())).toEqual({ ok: true });
      expect(validate('doctor', record({ live: null }))).toEqual({ ok: true });
      const notFound = { found: false, version: null, loggedIn: null, authMethod: null, flags: {}, settingSourcesAuthOk: null };
      expect(validate('doctor', record({ claude: notFound, live: null, ok: false }))).toEqual({ ok: true });
    });

    it('lehnt persönliche Felder, unbekannte Optionen und eine E-Mail als Anmeldeart ab', () => {
      const claude = record().claude;
      expect(issues(validate('doctor', record({ claude: { ...claude, email: 'person@example.com' } }))).map((issue) => issue.path)).toEqual(['/claude/email']);
      expect(issues(validate('doctor', record({ claude: { ...claude, authMethod: 'person@example.com' } }))).map((issue) => issue.path)).toEqual(['/claude/authMethod']);
      expect(issues(validate('doctor', record({ claude: { ...claude, flags: { '--bare': true } } }))).map((issue) => issue.path)).toEqual(['/claude/flags/--bare']);
      expect(issues(validate('doctor', record({ live: { ok: true } }))).map((issue) => issue.path)).toContain('/live/checkedAt');
    });
  });

  describe('attempt-outcome (spec.md §9.9)', () => {
    const outcome = (patch: Record<string, unknown> = {}) => ({
      schemaVersion: 1,
      snapshotId: 'S000002',
      runId: 'R20261014T080312Z-a3f9',
      attempt: 1,
      startedAt: '2026-10-14T10:03:12+02:00',
      endedAt: '2026-10-14T10:04:01+02:00',
      outcome: 'success',
      errorCode: null,
      message: null,
      ...patch,
    });

    it('akzeptiert jedes Ergebnis mit passender Fehlerklasse', () => {
      expect(validate('attempt-outcome', outcome())).toEqual({ ok: true });
      expect(validate('attempt-outcome', outcome({ snapshotId: null }))).toEqual({ ok: true });
      expect(validate('attempt-outcome', outcome({ outcome: 'claude_error', errorCode: 'not_executable', message: 'claude.cmd' }))).toEqual({ ok: true });
      expect(validate('attempt-outcome', outcome({ outcome: 'invalid_response', errorCode: 'invalid_envelope', message: 'x' }))).toEqual({ ok: true });
      expect(validate('attempt-outcome', outcome({ outcome: 'validation_failed', errorCode: 'rule_violation', message: 'R-02' }))).toEqual({ ok: true });
      expect(validate('attempt-outcome', outcome({ outcome: 'input_too_large', message: 'Limit' }))).toEqual({ ok: true });
    });

    it('lehnt unpassende Fehlerklassen, Versuchsnummern und leere Meldungen ab', () => {
      const paths = (patch: Record<string, unknown>) => issues(validate('attempt-outcome', outcome(patch))).map((issue) => issue.path);
      expect(paths({ outcome: 'validation_failed', errorCode: 'timeout' })).toContain('/errorCode');
      expect(paths({ outcome: 'success', errorCode: 'timeout' })).toContain('/errorCode');
      expect(paths({ outcome: 'claude_error', errorCode: null })).toContain('/errorCode');
      expect(paths({ attempt: 0 })).toEqual(['/attempt']);
      expect(paths({ message: '' })).toEqual(['/message']);
      expect(paths({ outcome: 'unbekannt' })).toContain('/outcome');
    });
  });
});
