import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCliLib } from '../../src/main/cli-lib';
import { createSchemaValidator } from '../../src/main/cli/validator';
import { createWorkspaceReader, type WorkspaceReader } from '../../src/main/reader/workspace';
import type { StatusReport } from '../../src/shared/cli-types';
import { REPO_ROOT, createTestEnv, fingerprintRepo, runCli, type InitializedProject, type TestEnv } from '../helpers/env';
import {
  SECRET_MARKER,
  TIMEZONE,
  buildBlockedWorkspace,
  buildFailedWorkspace,
  buildHaltWorkspace,
  buildRebaselineWorkspace,
  buildStatesWorkspace,
  type StatesWorkspace,
} from '../helpers/rich-workspace';

const validator = createSchemaValidator(path.join(REPO_ROOT, 'schemas'));

async function readerFor(project: InitializedProject): Promise<WorkspaceReader> {
  const lib = await loadCliLib(REPO_ROOT);
  return createWorkspaceReader({ workspacePath: project.workspacePath, validator, createScanner: (secrets) => lib.createSecretScanner(secrets), fallbackTimezone: TIMEZONE });
}

async function statusOf(env: TestEnv, project: InitializedProject): Promise<StatusReport> {
  const result = await runCli(env, project.repo.root, ['status', '--json']);
  return JSON.parse(result.stdout) as StatusReport;
}

