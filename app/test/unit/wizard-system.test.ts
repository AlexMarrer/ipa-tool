import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServices, type Services } from '../../src/main/services';
import { input } from '../../src/main/ipc/guard';
import { checkProjectFolder, normalizePath, probeDataRoot } from '../../src/main/project-check';
import { runGit } from '../../src/main/git';
import type { ShellPort } from '../../src/main/shell';
import { APP_ROOT, createRepo, createTestEnv, fingerprintRepo, initProject, type TestEnv } from '../helpers/env';

/** The wizard "Projekt hinzufügen" and the page System against the real CLI (AK-10-69 to AK-10-74). */
describe('Assistent und System mit dem echten CLI', () => {
  let env: TestEnv;
  let services: Services;
  let picked: string | null = null;
  let clipboard: string[] = [];
  let opened: string[] = [];
  const shell: ShellPort = {
    openPath: async (file) => (opened.push(file), ''),
    showItemInFolder: () => undefined,
    writeClipboard: (text) => void clipboard.push(text),
    openExternal: async () => undefined,
    trashItem: async () => undefined,
    chooseFile: async () => null,
    chooseFolder: async () => picked,
    setTheme: () => undefined,
  };
  const folder = async (target: string) => {
    picked = target;
    await services.chooseFolder();
  };
  const check = async () => {
    const result = await services.checkChosenFolder();
    if (!result.ok || result.value === null) throw new Error('keine Prüfung');
    return result.value;
  };

  beforeAll(async () => {
    env = await createTestEnv();
    services = await createServices({ appRoot: APP_ROOT, packaged: false, userDataDir: env.userData, env: env.env, appVersion: '0.1.0', electronVersion: '45.5.0', nodeExe: process.execPath, watchDebounceMs: 60, watchPollMs: 300, shell });
  }, 120_000);
  afterAll(async () => {
    await services.shutdown();
    await env.cleanup();
  });

  describe('Schritt 1: Prüfliste (AK-10-69)', () => {
    it('prüft ohne gewählten Ordner nichts', async () => {
      const result = await services.checkChosenFolder();
      expect(result.ok && result.value).toBeNull();
    });

    it('erkennt ein Git-Repository mit Branch, HEAD und Git-Version und beschreibt die Datenwurzel', async () => {
      const repo = await createRepo(env, 'neu-a');
      await folder(repo.root);
      const found = await check();
      expect(found.repository).toMatchObject({ isMainFolder: true, insideRepository: false, branch: 'main' });
      expect(found.repository.head).toMatch(/^[0-9a-f]{40}$/);
      expect(found.gitVersion).toMatch(/^\d+\.\d+/);
      expect(found.existing).toBeNull();
      expect(found.dataRoot).toMatchObject({ writable: true, path: env.dataRoot });
    });

    it('lehnt einen Ordner ohne Git und einen Unterordner ab und nennt den Grund', async () => {
      const plain = await mkdtemp(path.join(os.tmpdir(), 'ipa-kein-git-'));
      try {
        await folder(plain);
        expect((await check()).repository).toMatchObject({ isMainFolder: false, insideRepository: false, branch: null, head: null });
        const repo = await createRepo(env, 'neu-b');
        await mkdir(`${repo.root}/src`, { recursive: true });
        await folder(`${repo.root}/src`);
        expect((await check()).repository).toMatchObject({ isMainFolder: false, insideRepository: true });
        const refused = await services.initChosenFolder({ timezone: 'Europe/Zurich', workspace: 'default' });
        expect(refused).toMatchObject({ ok: false, error: { code: 'init_refused' } });
      } finally {
        await rm(plain, { recursive: true, force: true });
      }
    });

    it('erkennt ein schon eingerichtetes Repository, auch bei anderer Schreibweise des Pfads', async () => {
      const project = await initProject(env, 'schon-da');
      await folder(project.repo.root);
      expect((await check()).existing).toEqual({ repositoryId: project.repositoryId });
      await folder(project.repo.root.toUpperCase().replace(/\//g, '\\'));
      expect((await check()).existing).toEqual({ repositoryId: project.repositoryId });
    });

    it('verwechselt Pfade nur bei gleicher Normalisierung', () => {
      expect(normalizePath('C:\\Repos\\Alpha\\')).toBe(normalizePath('c:/repos/alpha'));
      expect(normalizePath('C:/repos/alpha')).not.toBe(normalizePath('C:/repos/alpha2'));
    });

    it('prüft die Datenwurzel mit einer Probedatei, die sofort wieder verschwindet, und legt nichts an', async () => {
      const base = await mkdtemp(path.join(os.tmpdir(), 'ipa-probe-'));
      try {
        const existing = await probeDataRoot(base);
        expect(existing).toMatchObject({ writable: true, exists: true, detail: null });
        const missing = path.join(base, 'noch', 'nicht', 'da');
        expect(await probeDataRoot(missing)).toMatchObject({ writable: true, exists: false });
        expect(await readdir(base)).toEqual([]);
        expect(await probeDataRoot(null)).toMatchObject({ writable: false, path: null });
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });

    it('ruft Git nur lesend auf', async () => {
      expect((await runGit(null, ['status'])).ok).toBe(false);
      expect((await runGit(null, ['commit', '-m', 'x'])).ok).toBe(false);
      expect((await runGit(null, ['--version'])).ok).toBe(true);
    });

    it('meldet bei nicht beschreibbarer Datenwurzel den Fehler, ohne zu raten', async () => {
      const repo = await createRepo(env, 'neu-c');
      const result = await checkProjectFolder({ repoPath: repo.root, dataRoot: null, entries: [], validator: { validate: () => ({ ok: true }) } as never, git: runGit });
      expect(result.dataRoot.writable).toBe(false);
      expect(result.repository.isMainFolder).toBe(true);
    });
  });

  describe('Schritte 2 bis 4: init (AK-10-70, AK-10-71)', () => {
    it('prüft Zeitzone und Arbeitsbereich vor dem Aufruf', () => {
      expect(input.initInput({ timezone: 'Europe/Zurich', workspace: 'default' })).toEqual({ timezone: 'Europe/Zurich', workspace: 'default' });
      expect(input.initInput({ timezone: 'UTC', workspace: 'repository' })).toEqual({ timezone: 'UTC', workspace: 'repository' });
      for (const bad of [{ timezone: 'Mars/Olympus', workspace: 'default' }, { timezone: '', workspace: 'default' }, { timezone: 'Europe/Zurich; rm', workspace: 'default' }, { timezone: 'Europe/Zurich', workspace: 'C:/x' }, { timezone: 'Europe/Zurich', workspace: 'default', path: 'C:/' }, 'x']) {
        expect(() => input.initInput(bad), JSON.stringify(bad)).toThrow();
      }
    });

    it('richtet das Projekt ein, ohne das Repository zu verändern, und nimmt es in die Registry auf', async () => {
      const repo = await createRepo(env, 'wirklich-neu');
      const before = await fingerprintRepo(repo.root);
      await folder(repo.root);
      const outcome = await services.initChosenFolder({ timezone: 'Europe/Zurich', workspace: 'default' });
      expect(outcome.ok).toBe(true);
      const value = outcome.ok ? outcome.value : null;
      expect(value).toMatchObject({ exitCode: 0, failure: null, result: { created: true, workspaceMode: 'default', timezone: 'Europe/Zurich', baselineSnapshotId: 'S000001', claude: { checked: true } } });
      expect(value?.result?.repositoryId).toMatch(/^wirklich-neu-[0-9a-f]{6}$/);
      expect(await fingerprintRepo(repo.root)).toEqual(before);
      const projects = await services.loadProjects();
      expect(projects.projects.map((project) => project.repositoryId)).toContain(value?.result?.repositoryId);
      // The same folder cannot be set up twice.
      const again = await services.initChosenFolder({ timezone: 'Europe/Zurich', workspace: 'default' });
      expect(again).toMatchObject({ ok: false, error: { code: 'init_refused' } });
    });

    it('legt den Arbeitsbereich auf Wunsch in .ipa im Repository an', async () => {
      const repo = await createRepo(env, 'im-repo');
      await folder(repo.root);
      const outcome = await services.initChosenFolder({ timezone: 'UTC', workspace: 'repository' });
      expect(outcome.ok && outcome.value.result).toMatchObject({ workspaceMode: 'explicit', timezone: 'UTC' });
      const workspace = outcome.ok ? outcome.value.result?.workspacePath : undefined;
      expect(workspace?.replace(/\\/g, '/')).toMatch(/\/im-repo\/\.ipa$/);
      expect(JSON.parse(await readFile(`${workspace}/config.json`, 'utf8')).timezone).toBe('UTC');
      const status = await services.systemStatus();
      expect(status.ok && status.value.workspacesInRepository.some((id) => id.startsWith('im-repo'))).toBe(true);
    });

    it('zeigt bei einem teilweise eingerichteten Projekt mit abweichenden Angaben die Meldung des CLI', async () => {
      const project = await initProject(env, 'teilweise');
      // The registry entry is gone, the workspace is still there (for example after a copied data root).
      const registry = `${env.dataRoot}/registry.json`;
      const original = await readFile(registry, 'utf8');
      const parsed = JSON.parse(original) as { repositories: { repositoryId: string }[] };
      await writeFile(registry, JSON.stringify({ ...parsed, repositories: parsed.repositories.filter((entry) => entry.repositoryId !== project.repositoryId) }, null, 2));
      try {
        await folder(project.repo.root);
        const outcome = await services.initChosenFolder({ timezone: 'UTC', workspace: 'default' });
        expect(outcome.ok).toBe(true);
        const value = outcome.ok ? outcome.value : null;
        expect(value?.exitCode).not.toBeNull();
        if (value?.exitCode !== 0) expect(value?.errors[0]?.message).toBeTruthy();
      } finally {
        await writeFile(registry, original);
      }
    });
  });

  describe('System (AK-10-72 bis AK-10-74)', () => {
    it('liest die neueste Prüfung von Claude und Git über alle Projekte', async () => {
      const status = await services.systemStatus();
      expect(status.ok).toBe(true);
      const value = status.ok ? status.value : null;
      expect(value?.dataRoot).toBe(env.dataRoot);
      expect(value?.check).toMatchObject({ ok: true, git: { found: true }, claude: { found: true } });
    });

    it('öffnet und kopiert die Datenwurzel, ohne dem Renderer einen Pfad zu geben', async () => {
      clipboard = [];
      opened = [];
      expect(await services.openDataRoot()).toEqual({ opened: true });
      expect(opened).toEqual([env.dataRoot]);
      expect(await services.copyDataRoot()).toEqual({ copied: true });
      expect(clipboard).toEqual([env.dataRoot]);
    });

    it('liest den Verbrauch aller Projekte, neueste zuerst, nach Zeitraum, ohne Prompt oder Antwort', async () => {
      const list = await services.loadProjects();
      const first = list.projects.find((project) => project.repositoryId.startsWith('schon-da'));
      expect(first).toBeDefined();
      const now = Date.now();
      const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const record = (id: string, startedMs: number, extra: Record<string, unknown> = {}) =>
        JSON.stringify({
          schemaVersion: 1,
          runId: `R20261126T10000${id}Z-aa0${id}`,
          purpose: 'analysis',
          subjectId: 'S000002',
          startedAt: iso(startedMs),
          endedAt: iso(startedMs + 4000),
          cliVersion: '0.1.0',
          models: ['claude-sonnet-5-5'],
          promptVersion: '1',
          outputSchemaVersion: '1',
          inputSha256: 'a'.repeat(64),
          inputIds: ['S000002:E001'],
          outcome: 'success',
          errorCode: null,
          costUsd: null,
          durationMs: 4000,
          ...extra,
        });
      await writeFile(`${first?.workspacePath}/ai-usage.jsonl`, `${record('1', now - 86_400_000)}\n${record('2', now - 20 * 86_400_000, { costUsd: 0.12, purpose: 'journal', subjectId: '2026-11-06' })}\n${record('3', now - 60 * 86_400_000, { outcome: 'claude_error', errorCode: 'timeout' })}\nkaputt\n`);
      const all = await services.loadUsage('all');
      const rows = all.ok ? all.value : [];
      expect(rows.map((row) => row.purpose)).toEqual(['analysis', 'journal', 'analysis']);
      expect(rows[1]).toMatchObject({ costUsd: 0.12, outcome: 'success' });
      expect(rows[0]).toMatchObject({ costUsd: null, durationMs: 4000, models: ['claude-sonnet-5-5'] });
      expect(rows[2]).toMatchObject({ outcome: 'claude_error' });
      expect(JSON.stringify(rows)).not.toMatch(/inputSha256|inputIds|promptVersion/);
      const week = await services.loadUsage('7');
      expect(week.ok && week.value).toHaveLength(1);
      const month = await services.loadUsage('30');
      expect(month.ok && month.value).toHaveLength(2);
      expect(() => input.usageRange('1')).toThrow();
    });
  });

  it('erlaubt den Live-Test nur als getippte Eingabe doctor mit live', () => {
    expect(input.runInput({ name: 'doctor', live: true })).toEqual({ name: 'doctor', live: true });
    expect(input.runInput({ name: 'doctor' })).toEqual({ name: 'doctor' });
    expect(() => input.runInput({ name: 'doctor', live: 'ja' })).toThrow();
    expect(() => input.runInput({ name: 'doctor', fix: true })).toThrow();
  });
});
