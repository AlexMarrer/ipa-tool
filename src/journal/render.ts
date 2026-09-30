/**
 * Markdown draft `journal/drafts/<day>-<runId>.md` (package 07 §4). Statements end with their references
 * in brackets, empty sections read "nicht erfasst" (I-13). The sections are built once per draft; the
 * references they show become `sources` of the record, so every reference resolves there.
 */
import type { StatusChange } from '../collector/types.js';
import type { NoteType, TimeBasis } from '../notes/types.js';
import type { DerivedAnalysis, JournalAnalysis, JournalGapType, JournalInput, JournalOutput, JournalRecord, OpenAnalysisStatus } from './types.js';

export const AI_NOTICE = 'KI-generierter Entwurf – persönlich prüfen, korrigieren und manuell nach journal/final/ übernehmen.';
export const NO_AI_NOTICE = 'Automatisch erzeugter Entwurf ohne KI – persönlich prüfen, korrigieren und manuell nach journal/final/ übernehmen.';
export const NOT_RECORDED = 'nicht erfasst';
export const NO_EVIDENCE = 'keine Belege erfasst';
export const UNKNOWN_TEST_RESULT = 'Ergebnis unbekannt';
export const TESTED_STATE_UNPROVEN = 'getesteter Codezustand nicht nachgewiesen';
export const FROM_WORK_LOG = 'aus Work-Log übernommen';
export const DELAY_NOT_ADDED = 'nicht zusätzlich summiert';
export const TIME_UNKNOWN = 'Zeit unbekannt';

/** Fixed order of the sections (package 07 §4). */
export const SECTION_TITLES = [
  'Geplante Arbeiten',
  'Ausgeführte Arbeiten',
  'Probleme und Lösungen',
  'Entscheidungen',
  'Tests',
  'Abweichungen von der Planung',
  'Erkenntnisse',
  'Nächste Schritte',
  'Zeitaufwand',
  'Unklare Tageszuordnung',
  'Offene Analysen und Erfassungslücken',
  'Unbekannt/offen',
  'Quellen',
] as const;

const WITHOUT_AI = `${NOT_RECORDED} (ohne KI)`;

const TEST_RESULTS = { passed: 'bestanden', failed: 'fehlgeschlagen', unknown: UNKNOWN_TEST_RESULT } as const;

const BASIS: Record<TimeBasis, string> = { measured: 'gemessen', estimated: 'geschätzt' };

const NOTE_LABELS: Record<NoteType, string> = {
  general: 'Notiz (allgemein)',
  activity: 'Notiz (Tätigkeit)',
  problem: 'Notiz (Problem)',
  decision: 'Notiz (Entscheidung)',
  insight: 'Notiz (Erkenntnis)',
  plan: 'Notiz (Planung)',
};

const OPEN_STATUS: Record<OpenAnalysisStatus, string> = {
  pending: 'noch nicht analysiert',
  failed: 'Analyse fehlgeschlagen, der nächste ipa capture versucht es erneut',
  blocked: 'blockiert, das Eingabepaket ist zu gross',
  exhausted: 'Versuche erschöpft, weiter mit ipa capture --retry oder ipa skip',
  skipped: 'bewusst ausgelassen mit ipa skip',
};

const GAP_LABELS: Record<JournalGapType, string> = {
  rebaseline: 'Neuer Ausgangspunkt',
  previous_state_unavailable: 'Vorheriger Stand nicht verfügbar',
  halt_detected: 'Halt vor neuem Ausgangspunkt',
  halt: 'Zuordnung angehalten',
  run_failed: 'Lauf nicht erfolgreich',
  no_capture: 'Keine Aufnahme',
  invalid_notes: 'Beschädigte Notizzeile',
  withheld: 'Offene Prüfung',
};

function inline(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}

function cell(text: string): string {
  return inline(text).replace(/\|/g, '\\|');
}

