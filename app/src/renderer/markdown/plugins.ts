/**
 * Pure rules of the Markdown view (app spec §11): labels per section name, references as chips and the plain-text
 * kinds of evidence. The renderer never guesses: unknown headings get no label, unknown references stay text.
 */
import type { ContentLabelKind } from '../../shared/messages';

export type DocKind = 'workLogAi' | 'workLogNoAi' | 'workLogNone' | 'journalAi' | 'journalNoAi' | 'plain';

const WORK_LOG_FACTS = new Set(['Statusänderungen', 'Erfassungshinweise', 'Belege']);
const WORK_LOG_CONTENT = new Set(['Zusammenfassung', 'Umgesetzt', 'Entscheidungen', 'Probleme', 'Tests', 'Widersprüche', 'Unbekannt/offen']);
const JOURNAL_FACTS = new Set(['Zeitaufwand', 'Unklare Tageszuordnung', 'Offene Analysen und Erfassungslücken', 'Quellen']);
const JOURNAL_CONTENT = new Set([
  'Geplante Arbeiten',
  'Ausgeführte Arbeiten',
  'Probleme und Lösungen',
  'Entscheidungen',
  'Tests',
  'Abweichungen von der Planung',
  'Erkenntnisse',
  'Nächste Schritte',
  'Unbekannt/offen',
]);

/** Label behind a level-2 heading, by its wording and the kind of document (spec §11.3). */
export function sectionLabel(doc: DocKind, title: string): ContentLabelKind | null {
  const text = title.trim();
  if (doc === 'workLogAi' || doc === 'workLogNoAi') {
    if (WORK_LOG_FACTS.has(text)) return 'tool';
    if (WORK_LOG_CONTENT.has(text)) return doc === 'workLogAi' ? 'ai' : 'noAi';
    return null;
  }
  if (doc === 'journalAi' || doc === 'journalNoAi') {
    if (JOURNAL_FACTS.has(text)) return 'tool';
    if (JOURNAL_CONTENT.has(text)) return doc === 'journalAi' ? 'ai' : 'noAi';
  }
  return null;
}

/** Label of a single list line, recognised by its wording (spec §11.3). */
export function rowLabel(text: string): ContentLabelKind | null {
  if (text.includes('aus Work-Log übernommen')) return 'aiWorkLog';
  if (/– Notiz \((allgemein|Tätigkeit|Problem|Entscheidung|Erkenntnis|Planung)\)/.test(text)) return 'note';
  return null;
}

/** Plain text for `kind` values of the evidence table (spec §5.8, §11.2). */
export const EVIDENCE_KIND_TEXT: Record<string, string> = {
  commit_message: 'Commit',
  commit_diff: 'Commit-Diff',
  staged_diff: 'Staged-Diff',
  unstaged_diff: 'Unstaged-Diff',
  state_delta: 'Datei-Zustand',
  test_report: 'Testbericht',
  note: 'Notiz',
  context: 'Kontext',
};

export type RefKind = 'note' | 'evidence' | 'context';

export interface RefInfo {
  kind: RefKind;
  /** As shown in the chip, for example `S000002:E003`. */
  id: string;
  /** Snapshot of an evidence reference. */
  snapshotId: string | null;
}

export interface RefContext {
  /** Snapshot of a work log: a bare `E001` then means `S000002:E001` (spec §11.4). */
  snapshotId: string | null;
}

const NOTE_REF = /^N\d{8}T\d{6}Z-[0-9a-f]{4}$/;
const EVIDENCE_REF = /^S(\d{6}):E\d{3,}$/;
const LOCAL_EVIDENCE_REF = /^E\d{3,}$/;
const CONTEXT_REF = /^C\d{2,}$/;

export function parseRef(token: string, context: RefContext): RefInfo | null {
  const text = token.trim();
  if (NOTE_REF.test(text)) return { kind: 'note', id: text, snapshotId: null };
  const evidence = EVIDENCE_REF.exec(text);
  if (evidence !== null) return { kind: 'evidence', id: text, snapshotId: `S${evidence[1]}` };
  if (CONTEXT_REF.test(text)) return { kind: 'context', id: text, snapshotId: null };
  if (context.snapshotId !== null && LOCAL_EVIDENCE_REF.test(text)) {
    return { kind: 'evidence', id: `${context.snapshotId}:${text}`, snapshotId: context.snapshotId };
  }
  return null;
}

export type TextPart = string | RefInfo;

/**
 * Splits a text at bracketed references: `[N2026…-0003]`, `[S000002:E003]`, `[E001, E002]`. A bracket whose parts are
 * not all references stays text. Brackets disappear in the chip, the commas stay as separators.
 */
export function splitReferences(text: string, context: RefContext): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[([^\][]+)\]/g)) {
    const refs = (match[1] ?? '').split(',').map((token) => parseRef(token, context));
    if (refs.length === 0 || refs.some((ref) => ref === null)) continue;
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    refs.forEach((ref, index) => {
      if (index > 0) parts.push(', ');
      parts.push(ref as RefInfo);
    });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** A cell that is exactly one reference becomes a chip (columns "Notiz", "Referenz", "ID"). */
export function cellReference(text: string, context: RefContext): RefInfo | null {
  return parseRef(text, context);
}

export const SHA256 = /^[0-9a-f]{64}$/;

/** `9e859f…b561` for a 64-character hash (spec §11.2). */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

/** Anchor id of a section heading, for the outline of a journal. */
export function slug(title: string): string {
  return `abschnitt-${title.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '')}`;
}

export function isHttpUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url.trim());
}
