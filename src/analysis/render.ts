/**
 * Markdown work log `logs/<snapshotId>.md` (package 06 §4). Every statement ends with its evidence IDs,
 * empty lists read "nicht erfasst" (I-13).
 */
import type { Manifest, StatusChange } from '../collector/types.js';
import type { AnalysisOutput, AnalysisRecord } from './types.js';

export const AI_NOTICE = 'Automatisch erzeugter KI-Entwurf – vor Verwendung persönlich prüfen.';
export const DETERMINISTIC_NOTICE = 'Automatisch erzeugter Entwurf ohne KI – vor Verwendung persönlich prüfen.';
export const BASELINE_HEADING = 'Ausgangslage – keine neu erbrachte Leistung';
export const NOT_RECORDED = 'nicht erfasst';
export const UNKNOWN_TEST_RESULT = 'Ergebnis unbekannt – kein passender Testbericht';

/** Fixed order of the sections. */
export const SECTION_TITLES = [
  'Zusammenfassung',
  'Umgesetzt',
  'Entscheidungen',
  'Probleme',
  'Tests',
  'Widersprüche',
  'Statusänderungen',
  'Unbekannt/offen',
  'Erfassungshinweise',
  'Belege',
] as const;

export interface WorkLogTexts {
  /** Checked commit messages by evidence ID (spec.md §14.4); only these are shown. */
  commitMessages?: Readonly<Record<string, string>>;
}

const WITHOUT_AI = `${NOT_RECORDED} (ohne KI-Analyse)`;

const TEST_RESULTS = { passed: 'bestanden', failed: 'fehlgeschlagen', unknown: UNKNOWN_TEST_RESULT } as const;

const ATTRIBUTIONS: Record<StatusChange['attribution'], string> = {
  documented: 'bereits dokumentiert',
  baseline: 'aus der Ausgangslage',
  unclear: 'Zuordnung unklar',
};

const DECISIONS = { excluded: 'Ausgeschlossen', withheld: 'Zurückgehalten', omitted: 'Ausgelassen' } as const;

function inline(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}

function refs(ids: readonly string[]): string {
  return `[${ids.join(', ')}]`;
}