function list(items: readonly string[], empty = NOT_RECORDED): string[] {
  return items.length === 0 ? [empty] : items.map((item) => `- ${item}`);
}

/** `Ursache: …; Lösung: …` without a period of the value before the separator. */
function details(parts: readonly [string, string | null][]): string {
  return parts.map(([label, value]) => `${label}: ${value === null ? NOT_RECORDED : inline(value).replace(/[.;]+$/, '')}`).join('; ');
}

/** Collects every reference shown in the draft, in order of first appearance. */
class Citations {
  readonly refs: string[] = [];
  private readonly seen = new Set<string>();

  cite(ids: readonly string[]): string {
    // A context reference of an analysis is dropped when the file changed since (spec.md §18).
    if (ids.length === 0) return '(ohne verfügbaren Beleg)';
    for (const id of ids) {
      if (!this.seen.has(id)) {
        this.seen.add(id);
        this.refs.push(id);
      }
    }
    return `[${ids.join(', ')}]`;
  }
}

function aiContent(journal: JournalOutput, c: Citations): { sections: string[][]; unknowns: string[] } {
  const statements = (items: readonly { text: string; evidence: string[] }[]) => list(items.map((item) => `${inline(item.text)} ${c.cite(item.evidence)}`));
  return {
    sections: [
      statements(journal.planned),
      statements(journal.done),
      list(
        journal.problems.map(
          (item) =>
            `**${inline(item.problem)}** (${details([
              ['Ursache', item.cause],
              ['Lösung', item.solution],
            ])}) ${c.cite(item.evidence)}`,
        ),
      ),
      list(
        journal.decisions.map((item) => {
          const alternatives = item.alternatives.length === 0 ? null : item.alternatives.map(inline).join(', ');
          return `**${inline(item.decision)}** (${details([
            ['Begründung', item.rationale],
            ['Alternativen', alternatives],
          ])}) ${c.cite(item.evidence)}`;
        }),
      ),
      list(journal.tests.map((item) => `${inline(item.description)} – ${TEST_RESULTS[item.result]}; ${TESTED_STATE_UNPROVEN} ${c.cite(item.evidence)}`)),
      statements(journal.deviations),
      statements(journal.insights),
      statements(journal.nextSteps),
    ],
    unknowns: list(journal.unknowns.map(inline)),
  };
}

function fromLog(snapshotId: string): string {
  return `${FROM_WORK_LOG} (${snapshotId})`;
}

