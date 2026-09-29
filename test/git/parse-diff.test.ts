import { describe, expect, it } from 'vitest';
import { parseNumstatZ, parseRawZ, quoteGitPath, splitPatch, unquoteGitPath } from '../../src/git/parse-diff.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const Z = '0'.repeat(40);

describe('parseRawZ', () => {
  it('liest Änderungen, Umbenennungen mit Ähnlichkeit und Pfade mit Sonderzeichen', () => {
    const output = [
      `:100644 100644 ${A} ${B} M`,
      'src/mit leer zeichen.ts',
      `:000000 100644 ${Z} ${B} A`,
      'neu\nzeile.txt',
      `:100644 000000 ${A} ${Z} D`,
      'weg.txt',
      `:100644 100644 ${A} ${A} R100`,
      'alt/ä.txt',
      'neu/ä.txt',
      `:120000 120000 ${A} ${B} T`,
      'link',
      '',
    ].join('\0');
    expect(parseRawZ(`\n${output}`)).toEqual([
      { srcMode: '100644', dstMode: '100644', srcBlob: A, dstBlob: B, status: 'M', score: null, path: 'src/mit leer zeichen.ts', oldPath: null },
      { srcMode: '000000', dstMode: '100644', srcBlob: Z, dstBlob: B, status: 'A', score: null, path: 'neu\nzeile.txt', oldPath: null },
      { srcMode: '100644', dstMode: '000000', srcBlob: A, dstBlob: Z, status: 'D', score: null, path: 'weg.txt', oldPath: null },
      { srcMode: '100644', dstMode: '100644', srcBlob: A, dstBlob: A, status: 'R', score: 100, path: 'neu/ä.txt', oldPath: 'alt/ä.txt' },
      { srcMode: '120000', dstMode: '120000', srcBlob: A, dstBlob: B, status: 'T', score: null, path: 'link', oldPath: null },
    ]);
  });

  it('meldet unerwartete Zeilen als Fehler', () => {
    expect(() => parseRawZ('kein raw\0x\0')).toThrow(/diff --raw/);
  });
});

describe('parseNumstatZ', () => {
  it('erkennt Binärdateien und Umbenennungen', () => {
    const output = '3\t1\tsrc/a.ts\0-\t-\tbild.png\0' + '0\t0\t\0alt.txt\0neu.txt\0';
    expect(parseNumstatZ(output)).toEqual([
      { added: 3, deleted: 1, binary: false, path: 'src/a.ts', oldPath: null },
      { added: null, deleted: null, binary: true, path: 'bild.png', oldPath: null },
      { added: 0, deleted: 0, binary: false, path: 'neu.txt', oldPath: 'alt.txt' },
    ]);
  });
});

describe('Pfad-Quoting', () => {
  it('kodiert und dekodiert Git-C-Quoting', () => {
    expect(quoteGitPath('a/einfach ä.txt')).toBe('a/einfach ä.txt');
    expect(quoteGitPath('a/mit "quote"\\und\ttab\nzeile')).toBe('"a/mit \\"quote\\"\\\\und\\ttab\\nzeile"');
    expect(unquoteGitPath('"a/mit \\"quote\\"\\\\und\\ttab\\nzeile"')).toBe('a/mit "quote"\\und\ttab\nzeile');
    expect(unquoteGitPath('"a/\\303\\244.txt"')).toBe('a/ä.txt');
    expect(unquoteGitPath('ohne/quotes.txt')).toBe('ohne/quotes.txt');
  });
});

describe('splitPatch', () => {
  it('teilt einen Patch in Dateiabschnitte und bestimmt alte und neue Pfade', () => {
    const sections = [
      'diff --git a/src/app.ts b/src/app.ts\nindex 1..2 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-alt\n+diff --git a/x b/x\n',
      'diff --git a/mit leer.txt b/mit leer.txt\nnew file mode 100644\nindex 0..3\n--- /dev/null\n+++ b/mit leer.txt\t\n@@ -0,0 +1 @@\n+neu\n',
      'diff --git a/alt.txt b/neu.txt\nsimilarity index 90%\nrename from alt.txt\nrename to neu.txt\n',
      'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"\ndeleted file mode 100644\nindex 4..0\n--- "a/q\\"uote.txt"\n+++ /dev/null\n@@ -1 +0,0 @@\n-weg\n',
      'diff --git a/bild.png b/bild.png\nnew file mode 100644\nindex 0..5\nBinary files /dev/null and b/bild.png differ\n',
      'diff --git a/leer a b/leer a\nold mode 100644\nnew mode 100755\n',
    ];
    const parsed = splitPatch(Buffer.from(sections.join(''), 'utf8'));
    expect(parsed.map(({ oldPath, newPath }) => ({ oldPath, newPath }))).toEqual([
      { oldPath: 'src/app.ts', newPath: 'src/app.ts' },
      { oldPath: null, newPath: 'mit leer.txt' },
      { oldPath: 'alt.txt', newPath: 'neu.txt' },
      { oldPath: 'q"uote.txt', newPath: null },
      { oldPath: null, newPath: 'bild.png' },
      { oldPath: 'leer a', newPath: 'leer a' },
    ]);
    expect(parsed.map((section) => section.content.toString('utf8'))).toEqual(sections);
  });

  it('liefert für eine leere Ausgabe keine Abschnitte', () => {
    expect(splitPatch(Buffer.alloc(0))).toEqual([]);
  });
});
