import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/core/config.js';
import type { WorkspaceContext } from '../../src/core/context.js';
import { IpaError } from '../../src/core/errors.js';
import { ID_PATTERNS } from '../../src/core/ids.js';
import { validate } from '../../src/core/schemas.js';
import { addNote, readNotes } from '../../src/notes/store.js';
import type { Note } from '../../src/notes/types.js';
import { createTempDir } from '../helpers/workspace.js';

interface TestContext {
  ctx: WorkspaceContext;
  /** Sets the injected clock. */
  at(iso: string): void;
}

async function context(timezone = 'Europe/Zurich'): Promise<TestContext> {
  let current = new Date('2026-10-14T08:15:00Z');
  const workspaceDir = await createTempDir('notes');
  await mkdir(`${workspaceDir}/notes`);
  const ctx: WorkspaceContext = {
    dataRoot: await createTempDir('data'),
    repoRoot: 'C:/nicht/benutzt',
    repositoryId: 'projekt-3fa9c1',
    workspaceDir,
    config: createDefaultConfig({ repositoryId: 'projekt-3fa9c1', repoPath: 'C:/nicht/benutzt', timezone }),
    clock: { now: () => current },
    runId: 'R20261014T081500Z-a3f9',
  };
  return {
    ctx,
    at: (iso) => {
      current = new Date(iso);
    },
  };
}

async function noteLines(workspaceDir: string, day: string): Promise<string[]> {
  return (await readFile(`${workspaceDir}/notes/${day}.jsonl`, 'utf8')).split('\n').filter((line) => line !== '');
}

