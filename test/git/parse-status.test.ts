import { describe, expect, it } from 'vitest';
import { parseLsFilesStageZ, parseStatusV2Z } from '../../src/git/parse-status.js';

const H = 'a'.repeat(40);
const I = 'b'.repeat(40);
const Z = '0'.repeat(40);

describe('parseStatusV2Z', () => {
  it('liest gewöhnliche, umbenannte, unaufgelöste, neue und ignorierte Einträge', () => {
    const output = [
      '# branch.oid ' + H,
      `1 .M N... 100644 100644 100644 ${H} ${H} Ordner mit Leerzeichen/Übung ä.txt`,
      `1 A. N... 000000 100644 100644 ${Z} ${I} neu gestagt.txt`,
      `2 R. N... 100644 100644 100644 ${H} ${I} R100 neuer Name.txt`,
      'alter Name.txt',
      `u UU N... 100644 100644 100644 100644 ${H} ${I} ${H} konflikt.txt`,
      '? zeile\nmit umbruch.txt',
      '! build/out.log',
      '',
    ].join('\0');
    expect(parseStatusV2Z(Buffer.from(output, 'utf8'))).toEqual([
      {
        type: 'ordinary',
        xy: '.M',
        sub: 'N...',
        modes: { head: '100644', index: '100644', worktree: '100644' },
        blobs: { head: H, index: H },
        path: 'Ordner mit Leerzeichen/Übung ä.txt',
      },
      {
        type: 'ordinary',
        xy: 'A.',
        sub: 'N...',
        modes: { head: '000000', index: '100644', worktree: '100644' },
        blobs: { head: Z, index: I },
        path: 'neu gestagt.txt',
      },
      {
        type: 'renamed',
        xy: 'R.',
        sub: 'N...',
        modes: { head: '100644', index: '100644', worktree: '100644' },
        blobs: { head: H, index: I },
        score: 'R100',
        path: 'neuer Name.txt',
        origPath: 'alter Name.txt',
      },
      {
        type: 'unmerged',
        xy: 'UU',
        sub: 'N...',
        modes: { stage1: '100644', stage2: '100644', stage3: '100644', worktree: '100644' },
        blobs: { stage1: H, stage2: I, stage3: H },
        path: 'konflikt.txt',
      },
      { type: 'untracked', path: 'zeile\nmit umbruch.txt' },
      { type: 'ignored', path: 'build/out.log' },
    ]);
  });

  it('meldet unbekannte Zeilen als Fehler', () => {
    expect(() => parseStatusV2Z('x kaputt\0')).toThrow(/status/);
    expect(parseStatusV2Z('')).toEqual([]);
  });
});

describe('parseLsFilesStageZ', () => {
  it('liest Modus, Objekt, Stufe und Pfad mit Tabulator und Leerzeichen', () => {
    const output = `100644 ${H} 0\tsrc/a b.ts\u0000120000 ${I} 0\tlink\u0000160000 ${H} 0\tsub\u0000100644 ${I} 2\tkonflikt.txt\u0000`;
    expect(parseLsFilesStageZ(output)).toEqual([
      { mode: '100644', blob: H, stage: 0, path: 'src/a b.ts' },
      { mode: '120000', blob: I, stage: 0, path: 'link' },
      { mode: '160000', blob: H, stage: 0, path: 'sub' },
      { mode: '100644', blob: I, stage: 2, path: 'konflikt.txt' },
    ]);
  });
});
