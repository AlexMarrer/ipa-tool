import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJournalFiles } from '../../src/main/reader/journal-files';

const DRAFT = '2026-11-26-R20261126T104200Z-7f10';
let ws: string;
let trashed: string[];
let trashFails: boolean;
const shell = {
  trashItem: async (file: string) => {
    if (trashFails) throw new Error('kein Papierkorb');
    trashed.push(file);
  },
};

beforeEach(async () => {
  ws = await mkdtemp(path.join(os.tmpdir(), 'ipa-journal-'));
  trashed = [];
  trashFails = false;
  await mkdir(path.join(ws, 'journal', 'drafts'), { recursive: true });
  await writeFile(path.join(ws, 'journal', 'drafts', `${DRAFT}.md`), '# Journal\nEntwurf\n');
  await writeFile(path.join(ws, 'journal', 'drafts', `${DRAFT}.json`), '{}');
});
afterEach(() => rm(ws, { recursive: true, force: true }));

describe('Endfassung und Löschen in der App (spec §4.3, §8.5)', () => {
  it('kopiert den Entwurf nach journal/final/<Tag>.md und lässt den Entwurf unverändert', async () => {
    const files = createJournalFiles(ws, shell);
    expect(await files.finalize(DRAFT)).toEqual({ ok: true, file: '2026-11-26.md' });
    expect(await readFile(path.join(ws, 'journal', 'final', '2026-11-26.md'), 'utf8')).toBe('# Journal\nEntwurf\n');
    expect(await readFile(path.join(ws, 'journal', 'drafts', `${DRAFT}.md`), 'utf8')).toBe('# Journal\nEntwurf\n');
  });

  it('überschreibt nie eine vorhandene Endfassung, sondern nummeriert', async () => {
    const files = createJournalFiles(ws, shell);
    await mkdir(path.join(ws, 'journal', 'final'), { recursive: true });
    await writeFile(path.join(ws, 'journal', 'final', '2026-11-26.md'), 'MEINE ARBEIT');
    expect(await files.finalize(DRAFT)).toEqual({ ok: true, file: '2026-11-26-2.md' });
    expect(await files.finalize(DRAFT)).toEqual({ ok: true, file: '2026-11-26-3.md' });
    expect(await readFile(path.join(ws, 'journal', 'final', '2026-11-26.md'), 'utf8')).toBe('MEINE ARBEIT');
  });

  it('lehnt ungültige und fehlende Entwürfe ab, ohne etwas anzulegen', async () => {
    const files = createJournalFiles(ws, shell);
    for (const bad of ['../drafts/x', '..\\..\\config', 'C:/Windows/win', `${DRAFT}.md`, '2026-11-26-R20261126T104200Z-zzzz']) {
      expect((await files.finalize(bad)).ok, bad).toBe(false);
    }
    expect(await files.finals('2026-11-26')).toEqual([]);
  });

  it('listet nur Dateien des Tages mit gültigem Namen', async () => {
    const files = createJournalFiles(ws, shell);
    const dir = path.join(ws, 'journal', 'final');
    await mkdir(dir, { recursive: true });
    for (const name of ['2026-11-26.md', '2026-11-26 überarbeitet.md', '2026-11-25.md', 'notizen.md', '2026-11-26.txt']) await writeFile(path.join(dir, name), 'x');
    await mkdir(path.join(dir, '2026-11-26-ordner.md'));
    const found = await files.finals('2026-11-26');
    expect(found.map((entry) => entry.file)).toEqual(['2026-11-26 überarbeitet.md', '2026-11-26.md']);
    expect(await files.finals('26.11.2026')).toEqual([]);
  });

  it('verschiebt einen Entwurf samt Datensatz in den Papierkorb und löscht nichts endgültig', async () => {
    const files = createJournalFiles(ws, shell);
    expect(await files.remove('draft', DRAFT)).toEqual({ removed: true, problem: null });
    expect(trashed.map((file) => path.basename(file))).toEqual([`${DRAFT}.md`, `${DRAFT}.json`]);
    // The fake bin only records; the files stay, which proves the app itself never unlinks.
    expect(await readFile(path.join(ws, 'journal', 'drafts', `${DRAFT}.md`), 'utf8')).toContain('Entwurf');
  });

  it('verschiebt eine Endfassung in den Papierkorb, aber nur aus journal/final/', async () => {
    const files = createJournalFiles(ws, shell);
    await files.finalize(DRAFT);
    expect((await files.remove('final', '2026-11-26.md')).removed).toBe(true);
    expect(path.basename(trashed[0] as string)).toBe('2026-11-26.md');
    for (const bad of ['..\\drafts\\x.md', '../config.json', 'config.json', '2026-11-26/../../config.md', 'C:\\x\\2026-11-26.md']) {
      expect((await files.remove('final', bad)).removed, bad).toBe(false);
    }
    expect(trashed).toHaveLength(1);
  });

  it('meldet einen fehlenden Papierkorb, statt endgültig zu löschen', async () => {
    const files = createJournalFiles(ws, shell);
    trashFails = true;
    expect(await files.remove('draft', DRAFT)).toMatchObject({ removed: false, problem: expect.stringContaining('Papierkorb') });
    expect(await readFile(path.join(ws, 'journal', 'drafts', `${DRAFT}.md`), 'utf8')).toContain('Entwurf');
  });

  it('folgt keinem Verweis aus dem Arbeitsbereich hinaus', async () => {
    const files = createJournalFiles(ws, shell);
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ipa-outside-'));
    try {
      await writeFile(path.join(outside, 'geheim.md'), 'nicht anfassen');
      await mkdir(path.join(ws, 'journal', 'final'), { recursive: true });
      try {
        await symlink(path.join(outside, 'geheim.md'), path.join(ws, 'journal', 'final', '2026-11-26-link.md'), 'file');
      } catch {
        return; // no permission for symbolic links on this machine
      }
      expect((await files.remove('final', '2026-11-26-link.md')).removed).toBe(false);
      expect(trashed).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
