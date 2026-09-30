import { describe, expect, it } from 'vitest';
import { validate } from '../../src/core/schemas.js';
import { buildTimeSummary } from '../../src/journal/time-summary.js';
import type { Note } from '../../src/notes/types.js';
import { fixedNotes, NOTE } from './fixtures.js';

function timed(id: string, type: Note['type'], minutes: number, basis: 'measured' | 'estimated', delay: Note['delay'] = null): Note {
  return {
    schemaVersion: 1,
    id,
    type,
    text: 'Text',
    activityDay: '2026-10-14',
    recordedAt: '2026-10-14T10:00:00+02:00',
    time: { minutes, basis, start: null, end: null },
    delay,
    reason: null,
    alternatives: [],
    cause: null,
    solution: null,
    refs: [],
  };
}

describe('Zeitübersicht aus Notizen (spec.md §15, I-07)', () => {
  it('summiert gemessen und geschätzt getrennt und addiert Verzögerungen nicht (AK-07-02)', () => {
    const summary = buildTimeSummary([
      timed('N20261014T080000Z-0001', 'activity', 45, 'measured'),
      timed('N20261014T081000Z-0002', 'activity', 30, 'estimated', { minutes: 20, basis: 'estimated' }),
    ]);
    expect(summary.totals).toEqual({ measuredMinutes: 45, estimatedMinutes: 30 });
    expect(summary.delays).toEqual([{ noteId: 'N20261014T081000Z-0002', minutes: 20, basis: 'estimated' }]);
    expect(summary.delayTotals).toEqual({ measuredMinutes: 0, estimatedMinutes: 20 });
    expect(summary).not.toHaveProperty('total');
    expect(summary.entries.map((entry) => [entry.noteId, entry.minutes, entry.basis, entry.counted])).toEqual([
      ['N20261014T080000Z-0001', 45, 'measured', true],
      ['N20261014T081000Z-0002', 30, 'estimated', true],
    ]);
  });

  it('führt eine Zeile pro Notiz mit Zeit, zählt Notizen ohne Zeit und hält Planungszeiten aus den Summen', () => {
    const summary = buildTimeSummary(fixedNotes(), new Set([NOTE.decision]));
    expect(summary.entries.map((entry) => entry.noteId)).toEqual([NOTE.plan, NOTE.activity, NOTE.decision]);
    expect(summary.entries.find((entry) => entry.noteId === NOTE.plan)).toMatchObject({ counted: false, minutes: 60 });
    expect(summary.entries.find((entry) => entry.noteId === NOTE.activity)).toMatchObject({ start: '09:10', end: '09:55', withheld: false });
    expect(summary.entries.find((entry) => entry.noteId === NOTE.decision)).toMatchObject({ withheld: true, counted: true });
    expect(summary.totals).toEqual({ measuredMinutes: 45, estimatedMinutes: 30 });
    expect(summary.planned).toEqual({ measuredMinutes: 0, estimatedMinutes: 60 });
    expect(summary.notesWithoutTime).toEqual([NOTE.problem, NOTE.insight, NOTE.general]);
    expect(summary.delays).toEqual([{ noteId: NOTE.problem, minutes: 20, basis: 'estimated' }]);
  });

  it('liefert ohne Notizen leere Listen und Nullsummen', () => {
    const summary = buildTimeSummary([]);
    expect(summary).toEqual({
      entries: [],
      totals: { measuredMinutes: 0, estimatedMinutes: 0 },
      planned: { measuredMinutes: 0, estimatedMinutes: 0 },
      delays: [],
      delayTotals: { measuredMinutes: 0, estimatedMinutes: 0 },
      notesWithoutTime: [],
    });
  });

  it('entspricht dem Teilschema der Journal-Eingabe', () => {
    const summary = buildTimeSummary(fixedNotes());
    const input = { timeSummary: summary };
    // Checked through the full record schema, which contains the same definition.
    const result = validate('journal-record', {
      schemaVersion: 1,
      day: '2026-10-14',
      runId: 'R20261014T160500Z-a3f9',
      generatedAt: '2026-10-14T18:05:00+02:00',
      mode: 'no_ai',
      journal: null,
      ...input,
      openItems: { analyses: [], gaps: [] },
      sources: [],
      provenance: { deterministic: true, reason: 'requested' },
    });
    expect(result).toEqual({ ok: true });
  });
});
