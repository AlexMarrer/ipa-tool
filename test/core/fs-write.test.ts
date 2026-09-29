import * as fsp from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});

const { createFileExclusive, RENAME_RETRIES, writeFileAtomic } = await import('../../src/core/fs-write.js');
const { FileExistsError } = await import('../../src/core/errors.js');
const { createTempDir } = await import('../helpers/workspace.js');

const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

/** File handle whose `writeFile` fails after part of the data. */
async function failingHandle(path: Parameters<typeof actual.open>[0], flags?: Parameters<typeof actual.open>[1]) {
  const handle = await actual.open(path, flags);
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'writeFile') {
        return async () => {
          await target.write('TEIL');
          throw errno('ENOSPC');
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('Schreibfunktionen (spec.md §8.5, AK-01-09)', () => {
  beforeEach(() => {
    vi.mocked(fsp.open).mockClear();
    vi.mocked(fsp.rename).mockClear();
  });

  it('ersetzt den Inhalt atomar und hinterlässt keine temporäre Datei', async () => {
    const dir = await createTempDir('atomic');
    await writeFileAtomic(`${dir}/state.json`, 'alt');
    await writeFileAtomic(`${dir}/state.json`, 'neu');
    expect(await actual.readFile(`${dir}/state.json`, 'utf8')).toBe('neu');
    expect(await actual.readdir(dir)).toEqual(['state.json']);
  });

  it('lässt den alten Inhalt unverändert, wenn das Schreiben vor dem Umbenennen scheitert', async () => {
    const dir = await createTempDir('atomic');
    await writeFileAtomic(`${dir}/config.json`, 'alter Inhalt');
    vi.mocked(fsp.rename).mockClear();
    vi.mocked(fsp.open).mockImplementationOnce(failingHandle as unknown as typeof fsp.open);
    await expect(writeFileAtomic(`${dir}/config.json`, 'neuer Inhalt')).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await actual.readFile(`${dir}/config.json`, 'utf8')).toBe('alter Inhalt');
    expect(await actual.readdir(dir)).toEqual(['config.json']);
    expect(fsp.rename).not.toHaveBeenCalled();
  });

  it('wiederholt das Umbenennen bei EPERM und EBUSY', async () => {
    const dir = await createTempDir('atomic');
    vi.mocked(fsp.rename).mockRejectedValueOnce(errno('EPERM')).mockRejectedValueOnce(errno('EBUSY'));
    await writeFileAtomic(`${dir}/registry.json`, 'inhalt');
    expect(fsp.rename).toHaveBeenCalledTimes(3);
    expect(await actual.readFile(`${dir}/registry.json`, 'utf8')).toBe('inhalt');
  });

  it('gibt nach fünf Wiederholungen auf und behält den alten Inhalt', async () => {
    const dir = await createTempDir('atomic');
    await writeFileAtomic(`${dir}/state.json`, 'alt');
    vi.mocked(fsp.rename).mockClear();
    for (let i = 0; i <= RENAME_RETRIES; i += 1) vi.mocked(fsp.rename).mockRejectedValueOnce(errno('EPERM'));
    await expect(writeFileAtomic(`${dir}/state.json`, 'neu')).rejects.toMatchObject({ code: 'EPERM' });
    expect(fsp.rename).toHaveBeenCalledTimes(RENAME_RETRIES + 1);
    expect(await actual.readFile(`${dir}/state.json`, 'utf8')).toBe('alt');
    expect(await actual.readdir(dir)).toEqual(['state.json']);
  });

  it('wiederholt andere Fehler beim Umbenennen nicht', async () => {
    const dir = await createTempDir('atomic');
    vi.mocked(fsp.rename).mockRejectedValueOnce(errno('EACCES'));
    await expect(writeFileAtomic(`${dir}/x.json`, 'inhalt')).rejects.toMatchObject({ code: 'EACCES' });
    expect(fsp.rename).toHaveBeenCalledTimes(1);
    expect(await actual.readdir(dir)).toEqual([]);
  });

  it('createFileExclusive legt neue Dateien an und scheitert bei vorhandenen', async () => {
    const dir = await createTempDir('exclusive');
    await createFileExclusive(`${dir}/complete.json`, 'erst');
    const error = await createFileExclusive(`${dir}/complete.json`, 'zweit').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileExistsError);
    expect(error).toMatchObject({ code: 'file_exists', exitCode: 1 });
    expect(await actual.readFile(`${dir}/complete.json`, 'utf8')).toBe('erst');
  });

  it('createFileExclusive entfernt eine angefangene Datei, wenn das Schreiben scheitert', async () => {
    const dir = await createTempDir('exclusive');
    vi.mocked(fsp.open).mockImplementationOnce(failingHandle as unknown as typeof fsp.open);
    await expect(createFileExclusive(`${dir}/skip.json`, 'inhalt')).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await actual.readdir(dir)).toEqual([]);
  });
});
