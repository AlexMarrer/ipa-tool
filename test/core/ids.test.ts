import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/core/clock.js';
import {
  createNoteId,
  createRepositoryId,
  createRunId,
  formatSnapshotId,
  ID_PATTERNS,
  parseSnapshotSeq,
  slugify,
} from '../../src/core/ids.js';

const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });

describe('IDs nach spec.md §8.2', () => {
  it('bildet den Slug aus [a-z0-9-] mit höchstens 32 Zeichen', () => {
    expect(slugify('Mein Projekt')).toBe('mein-projekt');
    expect(slugify('Übung Äpfel Größe')).toBe('uebung-aepfel-groesse');
    expect(slugify('Café  --  Crème')).toBe('cafe-creme');
    expect(slugify('---')).toBe('repo');
    expect(slugify('日本語')).toBe('repo');
    const long = slugify('ein sehr langer Ordnername für ein Repository mit vielen Wörtern');
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('erzeugt repositoryId als Slug, Bindestrich und 6 Hex-Zeichen', () => {
    const id = createRepositoryId('C:/GIT/Mein Projekt');
    expect(id).toMatch(ID_PATTERNS.repositoryId);
    expect(id).toMatch(/^mein-projekt-[0-9a-f]{6}$/);
    expect(createRepositoryId('C:/')).toMatch(/^repo-[0-9a-f]{6}$/);
    const ids = new Set(Array.from({ length: 50 }, () => createRepositoryId('C:/GIT/x')));
    expect(ids.size).toBeGreaterThan(45);
  });

  it('erzeugt runId und noteId aus der UTC-Zeit der Uhr', () => {
    const clock = fixedClock('2026-10-14T08:03:12.987Z');
    expect(createRunId(clock)).toMatch(/^R20261014T080312Z-[0-9a-f]{4}$/);
    expect(createNoteId(clock)).toMatch(/^N20261014T080312Z-[0-9a-f]{4}$/);
    expect(createRunId(clock)).toMatch(ID_PATTERNS.runOrNoteId);
    expect(createNoteId(clock)).toMatch(ID_PATTERNS.noteId);
  });

  it('formatiert und liest snapshotId', () => {
    expect(formatSnapshotId(1)).toBe('S000001');
    expect(formatSnapshotId(123456)).toBe('S123456');
    expect(parseSnapshotSeq('S000002')).toBe(2);
    expect(() => formatSnapshotId(0)).toThrow(RangeError);
    expect(() => formatSnapshotId(1_000_000)).toThrow(RangeError);
    expect(() => formatSnapshotId(1.5)).toThrow(RangeError);
    expect(() => parseSnapshotSeq('S12')).toThrow(RangeError);
  });

  it('prüft die Regex-Muster aus spec.md §8.2', () => {
    expect(ID_PATTERNS.snapshotId.test('S000002')).toBe(true);
    expect(ID_PATTERNS.snapshotId.test('S00002')).toBe(false);
    expect(ID_PATTERNS.evidenceId.test('E001')).toBe(true);
    expect(ID_PATTERNS.evidenceId.test('E1234')).toBe(true);
    expect(ID_PATTERNS.evidenceId.test('E01')).toBe(false);
    expect(ID_PATTERNS.qualifiedEvidence.test('S000002:E001')).toBe(true);
    expect(ID_PATTERNS.qualifiedEvidence.test('S000002-E001')).toBe(false);
    expect(ID_PATTERNS.runOrNoteId.test('R20261014T080312Z-a3f9')).toBe(true);
    expect(ID_PATTERNS.runOrNoteId.test('N20261014T081500Z-0c1d')).toBe(true);
    expect(ID_PATTERNS.runOrNoteId.test('R20261014T080312Z-A3F9')).toBe(false);
    expect(ID_PATTERNS.contextId.test('C01')).toBe(true);
    expect(ID_PATTERNS.contextId.test('C1')).toBe(false);
  });
});
