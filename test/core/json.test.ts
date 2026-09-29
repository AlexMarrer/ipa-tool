import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/core/config.js';
import { IpaError } from '../../src/core/errors.js';
import { readJsonValidated, writeJsonAtomic } from '../../src/core/json.js';
import { createTempDir } from '../helpers/workspace.js';

async function readError(file: string): Promise<IpaError> {
  const error = await readJsonValidated(file, 'config').catch((e: unknown) => e);
  if (error instanceof IpaError) return error;
  throw new Error('Es wurde kein IpaError geworfen');
}

const config = () => createDefaultConfig({ repositoryId: 'projekt-3fa9c1', repoPath: 'C:/GIT/projekt', timezone: 'Europe/Zurich' });

describe('Validiertes Lesen und Schreiben (spec.md §8.4, D-18)', () => {
  it('liest eine gültige Datei, auch mit BOM', async () => {
    const file = `${await createTempDir('json')}/config.json`;
    await writeFile(file, `\uFEFF${JSON.stringify(config())}`);
    await expect(readJsonValidated(file, 'config')).resolves.toEqual(config());
  });

  it('meldet fehlende Dateien und Syntaxfehler mit Exit-Code 2, ohne Inhalte zu zitieren', async () => {
    const dir = await createTempDir('json');
    expect((await readError(`${dir}/fehlt.json`)).code).toBe('file_not_found');
    await writeFile(`${dir}/kaputt.json`, '{\n  "geheimerWert": GEHEIM_123\n}');
    const syntax = await readError(`${dir}/kaputt.json`);
    expect(syntax.code).toBe('json_invalid');
    expect(syntax.exitCode).toBe(2);
    expect(syntax.message).not.toContain('GEHEIM_123');
    expect(syntax.message).toContain('kaputt.json');
  });

  it('bricht bei einer höheren schemaVersion mit Exit-Code 2 ab', async () => {
    const file = `${await createTempDir('json')}/config.json`;
    await writeFile(file, JSON.stringify({ ...config(), schemaVersion: 2 }));
    const error = await readError(file);
    expect(error.code).toBe('schema_version_unsupported');
    expect(error.exitCode).toBe(2);
  });

  it('nennt bei Schemafehlern Datei und JSON-Pfad', async () => {
    const file = `${await createTempDir('json')}/config.json`;
    await writeFile(file, JSON.stringify({ ...config(), limits: { ...config().limits, maxRunSeconds: 'lang' } }));
    const error = await readError(file);
    expect(error.code).toBe('schema_invalid');
    expect(error.message).toContain('/limits/maxRunSeconds');
  });

  it('schreibt keine ungültigen Werte', async () => {
    const file = `${await createTempDir('json')}/config.json`;
    await writeJsonAtomic(file, config(), 'config');
    const before = await readFile(file, 'utf8');
    await expect(writeJsonAtomic(file, { ...config(), timezone: 5 }, 'config')).rejects.toMatchObject({
      code: 'record_invalid',
      exitCode: 1,
    });
    expect(await readFile(file, 'utf8')).toBe(before);
  });
});
