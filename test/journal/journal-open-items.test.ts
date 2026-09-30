/**
 * Integration tests of `ipa journal` for day attribution, open items, baselines and withheld content
 * (package 07 §4, §6) with the fake Claude CLI and an injected clock.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { AttemptOutcomeRecord } from '../../src/analysis/types.js';
import { runBaseline } from '../../src/cli/commands/baseline.js';
import { runSkip } from '../../src/cli/commands/skip.js';
import type { Config } from '../../src/core/config.js';
import { NOT_RECORDED, SECTION_TITLES, TESTED_STATE_UNPROVEN, UNKNOWN_TEST_RESULT } from '../../src/journal/render.js';
import { namesIn } from '../helpers/analysis.js';
import { captureAt, contextAt, draftOf, draftsOf, inputOfCall, journalAt, journalRepo, noteAt } from '../helpers/journal.js';
import { createSecretMarker, filesContaining, secretAssignment } from '../helpers/secrets.js';
import { readManifestFile, setLimits } from '../helpers/snapshots.js';
import { readJsonFile } from '../helpers/workspace.js';
import { section } from './markdown.js';

const DAY = '2026-10-14';
const NEXT = '2026-10-15';

/** Every section except the unclear attribution and the sources. */
function otherSections(markdown: string): string {
  return SECTION_TITLES.filter((title) => title !== 'Unklare Tageszuordnung' && title !== 'Quellen')
    .map((title) => section(markdown, title))
    .join('\n');
}

async function writeAttempt(workspace: string, snapshotId: string, attempt: number, outcome: AttemptOutcomeRecord['outcome']): Promise<void> {
  const dir = `${workspace}/analyses/${snapshotId}/attempt-${attempt}`;
  await mkdir(dir, { recursive: true });
  const record: AttemptOutcomeRecord = {
    schemaVersion: 1,
    snapshotId,
    runId: 'R20261014T110000Z-0b0b',
    attempt,
    startedAt: `${DAY}T13:10:00+02:00`,
    endedAt: `${DAY}T13:11:00+02:00`,
    outcome,
    errorCode: outcome === 'claude_error' ? 'error_result' : null,
    message: 'künstlich',
  };
  await writeFile(`${dir}/outcome.json`, JSON.stringify(record));
}

