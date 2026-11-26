import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunInput, RunSummary } from '../../src/shared/run';
import type { RunEvent } from '../../src/shared/types';
import { createServices, type Services } from '../../src/main/services';
import { APP_ROOT, REPO_ROOT, createRepo, createTestEnv, waitFor, type TestEnv } from '../helpers/env';

const exec = promisify(execFile);
const STAGE_CLI = path.join(APP_ROOT, 'stage', 'cli');
const STAGE_NODE = path.join(APP_ROOT, 'stage', 'node', 'node.exe');
const UNPACKED = path.join(APP_ROOT, 'release', 'win-unpacked', 'resources');
const PRELOAD = path.join(APP_ROOT, 'test', 'helpers', 'schtasks-preload.mjs');
const staged = existsSync(path.join(STAGE_CLI, 'dist', 'cli.js')) && existsSync(STAGE_NODE);
const runtime = JSON.parse(readFileSync(path.join(APP_ROOT, 'node-runtime.json'), 'utf8')) as { version: string; sha256: string };

/** The delivered runtime: staged CLI and the bundled node.exe (AK-10-75 to AK-10-77). Needs `npm run dist` once (stage/). */
describe.skipIf(!staged)('Mitgelieferte Laufzeit (AK-10-75 bis AK-10-77)', () => {
  it('liefert die node.exe in der Version aus node-runtime.json (die Prüfsumme gilt dem Archiv, die fetch-node prüft)', async () => {
    expect(runtime.sha256).toMatch(/^[0-9a-f]{64}$/);
    const { stdout } = await exec(STAGE_NODE, ['--version']);
    expect(stdout.trim()).toBe(`v${runtime.version}`);
  });

  it('enthält das CLI wie `npm pack`: dist, schemas, prompts, package.json und die Produktionsabhängigkeiten', () => {
    for (const entry of ['dist/cli.js', 'schemas/config.schema.json', 'prompts', 'package.json', 'node_modules/commander', 'node_modules/ajv', 'node_modules/picomatch']) {
      expect(existsSync(path.join(STAGE_CLI, entry)), entry).toBe(true);
    }
    expect(existsSync(path.join(STAGE_CLI, 'node_modules', 'vitest'))).toBe(false);
    expect(existsSync(path.join(STAGE_CLI, 'node_modules', 'typescript'))).toBe(false);
    expect(existsSync(path.join(STAGE_CLI, 'src'))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(STAGE_CLI, 'package.json'), 'utf8')).version).toBe(JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version);
  });

  it.skipIf(!existsSync(path.join(UNPACKED, 'cli', 'dist', 'cli.js')))('hat im entpackten Installer resources/cli und resources/node/node.exe ausserhalb des ASAR-Archivs', async () => {
    expect(existsSync(path.join(UNPACKED, 'node', 'node.exe'))).toBe(true);
    expect(existsSync(path.join(UNPACKED, 'cli', 'node_modules', 'commander'))).toBe(true);
    const hash = async (file: string): Promise<string> => createHash('sha256').update(await readFile(file)).digest('hex');
    expect(await hash(path.join(UNPACKED, 'node', 'node.exe'))).toBe(await hash(STAGE_NODE));
  });

  describe('das gestagte CLI mit der mitgelieferten node.exe (AK-10-76)', () => {
    let env: TestEnv;
    beforeAll(async () => {
      env = await createTestEnv();
    });
    afterAll(() => env.cleanup());
    const cli = async (repo: string, args: string[]) => {
      try {
        const { stdout } = await exec(STAGE_NODE, [path.join(STAGE_CLI, 'dist', 'cli.js'), '--repo', repo, ...args], { env: env.env, windowsHide: true });
        return { exitCode: 0, stdout };
      } catch (error) {
        const failure = error as { code?: number; stdout?: string };
        return { exitCode: failure.code ?? -1, stdout: failure.stdout ?? '' };
      }
    };

    it('führt init, note und capture --no-analysis aus', async () => {
      const repo = await createRepo(env, 'gestagt');
      const init = await cli(repo.root, ['init', '--json']);
      expect(init.exitCode).toBe(0);
      await repo.write('src/a.ts', 'export const a = 1;\n');
      const note = await cli(repo.root, ['note', '--json', '--', 'Notiz mit der mitgelieferten Laufzeit']);
      expect(note.exitCode).toBe(0);
      const capture = await cli(repo.root, ['capture', '--no-analysis', '--json']);
      expect(capture.exitCode).toBe(0);
      expect(JSON.parse(capture.stdout)).toMatchObject({ command: 'capture', ok: true, result: { snapshot: { id: 'S000002' } } });
    }, 120_000);
  });

  describe('Zeitplan mit der mitgelieferten Laufzeit (AK-10-77)', () => {
    let env: TestEnv;
    let services: Services;
    let repositoryId = '';
    let stateFile = '';
    const events: RunEvent[] = [];

    beforeAll(async () => {
      env = await createTestEnv();
      stateFile = `${env.root}/schtasks-state.json`;
      env.env['IPA_TEST_SCHTASKS_STATE'] = stateFile;
      env.env['NODE_OPTIONS'] = `--import=${pathToFileURL(PRELOAD).href}`;
      // The project is set up with the staged runtime, as the installed app would do it.
      const repo = await createRepo(env, 'plan');
      await exec(STAGE_NODE, [path.join(STAGE_CLI, 'dist', 'cli.js'), '--repo', repo.root, 'init', '--json'], { env: env.env, windowsHide: true });
      services = await createServices({ appRoot: APP_ROOT, packaged: false, userDataDir: env.userData, env: env.env, appVersion: '0.1.0', electronVersion: '45.5.0', nodeExe: STAGE_NODE, cliRoot: STAGE_CLI, watchDebounceMs: 60, watchPollMs: 300 });
      const projects = await services.loadProjects();
      repositoryId = projects.projects[0]?.repositoryId ?? '';
      services.queue.onEvent((event) => events.push(event));
    }, 120_000);
    afterAll(async () => {
      await services.shutdown();
      await env.cleanup();
    });

    const run = async (request: RunInput): Promise<RunSummary> => {
      const before = events.length;
      const started = await services.startRun(repositoryId, request as never);
      if (!started.ok) throw new Error(started.reason);
      const finished = await waitFor(() => events.find((event, index) => index >= before && event.type === 'finished' && event.runKey === started.runKey), 60_000, 50);
      if (finished.type !== 'finished' || finished.summary === null) throw new Error('keine Zusammenfassung');
      return finished.summary;
    };

    it('trägt node.exe und cli.js der mitgelieferten Laufzeit in die Aufgabe ein', async () => {
      expect(repositoryId).not.toBe('');
      expect((await run({ name: 'scheduleInstall' })).exitCode).toBe(0);
      const xml = (JSON.parse(await readFile(stateFile, 'utf8')) as { xml: string }).xml;
      const normalized = xml.replace(/\\/g, '/').toLowerCase();
      expect(normalized).toContain(STAGE_NODE.replace(/\\/g, '/').toLowerCase());
      expect(normalized).toContain(path.join(STAGE_CLI, 'dist', 'cli.js').replace(/\\/g, '/').toLowerCase());
      const status = await services.loadSchedule(repositoryId);
      expect(status.ok && status.value.state).toBe('active');
    });

    it('zeigt nach einem Pfadwechsel (Neuinstallation) "veraltet" mit node_path und cli_path', async () => {
      // A second installation: another node.exe and another cli.js than the task knows.
      const moved = await createServices({ appRoot: APP_ROOT, packaged: false, userDataDir: env.userData, env: env.env, appVersion: '0.1.0', electronVersion: '45.5.0', nodeExe: process.execPath, cliRoot: REPO_ROOT, watchDebounceMs: 60, watchPollMs: 300 });
      try {
        await moved.loadProjects();
        const status = await moved.loadSchedule(repositoryId);
        expect(status.ok && status.value.state).toBe('stale');
        expect(status.ok && status.value.differences).toEqual(expect.arrayContaining(['node_path', 'cli_path']));
      } finally {
        await moved.shutdown();
      }
    });
  });
});
