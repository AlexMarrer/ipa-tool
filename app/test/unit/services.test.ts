import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServices, type Services } from '../../src/main/services';
import type { ProjectsChange } from '../../src/shared/types';
import { APP_ROOT, REPO_ROOT, createTestEnv, fingerprintRepo, initProject, readFakeCalls, waitFor, type InitializedProject, type TestEnv } from '../helpers/env';

const options = (env: TestEnv) => ({
  appRoot: APP_ROOT,
  packaged: false,
  userDataDir: env.userData,
  env: env.env,
  appVersion: '0.1.0',
  electronVersion: '45.5.0',
  nodeExe: process.execPath,
  watchDebounceMs: 50,
  watchPollMs: 500,
});

describe('Dienste des Main-Prozesses', () => {
  let env: TestEnv;
  let project: InitializedProject;
  let services: Services;

  beforeAll(async () => {
    env = await createTestEnv();
    project = await initProject(env, 'dienste');
    services = await createServices(options(env));
  });
  afterAll(async () => {
    await services.shutdown();
    await env.cleanup();
  });

  it('lädt die Projektliste aus der Registry und dem Status des echten CLI (AK-10-09)', async () => {
    const before = await fingerprintRepo(project.repo.root);
    const list = await services.loadProjects();
    expect(list.registry.state).toBe('ok');
    expect(list.projects).toEqual([
      expect.objectContaining({ repositoryId: project.repositoryId, status: 'ok', hint: '', timezone: expect.any(String), workspaceMode: 'default' }),
    ]);
    expect(await fingerprintRepo(project.repo.root)).toEqual(before);
  });

  it('ruft nur erlaubte Befehle automatisch auf und startet nie Claude (AK-10-15)', async () => {
    await services.loadProjects();
    await services.loadProject(project.repositoryId);
    const log = services.queue.log();
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log) {
      expect(entry).toMatchObject({ command: 'status', trigger: 'auto', ai: false });
    }
    // The overview adds `schedule status`, which is allowed as well and never calls a model.
    await services.loadOverview(project.repositoryId);
    const commands = new Set(services.queue.log().map((entry) => entry.command));
    expect([...commands].sort()).toEqual(['schedule status', 'status']);
    for (const entry of services.queue.log()) expect(entry).toMatchObject({ trigger: 'auto', ai: false });
    expect((await readFakeCalls(env)).filter((call) => call.kind === 'model-call')).toEqual([]);
    expect((await readFakeCalls(env)).filter((call) => call.kind === 'model-call')).toEqual([]);
  });

  it('schreibt das Protokoll der App ohne Argumentwerte, Ausgaben und Pfade', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(services.log.file, 'utf8');
    expect(text).toContain('"event":"cli_started"');
    expect(text).not.toContain(project.repo.root);
    expect(text).not.toContain(env.dataRoot);
  });

  it('meldet Änderungen der Registry und des beobachteten Arbeitsbereichs innerhalb von 2 Sekunden (AK-10-34)', async () => {
    const changes: ProjectsChange[] = [];
    services.onProjectsChanged((change) => changes.push(change));

    const second = await initProject(env, 'zweites');
    await waitFor(() => changes.find((change) => change.reason === 'registry'), 2_000);

    await services.loadProjects();
    services.watchProject(second.repositoryId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(`${second.workspacePath}/notes-test.txt`, 'x');
    const workspaceChange = await waitFor(() => changes.find((change) => change.reason === 'workspace'), 2_000);
    expect(workspaceChange.repositoryId).toBe(second.repositoryId);
    services.watchProject(null);
    expect((await services.loadProjects()).projects).toHaveLength(2);
  });

  it('meldet Version und Laufzeit', async () => {
    expect(await services.versions()).toMatchObject({ app: '0.1.0', electron: '45.5.0', cli: expect.stringMatching(/^\d+\./), runtime: 'test', runtimeProblem: null });
  });
});

describe('Dienste ohne lauffähiges CLI', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterAll(async () => env.cleanup());

  it('zeigt eine fehlende Laufzeit als Problem und eine leere Liste, ohne zu werfen (runtime_missing)', async () => {
    const services = await createServices({ ...options(env), cliRoot: `${env.root}/kein-cli` });
    expect(services.runtimeProblem).toContain('CLI-Laufzeit');
    const list = await services.loadProjects();
    expect(list.projects).toEqual([]);
    expect(list.registry).toMatchObject({ state: 'unreadable', detail: expect.stringContaining('CLI-Laufzeit') });
    expect(await services.versions()).toMatchObject({ runtimeProblem: expect.any(String), cli: null });
    await services.shutdown();
  });

  it('verhindert den Betrieb bei abweichender CLI-Version (cli_version_mismatch)', async () => {
    const fakeApp = `${env.root}/app-mit-anderer-version`;
    await mkdir(path.join(fakeApp, 'out'), { recursive: true });
    await writeFile(path.join(fakeApp, 'out', 'cli-version.json'), JSON.stringify({ version: '99.0.0' }));
    const services = await createServices({ ...options(env), appRoot: fakeApp, cliRoot: REPO_ROOT });
    expect(services.runtimeProblem).toContain('Version');
    expect((await services.loadProjects()).registry.state).toBe('unreadable');
    await services.shutdown();
  });
});