describe('Reader gegen Arbeitsbereiche des echten CLI', () => {
  let env: TestEnv;
  let states: StatesWorkspace;
  let reader: WorkspaceReader;

  beforeAll(async () => {
    env = await createTestEnv();
    states = await buildStatesWorkspace(env);
    reader = await readerFor(states.project);
  }, 420_000);
  afterAll(async () => env.cleanup());

  it('nutzt createSecretScanner des gebauten CLI (AD-07, AO-05)', async () => {
    const lib = await loadCliLib(REPO_ROOT);
    const hits = lib.createSecretScanner({ extraPatterns: [], disabledDetectors: [] }).scan(`api_key = "${SECRET_MARKER}"`);
    expect(hits.map((hit) => hit.detector)).toContain('assignment');
    await expect(loadCliLib(path.join(REPO_ROOT, 'nicht-vorhanden'))).rejects.toMatchObject({ code: 'cli_version_mismatch' });
  });

  describe('Analyse-Status (AK-10-18)', () => {
    it('leitet alle Status ab und stimmt mit status --json überein', async () => {
      const status = await statusOf(env, states.project);
      const derived = await reader.derivedCounts();
      expect(derived.counts).toEqual({
        pending: status.analyses.pending,
        failed: status.analyses.failed,
        blocked: status.analyses.blocked,
        exhausted: status.analyses.exhausted,
        complete: status.analyses.complete,
        skipped: status.analyses.skipped,
        notRequired: status.analyses.notRequired,
      });
      expect(derived.openIds).toEqual(status.analyses.openIds);
      expect(derived.withheldNotes).toBe(status.withheld.notes);
      // The fixture really covers the statuses (otherwise the comparison proves little).
      expect(derived.counts).toMatchObject({ complete: 2, exhausted: 1, skipped: 1, notRequired: 1 });
      expect(derived.counts.pending).toBeGreaterThanOrEqual(1);
      expect(derived.withheldNotes).toBe(1);
    });

    it('trägt je Snapshot Status, Art, Versuche und Fehlerklasse', async () => {
      const day = await reader.day(states.today);
      const byId = Object.fromEntries(day.snapshots.map((snapshot) => [snapshot.id, snapshot]));
      expect(byId['S000001']).toMatchObject({ kind: 'baseline', status: 'complete', aiMode: 'deterministic', dayAttribution: 'baseline' });
      expect(byId['S000002']).toMatchObject({ kind: 'work', status: 'complete', aiMode: 'ai', dayAttribution: 'day' });
      expect(byId['S000003']).toMatchObject({ status: 'exhausted', aiMode: 'none', attempts: { failed: 3, max: 3 } });
      expect(byId['S000003']?.lastErrorCode).toBeTruthy();
      expect(byId['S000004']).toMatchObject({ status: 'pending', attempts: { failed: 0 } });
      expect(byId['S000005']).toMatchObject({ status: 'skipped' });
      expect(byId['S000007']).toMatchObject({ status: 'pending' });
      expect(byId['S000008']).toMatchObject({ status: 'not_required' });
      expect(byId['S000002']?.runId).toMatch(/^R\d{8}T\d{6}Z-[0-9a-f]{4}$/);
    });
  });

  describe('Tagesansicht (AK-10-19 bis AK-10-24)', () => {
    it('ordnet Snapshots in der Projektzeitzone zu, auch über mehrere Tage (unklar)', async () => {
      const today = await reader.day(states.today);
      const yesterday = await reader.day(states.yesterday);
      expect(today.timezone).toBe(TIMEZONE);
      expect(today.isToday).toBe(true);
      expect(today.snapshots.find((snapshot) => snapshot.id === 'S000006')).toMatchObject({ dayAttribution: 'unclear' });
      expect(yesterday.snapshots.map((snapshot) => snapshot.id)).toEqual(['S000006']);
      expect(yesterday.isToday).toBe(false);
      const notice = today.attention.find((item) => item.kind === 'snapshot_unclear');
      expect(notice).toMatchObject({ level: 'notice', snapshotId: 'S000006' });
      expect(notice?.text).toContain('zählt an keinem Tag als ausgeführte Arbeit');
    });

    it('markiert Zukunft und Wochentag und lässt leere Tage leer', async () => {
      const future = await reader.day('2099-01-01');
      expect(future).toMatchObject({ isFuture: true, isToday: false, weekday: 'Donnerstag', title: 'Donnerstag, 1. Januar 2099' });
      expect(future.snapshots).toEqual([]);
      expect(future.timeline).toEqual([]);
      expect(future.attention.filter((item) => item.level === 'attention').map((item) => item.kind)).not.toContain('no_capture');
    });

    it('rechnet Zeiten nur aus Notizen, getrennt und ohne Gesamtsumme (AK-10-21)', async () => {
      const { summary } = await reader.day(states.today);
      expect(summary.time.time).toEqual({ measured: 90, estimated: 0 });
      expect(summary.time.planned).toEqual({ measured: 0, estimated: 60 });
      expect(summary.time.delays).toEqual({ measured: 0, estimated: 20 });
      expect(summary.time.withoutTime).toBe(5);
      expect(JSON.stringify(summary)).not.toMatch(/total|gesamt|sum/i);
      expect(summary.noteCount).toBe(8);
    });

    it('hält zurückgehaltene Notizen als Anzahl und Detektor, nie als Wert (AK-10-26)', async () => {
      const { notes } = await reader.day(states.today);
      const withheld = notes.filter((note) => note.withheld !== null);
      expect(withheld).toHaveLength(1);
      expect(withheld[0]?.withheld).toMatchObject({ detectors: ['assignment'], fields: ['text'] });
      expect(JSON.stringify(notes)).not.toContain(SECRET_MARKER);
      // The masked note still counts with its time (here none) and keeps its other fields.
      expect(withheld[0]?.type).toBe('activity');
    });

    it('liest die Felder jeder Notizart', async () => {
      const { notes } = await reader.day(states.today);
      const find = (type: string, text: string) => notes.find((note) => note.type === type && note.text.includes(text));
      expect(find('activity', 'Pair-Programming')).toMatchObject({ time: { minutes: 45, basis: 'measured', start: '09:10', end: '09:55' } });
      expect(find('problem', 'hängen')).toMatchObject({ delay: { minutes: 20, basis: 'estimated' }, cause: 'Lock-Datei blieb liegen', solution: 'Toten Lock erkannt' });
      expect(find('decision', 'Electron')).toMatchObject({ reason: 'Kleinere Angriffsfläche', alternatives: ['Tauri', 'NW.js'] });
      expect(find('plan', 'Notizdialog')).toMatchObject({ time: { minutes: 60, basis: 'estimated' } });
      expect(find('activity', 'Pair-Programming')?.refs[0]).toMatch(/^S000002:E\d{3}$/);
    });

    it('zählt beschädigte Zeilen und meldet sie als Hinweis (AK-10-23)', async () => {
      const day = await reader.day(states.today);
      expect(day.invalid).toMatchObject({ noteLines: 1, runLines: 1, unreadableFiles: [] });
      expect(day.attention.filter((item) => item.kind === 'invalid_lines')).toHaveLength(2);
    });

    it('stellt offene Snapshots, zurückgehaltene Notizen und Zähler im Panel dar, Zur-Kenntnis zählt nicht', async () => {
      const { attention } = await reader.day(states.today);
      const open = attention.filter((item) => item.kind === 'snapshot_open');
      expect(open.map((item) => item.snapshotId).sort()).toEqual(['S000003', 'S000004', 'S000006', 'S000007']);
      expect(open.find((item) => item.snapshotId === 'S000003')?.text).toContain('3 von 3 Versuchen');
      expect(attention.some((item) => item.kind === 'withheld' && item.text.includes('Notiz'))).toBe(true);
      expect(attention.filter((item) => item.level === 'attention').length).toBe(attention.length - attention.filter((item) => item.level === 'notice').length);
    });

    it('sortiert den Zeitstrahl: Snapshot vor Notiz vor Lauf bei gleicher Zeit, ohne Zeit am Ende', async () => {
      const { timeline } = await reader.day(states.today);
      const times = timeline.map((entry) => entry.time);
      const dated = times.filter((time): time is string => time !== null);
      expect(dated).toEqual([...dated].sort());
      // Entries without a time stay at the end.
      const firstNull = times.indexOf(null);
      if (firstNull !== -1) expect(times.slice(firstNull).every((time) => time === null)).toBe(true);
      expect(timeline.filter((entry) => entry.kind === 'snapshot').length).toBe(8);
      expect(timeline.some((entry) => entry.kind === 'run')).toBe(true);
    });

    it('zeigt alle Snapshots des Tages, auch offene und die Ausgangslage (AK-10-22)', async () => {
      const { snapshots } = await reader.day(states.today);
      expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['S000001', 'S000002', 'S000003', 'S000004', 'S000005', 'S000006', 'S000007', 'S000008']);
    });

    it('zählt Läufe nach Datum und liefert Ergebnis, Exit-Code und Dauer (AK-10-22)', async () => {
      const { runs } = await reader.day(states.today);
      expect(runs.length).toBeGreaterThan(5);
      expect(runs.some((run) => run.outcome === 'analysis_failed' && run.exitCode === 6)).toBe(true);
      expect(runs.every((run) => run.durationMs >= 0 && /^\d\d:\d\d$/.test(run.time))).toBe(true);
    });
  });

  describe('Kalender (AK-10-20)', () => {
    it('markiert Tage mit Daten und mit Warnung', async () => {
      const index = await reader.dayIndex();
      expect(index.timezone).toBe(TIMEZONE);
      expect(index.today).toBe(states.today);
      const entry = (day: string) => index.days.find((candidate) => candidate.day === day);
      expect(entry(states.today)).toMatchObject({ hasData: true, warning: true });
      expect(entry(states.yesterday)).toMatchObject({ hasData: true });
      expect(index.days.map((candidate) => candidate.day)).toEqual([...index.days.map((candidate) => candidate.day)].sort());
    });
  });

  describe('Work-Logs (AK-10-25)', () => {
    it('liefert das Markdown des Work-Logs und die Ausgangslage', async () => {
      const log = await reader.workLog('S000002');
      expect(log).toMatchObject({ state: 'ok', replacement: false });
      expect(log?.markdown).toContain('Work-Log S000002');
      const baseline = await reader.workLog('S000001');
      expect(baseline?.markdown).toContain('Ausgangslage – keine neu erbrachte Leistung');
      expect(baseline?.snapshot.kind).toBe('baseline');
    });

    it('baut für Snapshots ohne Work-Log die Ersatzansicht "Nicht erstellt" aus Manifest und Status', async () => {
      const log = await reader.workLog('S000003');
      expect(log).toMatchObject({ replacement: true, state: 'missing' });
      expect(log?.markdown).toContain('Nicht erstellt. Die Analyse ist nicht abgeschlossen.');
      expect(log?.markdown).toContain('Analyse nach 3 Versuchen nicht abgeschlossen.');
      for (const title of ['Zusammenfassung', 'Umgesetzt', 'Entscheidungen', 'Probleme', 'Tests', 'Widersprüche', 'Statusänderungen', 'Unbekannt/offen', 'Erfassungshinweise', 'Belege']) {
        expect(log?.markdown).toContain(`## ${title}`);
      }
      expect(await reader.workLog('S000999')).toBeNull();
      expect(await reader.workLog('../../etc')).toBeNull();
    });

    it('zeigt den Grund eines Überspringens nie (spec §12.6)', async () => {
      const log = await reader.workLog('S000005');
      expect(log?.markdown).not.toContain('bewusst ausgelassen');
      expect(JSON.stringify(log)).not.toContain('Test: bewusst');
    });
  });

  describe('Journal (AK-10-27)', () => {
    it('listet die Entwürfe des Tages mit Art und liest den neuesten', async () => {
      const drafts = await reader.drafts(states.today);
      expect(drafts.length).toBeGreaterThanOrEqual(1);
      expect(drafts.map((draft) => draft.mode)).toContain('no_ai');
      const newest = drafts.at(-1);
      expect(newest?.file).toMatch(/^\d{4}-\d{2}-\d{2}-R\d{8}T\d{6}Z-[0-9a-f]{4}$/);
      const view = await reader.journal(newest?.file ?? '');
      expect(view?.state).toBe('ok');
      expect(view?.markdown).toContain('# Journal-Entwurf');
      expect(view?.headings).toEqual([
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
      ]);
      expect(await reader.journal('../../x')).toBeNull();
    });
  });

  describe('Referenz-Index (spec §5.8)', () => {
    it('ordnet Notiz-IDs und Snapshot-IDs Tagen zu', async () => {
      const index = await reader.references();
      expect(Object.values(index.notes).filter((day) => day === states.today)).toHaveLength(8);
      expect(Object.values(index.notes).filter((day) => day === states.yesterday)).toHaveLength(1);
      expect(index.snapshots['S000002']).toBe(states.today);
    });
  });

  describe('Übersicht (AK-10-31)', () => {
    it('übernimmt die Zähler aus status --json und meldet keinen Widerspruch', async () => {
      const status = await statusOf(env, states.project);
      const overview = await reader.overview(status, null);
      expect(overview).toMatchObject({ halt: null, inconsistent: false, notesToday: 8, analysedUpTo: status.lastAnalysedSnapshotId });
      expect(overview.claude).toMatchObject({ ok: true, problem: null });
      expect(overview.analyses.exhausted).toBe(1);
      expect(overview.withheld).toEqual(status.withheld);
      expect(overview.lastRun).not.toBeNull();
      expect(overview.recentDays[0]?.day).toBe(states.today);
    });

    it('meldet "Analyse-Stand uneinheitlich", wenn die Ableitung abweicht, und zeigt dann status', async () => {
      const status = await statusOf(env, states.project);
      const tampered = { ...status, analyses: { ...status.analyses, pending: status.analyses.pending + 1 } };
      const overview = await reader.overview(tampered, null);
      expect(overview.inconsistent).toBe(true);
      expect(overview.analyses.pending).toBe(tampered.analyses.pending);
    });
  });

  describe('Dateien öffnen nur über Art und ID (spec §3.8)', () => {
    it('löst Work-Log, Entwurf und Beleg auf und lehnt alles andere ab', async () => {
      const workspace = states.project.workspacePath;
      expect(await reader.resolveFile({ kind: 'workLog', snapshotId: 'S000002' })).toBe(path.join(workspace, 'logs', 'S000002.md'));
      const draft = (await reader.drafts(states.today)).at(-1);
      expect(await reader.resolveFile({ kind: 'journalDraft', file: draft?.file ?? '' })).toMatch(/\.md$/);
      expect(await reader.resolveFile({ kind: 'workLog', snapshotId: '../../config' })).toBeNull();
      expect(await reader.resolveFile({ kind: 'journalDraft', file: '..\\..\\config' })).toBeNull();
      expect(await reader.resolveFile({ kind: 'evidence', snapshotId: 'S000002', evidenceId: 'E999' })).toBeNull();
      expect(await reader.resolveFile({ kind: 'workLog', snapshotId: 'S000003' })).toBeNull();
    });

    it('öffnet journal/final, legt es aber nie an und liest nie darin (I-09)', async () => {
      const final = path.join(states.project.workspacePath, 'journal', 'final');
      // `ipa init` creates the folder; the app only opens it.
      expect(await reader.resolveFile({ kind: 'journalFinalFolder' })).toContain('final');
      await rm(final, { recursive: true, force: true });
      expect(await reader.resolveFile({ kind: 'journalFinalFolder' })).toBeNull();
      await expect(access(final)).rejects.toThrow();
    });
  });

  it('verändert beim Lesen weder Arbeitsbereich noch Repository (AK-10-35)', async () => {
    const workspaceBefore = await fingerprintRepo(states.project.workspacePath);
    const repoBefore = await fingerprintRepo(states.project.repo.root);
    for (let round = 0; round < 2; round += 1) {
      await reader.day(states.today);
      await reader.day(states.yesterday);
      await reader.dayIndex();
      await reader.references();
      await reader.workLog('S000002');
      await reader.workLog('S000003');
      await reader.overview(null, null);
      const draft = (await reader.drafts(states.today)).at(-1);
      if (draft !== undefined) await reader.journal(draft.file);
    }
    expect(await fingerprintRepo(states.project.workspacePath)).toEqual(workspaceBefore);
    expect(await fingerprintRepo(states.project.repo.root)).toEqual(repoBefore);
  });
});

