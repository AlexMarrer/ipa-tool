import { realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  canonicalizePath,
  comparisonKey,
  isSameOrInside,
  isStrictlyInside,
  relativeInside,
  samePath,
  toPortablePath,
} from '../../src/core/paths.js';
import { createTempDir, portable } from '../helpers/workspace.js';

describe('Pfadnormalisierung (spec.md §5.4)', () => {
  it('schreibt Pfade mit / und grossem Laufwerksbuchstaben', () => {
    expect(toPortablePath('c:\\Users\\Test\\Projekt\\')).toBe('C:/Users/Test/Projekt');
    expect(toPortablePath('C:\\')).toBe('C:/');
    expect(toPortablePath('/home/test/')).toBe('/home/test');
    expect(toPortablePath('/')).toBe('/');
  });

  it('vergleicht unter Windows ohne Gross- und Kleinschreibung', () => {
    expect(comparisonKey('C:\\GIT\\Repo', 'win32')).toBe('c:/git/repo');
    expect(samePath('C:/GIT/Repo', 'c:\\git\\repo', 'win32')).toBe(true);
    expect(samePath('/home/Repo', '/home/repo', 'linux')).toBe(false);
  });

  it('erkennt Enthaltensein ohne Präfix-Falle', () => {
    expect(isSameOrInside('C:/repo/.ipa', 'C:/repo', 'win32')).toBe(true);
    expect(isSameOrInside('C:/REPO', 'c:/repo', 'win32')).toBe(true);
    expect(isSameOrInside('C:/repo2', 'C:/repo', 'win32')).toBe(false);
    expect(isStrictlyInside('C:/repo', 'C:/repo', 'win32')).toBe(false);
    expect(isStrictlyInside('C:/repo/a', 'C:/', 'win32')).toBe(true);
    expect(relativeInside('C:/repo/.ipa/x', 'c:/REPO', 'win32')).toBe('.ipa/x');
    expect(relativeInside('C:/other', 'C:/repo', 'win32')).toBeNull();
  });

  it('kanonisiert bestehende Pfade mit realpath und hängt fehlende Teile an', async () => {
    const base = await createTempDir('paths');
    await mkdir(`${base}/vorhanden`);
    expect(await canonicalizePath(`${base}/vorhanden/neu/tiefer`)).toBe(`${base}/vorhanden/neu/tiefer`);
    expect(await canonicalizePath(os.tmpdir())).toBe(portable(realpathSync.native(os.tmpdir())));
  });

  it.runIf(process.platform === 'win32')('bildet abweichende Schreibweisen unter Windows auf den echten Pfad ab', async () => {
    const base = await createTempDir('Gross');
    await mkdir(`${base}/Unterordner`);
    const variant = `${base}/UNTERORDNER`.toLowerCase().replace(/\//g, '\\');
    expect(await canonicalizePath(variant)).toBe(`${base}/Unterordner`);
  });
});
