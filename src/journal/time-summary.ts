/**
 * Time overview of a journal day (spec.md §15): only from notes (I-07), measured and estimated apart,
 * delays shown separately and never added.
 */
import type { Note } from '../notes/types.js';
import type { MinuteSums, TimeSummary } from './types.js';

function add(sums: MinuteSums, basis: 'measured' | 'estimated', minutes: number): void {
  if (basis === 'measured') sums.measuredMinutes += minutes;
  else sums.estimatedMinutes += minutes;
}

/**
 * `notes` are the valid notes of the day in their order, including the ones withheld for a secret hit:
 * the check covers the texts, not the recorded time.
 */
export function buildTimeSummary(notes: readonly Note[], withheldIds: ReadonlySet<string> = new Set()): TimeSummary {
  const summary: TimeSummary = {
    entries: [],
    totals: { measuredMinutes: 0, estimatedMinutes: 0 },
    planned: { measuredMinutes: 0, estimatedMinutes: 0 },
    delays: [],
    delayTotals: { measuredMinutes: 0, estimatedMinutes: 0 },
    notesWithoutTime: [],
  };
  for (const note of notes) {
    if (note.time === null) {
      summary.notesWithoutTime.push(note.id);
    } else {
      const counted = note.type !== 'plan';
      summary.entries.push({
        noteId: note.id,
        noteType: note.type,
        minutes: note.time.minutes,
        basis: note.time.basis,
        start: note.time.start,
        end: note.time.end,
        counted,
        withheld: withheldIds.has(note.id),
      });
      add(counted ? summary.totals : summary.planned, note.time.basis, note.time.minutes);
    }
    if (note.delay !== null) {
      summary.delays.push({ noteId: note.id, minutes: note.delay.minutes, basis: note.delay.basis });
      add(summary.delayTotals, note.delay.basis, note.delay.minutes);
    }
  }
  return summary;
}