describe('addNote (spec.md §10, Paket 04 §4)', () => {
  it('speichert eine schemagültige Notiz als Zeile in notes/<Tag>.jsonl (AK-04-01)', async () => {
    const { ctx } = await context();
    const note = await addNote(ctx, { type: 'general', text: '  Mock lieferte den falschen Datentyp; "Testdaten" angepasst – äöü ' });
    expect(note).toEqual({
      schemaVersion: 1,
      id: expect.stringMatching(/^N20261014T081500Z-[0-9a-f]{4}$/) as unknown as string,
      type: 'general',
      text: 'Mock lieferte den falschen Datentyp; "Testdaten" angepasst – äöü',
      activityDay: '2026-10-14',
      recordedAt: '2026-10-14T10:15:00+02:00',
      time: null,
      delay: null,
      reason: null,
      alternatives: [],
      cause: null,
      solution: null,
      refs: [],
    });
    expect(note.id).toMatch(ID_PATTERNS.noteId);
    expect(validate('note', note)).toEqual({ ok: true });
    const lines = await noteLines(ctx.workspaceDir, '2026-10-14');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(note);
    // Field order of spec.md §9.5.
    expect(Object.keys(JSON.parse(lines[0]!) as object)).toEqual([
      'schemaVersion',
      'id',
      'type',
      'text',
      'activityDay',
      'recordedAt',
      'time',
      'delay',
      'reason',
      'alternatives',
      'cause',
      'solution',
      'refs',
    ]);
  });

  it('bestimmt den Tätigkeitstag in der konfigurierten Zeitzone, nicht in UTC (Paket 04 §6)', async () => {
    const { ctx, at } = await context();
    // 23:59 in Zurich (summer time) is 21:59 UTC on the same day.
    at('2026-10-14T21:59:00Z');
    expect(await addNote(ctx, { type: 'activity', text: 'spät' })).toMatchObject({
      activityDay: '2026-10-14',
      recordedAt: '2026-10-14T23:59:00+02:00',
    });
    // 00:30 in Zurich is still the previous day in UTC.
    at('2026-10-14T22:30:00Z');
    expect(await addNote(ctx, { type: 'activity', text: 'nach Mitternacht' })).toMatchObject({
      activityDay: '2026-10-15',
      recordedAt: '2026-10-15T00:30:00+02:00',
    });
    at('2026-01-15T23:30:00Z');
    expect(await addNote(ctx, { type: 'activity', text: 'Winterzeit' })).toMatchObject({
      activityDay: '2026-01-16',
      recordedAt: '2026-01-16T00:30:00+01:00',
    });
    expect((await readdir(`${ctx.workspaceDir}/notes`)).sort()).toEqual(['2026-01-16.jsonl', '2026-10-14.jsonl', '2026-10-15.jsonl']);

    const newYork = await context('America/New_York');
    newYork.at('2026-10-15T02:00:00Z');
    expect(await addNote(newYork.ctx, { type: 'general', text: 'New York' })).toMatchObject({
      activityDay: '2026-10-14',
      recordedAt: '2026-10-14T22:00:00-04:00',
    });
  });

  it('prüft den Tag gegen heute in der Zeitzone: Zukunft nur bei plan (AK-04-05)', async () => {
    const { ctx, at } = await context();
    at('2026-10-14T22:30:00Z');
    // In Zurich it is already 15 October, so this day is not in the future.
    expect((await addNote(ctx, { type: 'general', text: 'x', activityDay: '2026-10-15' })).activityDay).toBe('2026-10-15');
    const error = await addNote(ctx, { type: 'general', text: 'x', activityDay: '2026-10-16' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IpaError);
    expect(error).toMatchObject({ code: 'note_day_future', exitCode: 2 });
    expect((await addNote(ctx, { type: 'plan', text: 'x', activityDay: '2026-10-16' })).activityDay).toBe('2026-10-16');
  });

  it('schreibt bei einer ungültigen Eingabe nichts', async () => {
    const { ctx } = await context();
    await expect(addNote(ctx, { type: 'activity', text: '   ' })).rejects.toMatchObject({ code: 'note_text_empty', exitCode: 2 });
    await expect(addNote(ctx, { type: 'activity', text: 'x', reason: 'weil' })).rejects.toMatchObject({ code: 'note_decision_fields' });
    expect(await readdir(`${ctx.workspaceDir}/notes`)).toEqual([]);
  });

  it('hängt an, ohne den Lock zu nehmen oder anzutasten (D-16)', async () => {
    const { ctx } = await context();
    const lock = `${JSON.stringify({ pid: process.pid, hostname: os.hostname(), command: 'capture', runId: 'R20261014T081000Z-beef', startedAt: '2026-10-14T10:10:00+02:00' })}\n`;
    await writeFile(`${ctx.workspaceDir}/lock`, lock);
    await addNote(ctx, { type: 'general', text: 'während capture' });
    expect(await readFile(`${ctx.workspaceDir}/lock`, 'utf8')).toBe(lock);
    expect(await noteLines(ctx.workspaceDir, '2026-10-14')).toHaveLength(1);
  });

  it('legt den Ordner notes/ bei Bedarf an', async () => {
    const { ctx } = await context();
    const bare = { ...ctx, workspaceDir: await createTempDir('ohne-notes') };
    await addNote(bare, { type: 'general', text: 'x' });
    expect(await readdir(`${bare.workspaceDir}/notes`)).toEqual(['2026-10-14.jsonl']);
  });
});

describe('readNotes (spec.md §10, AK-04-10)', () => {
  /** Notes on two days, recorded at different times and in different orders. */
  async function sample() {
    const test = await context();
    const { ctx, at } = test;
    at('2026-10-14T07:00:00Z');
    const early = await addNote(ctx, { type: 'activity', text: 'früh', refs: ['S000002:E001'] });
    at('2026-10-14T09:00:00Z');
    const yesterday = await addNote(ctx, { type: 'general', text: 'nachgetragen', activityDay: '2026-10-13' });
    at('2026-10-14T11:00:00Z');
    const late = await addNote(ctx, { type: 'problem', text: 'spät', refs: ['S000003:E002', 'S000002:E004'] });
    return { ...test, early, yesterday, late };
  }

  const ids = (notes: Note[]): string[] => notes.map((note) => note.id);

  it('liefert ohne Kriterien alle Notizen nach recordedAt sortiert', async () => {
    const { ctx, early, yesterday, late } = await sample();
    expect(await readNotes(ctx)).toEqual({ notes: [early, yesterday, late], invalid: [] });
  });

  it('filtert nach Tätigkeitstag', async () => {
    const { ctx, early, yesterday, late } = await sample();
    expect(ids((await readNotes(ctx, { day: '2026-10-14' })).notes)).toEqual(ids([early, late]));
    expect(ids((await readNotes(ctx, { day: '2026-10-13' })).notes)).toEqual(ids([yesterday]));
    expect(await readNotes(ctx, { day: '2026-10-12' })).toEqual({ notes: [], invalid: [] });
  });

  it('filtert recordedAt im Intervall (von, bis] wie observedPeriod, auch bei anderem Offset (spec.md §12.2)', async () => {
    const { ctx, early, yesterday, late } = await sample();
    // early was recorded at 09:00+02:00, yesterday at 11:00+02:00, late at 13:00+02:00.
    expect(ids((await readNotes(ctx, { recordedFrom: '2026-10-14T09:00:00+02:00', recordedTo: '2026-10-14T11:00:00+02:00' })).notes)).toEqual(
      ids([yesterday]),
    );
    expect(ids((await readNotes(ctx, { recordedFrom: '2026-10-14T06:59:59Z' })).notes)).toEqual(ids([early, yesterday, late]));
    expect(ids((await readNotes(ctx, { recordedTo: '2026-10-14T07:00:00Z' })).notes)).toEqual(ids([early]));
    expect(ids((await readNotes(ctx, { recordedFrom: '2026-10-14T03:00:00-04:00', recordedTo: '2026-10-14T12:00:00+01:00' })).notes)).toEqual(
      ids([yesterday, late]),
    );
  });

  it('filtert nach Referenz auf einen Snapshot und verknüpft Kriterien mit und', async () => {
    const { ctx, early, late } = await sample();
    expect(ids((await readNotes(ctx, { refsToSnapshot: 'S000002' })).notes)).toEqual(ids([early, late]));
    expect(ids((await readNotes(ctx, { refsToSnapshot: 'S000003' })).notes)).toEqual(ids([late]));
    expect((await readNotes(ctx, { refsToSnapshot: 'S000001' })).notes).toEqual([]);
    expect(ids((await readNotes(ctx, { refsToSnapshot: 'S000002', recordedFrom: '2026-10-14T08:00:00Z' })).notes)).toEqual(ids([late]));
    expect((await readNotes(ctx, { refsToSnapshot: 'S000002', day: '2026-10-13' })).notes).toEqual([]);
  });

  it('sortiert bei gleichem recordedAt nach id', async () => {
    const { ctx } = await context();
    const notes: Note[] = [];
    for (let i = 0; i < 4; i += 1) notes.push(await addNote(ctx, { type: 'general', text: `Notiz ${i}` }));
    const sorted = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(ids((await readNotes(ctx)).notes)).toEqual(ids(sorted));
  });

  it('meldet eine beschädigte Zeile mit Datei und Zeile, ohne die übrigen Notizen zu verlieren', async () => {
    const { ctx, at } = await context();
    const first = await addNote(ctx, { type: 'general', text: 'eins' });
    // A line damaged by hand, without a final line break.
    await appendFile(`${ctx.workspaceDir}/notes/2026-10-14.jsonl`, '{"schemaVersion":1,"id":"kaputt');
    at('2026-10-14T08:16:00Z');
    const third = await addNote(ctx, { type: 'general', text: 'drei' });
    const result = await readNotes(ctx, { day: '2026-10-14' });
    expect(result.notes).toEqual([first, third]);
    expect(result.invalid).toEqual([{ file: 'notes/2026-10-14.jsonl', line: 2, error: 'kein gültiges JSON' }]);
  });

  it('meldet von Hand erzeugte Widersprüche: falsche Tagesdatei, doppelte ID, Felder eines anderen Typs', async () => {
    const { ctx } = await context();
    const note = await addNote(ctx, { type: 'general', text: 'Original' });
    const line = JSON.stringify(note);
    await appendFile(`${ctx.workspaceDir}/notes/2026-10-14.jsonl`, `${line}\n`);
    await writeFile(`${ctx.workspaceDir}/notes/2026-10-13.jsonl`, `${JSON.stringify({ ...note, id: 'N20261014T081500Z-ffff' })}\n`);
    await appendFile(
      `${ctx.workspaceDir}/notes/2026-10-14.jsonl`,
      `${JSON.stringify({ ...note, id: 'N20261014T081500Z-eeee', reason: 'nur bei decision' })}\n`,
    );

    const result = await readNotes(ctx);
    expect(result.notes).toEqual([note]);
    expect(result.invalid).toEqual([
      { file: 'notes/2026-10-13.jsonl', line: 1, error: 'activityDay 2026-10-14 passt nicht zur Datei des Tages 2026-10-13' },
      { file: 'notes/2026-10-14.jsonl', line: 2, error: `Notiz-ID ${note.id} kommt mehrfach vor` },
      { file: 'notes/2026-10-14.jsonl', line: 3, error: expect.stringContaining('/reason: muss vom Typ null sein') as unknown as string },
    ]);
  });

  it('liefert leere Listen ohne Notizen und übergeht fremde Dateien in notes/', async () => {
    const { ctx } = await context();
    expect(await readNotes(ctx)).toEqual({ notes: [], invalid: [] });
    await writeFile(`${ctx.workspaceDir}/notes/README.txt`, 'kein JSONL');
    await writeFile(`${ctx.workspaceDir}/notes/2026-10-14.jsonl.bak`, '{kaputt}\n');
    expect(await readNotes(ctx)).toEqual({ notes: [], invalid: [] });
    const bare = { ...ctx, workspaceDir: await createTempDir('ohne-notes') };
    expect(await readNotes(bare)).toEqual({ notes: [], invalid: [] });
  });

  it('lehnt ungültige Abfragen als Programmierfehler ab', async () => {
    const { ctx } = await context();
    await expect(readNotes(ctx, { day: '../state' })).rejects.toBeInstanceOf(RangeError);
    await expect(readNotes(ctx, { recordedFrom: 'gestern' })).rejects.toBeInstanceOf(RangeError);
  });
});
