import { describe, expect, it } from 'vitest';
import { validate } from '../../src/core/schemas.js';
import {
  AI_NOTICE,
  DELAY_NOT_ADDED,
  draftBody,
  FROM_WORK_LOG,
  NO_AI_NOTICE,
  NO_EVIDENCE,
  NOT_RECORDED,
  renderJournal,
  SECTION_TITLES,
  TESTED_STATE_UNPROVEN,
  UNKNOWN_TEST_RESULT,
} from '../../src/journal/render.js';
import { buildTimeSummary } from '../../src/journal/time-summary.js';
import type { JournalInput, JournalOutput, JournalRecord } from '../../src/journal/types.js';
import { AI_CONTENT, fixedJournalInput, fixedRecord, NO_AI_CONTENT, NOTE } from './fixtures.js';
import { bracketRefs, headings, section } from './markdown.js';

function draft(record: JournalRecord, input: JournalInput = fixedJournalInput()): string {
  expect(validate('journal-record', record)).toEqual({ ok: true });
  return renderJournal(input, record);
}

const EMPTY_OUTPUT: JournalOutput = {
  planned: [],
  done: [],
  problems: [],
  decisions: [],
  tests: [],
  deviations: [],
  insights: [],
  nextSteps: [],
  unknowns: [],
};