/** Without Claude: notes grouped by type and the statements of the analyses of the day (package 07 §4). */
function noAiContent(input: JournalInput, c: Citations): { sections: string[][]; unknowns: string[] } {
  const notesOf = (...types: NoteType[]) => input.notes.filter((note) => types.includes(note.type));
  const noteLine = (text: string, note: { id: string; type: NoteType }) => `${text} – ${NOTE_LABELS[note.type]} ${c.cite([note.id])}`;
  const derived = input.analyses.filter((entry): entry is JournalAnalysis & { derived: DerivedAnalysis } => entry.dayAttribution === 'day' && entry.derived !== null);

  // Built in the order of the sections, so the references keep the order in which they appear.
  const planned = notesOf('plan').map((note) => noteLine(inline(note.text), note));
  const done = [
    ...notesOf('activity', 'general').map((note) => noteLine(inline(note.text), note)),
    ...derived.flatMap(({ snapshotId, derived: analysis }) => [
      `Zusammenfassung: ${inline(analysis.summary.text)} – ${fromLog(snapshotId)} ${c.cite(analysis.summary.evidence)}`,
      ...analysis.implemented.map((item) => `**${inline(item.title)}**: ${inline(item.description)} – ${fromLog(snapshotId)} ${c.cite(item.evidence)}`),
    ]),
  ];
  const problems = [
    ...notesOf('problem').map((note) =>
      noteLine(
        `**${inline(note.text)}** (${details([
          ['Ursache', note.cause],
          ['Lösung', note.solution],
        ])})`,
        note,
      ),
    ),
    ...derived.flatMap(({ snapshotId, derived: analysis }) =>
      analysis.problems.map(
        (item) =>
          `**${inline(item.title)}**: ${inline(item.description)} (${details([
            ['Ursache', item.cause],
            ['Lösung', item.solution],
          ])}) – ${fromLog(snapshotId)} ${c.cite(item.evidence)}`,
      ),
    ),
  ];
  const decisions = [
    ...notesOf('decision').map((note) =>
      noteLine(
        `**${inline(note.text)}** (${details([
          ['Begründung', note.reason],
          ['Alternativen', note.alternatives.length === 0 ? null : note.alternatives.map(inline).join(', ')],
        ])})`,
        note,
      ),
    ),
    ...derived.flatMap(({ snapshotId, derived: analysis }) =>
      analysis.decisions.map(
        (item) =>
          `**${inline(item.title)}**: ${inline(item.description)} (${details([
            ['Begründung', item.rationale],
            ['Alternativen', item.alternatives.length === 0 ? null : item.alternatives.map(inline).join(', ')],
          ])}) – ${fromLog(snapshotId)} ${c.cite(item.evidence)}`,
      ),
    ),
  ];
  const tests = derived.flatMap(({ snapshotId, derived: analysis }) =>
    analysis.tests.map((item) => `${inline(item.description)} – ${TEST_RESULTS[item.result]}; ${TESTED_STATE_UNPROVEN} – ${fromLog(snapshotId)} ${c.cite(item.evidence)}`),
  );
  const insights = notesOf('insight').map((note) => noteLine(inline(note.text), note));
  const unknowns = derived.flatMap(({ snapshotId, derived: analysis }) => [
    ...analysis.contradictions.map((item) => `Widerspruch: ${inline(item.description)} – ${fromLog(snapshotId)} ${c.cite(item.evidence)}`),
    ...analysis.unknowns.map((text) => `${inline(text)} – ${fromLog(snapshotId)}`),
  ]);
  return {
    sections: [
      list(planned),
      list(done),
      list(problems),
      list(decisions),
      list(tests),
      [WITHOUT_AI],
      list(insights),
      [WITHOUT_AI],
    ],
    unknowns: list(unknowns),
  };
}

function minutes(value: number): string {
  return `${value} Minuten`;
}

/** Deterministic, only from notes (spec.md §15, I-07). */
function timeSection(input: JournalInput, c: Citations): string[] {
  const { timeSummary: summary } = input;
  if (summary.entries.length === 0 && summary.delays.length === 0 && summary.notesWithoutTime.length === 0) return [NOT_RECORDED];
  const usable = new Map(input.notes.map((note) => [note.id, note]));
  // Withheld notes are named without brackets: they are no source of the draft.
  const noteRefs = (ids: readonly string[]) => {
    const cited = ids.filter((id) => usable.has(id));
    const withheld = ids.filter((id) => !usable.has(id)).map((id) => `${id} (zurückgehalten)`);
    return [...(cited.length === 0 ? [] : [c.cite(cited)]), ...withheld].join(', ');
  };
  const lines = ['Zeiten stammen nur aus Notizen; Aufnahmezeiträume und Commit-Zeitpunkte sind keine Arbeitszeit.', ''];
  if (summary.entries.length > 0) {
    lines.push('| Notiz | Typ | Minuten | Basis | Zeitraum | Text |', '| --- | --- | --- | --- | --- | --- |');
    for (const entry of summary.entries) {
      const span = entry.start !== null && entry.end !== null ? `${entry.start}–${entry.end}` : '–';
      const basis = entry.counted ? BASIS[entry.basis] : `${BASIS[entry.basis]}, Planung (nicht summiert)`;
      const text = usable.get(entry.noteId)?.text;
      lines.push(`| ${noteRefs([entry.noteId])} | ${entry.noteType} | ${entry.minutes} | ${basis} | ${span} | ${text === undefined ? 'zurückgehalten' : cell(text)} |`);
    }
    lines.push('');
  }
  lines.push(`- Summe gemessen: ${minutes(summary.totals.measuredMinutes)}`, `- Summe geschätzt: ${minutes(summary.totals.estimatedMinutes)}`);
  if (summary.planned.measuredMinutes + summary.planned.estimatedMinutes > 0) {
    lines.push(`- Geplant (Planungsnotizen, nicht summiert): ${minutes(summary.planned.measuredMinutes)} gemessen, ${minutes(summary.planned.estimatedMinutes)} geschätzt`);
  }
  if (summary.delays.length === 0) {
    lines.push(`- Verzögerungen: ${NOT_RECORDED}`);
  } else {
    for (const delay of summary.delays) {
      lines.push(`- Verzögerung (separat, ${DELAY_NOT_ADDED}): ${minutes(delay.minutes)} ${BASIS[delay.basis]} ${noteRefs([delay.noteId])}`);
    }
  }
  if (summary.notesWithoutTime.length > 0) {
    lines.push(`- ${TIME_UNKNOWN}: ${summary.notesWithoutTime.length} Notiz(en) ohne Zeitangabe ${noteRefs(summary.notesWithoutTime)}`);
  }
  return lines;
}

