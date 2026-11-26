import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { archiveUrl, fetchNode, sha256Of } from '../../scripts/fetch-node.mjs';
import { APP_ROOT, REPO_ROOT } from '../helpers/env';

const execFileAsync = promisify(execFile);
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('Das CLI bleibt unberührt (AK-10-01, AK-10-02)', () => {
  const root = json(path.join(REPO_ROOT, 'package.json'));
  const app = json(path.join(APP_ROOT, 'package.json'));

  it('hat keine Workspaces und eigenes package.json und package-lock.json in app/', () => {
    expect(root['workspaces']).toBeUndefined();
    expect(app['workspaces']).toBeUndefined();
    expect(existsSync(path.join(APP_ROOT, 'package-lock.json'))).toBe(true);
    expect(app['name']).not.toBe(root['name']);
  });

  it('hängt Electron und die App nicht an die Abhängigkeiten des CLI', () => {
    const all = JSON.stringify({ d: root['dependencies'], dev: root['devDependencies'] });
    expect(all).not.toMatch(/electron|react|playwright|ipa-assistant-app/);
    expect((app['devDependencies'] as Record<string, string>)['electron']).toBe('45.5.0');
  });

  it('leitet die Skripte app:* aus dem Wurzelordner an app/ weiter und ändert keines der bestehenden', () => {
    const scripts = root['scripts'] as Record<string, string>;
    for (const name of ['app:install', 'app:dev', 'app:typecheck', 'app:test', 'app:build', 'app:dist']) {
      expect(scripts[name], name).toContain('app');
    }
    expect(scripts['app:install']).toBe('npm ci --prefix app');
    expect(scripts['build']).toBe('tsc -p tsconfig.build.json');
    expect(scripts['typecheck']).toBe('tsc -p tsconfig.json --noEmit');
    expect(scripts['test']).toBe('vitest run');
    expect(scripts['app:build']).toMatch(/^npm run build && /);
  });

  it('ignoriert die Ausgaben der App in Git', () => {
    const ignore = readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    for (const entry of ['app/out/', 'app/stage/', 'app/release/', 'app/playwright-report/', 'app/test-results/', 'node_modules/', 'dist/']) {
      expect(ignore, entry).toContain(entry);
    }
  });

  it('erfasst app/ weder mit der Wurzel-tsconfig noch mit dem Wurzel-vitest', () => {
    const tsconfig = json(path.join(REPO_ROOT, 'tsconfig.json'));
    expect(JSON.stringify(tsconfig['include'])).not.toContain('app');
    const vitestConfig = readFileSync(path.join(REPO_ROOT, 'vitest.config.ts'), 'utf8');
    expect(vitestConfig).toContain("include: ['test/**/*.test.ts']");
    expect(vitestConfig).not.toContain('app/');
  });

  it('packt keine Datei aus app/ in das CLI (npm pack --dry-run)', async () => {
    // npm ships next to node; running its script with node avoids a shell.
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const [command, args] = existsSync(npmCli)
      ? [process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts']]
      : ['npm', ['pack', '--dry-run', '--json', '--ignore-scripts']];
    const { stdout } = await execFileAsync(command as string, args as string[], { cwd: REPO_ROOT, encoding: 'utf8' });
    const files = (JSON.parse(stdout) as { files: { path: string }[] }[])[0]?.files.map((file) => file.path) ?? [];
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => file.startsWith('app/'))).toEqual([]);
    expect(files).toContain('dist/cli.js');
  });
});

describe('Laufzeit-Bereitstellung (AD-04, AK-10-76 Vorbereitung)', () => {
  const pinned = json(path.join(APP_ROOT, 'node-runtime.json')) as { version: string; sha256: string };

  it('legt Version und SHA-256 der node.exe in node-runtime.json fest', () => {
    expect(pinned.version).toMatch(/^24\.\d+\.\d+$/);
    expect(pinned.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(archiveUrl(pinned.version)).toBe(`https://nodejs.org/dist/v${pinned.version}/node-v${pinned.version}-win-x64.zip`);
  });

  it('prüft die Prüfsumme und bricht bei Abweichung ab, ohne node.exe zu schreiben', async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), 'ipa-fetch-'));
    try {
      let extracted = false;
      const download = async (_url: string, file: string) => writeFile(file, 'kein echtes node');
      await expect(fetchNode({ version: '24.0.0', sha256: 'a'.repeat(64), targetDir: target, download, extract: () => void (extracted = true) })).rejects.toThrow(/Prüfsumme/);
      expect(extracted).toBe(false);
      expect(existsSync(path.join(target, 'node.exe'))).toBe(false);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });

  it('entpackt bei passender Prüfsumme', async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), 'ipa-fetch-'));
    try {
      const content = 'künstliches Archiv';
      const sha256 = createHash('sha256').update(content).digest('hex');
      const calls: string[] = [];
      const result = await fetchNode({
        version: '24.0.0',
        sha256: sha256.toUpperCase(),
        targetDir: target,
        download: async (url, file) => {
          calls.push(url);
          await writeFile(file, content);
        },
        extract: async (zip, version, dir) => {
          calls.push(`extract ${version}`);
          expect(await sha256Of(zip)).toBe(sha256);
          await writeFile(path.join(dir, 'node.exe'), 'x');
        },
      });
      expect(calls).toEqual(['https://nodejs.org/dist/v24.0.0/node-v24.0.0-win-x64.zip', 'extract 24.0.0']);
      expect(result.sha256).toBe(sha256);
      expect(await readFile(path.join(target, 'node.exe'), 'utf8')).toBe('x');
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
});

describe('electron-builder.yml (AO-07)', () => {
  const yml = readFileSync(path.join(APP_ROOT, 'electron-builder.yml'), 'utf8');
  it('liefert CLI und node.exe ausserhalb des ASAR-Archivs und installiert pro Benutzer', () => {
    // from: stage keeps cli/node_modules (electron-builder drops a node_modules directly below `from`).
    expect(yml).toMatch(/from: stage\s+to: \./);
    for (const pattern of ['cli/**/*', 'cli/node_modules/**/*', 'node/**/*']) expect(yml).toContain(`"${pattern}"`);
    expect(yml).toContain('perMachine: false');
    expect(yml).toContain('createDesktopShortcut: true');
    expect(yml).toContain('afterPack: scripts/after-pack.mjs');
  });
});