describe('Weitere Zustände', () => {
  let env: TestEnv;
  let blocked: InitializedProject;
  beforeAll(async () => {
    env = await createTestEnv();
    blocked = await buildBlockedWorkspace(env);
  }, 120_000);
  afterAll(async () => env.cleanup());

  it('erkennt einen blockierten Snapshot und gleicht ihn mit status --json ab (AK-10-18)', async () => {
    const project = blocked;
    const reader = await readerFor(project);
    const status = await statusOf(env, project);
    expect(status.analyses.blocked).toBe(1);
    const derived = await reader.derivedCounts();
    expect(derived.counts.blocked).toBe(1);
    expect(derived.openIds).toEqual(status.analyses.openIds);
    const log = await reader.workLog('S000002');
    expect(log).toMatchObject({ replacement: true });
    expect(log?.markdown).toContain('Eingabe zu gross');
    expect(log?.markdown).toContain('Limit in der Konfiguration erhöhen');
    expect(log?.snapshot.lastErrorCode).toBe('input_too_large');
  });

  it('erkennt einen fehlgeschlagenen Versuch als failed mit Fehlerklasse (AK-10-18)', async () => {
    const project = await buildFailedWorkspace(env);
    const reader = await readerFor(project);
    const status = await statusOf(env, project);
    expect(status.analyses.failed).toBe(1);
    const derived = await reader.derivedCounts();
    expect(derived.counts.failed).toBe(1);
    const day = await reader.day((await reader.dayIndex()).today);
    const snapshot = day.snapshots.find((candidate) => candidate.status === 'failed');
    expect(snapshot).toMatchObject({ attempts: { failed: 1, max: 3 } });
    expect(snapshot?.lastErrorCode).toBeTruthy();
    expect(day.attention.find((item) => item.status === 'failed')?.text).toContain('Der nächste Lauf versucht es erneut');
  }, 120_000);

  it.each(['branch_changed', 'history_rewritten', 'head_missing'] as const)('liest den Halt %s mit erwartetem und beobachtetem Stand (AK-10-32)', async (reason) => {
    const project = await buildHaltWorkspace(env, reason);
    const reader = await readerFor(project);
    const overview = await reader.overview(await statusOf(env, project).catch(() => null), null);
    expect(overview.halt?.reason).toBe(reason);
    expect(overview.halt?.detectedAt).toMatch(/^\d{4}-/);
    expect(overview.halt?.expected).toHaveProperty('head');
    expect(overview.halt?.observed).toHaveProperty('branch');
    if (reason === 'branch_changed') expect(overview.halt?.observed.branch).toBe('anderer-branch');
    if (reason === 'head_missing') expect(overview.halt?.observed.head).toBeNull();
    const index = await reader.dayIndex();
    expect(index.days.some((day) => day.warning)).toBe(true);
    const day = await reader.day(index.today);
    expect(day.attention.some((item) => item.kind === 'halt' && item.link === 'overview')).toBe(true);
  }, 120_000);

  it('zeigt die Lücke "Neuer Ausgangspunkt" nach einem neuen Ausgangspunkt (AK-10-23)', async () => {
    const project = await buildRebaselineWorkspace(env);
    const reader = await readerFor(project);
    const index = await reader.dayIndex();
    const day = await reader.day(index.today);
    const gap = day.attention.find((item) => item.kind === 'gap');
    expect(gap?.text).toContain('Neuer Ausgangspunkt');
    expect(day.snapshots.some((snapshot) => snapshot.kind === 'baseline' && snapshot.gaps.length > 0)).toBe(true);
    const overview = await reader.overview(null, null);
    expect(overview.halt).toBeNull();
  }, 120_000);

  it('bleibt bei beschädigten Dateien bedienbar und nennt sie, statt abzustürzen (AK-10-17)', async () => {
    const project = blocked;
    const reader = await readerFor(project);
    await mkdir(path.join(project.workspacePath, 'snapshots', 'S000099'), { recursive: true });
    await writeFile(path.join(project.workspacePath, 'snapshots', 'S000099', 'manifest.json'), '{"schemaVersion": 1}');
    await mkdir(path.join(project.workspacePath, 'snapshots', 'S000098'), { recursive: true });
    await writeFile(path.join(project.workspacePath, 'snapshots', 'S000098', 'manifest.json'), '{"schemaVersion": 7}');
    await writeFile(path.join(project.workspacePath, 'config.json'), '{kaputt');
    const day = await reader.day((await reader.dayIndex()).today);
    expect(day.invalid.unreadableFiles.sort()).toEqual(['snapshots/S000098/manifest.json', 'snapshots/S000099/manifest.json']);
    expect(day.timezone).toBe(TIMEZONE);
    expect(day.snapshots.length).toBeGreaterThan(0);
  }, 120_000);
});