function analysisState(input: JournalInput, entry: JournalAnalysis): string {
  const open = input.openItems.analyses.find((item) => item.snapshotId === entry.snapshotId);
  if (open !== undefined) return `${open.status}, ${OPEN_STATUS[open.status]}`;
  return entry.derived === null ? 'ohne KI-Aussagen' : 'abgeschlossen';
}

function statusChangeLine(change: StatusChange): string {
  const commit = change.commit === null ? '' : ` (Commit \`${change.commit.slice(0, 12)}\`)`;
  return `Statusänderung \`${change.path}\`: ${change.from} → ${change.to}${commit}`;
}

/** Snapshots across several days, on each of them only here (spec.md §15, AK-07-05). */
function unclearSection(input: JournalInput, c: Citations): string[] {
  const unclear = input.analyses.filter((entry) => entry.dayAttribution === 'unclear');
  if (unclear.length === 0) return [NOT_RECORDED];
  const lines: string[] = [];
  for (const entry of unclear) {
    const { from, to } = entry.observedPeriod;
    lines.push(`- ${entry.snapshotId}: Beobachtungszeitraum ${from ?? 'Beginn der Erfassung'} bis ${to}; Analyse: ${analysisState(input, entry)}`);
    if (entry.derived !== null) {
      lines.push(`  - Zusammenfassung: ${inline(entry.derived.summary.text)} – ${FROM_WORK_LOG} ${c.cite(entry.derived.summary.evidence)}`);
      for (const item of entry.derived.implemented) {
        lines.push(`  - **${inline(item.title)}**: ${inline(item.description)} – ${FROM_WORK_LOG} ${c.cite(item.evidence)}`);
      }
    }
    for (const commit of input.commits.filter((candidate) => candidate.snapshotId === entry.snapshotId)) {
      const subject = commit.message === null ? '(Nachricht nicht verfügbar)' : inline(commit.message.split(/\r?\n/)[0] ?? '');
      const foreign = commit.authoredByConfiguredUser ? '' : ' (fremder Commit)';
      const ref = commit.messageRef === null ? '' : ` ${c.cite([commit.messageRef])}`;
      lines.push(`  - Commit \`${commit.sha.slice(0, 12)}\` ${subject}${foreign}${ref}`);
    }
    for (const change of entry.statusChanges) lines.push(`  - ${statusChangeLine(change)}`);
  }
  return lines;
}

function openSection(input: JournalInput): string[] {
  const lines = [
    ...input.openItems.analyses.map((item) => `Analyse ${item.snapshotId} (${item.status}): ${OPEN_STATUS[item.status]}`),
    ...input.openItems.gaps.map((gap) => `${GAP_LABELS[gap.type]}${gap.snapshotId === null ? '' : ` (${gap.snapshotId})`}: ${inline(gap.detail)}`),
  ];
  return list(lines);
}

