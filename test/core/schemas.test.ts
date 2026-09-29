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
    expect(SCHEMA_IDS).toEqual(['config', 'state', 'registry', 'run-record']);
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
});
