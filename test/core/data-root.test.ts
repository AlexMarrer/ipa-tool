import { readdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  assertDataRootSeparate,
  dataRootCandidate,
  ensureDataRootWritable,
  resolveDataRoot,
} from '../../src/core/data-root.js';
import { IpaError } from '../../src/core/errors.js';
import { createTempDir } from '../helpers/workspace.js';

async function captureError(promise: Promise<unknown> | (() => unknown)): Promise<IpaError> {
  try {
    if (typeof promise === 'function') promise();
    else await promise;
  } catch (error) {
    if (error instanceof IpaError) return error;
    throw error;
  }
  throw new Error('Es wurde kein Fehler geworfen');
}

describe('Datenwurzel (spec.md §5.2)', () => {
  const env = { IPA_ASSISTANT_HOME: 'D:\\Env\\Home', LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' };

  it('bestimmt die Datenwurzel in der Reihenfolge --data-dir, IPA_ASSISTANT_HOME, Plattform-Standard', () => {
    expect(dataRootCandidate({ dataDir: 'E:\\Option', env, platform: 'win32', cwd: 'C:\\' })).toEqual({
      path: 'E:/Option',
      source: 'option',
    });
    expect(dataRootCandidate({ env, platform: 'win32', cwd: 'C:\\' })).toEqual({ path: 'D:/Env/Home', source: 'env' });
    expect(dataRootCandidate({ env: { LOCALAPPDATA: env.LOCALAPPDATA }, platform: 'win32', cwd: 'C:\\' })).toEqual({
      path: 'C:/Users/Test/AppData/Local/ipa-assistant',
      source: 'default',
    });
  });

  it('kennt die Standards für macOS und Linux (nicht geprüfte Plattformen)', () => {
    expect(dataRootCandidate({ env: {}, platform: 'darwin', homedir: '/Users/t', cwd: '/' }).path).toBe(
      '/Users/t/Library/Application Support/ipa-assistant',
    );
    expect(dataRootCandidate({ env: { XDG_DATA_HOME: '/data' }, platform: 'linux', homedir: '/home/t', cwd: '/' }).path).toBe(
      '/data/ipa-assistant',
    );
    expect(dataRootCandidate({ env: {}, platform: 'linux', homedir: '/home/t', cwd: '/' }).path).toBe('/home/t/.local/share/ipa-assistant');
  });

  it('löst relative Angaben gegen das aktuelle Verzeichnis auf und ignoriert eine leere Umgebungsvariable', () => {
    expect(dataRootCandidate({ dataDir: 'daten', env, platform: 'win32', cwd: 'C:\\Arbeit' }).path).toBe('C:/Arbeit/daten');
    expect(dataRootCandidate({ env: { ...env, IPA_ASSISTANT_HOME: '  ' }, platform: 'win32', cwd: 'C:\\' }).source).toBe('default');
  });

  it('meldet einen leeren Pfad und ein fehlendes LOCALAPPDATA mit Exit-Code 2', async () => {
    const empty = await captureError(() => dataRootCandidate({ dataDir: '', env, platform: 'win32', cwd: 'C:\\' }));
    expect(empty.exitCode).toBe(2);
    const unknown = await captureError(() => dataRootCandidate({ env: {}, platform: 'win32', cwd: 'C:\\' }));
    expect(unknown.code).toBe('data_root_unknown');
    expect(unknown.exitCode).toBe(2);
    expect(unknown.message).toContain('--data-dir');
  });

  it('lehnt Datenwurzel im Repository und Repository in der Datenwurzel ab (AK-01-06)', async () => {
    const inside = await captureError(() => assertDataRootSeparate('C:/repo/daten', 'C:/repo'));
    expect(inside.code).toBe('data_root_in_repository');
    expect(inside.exitCode).toBe(2);
    const outside = await captureError(() => assertDataRootSeparate('C:/daten', 'C:/daten/repo'));
    expect(outside.code).toBe('repository_in_data_root');
    const same = await captureError(() => assertDataRootSeparate('C:/x', 'C:/x'));
    expect(same.exitCode).toBe(2);
    expect(() => assertDataRootSeparate('C:/daten', 'C:/repo')).not.toThrow();
  });

  it.runIf(process.platform === 'win32')('erkennt die Verschachtelung auch bei anderer Schreibweise', async () => {
    const error = await captureError(() => assertDataRootSeparate('c:/REPO/Daten', 'C:/repo'));
    expect(error.code).toBe('data_root_in_repository');
  });

  it('legt eine fehlende Datenwurzel an und hinterlässt keine Probedatei', async () => {
    const base = await createTempDir('dr');
    const target = `${base}/neu/tiefer`;
    const resolved = await resolveDataRoot({ dataDir: target });
    await ensureDataRootWritable(resolved.path);
    expect(await readdir(target)).toEqual([]);
  });

  it('meldet eine nicht beschreibbare Datenwurzel mit Pfad und Auswegen (AK-01-16)', async () => {
    const base = await createTempDir('dr');
    const file = `${base}/ich-bin-eine-datei`;
    await writeFile(file, 'kein Ordner');
    const error = await captureError(ensureDataRootWritable(file));
    expect(error.code).toBe('data_root_not_writable');
    expect(error.exitCode).toBe(2);
    for (const expected of [file, '--data-dir', 'IPA_ASSISTANT_HOME', '--workspace']) {
      expect(error.message).toContain(expected);
    }
    expect(await readdir(base)).toEqual(['ich-bin-eine-datei']);
  });
});
