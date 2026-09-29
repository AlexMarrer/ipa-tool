/**
 * Secret check of notes (D-23, spec.md §12.2): notes are stored unchecked and scanned whenever an input
 * package is built, when `ipa note` warns and when `ipa status` counts open reviews.
 */
import type { SecretDetector } from '../core/config.js';
import type { SecretScanner } from '../filter/secret-scanner.js';
import type { Note } from '../notes/types.js';

export type NoteTextField = 'text' | 'reason' | 'alternatives' | 'cause' | 'solution';

export interface NoteSecretHit {
  field: NoteTextField;
  detector: SecretDetector;
}

/** Text, reason, alternatives, cause and solution; each field and detector once, never the value. */
export function noteSecretHits(scanner: SecretScanner, note: Pick<Note, NoteTextField>): NoteSecretHit[] {
  const fields: [NoteTextField, string | null][] = [
    ['text', note.text],
    ['reason', note.reason],
    ...note.alternatives.map((alternative): [NoteTextField, string] => ['alternatives', alternative]),
    ['cause', note.cause],
    ['solution', note.solution],
  ];
  const hits: NoteSecretHit[] = [];
  for (const [field, value] of fields) {
    if (value === null) continue;
    for (const { detector } of scanner.scan(value)) {
      if (!hits.some((hit) => hit.field === field && hit.detector === detector)) hits.push({ field, detector });
    }
  }
  return hits;
}
