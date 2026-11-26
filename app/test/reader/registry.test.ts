import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchemaValidator } from '../../src/main/cli/validator';
import { readRegistry, resolveDataRoot } from '../../src/main/reader/registry';
import { buildProject, deriveStatus } from '../../src/main/reader/status';
import type { StatusReport } from '../../src/shared/cli-types';
import { REPO_ROOT, createTestEnv, initProject, type InitializedProject, type TestEnv } from '../helpers/env';

const validator = createSchemaValidator(`${REPO_ROOT}/schemas`);

describe('Projektliste aus registry.json (AK-10-09)', () => {
  let env: TestEnv;
  let project: InitializedProject;
  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterAll(async () => env.cleanup());

  it('ist leer, wenn registry.json fehlt', async () => {
    expect(await readRegistry(`${env.root}/gibt-es-nicht`, validator)).toMatchObject({ state: 'missing', repositories: [] });
  });

  it('liest die vom CLI geschriebene Registry und validiert sie gegen das Schema', async () => {
    project = await initProject(env, 'liste');
    const result = await readRegistry(env.dataRoot, validator);
    expect(result.state).toBe('ok');
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]).toMatchObject({ repositoryId: project.repositoryId, workspaceMode: 'default' });
  });

  it('meldet eine ungültige Registry mit Pfad und Schemafehler, ohne zu werfen', async () => {
    const dir = `${env.root}/kaputt`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/registry.json`, JSON.stringify({ schemaVersion: 1, repositories: [{ repositoryId: 'x' }] }));
    const result = await readRegistry(dir, validator);
    expect(result).toMatchObject({ state: 'invalid', repositories: [] });
    expect(result.path).toContain('registry.json');
    expect(result.detail).toContain('Schemafehler');
    await writeFile(`${dir}/registry.json`, '{kein json');
    expect(await readRegistry(dir, validator)).toMatchObject({ state: 'invalid', detail: expect.stringContaining('JSON') });
  });

  it('meldet einen nicht lesbaren Pfad als unreadable', async () => {
    const dir = `${env.root}/ordner-statt-datei`;
    await mkdir(`${dir}/registry.json`, { recursive: true });
    expect((await readRegistry(dir, validator)).state).toBe('unreadable');
  });

  it('bestimmt die Datenwurzel wie das CLI', () => {
    expect(resolveDataRoot({ IPA_ASSISTANT_HOME: 'D:/daten' }, 'win32')).toBe('D:/daten');
    expect(resolveDataRoot({ IPA_ASSISTANT_HOME: '  ', LOCALAPPDATA: 'C:\\L' }, 'win32')).toMatch(/ipa-assistant$/);
    expect(resolveDataRoot({}, 'win32')).toBeNull();
  });
});

const report = (overrides: Partial<StatusReport> = {}): StatusReport => ({
  repositoryId: 'p-123456',
  repoPath: 'C:/p',
  workspacePath: 'C:/w',
  dataRoot: 'C:/d',
  timezone: 'Europe/Zurich',
  workspaceMode: 'default',
  baselineSnapshotId: 'S000001',
  lastSnapshotId: 'S000001',
  lastAnalysedSnapshotId: 'S000001',
  lastSuccessfulRun: null,
  lastRun: null,
  snapshots: { total: 1, baseline: 1, work: 0 },
  halt: null,
  notesToday: 0,
  claude: { checkedAt: 'x', ok: true, cliVersion: '2.1.0' },
  analyses: { pending: 0, failed: 0, blocked: 0, exhausted: 0, complete: 1, skipped: 0, notRequired: 0, openIds: [] },
  withheld: { units: 0, notes: 0 },
  ...overrides,
});

describe('Statuspunkt eines Projekts (spec §5.1)', () => {
  const run = (outcome: string) => ({ command: 'capture', outcome, exitCode: 0, startedAt: 'x', errors: [] });

  it.each([
    ['ok', report(), 'ok', ''],
    ['Halt hat Vorrang', report({ halt: { reason: 'branch_changed' }, analyses: { ...report().analyses, pending: 3 } }), 'halt', 'Halt'],
    ['letzter Lauf mit Fehler', report({ lastRun: run('error') }), 'error', 'Fehler: letzter Lauf'],
    ['offene Analysen', report({ analyses: { ...report().analyses, pending: 1, exhausted: 2 } }), 'warning', '3 offene Analysen'],
    ['eine offene Analyse', report({ analyses: { ...report().analyses, failed: 1 } }), 'warning', '1 offene Analyse'],
    ['zurückgehaltene Inhalte', report({ withheld: { units: 0, notes: 2 } }), 'warning', 'Zurückgehaltene Inhalte'],
    ['Claude nicht bereit', report({ claude: { checkedAt: 'x', ok: false, cliVersion: null } }), 'warning', 'Claude nicht bereit'],
    ['Lauf analysis_failed', report({ lastRun: run('analysis_failed') }), 'warning', 'Letzter Lauf mit Problem'],
    ['Lauf unstable', report({ lastRun: run('unstable') }), 'warning', 'Letzter Lauf mit Problem'],
    ['Lauf usage_error', report({ lastRun: run('usage_error') }), 'warning', 'Letzter Lauf mit Problem'],
    ['Lauf ok bleibt ok', report({ lastRun: run('ok') }), 'ok', ''],
    ['Claude nie geprüft ist keine Warnung', report({ claude: null }), 'ok', ''],
  ])('%s', (_name, input, status, hint) => {
    expect(deriveStatus(input)).toEqual({ status, hint });
  });

  const entry = { repositoryId: 'p-123456', repoPath: 'C:/p', workspacePath: 'C:/w', workspaceMode: 'default' as const, createdAt: 'x' };

  it('zeigt ein Projekt mit fehlendem Repository oder Arbeitsbereich als Fehler, ohne Prozess', async () => {
    let started = 0;
    const runStatus = async () => {
      started += 1;
      return { report: report(), failed: false };
    };
    const noRepo = await buildProject(entry, runStatus, async (file) => file !== 'C:/p');
    expect(noRepo).toMatchObject({ status: 'error', hint: 'Fehler: Repository fehlt', timezone: null });
    const noWorkspace = await buildProject(entry, runStatus, async (file) => file !== 'C:/w');
    expect(noWorkspace).toMatchObject({ status: 'error', hint: 'Fehler: Arbeitsbereich fehlt' });
    expect(started).toBe(0);
  });

  it('zeigt ein Projekt als Fehler, wenn status --json scheitert, und übernimmt sonst die Zeitzone', async () => {
    const failing = await buildProject(entry, async () => ({ report: null, failed: true }), async () => true);
    expect(failing).toMatchObject({ status: 'error', hint: 'Fehler: nicht lesbar' });
    const good = await buildProject(entry, async () => ({ report: report(), failed: false }), async () => true);
    expect(good).toMatchObject({ status: 'ok', timezone: 'Europe/Zurich' });
  });
});
