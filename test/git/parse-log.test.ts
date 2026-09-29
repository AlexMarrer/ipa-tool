import { describe, expect, it } from 'vitest';
import { parseCommitLogZ, parseRevList } from '../../src/git/parse-log.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

describe('parseRevList', () => {
  it('liest eine Commit-ID pro Zeile', () => {
    expect(parseRevList(`${A}\n${B}\r\n\n`)).toEqual([A, B]);
    expect(parseRevList('')).toEqual([]);
    expect(() => parseRevList('kein-hash\n')).toThrow(/rev-list/);
  });
});

describe('parseCommitLogZ', () => {
  it('liest Metadaten, Eltern und mehrzeilige Nachrichten', () => {
    const output =
      [A, '', '1790682464', '1790682465', 'ich@example.invalid', 'Erster Commit\n'].join('\0') +
      '\0' +
      [C, `${A} ${B}`, '1790682470', '1790682471', 'fremd@example.invalid', 'Merge\n\nmit Text\nund Leerzeile\n'].join('\0') +
      '\0';
    expect(parseCommitLogZ(Buffer.from(output))).toEqual([
      { sha: A, parents: [], authorTime: 1790682464, committerTime: 1790682465, authorEmail: 'ich@example.invalid', message: 'Erster Commit\n' },
      {
        sha: C,
        parents: [A, B],
        authorTime: 1790682470,
        committerTime: 1790682471,
        authorEmail: 'fremd@example.invalid',
        message: 'Merge\n\nmit Text\nund Leerzeile\n',
      },
    ]);
  });

  it('meldet eine unvollständige Ausgabe als Fehler', () => {
    expect(() => parseCommitLogZ(`${A}\0\0`)).toThrow(/log/);
  });
});