describe('ipa journal: Tageszuordnung, offene Punkte und Ausgangslage (Paket 07)', () => {
  it('führt einen Snapshot über zwei Tage an beiden Tagen nur unter „Unklare Tageszuordnung“ (AK-07-05)', async () => {
    const env = await journalRepo(`${DAY}T08:00:00+02:00`);
    await env.repo.write('a.txt', 'eins\nzwei\n');
    expect((await captureAt(env, `${DAY}T16:00:00+02:00`, 'analysis')).exitCode).toBe(0);
    await env.repo.write('export.ts', 'export const csv = 1;\n');
    expect((await captureAt(env, `${NEXT}T09:00:00+02:00`, 'analysis')).exitCode).toBe(0);
    await noteAt(env, `${DAY}T12:00:00+02:00`, { type: 'activity', text: 'Arbeit am ersten Tag' });
    await noteAt(env, `${NEXT}T10:00:00+02:00`, { type: 'activity', text: 'Arbeit am zweiten Tag' });

    for (const day of [DAY, NEXT]) {
      for (const noAi of [false, true]) {
        const run = await journalAt(env, `${NEXT}T18:00:00+02:00`, { day, noAi });
        expect(run.exitCode, run.stderr).toBe(0);
        const { markdown } = await draftOf(env, day, run.runId);
        expect(section(markdown, 'Unklare Tageszuordnung')).toContain(
          '- S000003: Beobachtungszeitraum 2026-10-14T16:00:00+02:00 bis 2026-10-15T09:00:00+02:00; Analyse: abgeschlossen',
        );
        expect(section(markdown, 'Unklare Tageszuordnung')).toContain('Änderung an export.ts');
        expect(otherSections(markdown), `${day} ${noAi ? 'ohne KI' : 'mit KI'}`).not.toMatch(/S000003|export\.ts/);
        if (!noAi) {
          const input = inputOfCall(run.modelCalls[0]);
          expect(input.analyses.find((entry) => entry.snapshotId === 'S000003')?.dayAttribution).toBe('unclear');
          expect(input.allowedEvidenceIds.some((id) => id.startsWith('S000003:'))).toBe(false);
          expect(input.analyses.some((entry) => entry.snapshotId === 'S000002')).toBe(day === DAY);
        }
      }
    }
  });

  it('zeigt offene, blockierte, erschöpfte, übersprungene Analysen, Lücken nach baseline, Fehlerläufe, beschädigte Notizzeilen und Tage ohne Aufnahme (AK-07-06)', async () => {
    const env = await journalRepo(`${DAY}T08:00:00+02:00`, { claude: { maxAttemptsPerSnapshot: 2 } });
    for (const [index, hour] of ['09', '10', '11', '12', '13'].entries()) {
      await env.repo.write(`datei-${index}.txt`, `${index}\n`);
      expect((await captureAt(env, `${DAY}T${hour}:00:00+02:00`)).exitCode).toBe(0);
    }
    // Statuses from the files the pipeline writes (spec.md §12.1): S2 skipped, S3 blocked, S4 exhausted, S5 failed, S6 pending.
    await runSkip(await contextAt(env, `${DAY}T13:05:00+02:00`), 'S000002', 'Analyse nicht nötig');
    await writeAttempt(env.workspace, 'S000003', 1, 'input_too_large');
    await writeAttempt(env.workspace, 'S000004', 1, 'claude_error');
    await writeAttempt(env.workspace, 'S000004', 2, 'claude_error');
    await writeAttempt(env.workspace, 'S000005', 1, 'claude_error');

    await env.repo.git('checkout', '-q', '-b', 'review');
    expect((await captureAt(env, `${DAY}T14:00:00+02:00`)).exitCode).toBe(4);
    const baseline = await runBaseline(await contextAt(env, `${DAY}T14:30:00+02:00`), { reason: 'Branch für das Review gewechselt' });
    expect(baseline.snapshotId).toBe('S000007');
    const note = await noteAt(env, `${DAY}T15:00:00+02:00`, { type: 'activity', text: 'Review vorbereitet' });
    await appendFile(`${env.workspace}/notes/${DAY}.jsonl`, '{kaputt\n');

    const run = await journalAt(env, `${DAY}T18:00:00+02:00`, { noAi: true });
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stderr).toContain(`Warnung: notes/${DAY}.jsonl, Zeile 2 wird übersprungen`);
    const { markdown, record } = await draftOf(env, DAY, run.runId);
    const open = section(markdown, 'Offene Analysen und Erfassungslücken');
    for (const line of [
      '- Analyse S000002 (skipped): bewusst ausgelassen mit ipa skip',
      '- Analyse S000003 (blocked): blockiert, das Eingabepaket ist zu gross',
      '- Analyse S000004 (exhausted): Versuche erschöpft',
      '- Analyse S000005 (failed): Analyse fehlgeschlagen',
      '- Analyse S000006 (pending): noch nicht analysiert',
      '- Neuer Ausgangspunkt (S000007): Branch für das Review gewechselt',
      '- Halt vor neuem Ausgangspunkt (S000007): branch_changed, erkannt am 2026-10-14T14:00:00+02:00',
      `- Beschädigte Notizzeile: notes/${DAY}.jsonl, Zeile 2: ungültige Notizzeile`,
    ]) {
      expect(open).toContain(line);
    }
    expect(open).toMatch(/- Lauf nicht erfolgreich: capture R\d{8}T\d{6}Z-[0-9a-f]{4} um 14:00:00: halted \(Exit-Code 4\)\./);
    expect(record.openItems.analyses).toEqual([
      { snapshotId: 'S000002', status: 'skipped' },
      { snapshotId: 'S000003', status: 'blocked' },
      { snapshotId: 'S000004', status: 'exhausted' },
      { snapshotId: 'S000005', status: 'failed' },
      { snapshotId: 'S000006', status: 'pending' },
    ]);
    expect(section(markdown, 'Ausgeführte Arbeiten')).toBe(`- Review vorbereitet – Notiz (Tätigkeit) [${note.id}]`);

    // A day without any snapshot and without notes: draft without Claude and the gap "keine Aufnahme".
    const empty = await journalAt(env, `${NEXT}T18:00:00+02:00`, { day: NEXT });
    expect(empty.exitCode, empty.stderr).toBe(0);
    expect(empty.calls).toEqual([]);
    expect(empty.stdout).toContain('ohne KI, weil weder Snapshots noch verwendbare Notizen den Tag betreffen');
    const nextDraft = await draftOf(env, NEXT, empty.runId);
    expect(nextDraft.record).toMatchObject({ mode: 'no_ai', provenance: { reason: 'no_data' }, sources: [] });
    expect(nextDraft.markdown).toContain('- Keine Belege erfasst: Zu diesem Tag gibt es weder Snapshots noch verwendbare Notizen.');
    expect(section(nextDraft.markdown, 'Offene Analysen und Erfassungslücken')).toContain('- Keine Aufnahme: Keine Aufnahme an diesem Tag');
    expect(section(nextDraft.markdown, 'Quellen')).toBe('keine Belege erfasst');
  });

  it('zeigt leere Abschnitte als „nicht erfasst“ und eine geänderte Testdatei ohne Bericht als „Ergebnis unbekannt“ (AK-07-09)', async () => {
    const env = await journalRepo(`${DAY}T08:00:00+02:00`);
    await env.repo.write('test/wort.test.ts', 'test("wort", () => {});\n');
    expect((await captureAt(env, `${DAY}T10:00:00+02:00`, 'analysis')).exitCode).toBe(0);
    const manifest = await readManifestFile(env.workspace, 'S000002');
    const delta = manifest.evidence.find((entry) => entry.kind === 'state_delta' && entry.path === 'test/wort.test.ts')!;

    const run = await journalAt(env, `${DAY}T18:00:00+02:00`);
    expect(run.exitCode, run.stderr).toBe(0);
    const { markdown } = await draftOf(env, DAY, run.runId);
    expect(section(markdown, 'Tests')).toBe(
      `- Geänderte Testdatei test/wort.test.ts – ${UNKNOWN_TEST_RESULT}; ${TESTED_STATE_UNPROVEN} [S000002:${delta.id}]`,
    );
    for (const title of ['Geplante Arbeiten', 'Probleme und Lösungen', 'Entscheidungen', 'Abweichungen von der Planung', 'Erkenntnisse', 'Nächste Schritte', 'Zeitaufwand', 'Unklare Tageszuordnung', 'Offene Analysen und Erfassungslücken']) {
      expect(section(markdown, title), title).toBe(NOT_RECORDED);
    }
  });

  it('zeigt Inhalte des Ausgangs-Snapshots nicht als ausgeführte Arbeit (AK-07-10)', async () => {
    const env = await journalRepo(`${DAY}T08:00:00+02:00`, {
      files: { 'vorhanden.txt': 'alt\n' },
      prepare: async (repo) => {
        await repo.write('vorhanden.txt', 'alt\nschon begonnen\n');
        await repo.write('vor-init.txt', 'unversioniert\n');
      },
    });
    const baseline = await readManifestFile(env.workspace, 'S000001');
    expect(baseline.fileStates.map((state) => state.path).sort()).toEqual(['vor-init.txt', 'vorhanden.txt']);
    const note = await noteAt(env, `${DAY}T09:00:00+02:00`, { type: 'activity', text: 'Einarbeitung in das Projekt' });

    for (const noAi of [false, true]) {
      const run = await journalAt(env, `${DAY}T18:00:00+02:00`, { noAi });
      expect(run.exitCode, run.stderr).toBe(0);
      const { markdown } = await draftOf(env, DAY, run.runId);
      expect(section(markdown, 'Ausgeführte Arbeiten')).toBe(noAi ? `- Einarbeitung in das Projekt – Notiz (Tätigkeit) [${note.id}]` : `- Einarbeitung in das Projekt [${note.id}]`);
      expect(markdown).not.toMatch(/S000001|vorhanden\.txt|vor-init\.txt/);
      if (!noAi) {
        const input = inputOfCall(run.modelCalls[0]);
        expect(input.analyses).toEqual([]);
        expect(input.evidence).toEqual([]);
        expect(input.openItems.gaps).toEqual([]);
      }
    }
  });

  it('hält Notizen, Commit-Nachrichten und Analyseaussagen mit Secret-Treffer zurück und weist sie als offene Prüfung aus (I-05, I-12)', async () => {
    const marker = createSecretMarker();
    const env = await journalRepo(`${DAY}T08:00:00+02:00`);
    await env.repo.write('a.txt', 'eins\nzwei\n');
    await env.repo.commit(`Zwei ${secretAssignment(marker)}`);
    await env.repo.write('b.txt', 'neu\n');
    await env.repo.commit('Refactoring ABCMARKER');
    expect((await captureAt(env, `${DAY}T10:00:00+02:00`, 'analysis')).exitCode).toBe(0);
    const secretNote = await noteAt(env, `${DAY}T11:00:00+02:00`, {
      type: 'activity',
      text: `Zugang eingerichtet ${secretAssignment(marker)}`,
      time: { minutes: 15, basis: 'measured', start: null, end: null },
    });
    const plainNote = await noteAt(env, `${DAY}T11:30:00+02:00`, { type: 'activity', text: 'Dokumentation ergänzt' });
    // Patterns added after the capture: the second message and the analysis text are checked again (I-05).
    const config = await readJsonFile<Config>(`${env.workspace}/config.json`);
    await writeFile(`${env.workspace}/config.json`, JSON.stringify({ ...config, secrets: { ...config.secrets, extraPatterns: ['ABCMARKER', 'Künstliche Analyse'] } }, null, 2));

    const run = await journalAt(env, `${DAY}T18:00:00+02:00`);
    expect(run.exitCode, run.stderr).toBe(0);
    const input = inputOfCall(run.modelCalls[0]);
    expect(input.notes.map((note) => note.id)).toEqual([plainNote.id]);
    expect(input.timeSummary.entries).toEqual([expect.objectContaining({ noteId: secretNote.id, minutes: 15, withheld: true })]);
    expect(input.commits.map((commit) => commit.message)).toEqual([null, null]);
    expect(input.commits.every((commit) => commit.messageRef !== null)).toBe(true);
    expect(input.evidence.filter((entry) => entry.kind === 'commit_message').every((entry) => entry.omitted)).toBe(true);
    expect(input.analyses[0]?.derived).toBeNull();
    const gaps = input.openItems.gaps.filter((gap) => gap.type === 'withheld').map((gap) => gap.detail);
    expect(gaps).toEqual([
      expect.stringContaining('2 Einheit(en) wegen Secret-Verdacht zurückgehalten, davon 1 Commit-Nachricht(en) bei der erneuten Prüfung'),
      expect.stringContaining('Die Aussagen der Analyse wurden bei der erneuten Prüfung wegen Secret-Verdacht zurückgehalten (Detektor custom)'),
      expect.stringContaining(`Notiz ${secretNote.id} wegen Secret-Verdacht zurückgehalten (assignment in text)`),
    ]);

    for (const text of [run.stdout, run.stderr, run.modelCalls[0]!.stdin!]) {
      expect(text).not.toContain(marker);
      expect(text).not.toContain('ABCMARKER');
    }
    expect(await filesContaining(`${env.workspace}/journal`, marker)).toEqual([]);
    expect(await filesContaining(`${env.workspace}/journal`, 'ABCMARKER')).toEqual([]);
    const { markdown } = await draftOf(env, DAY, run.runId);
    expect(section(markdown, 'Zeitaufwand')).toContain(`| ${secretNote.id} (zurückgehalten) | activity | 15 | gemessen | – | zurückgehalten |`);
    expect(section(markdown, 'Offene Analysen und Erfassungslücken')).toContain(`- Offene Prüfung: Notiz ${secretNote.id} wegen Secret-Verdacht zurückgehalten`);
  });

  it('bricht bei zu grosser Eingabe ohne Kürzung mit Exit-Code 6 ab und verweist auf --no-ai (package 07 §4)', async () => {
    const env = await journalRepo(`${DAY}T08:00:00+02:00`);
    await noteAt(env, `${DAY}T09:00:00+02:00`, { type: 'activity', text: 'Recherche' });
    await setLimits(env.workspace, { maxJournalInputBytes: 200 });

    const run = await journalAt(env, `${DAY}T18:00:00+02:00`);
    expect(run.exitCode).toBe(6);
    expect(run.calls).toEqual([]);
    expect(run.stderr).toContain('limits.maxJournalInputBytes beträgt 200 Bytes');
    expect(run.stderr).toContain(`ipa journal --day ${DAY} --no-ai`);
    const runDir = `${env.workspace}/journal/runs/${run.runId}`;
    expect(await namesIn(runDir)).toEqual(['input.json', 'outcome.json']);
    expect(Buffer.byteLength(await readFile(`${runDir}/input.json`, 'utf8'))).toBeGreaterThan(200);
    expect(await readJsonFile<AttemptOutcomeRecord>(`${runDir}/outcome.json`)).toMatchObject({ outcome: 'input_too_large', errorCode: null });
    expect(await draftsOf(env.workspace)).toEqual([]);

    expect((await journalAt(env, `${DAY}T18:05:00+02:00`, { noAi: true })).exitCode).toBe(0);
  });

  it('endet mit Exit-Code 6 ohne Laufordner, wenn Claude nicht einsatzbereit ist', async () => {
    const env = await journalRepo(`${DAY}T08:00:00+02:00`, { ready: false, claude: { command: [`${process.cwd()}/gibt-es-nicht/claude.exe`] } });
    await noteAt(env, `${DAY}T09:00:00+02:00`, { type: 'activity', text: 'Recherche' });
    const run = await journalAt(env, `${DAY}T18:00:00+02:00`);
    expect(run.exitCode).toBe(6);
    expect(run.stderr).toContain(`Fehler: Kein Journal-Entwurf für ${DAY} (claude_not_ready)`);
    expect(run.stderr).toContain('--no-ai');
    expect(await namesIn(`${env.workspace}/journal/runs`)).toEqual([]);
    expect(await draftsOf(env.workspace)).toEqual([]);
  });
});