export interface DraftBody {
  /** The sections before "Quellen", in the order of `SECTION_TITLES`. */
  sections: string[][];
  /** Every reference shown, in order of first appearance. */
  refs: string[];
}

/** Content of the draft; `journal` is `null` without Claude. */
export function draftBody(input: JournalInput, journal: JournalOutput | null): DraftBody {
  const c = new Citations();
  const content = journal === null ? noAiContent(input, c) : aiContent(journal, c);
  const sections = [...content.sections, timeSection(input, c), unclearSection(input, c), openSection(input), content.unknowns];
  return { sections, refs: c.refs };
}

function sourcesSection(record: JournalRecord): string[] {
  if (record.sources.length === 0) return [record.mode === 'no_ai' && record.provenance.reason === 'no_data' ? NO_EVIDENCE : NOT_RECORDED];
  const rows = ['| Referenz | Art | Pfad | Snapshot | SHA-256 |', '| --- | --- | --- | --- | --- |'];
  for (const source of record.sources) {
    rows.push(
      `| ${source.ref} | ${source.kind} | ${source.path === null ? '–' : cell(source.path)} | ${source.snapshotId ?? '–'} | ${source.sha256 ?? '–'} |`,
    );
  }
  return rows;
}

function header(input: JournalInput, record: JournalRecord): string[] {
  const byAttribution = (attribution: 'day' | 'unclear') =>
    input.analyses.filter((entry) => entry.dayAttribution === attribution).map((entry) => entry.snapshotId);
  const dayIds = byAttribution('day');
  const unclearIds = byAttribution('unclear');
  const snapshots =
    dayIds.length + unclearIds.length === 0
      ? 'keine'
      : [...(dayIds.length > 0 ? [`${dayIds.join(', ')} (am Tag)`] : []), ...(unclearIds.length > 0 ? [`${unclearIds.join(', ')} (unklare Tageszuordnung)`] : [])].join('; ');
  const lines = [`- Tag: ${record.day} (Zeitzone ${input.timezone})`, `- Erstellt: ${record.generatedAt}`, `- Lauf: ${record.runId}`];
  if (record.mode === 'ai') {
    lines.push(
      '- Modus: KI-Entwurf (Claude)',
      `- Modelle: ${record.provenance.models.join(', ') || 'unbekannt'}`,
      `- Prompt-Version: ${record.provenance.promptVersion}`,
    );
  } else {
    const reason = record.provenance.reason === 'requested' ? 'ohne KI (--no-ai)' : 'ohne KI (keine Snapshots und keine verwendbaren Notizen)';
    lines.push(`- Modus: ${reason}`, '- Modelle: keine (ohne KI)', '- Prompt-Version: keine (ohne KI)');
  }
  lines.push(`- Snapshots: ${snapshots}`, `- Notizen des Tages: ${input.notes.length}`);
  if (record.mode === 'no_ai' && record.provenance.reason === 'no_data') {
    lines.push(`- ${NO_EVIDENCE[0]!.toUpperCase()}${NO_EVIDENCE.slice(1)}: Zu diesem Tag gibt es weder Snapshots noch verwendbare Notizen.`);
  }
  return lines;
}

/** The draft of a record; `input` supplies the notes, analyses and open items that the sections show. */
export function renderJournal(input: JournalInput, record: JournalRecord): string {
  const body = draftBody(input, record.journal);
  const lines = [`# Journal-Entwurf ${record.day}`, '', `> ${record.mode === 'ai' ? AI_NOTICE : NO_AI_NOTICE}`, '', ...header(input, record)];
  const bodies = [...body.sections, sourcesSection(record)];
  SECTION_TITLES.forEach((title, index) => {
    lines.push('', `## ${title}`, '', ...(bodies[index] ?? []));
  });
  return `${lines.join('\n')}\n`;
}
