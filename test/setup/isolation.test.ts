import { readdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import type { Registry } from '../../src/core/registry.js';
import { createTempRepo } from '../helpers/git-repo.js';
import { portable, readJsonFile, runCli } from '../helpers/workspace.js';
import { CLAUDE_EXECUTABLE } from './global-setup.js';

function inside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

describe('Globales Vitest-Setup (AK-01-14)', () => {
  it('lässt IPA_ASSISTANT_HOME und die Standard-Datenorte auf ein Temp-Verzeichnis zeigen', () => {
    const root = inject('ipaTestRoot');
    expect(inside(root, inject('ipaSystemTmpDir'))).toBe(true);
    for (const name of ['IPA_ASSISTANT_HOME', 'LOCALAPPDATA', 'XDG_DATA_HOME']) {
      const value = process.env[name];
      expect(value, name).toBeDefined();
      expect(inside(value ?? '', root), name).toBe(true);
    }
    for (const real of inject('ipaRealDataRoots')) {
      expect(inside(process.env['IPA_ASSISTANT_HOME'] ?? '', real)).toBe(false);
      expect(path.resolve(process.env['IPA_ASSISTANT_HOME'] ?? '')).not.toBe(path.resolve(real));
    }
  });

  it('blendet claude aus dem PATH aus und legt das Temp-Verzeichnis in den Test-Ordner (spec.md §16.2)', () => {
    expect(inject('ipaClaudeHidden')).toBe(true);
    const reachable = (process.env['PATH'] ?? '')
      .split(path.delimiter)
      .filter((dir) => dir !== '')
      .filter((dir) => {
        try {
          return readdirSync(dir).some((name) => CLAUDE_EXECUTABLE.test(name));
        } catch {
          return false;
        }
      });
    expect(reachable).toEqual([]);
    expect(inside(realpathSync.native(os.tmpdir()), inject('ipaTestRoot'))).toBe(true);
  });

  it('ohne --data-dir verwendet das CLI IPA_ASSISTANT_HOME aus dem Temp-Verzeichnis', async () => {
    const repo = await createTempRepo();
    const result = await runCli(['init'], { dataDir: null, repo: repo.root });
    expect(result.exitCode).toBe(0);
    const home = portable(process.env['IPA_ASSISTANT_HOME'] ?? '');
    const registry = await readJsonFile<Registry>(`${home}/registry.json`);
    expect(registry.repositories.some((entry) => entry.repoPath === repo.root)).toBe(true);
  });

  it.runIf(process.platform === 'win32')('ohne IPA_ASSISTANT_HOME greift %LOCALAPPDATA%\\ipa-assistant, ebenfalls im Temp-Verzeichnis', async () => {
    const repo = await createTempRepo();
    const result = await runCli(['init'], { dataDir: null, repo: repo.root, env: { IPA_ASSISTANT_HOME: undefined } });
    expect(result.exitCode).toBe(0);
    const expectedRoot = portable(path.join(process.env['LOCALAPPDATA'] ?? '', 'ipa-assistant'));
    const status = await runCli(['status', '--json'], { dataDir: null, repo: repo.root, env: { IPA_ASSISTANT_HOME: undefined } });
    expect(JSON.parse(status.stdout)).toMatchObject({ dataRoot: expectedRoot });
    expect(inside(expectedRoot, inject('ipaTestRoot'))).toBe(true);
  });
});