function cell(text: string): string {
  return inline(text).replace(/\|/g, '\\|');
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

function list(items: readonly string[]): string[] {
  return items.length === 0 ? [NOT_RECORDED] : items.map((item) => `- ${item}`);
}

/** `Begründung: …; Alternativen: …` without a period of the value before the separator. */
function details(parts: readonly [string, string | null][]): string {
  return parts.map(([label, value]) => `${label}: ${value === null ? NOT_RECORDED : inline(value).replace(/[.;]+$/, '')}`).join('; ');
}

function commitLines(manifest: Manifest, texts: WorkLogTexts): string[] {
  if (manifest.commits.length === 0) return [`- Commits: ${NOT_RECORDED}`];
  const lines = ['- Commits:'];
  for (const commit of manifest.commits) {
    const evidence = manifest.evidence.find((entry) => entry.id === commit.messageEvidence);
    const text = commit.messageEvidence === null ? null : texts.commitMessages?.[commit.messageEvidence];
    let subject: string;
    if (evidence === undefined) subject = '(ohne Nachricht)';
    else if (evidence.omitted !== null) subject = `(Nachricht ausgelassen: ${evidence.omitted.reason})`;
    else subject = text === undefined || text === null ? '(Nachricht nicht verfügbar)' : inline(text.split(/\r?\n/)[0] ?? '');
    const flags = [...(commit.isMerge ? ['Merge'] : []), ...(commit.authoredByConfiguredUser ? [] : ['fremder Commit'])];
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    const evidenceRef = commit.messageEvidence === null ? '' : ` ${refs([commit.messageEvidence])}`;
    lines.push(`  - \`${short(commit.sha)}\` ${subject}${suffix}${evidenceRef}`);
  }
  return lines;
}

function header(record: AnalysisRecord, manifest: Manifest, texts: WorkLogTexts): string[] {
  const { observedPeriod, repository } = record;
  const created =
    record.analysis === null
      ? `ohne KI, keine Analyse nötig (D-08), am ${record.provenance.generatedAt}`
      : `Claude, Versuch ${record.provenance.attempt}, ${record.provenance.promptVersion}, ` +
        `Modelle: ${record.provenance.models.join(', ') || 'unbekannt'}, am ${record.provenance.analysedAt}`;
  return [
    `- Snapshot: ${record.snapshotId} (${manifest.kind === 'baseline' ? 'Ausgangs-Snapshot' : 'Arbeits-Snapshot'})`,
    `- Vorgänger: ${record.previousSnapshotId ?? 'keiner'}`,
    `- Beobachtungszeitraum: ${observedPeriod.from ?? 'Beginn der Erfassung'} bis ${observedPeriod.to}`,
    `- Branch: ${repository.branch ?? '(detached HEAD)'}`,
    `- HEAD: ${repository.head ?? '(kein Commit)'}`,
    `- Erzeugt: ${created}`,
    ...commitLines(manifest, texts),
  ];
}

function deterministicSummary(manifest: Manifest): string {
  if (manifest.kind === 'baseline') {
    return (
      `Der Ausgangs-Snapshot hält den vorhandenen Stand als Vergleichsbasis fest ` +
      `(${manifest.fileStates.length} Dateizustände abweichend von HEAD). Er ist keine neu erbrachte Leistung.`
    );
  }
  return (
    'Keine KI-Analyse nötig (D-08): Der Snapshot enthält weder neue Zustandsdeltas noch neue Testberichte. ' +
    'Bereits dokumentierte Stände erscheinen nur als Statusänderungen.'
  );
}

function aiSections(analysis: AnalysisOutput): string[][] {
  return [
    [`${inline(analysis.summary.text)} ${refs(analysis.summary.evidence)}`],
    list(analysis.implemented.map((item) => `**${inline(item.title)}**: ${inline(item.description)} ${refs(item.evidence)}`)),
    list(
      analysis.decisions.map((item) => {
        const alternatives = item.alternatives.length === 0 ? null : item.alternatives.map(inline).join(', ');
        const facts = details([
          ['Begründung', item.rationale],
          ['Alternativen', alternatives],
        ]);
        return `**${inline(item.title)}**: ${inline(item.description)} (${facts}) ${refs(item.evidence)}`;
      }),
    ),
    list(
      analysis.problems.map((item) => {
        const facts = details([
          ['Ursache', item.cause],
          ['Lösung', item.solution],
        ]);
        return `**${inline(item.title)}**: ${inline(item.description)} (${facts}) ${refs(item.evidence)}`;
      }),
    ),
    list(analysis.tests.map((item) => `${inline(item.description)} – ${TEST_RESULTS[item.result]} ${refs(item.evidence)}`)),
    list(analysis.contradictions.map((item) => `${inline(item.description)} ${refs(item.evidence)}`)),
  ];
}

function statusChangeLines(changes: readonly StatusChange[]): string[] {
  return list(
    changes.map((change) => {
      const commit = change.commit === null ? '' : ` (Commit \`${short(change.commit)}\`)`;
      const previous = change.previousEvidence.length === 0 ? '' : ` ${refs(change.previousEvidence)}`;
      return `\`${change.path}\`: ${change.from} → ${change.to}${commit}, ${ATTRIBUTIONS[change.attribution]}${previous}`;
    }),
  );
}

function captureNotes(manifest: Manifest): string[] {
  const lines: string[] = [];
  for (const decision of ['excluded', 'withheld', 'omitted'] as const) {
    const entries = manifest.filterDecisions.filter((entry) => entry.decision === decision);
    const reasons = new Map<string, number>();
    for (const entry of entries) reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
    const byReason = [...reasons].map(([reason, count]) => `${reason}: ${count}`).join(', ');
    lines.push(`- ${DECISIONS[decision]}: ${entries.length}${byReason === '' ? '' : ` (${byReason})`}`);
  }
  if (manifest.filterDecisions.some((entry) => entry.decision === 'withheld')) {
    lines.push(
      `- Offene Prüfung: Zurückgehaltene Inhalte stehen mit Pfad, Detektor und Zeile, ohne Wert, in filterDecisions von snapshots/${manifest.snapshotId}/manifest.json.`,
    );
  }
  if (manifest.gaps.length === 0) lines.push(`- Lücken: ${NOT_RECORDED}`);
  for (const gap of manifest.gaps) lines.push(`- Lücke ${gap.type}: ${inline(gap.detail)}`);
  return lines;
}

function evidenceTable(record: AnalysisRecord, manifest: Manifest): string[] {
  if (record.evidenceIndex.length === 0) return [NOT_RECORDED];
  const rows = ['| ID | Art | Pfad | Datei |', '| --- | --- | --- | --- |'];
  for (const entry of record.evidenceIndex) {
    const omitted = manifest.evidence.find((candidate) => candidate.id === entry.id)?.omitted ?? null;
    const file = entry.snapshotFile ?? (omitted === null ? '–' : `ausgelassen (${omitted.reason})`);
    rows.push(`| ${entry.id} | ${entry.kind} | ${entry.path === null ? '–' : cell(entry.path)} | ${cell(file)} |`);
  }
  return rows;
}

/** spec.md §10. `texts` supplies the checked commit messages for the commit list. */
export function renderWorkLog(record: AnalysisRecord, manifest: Manifest, texts: WorkLogTexts = {}): string {
  const title = manifest.kind === 'baseline' ? `Work-Log ${record.snapshotId}: ${BASELINE_HEADING}` : `Work-Log ${record.snapshotId}`;
  const notice = record.analysis === null ? DETERMINISTIC_NOTICE : AI_NOTICE;
  const analysisParts = record.analysis === null ? [[deterministicSummary(manifest)], ...Array.from({ length: 5 }, () => [WITHOUT_AI])] : aiSections(record.analysis);
  const unknowns = record.analysis === null ? [WITHOUT_AI] : list(record.analysis.unknowns.map(inline));
  const bodies = [...analysisParts, statusChangeLines(record.statusChanges), unknowns, captureNotes(manifest), evidenceTable(record, manifest)];

  const lines = [`# ${title}`, '', `> ${notice}`, '', ...header(record, manifest, texts)];
  SECTION_TITLES.forEach((section, index) => {
    lines.push('', `## ${section}`, '', ...(bodies[index] ?? []));
  });
  return `${lines.join('\n')}\n`;
}
