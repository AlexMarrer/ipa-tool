import { describe, expect, it } from 'vitest';
import { aiRecord, deterministicRecord } from '../../src/analysis/record.js';
import {
  AI_NOTICE,
  BASELINE_HEADING,
  DETERMINISTIC_NOTICE,
  NOT_RECORDED,
  renderWorkLog,
  SECTION_TITLES,
  UNKNOWN_TEST_RESULT,
} from '../../src/analysis/render.js';
import type { AnalysisOutput } from '../../src/analysis/types.js';
import type { Manifest } from '../../src/collector/types.js';
import { validate } from '../../src/core/schemas.js';
import { fixedContents, fixedInput, fixedManifest, validOutput } from './fixtures.js';

const TEXTS = { commitMessages: { E001: fixedContents()['E001']! } };

function aiLog(output: AnalysisOutput = validOutput(), manifest: Manifest = fixedManifest()) {
  const record = aiRecord({
    manifest,
    input: fixedInput(),
    output,
    attempt: 2,
    analysedAt: '2026-10-14T10:05:00+02:00',
    meta: { cliVersion: '2.1.201', models: ['claude-fake-model'] },
    inputSha256: 'd'.repeat(64),
  });
  expect(validate('analysis-record', record)).toEqual({ ok: true });
  return renderWorkLog(record, manifest, TEXTS);
}

function headings(log: string): string[] {
  return log
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3));
}

describe('Work-Log (AK-06-15)', () => {
  it('entspricht dem festen Beispiel-Log (Snapshot-Test)', async () => {
    await expect(aiLog()).toMatchFileSnapshot('./__snapshots__/work-log-ai.md');
  });

  it('beginnt mit dem Hinweis und hat alle Abschnitte in fester Reihenfolge', () => {
    const log = aiLog();
    expect(log.split('\n').slice(0, 3)).toEqual(['# Work-Log S000002', '', `> ${AI_NOTICE}`]);
    expect(headings(log)).toEqual([...SECTION_TITLES]);
    expect(log).toContain('| ID | Art | Pfad | Datei |');
    expect(log).toContain('| E003 | state_delta | src/wort.ts | snapshots/S000002/content/E003.patch |');
    expect(log).toContain('| E004 | state_delta | config/app.properties | ausgelassen (secret_suspected) |');
    expect(log).toContain(`- E2E-Tests – ${UNKNOWN_TEST_RESULT} [E007]`);
    // Every statement ends with its evidence IDs in brackets.
    expect(log).toContain('- **Service für Wortvalidierung**: Neue Konstante im Service. [E003, E001]');
  });

  it('zeigt leere Listen als „nicht erfasst“ (I-13)', () => {
    const empty: AnalysisOutput = { ...validOutput(), implemented: [], decisions: [], problems: [], tests: [], contradictions: [], unknowns: [] };
    const manifest = { ...fixedManifest(), statusChanges: [], gaps: [] };
    const log = aiLog(empty, manifest);
    const sections = log.split('\n## ').slice(1);
    for (const title of ['Umgesetzt', 'Entscheidungen', 'Probleme', 'Tests', 'Widersprüche', 'Statusänderungen', 'Unbekannt/offen']) {
      const section = sections.find((part) => part.startsWith(`${title}\n`));
      expect(section?.trim(), title).toBe(`${title}\n\n${NOT_RECORDED}`);
    }
    expect(log).toContain(`- Lücken: ${NOT_RECORDED}`);
  });

  it('kennzeichnet einen Ausgangs-Snapshot als Ausgangslage ohne KI (AK-06-12)', () => {
    const baseline: Manifest = {
      ...fixedManifest(),
      snapshotId: 'S000001',
      kind: 'baseline',
      previousSnapshotId: null,
      observedPeriod: { from: null, to: '2026-10-14T08:00:00+02:00' },
      analysisRequired: false,
      commits: [],
      evidence: [],
      statusChanges: [],
      filterDecisions: [],
      gaps: [],
    };
    const record = deterministicRecord(baseline, '2026-10-14T08:00:05+02:00');
    expect(validate('analysis-record', record)).toEqual({ ok: true });
    const log = renderWorkLog(record, baseline);
    expect(log.split('\n')[0]).toBe(`# Work-Log S000001: ${BASELINE_HEADING}`);
    expect(log).toContain(`> ${DETERMINISTIC_NOTICE}`);
    expect(log).toContain('keine neu erbrachte Leistung');
    expect(log).toContain('- Erzeugt: ohne KI, keine Analyse nötig (D-08), am 2026-10-14T08:00:05+02:00');
    expect(headings(log)).toEqual([...SECTION_TITLES]);
    expect(log).toContain(`## Umgesetzt\n\n${NOT_RECORDED} (ohne KI-Analyse)`);
  });

  it('nennt im Kopf Commits mit geprüfter Nachricht, fremde Commits und zurückgehaltene Nachrichten', () => {
    const manifest = fixedManifest();
    manifest.commits[0]!.authoredByConfiguredUser = false;
    const log = aiLog(validOutput(), manifest);
    expect(log).toContain(`  - \`${manifest.commits[0]!.sha.slice(0, 12)}\` Wortvalidierung in Service verschieben (fremder Commit) [E001]`);
    const withheld = fixedManifest();
    withheld.evidence[0] = { ...withheld.evidence[0]!, file: null, sha256: null, omitted: { reason: 'secret_suspected', detector: 'assignment' } };
    expect(renderWorkLog(deterministicRecord(withheld, '2026-10-14T10:05:00+02:00'), withheld)).toContain('(Nachricht ausgelassen: secret_suspected) [E001]');
  });
});
