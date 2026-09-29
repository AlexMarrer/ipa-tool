import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IpaError } from '../../src/core/errors.js';
import { appendJsonl, readJsonl } from '../../src/core/jsonl.js';
import { createRunRecord, type RunRecord } from '../../src/core/run-log.js';
import { createTempDir } from '../helpers/workspace.js';

function record(runId: string): RunRecord {
  return createRunRecord({
    runId,
    command: 'init',
    startedAt: new Date('2026-10-14T08:03:12Z'),
    endedAt: new Date('2026-10-14T08:03:13Z'),
    timezone: 'Europe/Zurich',
    exitCode: 0,
    lockBroken: false,
  });
}

describe('JSONL (spec.md §8.5, AK-01-09)', () => {
  it('hängt validierte Datensätze als je eine Zeile an', async () => {
    const file = `${await createTempDir('jsonl')}/runs.jsonl`;
    await appendJsonl(file, record('R20261014T080312Z-0001'), 'run-record');
    await appendJsonl(file, record('R20261014T080312Z-0002'), 'run-record');
    const text = await readFile(file, 'utf8');
    expect(text.split('\n')).toHaveLength(3);
    expect(text.endsWith('\n')).toBe(true);
    const result = await readJsonl<RunRecord>(file, 'run-record');
    expect(result.records.map((r) => r.runId)).toEqual(['R20261014T080312Z-0001', 'R20261014T080312Z-0002']);
    expect(result.invalid).toEqual([]);
  });

  it('schreibt keinen ungültigen Datensatz', async () => {
    const file = `${await createTempDir('jsonl')}/runs.jsonl`;
    const error = await appendJsonl(file, { ...record('R20261014T080312Z-0001'), outcome: 'super' }, 'run-record').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(IpaError);
    expect(error).toMatchObject({ code: 'record_invalid', exitCode: 1 });
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('meldet ungültige und unvollständige Zeilen, ohne gültige zu verlieren', async () => {
    const file = `${await createTempDir('jsonl')}/runs.jsonl`;
    const valid = JSON.stringify(record('R20261014T080312Z-0001'));
    const lines = [
      valid,
      '{kein json',
      JSON.stringify({ ...record('R20261014T080312Z-0002'), exitCode: 42 }),
      '',
      JSON.stringify({ ...record('R20261014T080312Z-0003'), schemaVersion: 2 }),
      JSON.stringify(record('R20261014T080312Z-0004')),
      JSON.stringify(record('R20261014T080312Z-0005')),
    ];
    await writeFile(file, `﻿${lines.join('\r\n')}`);
    const result = await readJsonl<RunRecord>(file, 'run-record');
    expect(result.records.map((r) => r.runId)).toEqual(['R20261014T080312Z-0001', 'R20261014T080312Z-0004']);
    expect(result.invalid.map((i) => i.line)).toEqual([2, 3, 5, 7]);
    expect(result.invalid[0]?.error).toBe('kein gültiges JSON');
    expect(result.invalid[1]?.error).toContain('/exitCode');
    expect(result.invalid[2]?.error).toBe('unbekannte Schemaversion 2');
    expect(result.invalid[3]?.error).toBe('unvollständige letzte Zeile');
  });

  it('schliesst eine abgebrochene letzte Zeile ab, bevor ein neuer Datensatz folgt', async () => {
    const file = `${await createTempDir('jsonl')}/runs.jsonl`;
    await writeFile(file, `${JSON.stringify(record('R20261014T080312Z-0001'))}\n{"schemaVersion":1,"runId":"R2026`);
    await appendJsonl(file, record('R20261014T080312Z-0002'), 'run-record');
    const result = await readJsonl<RunRecord>(file, 'run-record');
    expect(result.records.map((r) => r.runId)).toEqual(['R20261014T080312Z-0001', 'R20261014T080312Z-0002']);
    expect(result.invalid).toEqual([{ line: 2, error: 'kein gültiges JSON' }]);
  });

  it('liefert für eine fehlende Datei eine leere Liste', async () => {
    const result = await readJsonl(`${await createTempDir('jsonl')}/fehlt.jsonl`, 'run-record');
    expect(result).toEqual({ records: [], invalid: [] });
  });
});
