/**
 * IDs gemäss spec.md §8.2.
 */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Clock } from './clock.js';
import { formatUtcCompact } from './time.js';

/** Regex-Muster aus spec.md §8.2, ergänzt um `repositoryId`. */
export const ID_PATTERNS = {
  repositoryId: /^[a-z0-9-]{1,32}-[0-9a-f]{6}$/,
  snapshotId: /^S[0-9]{6}$/,
  evidenceId: /^E[0-9]{3,}$/,
  qualifiedEvidence: /^S[0-9]{6}:E[0-9]{3,}$/,
  runOrNoteId: /^[RN][0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}$/,
  runId: /^R[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}$/,
  noteId: /^N[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}$/,
  contextId: /^C[0-9]{2,}$/,
} as const;

const MAX_SLUG_LENGTH = 32;
const MAX_SNAPSHOT_SEQ = 999_999;

export function randomHex(chars: number): string {
  return randomBytes(Math.ceil(chars / 2))
    .toString('hex')
    .slice(0, chars);
}

/**
 * Slug eines Ordnernamens: `[a-z0-9-]`, höchstens 32 Zeichen, ohne Rand-Bindestriche.
 * Deutsche Umlaute werden umschrieben, andere diakritische Zeichen entfernt.
 */
export function slugify(name: string): string {
  const transliterated = name
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/[ßẞ]/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const slug = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'repo';
}

/** `repositoryId`: Slug des Repository-Ordners, `-` und 6 Hex-Zeichen. */
export function createRepositoryId(repoRoot: string): string {
  const portable = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  // Eine Laufwerkswurzel wie `C:/` hat keinen Ordnernamen.
  const folder = /^[A-Za-z]:$/.test(portable) ? '' : path.posix.basename(portable);
  return `${slugify(folder)}-${randomHex(6)}`;
}

/** `runId`: `R`, UTC-Zeit und 4 Hex-Zeichen. */
export function createRunId(clock: Clock): string {
  return `R${formatUtcCompact(clock.now())}-${randomHex(4)}`;
}

/** `noteId`: `N`, UTC-Zeit und 4 Hex-Zeichen. */
export function createNoteId(clock: Clock): string {
  return `N${formatUtcCompact(clock.now())}-${randomHex(4)}`;
}

/** `snapshotId` aus der fortlaufenden Nummer, zum Beispiel `S000002`. */
export function formatSnapshotId(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_SNAPSHOT_SEQ) {
    throw new RangeError(`Ungültige Snapshot-Nummer: ${seq}`);
  }
  return `S${String(seq).padStart(6, '0')}`;
}

/** Nummer einer `snapshotId`. */
export function parseSnapshotSeq(snapshotId: string): number {
  if (!ID_PATTERNS.snapshotId.test(snapshotId)) {
    throw new RangeError(`Ungültige Snapshot-ID: ${snapshotId}`);
  }
  return Number(snapshotId.slice(1));
}