describe('Markdown-Entwurf des Journals (package 07 §4)', () => {
  it('entspricht dem festen Beispiel mit KI (Snapshot-Test)', async () => {
    await expect(draft(fixedRecord(AI_CONTENT()))).toMatchFileSnapshot('./__snapshots__/journal-ai.md');
  });

  it('entspricht dem festen Beispiel ohne KI (Snapshot-Test)', async () => {
    await expect(draft(fixedRecord(NO_AI_CONTENT))).toMatchFileSnapshot('./__snapshots__/journal-no-ai.md');
  });

  it('beginnt mit dem Hinweis, nennt Tag, Lauf, Modus, Modelle und Prompt-Version und hat alle Abschnitte in fester Reihenfolge (AK-07-01)', () => {
    const markdown = draft(fixedRecord(AI_CONTENT()));
    expect(markdown.split('\n').slice(0, 3)).toEqual(['# Journal-Entwurf 2026-10-14', '', `> ${AI_NOTICE}`]);
    for (const line of [
      '- Tag: 2026-10-14 (Zeitzone Europe/Zurich)',
      '- Erstellt: 2026-10-14T18:05:00+02:00',
      '- Lauf: R20261014T160500Z-a3f9',
      '- Modus: KI-Entwurf (Claude)',
      '- Modelle: claude-fake-model',
      '- Prompt-Version: journal@1',
    ]) {
      expect(markdown).toContain(`${line}\n`);
    }
    expect(headings(markdown)).toEqual([...SECTION_TITLES]);
    const noAi = draft(fixedRecord(NO_AI_CONTENT));
    expect(noAi.split('\n')[2]).toBe(`> ${NO_AI_NOTICE}`);
    expect(headings(noAi)).toEqual([...SECTION_TITLES]);
  });

  it('löst jede Referenz in sources auf und listet nur angezeigte Referenzen (AK-07-01)', () => {
    for (const content of [AI_CONTENT(), NO_AI_CONTENT]) {
      const record = fixedRecord(content);
      const markdown = draft(record);
      const shown = [...new Set(bracketRefs(markdown))];
      expect(record.sources.map((source) => source.ref).sort()).toEqual([...shown].sort());
      for (const source of record.sources) expect(section(markdown, 'Quellen')).toContain(`| ${source.ref} | ${source.kind} |`);
    }
  });

  it('zeigt Tests mit Ergebnis und dem Zusatz zum getesteten Codezustand, ohne Bericht als „Ergebnis unbekannt“ (AK-07-09)', () => {
    const tests = section(draft(fixedRecord(AI_CONTENT())), 'Tests');
    expect(tests).toBe(
      [
        `- Unit-Tests – bestanden; ${TESTED_STATE_UNPROVEN} [S000002:E006]`,
        `- Geänderte Testdatei test/wort.test.ts – ${UNKNOWN_TEST_RESULT}; ${TESTED_STATE_UNPROVEN} [S000003:E002]`,
      ].join('\n'),
    );
  });

  it('zeigt leere Abschnitte als „nicht erfasst“ (I-13, AK-07-09)', () => {
    const input = { ...fixedJournalInput(), analyses: [], notes: [], timeSummary: buildTimeSummary([]), openItems: { analyses: [], gaps: [] } };
    const markdown = draft(fixedRecord(AI_CONTENT(EMPTY_OUTPUT), input), input);
    for (const title of SECTION_TITLES.slice(0, 12)) expect(section(markdown, title), title).toBe(NOT_RECORDED);
    expect(section(markdown, 'Quellen')).toBe(NOT_RECORDED);
  });

  it('weist Zeiten nur aus Notizen aus, gemessen und geschätzt getrennt, Verzögerungen separat (AK-07-02)', () => {
    const time = section(draft(fixedRecord(AI_CONTENT())), 'Zeitaufwand');
    expect(time).toContain(`| [${NOTE.activity}] | activity | 45 | gemessen | 09:10–09:55 | Recherche zur Testkonfiguration |`);
    expect(time).toContain(`| [${NOTE.plan}] | plan | 60 | geschätzt, Planung (nicht summiert) | – |`);
    expect(time).toContain('- Summe gemessen: 45 Minuten\n- Summe geschätzt: 30 Minuten');
    expect(time).toContain(`- Verzögerung (separat, ${DELAY_NOT_ADDED}): 20 Minuten geschätzt [${NOTE.problem}]`);
    expect(time).toContain(`- Zeit unbekannt: 3 Notiz(en) ohne Zeitangabe [${NOTE.problem}, ${NOTE.insight}, ${NOTE.general}]`);
    expect(time).not.toMatch(/Gesamt|95 Minuten|65 Minuten/);
  });

  it('nennt zurückgehaltene Notizen in der Zeitübersicht ohne Text und ohne Referenz', () => {
    const input = fixedJournalInput();
    const withheld = input.notes.find((note) => note.id === NOTE.activity)!;
    input.notes = input.notes.filter((note) => note !== withheld);
    input.timeSummary = buildTimeSummary([...input.notes, withheld], new Set([withheld.id]));
    input.allowedEvidenceIds = input.allowedEvidenceIds.filter((id) => id !== withheld.id);
    const markdown = draft(fixedRecord(AI_CONTENT({ ...EMPTY_OUTPUT }), input), input);
    expect(section(markdown, 'Zeitaufwand')).toContain(`| ${NOTE.activity} (zurückgehalten) | activity | 45 | gemessen | 09:10–09:55 | zurückgehalten |`);
    expect(markdown).not.toContain('Recherche zur Testkonfiguration');
  });

  it('führt einen Snapshot mit unklarer Tageszuordnung nur in seinem Abschnitt auf (AK-07-05)', () => {
    for (const content of [AI_CONTENT(), NO_AI_CONTENT]) {
      const markdown = draft(fixedRecord(content));
      const unclear = section(markdown, 'Unklare Tageszuordnung');
      expect(unclear).toContain('- S000004: Beobachtungszeitraum 2026-10-14T16:00:00+02:00 bis 2026-10-15T09:00:00+02:00; Analyse: abgeschlossen');
      expect(unclear).toContain(`  - **CSV-Export**: Neue Exportfunktion. – ${FROM_WORK_LOG} [S000004:E002]`);
      expect(unclear).toContain(`  - Commit \`dddddddddddd\` Export ergänzt (fremder Commit) [S000004:E001]`);
      for (const title of SECTION_TITLES.filter((name) => name !== 'Unklare Tageszuordnung' && name !== 'Quellen')) {
        expect(section(markdown, title), title).not.toContain('S000004');
      }
    }
  });

  it('zeigt ohne KI Notizen nach Typ und übernommene Aussagen der Analysen des Tages mit Belegen (AK-07-07)', () => {
    const markdown = draft(fixedRecord(NO_AI_CONTENT));
    expect(section(markdown, 'Geplante Arbeiten')).toBe(`- Wortvalidierung in einen Service verschieben – Notiz (Planung) [${NOTE.plan}]`);
    const done = section(markdown, 'Ausgeführte Arbeiten');
    expect(done).toContain(`- Recherche zur Testkonfiguration – Notiz (Tätigkeit) [${NOTE.activity}]`);
    expect(done).toContain(`- Besprechung mit der Fachperson – Notiz (allgemein) [${NOTE.general}]`);
    expect(done).toContain(`- **Service für Wortvalidierung**: Neue Konstante im Service. – ${FROM_WORK_LOG} (S000002) [S000002:E003, S000002:E001]`);
    expect(section(markdown, 'Tests')).toContain(`- Unit-Tests – bestanden; ${TESTED_STATE_UNPROVEN} – ${FROM_WORK_LOG} (S000002) [S000002:E006]`);
    expect(section(markdown, 'Entscheidungen')).toContain(
      `- **Validierung im Service** (Begründung: Zwei Komponenten nutzen dieselbe Prüfung; Alternativen: Logik in der Komponente) – Notiz (Entscheidung) [${NOTE.decision}]`,
    );
    expect(section(markdown, 'Unbekannt/offen')).toContain(`- Widerspruch: Die Anforderung nennt eine andere Grenze als der Code. – ${FROM_WORK_LOG} (S000002) [C01, S000002:E003]`);
    expect(section(markdown, 'Abweichungen von der Planung')).toBe(`${NOT_RECORDED} (ohne KI)`);
    expect(markdown).toContain('- Modus: ohne KI (--no-ai)');
  });

  it('listet offene Analysen und Lücken im Abschnitt „Offene Analysen und Erfassungslücken“ (AK-07-06)', () => {
    const open = section(draft(fixedRecord(AI_CONTENT())), 'Offene Analysen und Erfassungslücken');
    expect(open).toBe(
      [
        '- Analyse S000003 (pending): noch nicht analysiert',
        '- Offene Prüfung (S000003): 1 Einheit(en) wegen Secret-Verdacht zurückgehalten, davon 1 Commit-Nachricht(en) bei der erneuten Prüfung.',
        '- Lauf nicht erfolgreich: capture R20261014T100000Z-0a0a um 12:00:00: unstable (Exit-Code 5).',
      ].join('\n'),
    );
  });

  it('kennzeichnet einen Tag ohne Belege und nennt „keine Belege erfasst“', () => {
    const input: JournalInput = {
      ...fixedJournalInput(),
      analyses: [],
      evidence: [],
      commits: [],
      notes: [],
      context: [],
      timeSummary: buildTimeSummary([]),
      openItems: { analyses: [], gaps: [{ snapshotId: null, type: 'no_capture', detail: 'Keine Aufnahme an diesem Tag.' }] },
      allowedEvidenceIds: [],
    };
    const markdown = draft(fixedRecord({ mode: 'no_ai', journal: null, provenance: { deterministic: true, reason: 'no_data' } }, input), input);
    expect(markdown).toContain('- Modus: ohne KI (keine Snapshots und keine verwendbaren Notizen)');
    expect(markdown).toContain(`- Keine Belege erfasst: Zu diesem Tag gibt es weder Snapshots noch verwendbare Notizen.`);
    expect(section(markdown, 'Quellen')).toBe(NO_EVIDENCE);
    expect(section(markdown, 'Offene Analysen und Erfassungslücken')).toBe('- Keine Aufnahme: Keine Aufnahme an diesem Tag.');
  });

  it('sammelt die Referenzen in der Reihenfolge ihres ersten Auftretens', () => {
    const { refs, sections } = draftBody(fixedJournalInput(), null);
    expect(sections).toHaveLength(12);
    expect(refs[0]).toBe(NOTE.plan);
    expect(new Set(refs).size).toBe(refs.length);
  });
});
