import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunInput, RunSummary } from '../../src/shared/run';
import type { RunEvent } from '../../src/shared/types';
import { describeRun } from '../../src/shared/run-texts';
import { createServices, type Services } from '../../src/main/services';
import type { ShellPort } from '../../src/main/shell';
import { APP_ROOT, REPO_ROOT, createTestEnv, fingerprintRepo, initProject, isAlive, readFakeCalls, waitFor, type InitializedProject, type TestEnv } from '../helpers/env';
import { SECRET_MARKER } from '../helpers/rich-workspace';

const SLOW_FAKE = path.join(APP_ROOT, 'test', 'helpers', 'slow-fake.mjs');

/** Actions of package 12 against the real CLI with the fake Claude (spec §17). */
describe('Aktionen mit dem echten CLI', () => {
  let env: TestEnv;
  let project: InitializedProject;
  let services: Services;
  const events: RunEvent[] = [];
  const clipboard: string[] = [];

  const shell: ShellPort = { openPath: async () => '', showItemInFolder: () => undefined, writeClipboard: (text) => void clipboard.push(text), openExternal: async () => undefined, trashItem: async () => undefined, chooseFile: async () => null, chooseFolder: async () => null };

  beforeAll(async () => {
    env = await createTestEnv();
    project = await initProject(env, 'aktionen');
    services = await createServices({
      appRoot: APP_ROOT,
      packaged: false,
      userDataDir: env.userData,
      env: env.env,
      appVersion: '0.1.0',
      electronVersion: '45.5.0',
      nodeExe: process.execPath,
      watchDebounceMs: 60,
      watchPollMs: 300,
      shell,
    });
    await services.loadProjects();
    services.queue.onEvent((event) => events.push(event));
  }, 120_000);
  afterAll(async () => {
    await services.shutdown();
    await env.cleanup();
  });

  /** Starts an action and waits for its summary, like the dialog does. */
  async function run(input: RunInput, extraEnv: Record<string, string> = {}): Promise<{ summary: RunSummary; runKey: string; events: RunEvent[] }> {
    for (const [key, value] of Object.entries(extraEnv)) env.env[key] = value;
    const before = events.length;
    const started = await services.startRun(project.repositoryId, input as never);
    if (!started.ok) throw new Error(`abgelehnt: ${started.reason}`);
    const finished = await waitFor(() => events.find((event, index) => index >= before && event.type === 'finished' && event.runKey === started.runKey), 120_000, 50);
    if (finished.type !== 'finished' || finished.summary === null) throw new Error('keine Zusammenfassung');
    // The closing live line follows the finished event; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { summary: finished.summary, runKey: started.runKey, events: events.slice(before) };
  }

  const setMode = (mode: string) => {
    env.env['FAKE_CLAUDE_MODE'] = mode;
  };

  describe('Erfassen (AK-10-38)', () => {
    it('Nur aufnehmen speichert einen Snapshot ohne Claude und lässt das Repository unverändert', async () => {
      await project.repo.write('src/a.ts', 'export const a = 1;\n');
      const before = await fingerprintRepo(project.repo.root);
      const { summary } = await run({ name: 'capture', mode: 'noAnalysis' });
      expect(summary).toMatchObject({ command: 'capture --no-analysis', exitCode: 0, outcome: 'ok', cancelled: false, failure: null });
      expect(summary.result).toMatchObject({ kind: 'capture', capture: 'created', snapshot: { id: 'S000002' }, analysis: null });
      expect(describeRun(summary)).toMatchObject({ title: 'Lauf beendet', chip: 'Erfolg', tone: 'neutral', text: 'Snapshot S000002 gespeichert. Analyse nicht ausgeführt (Nur aufnehmen).' });
      expect((await readFakeCalls(env)).filter((call) => call.kind === 'model-call')).toEqual([]);
      expect(await fingerprintRepo(project.repo.root)).toEqual(before);
    });

    it('Jetzt erfassen analysiert den offenen Snapshot mit Claude', async () => {
      setMode('analysis');
      const { summary } = await run({ name: 'capture', mode: 'full' });
      expect(summary.exitCode).toBe(0);
      expect(summary.result).toMatchObject({ kind: 'capture', analysis: { claudeCalls: 1, failed: [] } });
      expect((summary.result as { analysis: { completed: unknown[] } }).analysis.completed).toContainEqual({ snapshotId: 'S000002', mode: 'ai' });
      // No new work since the last capture, but the open analysis of S000002 ran now.
      expect(describeRun(summary)).toMatchObject({ title: 'Keine neue Arbeit', text: 'Keine neue Arbeit. Die Analyse von S000002 wurde abgeschlossen.' });
      expect((await readFakeCalls(env)).filter((call) => call.kind === 'model-call')).toHaveLength(1);
    });

    it('meldet "Keine neue Arbeit" bei unverändertem Stand', async () => {
      const { summary } = await run({ name: 'capture', mode: 'full' });
      expect(summary.result).toMatchObject({ capture: 'unchanged', snapshot: null });
      expect(describeRun(summary)).toMatchObject({ title: 'Keine neue Arbeit', chip: 'Keine neue Arbeit', tone: 'neutral' });
    });

    it('zeigt Exit-Code 6 als Hinweis mit nächstem Schritt, ohne dass der Snapshot verloren geht', async () => {
      await project.repo.write('src/b.ts', 'export const b = 1;\n');
      const { summary } = await run({ name: 'capture', mode: 'full' }, { FAKE_CLAUDE_MODE: 'invalid-json' });
      expect(summary.exitCode).toBe(6);
      expect(summary.result).toMatchObject({ kind: 'capture', snapshot: { id: 'S000003' }, analysis: { failed: [{ snapshotId: 'S000003' }] } });
      const text = describeRun(summary);
      expect(text).toMatchObject({ chip: 'KI-Schritt nicht abgeschlossen', tone: 'warn' });
      expect(text.text).toContain('Snapshot S000003 ist gespeichert');
      expect(text.text).toContain('beim nächsten Lauf erneut versucht');
      setMode('analysis');
    });
  });

  describe('Journal und Prüfen', () => {
    it('erzeugt ein Journal ohne KI und mit KI und meldet Exit-Code 6 ohne neuen Entwurf', async () => {
      const day = new Date().toISOString().slice(0, 10);
      const noAi = await run({ name: 'journal', noAi: true });
      expect(noAi.summary.result).toMatchObject({ kind: 'journal', mode: 'no_ai', draftWritten: true });
      expect(describeRun(noAi.summary).text).toMatch(/Journal-Entwurf für \d{4}-\d{2}-\d{2} gespeichert \(ohne KI\)/);
      setMode('journal');
      const ai = await run({ name: 'journal' });
      expect(ai.summary.result).toMatchObject({ kind: 'journal', mode: 'ai' });
      const found = await services.loadDay(project.repositoryId, (ai.summary.result as { day: string }).day);
      expect(found.ok && found.value.drafts.length).toBe(2);
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const failed = await run({ name: 'journal' }, { FAKE_CLAUDE_MODE: 'invalid-json' });
      expect(failed.summary.exitCode).toBe(6);
      expect(describeRun(failed.summary).text).toMatch(/kein neuer Entwurf geschrieben.*früherer Entwurf bleibt unverändert/);
      const after = await services.loadDay(project.repositoryId, (ai.summary.result as { day: string }).day);
      expect(after.ok && after.value.drafts.length).toBe(2);
      setMode('analysis');
    });

    it('prüft mit doctor ohne Modellaufruf und liefert Version, Anmeldeart und Befunde', async () => {
      const calls = (await readFakeCalls(env)).filter((call) => call.kind === 'model-call').length;
      const { summary } = await run({ name: 'doctor' });
      expect(summary.result).toMatchObject({ kind: 'doctor', ok: true, git: { found: true }, claude: { found: true, loggedIn: true }, billing: { blocked: false } });
      expect((await readFakeCalls(env)).filter((call) => call.kind === 'model-call')).toHaveLength(calls);
    });
  });

  describe('Notiz speichern (AK-10-48, AO-10)', () => {
    const noteFrom = async (text: string) => {
      const day = await services.loadDayIndex(project.repositoryId);
      const today = day.ok ? day.value.today : '';
      const view = await services.loadDay(project.repositoryId, today);
      return view.ok ? view.value.notes.find((note) => note.text === text) : undefined;
    };

    it.each([
      ['Umlaute und Anführungszeichen', 'Käse „schön“ & "gut" \'so\' äöüß'],
      ['führendes Minus', '-- das ist kein Parameter'],
      ['Zeilenumbrüche', 'Zeile eins\nZeile zwei\r\nZeile drei'],
      ['Sonderzeichen der Shell', 'a | b & c > d < e ^ f % PATH % `x` $(y)'],
    ])('speichert %s unverändert', async (_name, text) => {
      const { summary } = await run({ name: 'note', text, type: 'activity' });
      expect(summary.exitCode).toBe(0);
      expect(summary.result).toMatchObject({ kind: 'note', type: 'activity', secretFindings: [] });
      const normalized = text.replace(/\r\n/g, '\n');
      const saved = await services.loadDay(project.repositoryId, (summary.result as { activityDay: string }).activityDay);
      expect(saved.ok && saved.value.notes.some((note) => note.text.replace(/\r\n/g, '\n') === normalized)).toBe(true);
      expect(await noteFrom(text)).toBeDefined();
    });

    it('speichert alle Felder: Zeit, Verzögerung, Alternativen, Verweise', async () => {
      const { summary } = await run({ name: 'note', type: 'decision', text: 'Wahl getroffen', reason: 'Kleiner', alternatives: ['A', 'B'], start: '09:10', end: '09:55', timeKind: 'measured', delay: 5, refs: ['S000002:E001'] });
      expect(summary.result).toMatchObject({ kind: 'note', type: 'decision', time: { minutes: 45, basis: 'measured', start: '09:10', end: '09:55' }, delay: { minutes: 5, basis: 'measured' } });
    });

    it('nimmt einen Text von 8 000 Zeichen an, die Grenze des Dialogs (AO-10)', async () => {
      const text = `${'ä'.repeat(7_990)} Ende`;
      const { summary } = await run({ name: 'note', text });
      expect(summary.exitCode).toBe(0);
      expect(text.length).toBeLessThanOrEqual(8000);
    });

    it('lehnt eine ungültige Kombination mit Exit-Code 2 am Feld ab, nie als Absturz', async () => {
      const { summary } = await run({ name: 'note', text: 'Zeit ohne Basis', minutes: 30 });
      expect(summary.exitCode).toBe(2);
      expect(summary.failure).toBeNull();
      expect(describeRun(summary)).toMatchObject({ chip: 'Bedienungsfehler', tone: 'warn' });
      expect(summary.errors.length).toBeGreaterThan(0);
    });

    it('meldet bei möglichem Zugangsdatum nur Detektor und Feld, nie den Wert', async () => {
      const { summary, events: seen } = await run({ name: 'note', text: `api_key = "${SECRET_MARKER}"`, type: 'activity' });
      expect(summary.result).toMatchObject({ kind: 'note', secretFindings: [{ detector: 'assignment', field: 'text' }] });
      expect(JSON.stringify([summary, seen])).not.toContain(SECRET_MARKER);
    });
  });

  describe('Gründe (AK-10-44)', () => {
    it('prüft einen Grund vor dem Absenden mit dem Scanner des CLI und nennt nur den Detektor', async () => {
      const hit = await services.scanText(project.repositoryId, `Grund: password = "${SECRET_MARKER}"`);
      expect(hit).toEqual({ ok: true, value: { detectors: ['assignment'] } });
      expect(JSON.stringify(hit)).not.toContain(SECRET_MARKER);
      expect(await services.scanText(project.repositoryId, 'Ganz normaler Grund')).toEqual({ ok: true, value: { detectors: [] } });
    });

    it('lässt das CLI einen Grund mit Secret ablehnen (Exit-Code 2) und zeigt den Wert nirgends', async () => {
      const bad = `bewusst, token = "${SECRET_MARKER}"`;
      const { summary, events: seen } = await run({ name: 'skip', snapshotId: 'S000003', reason: bad });
      expect(summary.exitCode).toBe(2);
      expect(summary.result).toBeNull();
      const everything = JSON.stringify({ summary, seen, log: services.queue.log() });
      expect(everything).not.toContain(SECRET_MARKER);
      const appLog = await readFile(services.log.file, 'utf8');
      expect(appLog).not.toContain(SECRET_MARKER);
      expect(appLog).not.toContain('bewusst');
      // The snapshot stays open: nothing was skipped.
      const day = await services.loadDay(project.repositoryId, (await services.loadDayIndex(project.repositoryId).then((r) => (r.ok ? r.value.today : ''))));
      expect(day.ok && day.value.snapshots.find((snapshot) => snapshot.id === 'S000003')?.status).not.toBe('skipped');
    });

    it('überspringt mit gültigem Grund und liefert Snapshot und bisherigen Status', async () => {
      const { summary } = await run({ name: 'skip', snapshotId: 'S000003', reason: 'Bewusst ausgelassen (Test)' });
      expect(summary.exitCode).toBe(0);
      expect(summary.result).toMatchObject({ kind: 'skip', snapshotId: 'S000003', previousStatus: 'failed' });
      expect(describeRun(summary).text).toBe('S000003 übersprungen.');
      expect(JSON.stringify(summary)).not.toContain('Bewusst ausgelassen');
    });

    it('lehnt den Ausgangspunkt ohne Halt ab und setzt ihn mit --force', async () => {
      const plain = await run({ name: 'baseline', reason: 'Test' });
      expect(plain.summary.exitCode).toBe(2);
      const forced = await run({ name: 'baseline', reason: 'Absichtlich neu', force: true });
      expect(forced.summary.exitCode).toBe(0);
      expect(forced.summary.result).toMatchObject({ kind: 'baseline', forced: true, endedHalt: null });
    });
  });

  describe('Evidenz-Liste (AK-10-47)', () => {
    it('gruppiert alle Belege nach Snapshot mit Klartext der Art', async () => {
      const result = await services.loadEvidenceList(project.repositoryId);
      expect(result.ok).toBe(true);
      const groups = result.ok ? result.value : [];
      expect(groups[0]).toMatchObject({ snapshotId: 'S000001', title: 'S000001 · Ausgangslage' });
      const second = groups.find((group) => group.snapshotId === 'S000002');
      expect(second?.title).toMatch(/^S000002 · /);
      expect(second?.items[0]).toMatchObject({ ref: expect.stringMatching(/^S000002:E\d{3,}$/), kindLabel: expect.any(String), omitted: null });
      expect(second?.items.some((item) => item.kindLabel === 'Datei-Zustand' || item.kindLabel === 'Commit')).toBe(true);
    });
  });

  describe('Sperren und fremde Läufe (AK-10-39)', () => {
    it('erkennt einen Lauf eines zweiten Prozesses an der Lock-Datei, sperrt und meldet Exit-Code 3 als Hinweis', async () => {
      const holder: ChildProcess = spawn(process.execPath, [path.join(REPO_ROOT, 'test', 'helpers', 'lock-holder.mjs'), project.workspacePath], { stdio: ['pipe', 'pipe', 'pipe'] });
      try {
        await waitFor(
          () =>
            new Promise<boolean>((resolve) => {
              let seen = '';
              holder.stdout?.on('data', (chunk: Buffer) => {
                seen += chunk.toString();
                if (seen.includes('LOCKED')) resolve(true);
              });
              setTimeout(() => resolve(false), 200);
            }),
          20_000,
          50,
        ).catch(() => undefined);
        const state = await waitFor(async () => (await services.runState(project.repositoryId)).foreign, 10_000, 100);
        expect(state.command).toBe('lock-holder');
        // The buttons are locked without starting a process.
        const rejected = await services.startRun(project.repositoryId, { name: 'capture', mode: 'full' });
        expect(rejected).toMatchObject({ ok: false, reason: 'foreign_lock' });
        const journal = await services.startRun(project.repositoryId, { name: 'journal' });
        expect(journal).toMatchObject({ ok: false, reason: 'foreign_lock' });
        // A note is still possible; it takes no lock.
        const note = await run({ name: 'note', text: 'Während eines fremden Laufs' });
        expect(note.summary.exitCode).toBe(0);
        // A write run started anyway ends with exit code 3 and a notice, naming who holds the lock.
        const direct = await services.queue.start(project.repositoryId, { name: 'baseline', reason: 'x', force: true }, 'user');
        expect(direct.ok).toBe(false);
      } finally {
        holder.stdin?.end();
        await new Promise((resolve) => holder.once('exit', resolve));
      }
      await waitFor(async () => (await services.runState(project.repositoryId)).foreign === null, 10_000, 100);
    });
  });

  describe('Live-Zeilen aus Dateiereignissen (AK-10-37)', () => {
    it('zeigt die Zeilen in der Reihenfolge der Ereignisse mit Uhrzeit und ohne Inhalte', async () => {
      const file = `${project.workspacePath}/config.json`;
      const config = JSON.parse(await readFile(file, 'utf8')) as { claude: { command: string[] } };
      config.claude.command = [process.execPath, SLOW_FAKE];
      await writeFile(file, JSON.stringify(config, null, 2));
      await project.repo.write('src/live.ts', 'export const live = 1;\n');
      setMode('analysis');
      const { summary, events: seen } = await run({ name: 'capture', mode: 'full' }, { SLOW_MS: '2500' });
      const lines = seen.flatMap((event) => (event.type === 'live' ? [event.line] : []));
      const texts = lines.map((line) => line.text);
      expect(summary.exitCode).toBe(0);
      expect(texts[0], texts.join(' | ')).toBe('Lauf gestartet (capture)');
      const index = (fragment: string) => texts.findIndex((text) => text.includes(fragment));
      expect(index('gespeichert'), texts.join(' | ')).toBeGreaterThan(0);
      expect(index('Claude-Aufruf 1 von')).toBeGreaterThan(index('gespeichert'));
      expect(index('Antwort von Claude erhalten')).toBeGreaterThan(index('Claude-Aufruf 1 von'));
      expect(texts.findLastIndex((text) => text.includes('abgeschlossen'))).toBeGreaterThan(index('Antwort von Claude erhalten'));
      expect(texts.at(-1)).toBe('Lauf beendet, Exit-Code 0');
      // Times never go backwards, and the slow call leaves a visible gap between start and answer.
      const times = lines.map((line) => Date.parse(line.at));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times[index('Antwort von Claude erhalten')]! - times[index('Claude-Aufruf 1 von')]!).toBeGreaterThan(1500);
      // Names and counters only: no note text, no secret, no reason.
      const all = JSON.stringify(lines);
      expect(all).not.toContain(SECRET_MARKER);
      expect(all).not.toContain('Käse');
      expect(all).not.toContain('Bewusst ausgelassen');
    });
  });

  describe('Abbrechen und Fortsetzen (AK-10-51)', () => {
    it('beendet den Prozessbaum über die Dienste, meldet "abgebrochen" und der nächste Lauf setzt fort', async () => {
      const file = `${project.workspacePath}/config.json`;
      const config = JSON.parse(await readFile(file, 'utf8')) as { claude: { command: string[] } };
      config.claude.command = [process.execPath, path.join(REPO_ROOT, 'test', 'helpers', 'fake-claude.mjs')];
      await writeFile(file, JSON.stringify(config, null, 2));
      await project.repo.write('src/abbruch.ts', 'export const x = 1;\n');
      const callsBefore = (await readFakeCalls(env)).length;
      env.env['FAKE_CLAUDE_MODE'] = 'hang';
      const before = events.length;
      const started = await services.startRun(project.repositoryId, { name: 'capture', mode: 'full' });
      if (!started.ok) throw new Error(started.reason);
      const call = await waitFor(async () => (await readFakeCalls(env)).slice(callsBefore).find((entry) => entry.kind === 'model-call'), 60_000, 100);
      expect(await services.queue.cancel(started.runKey)).toEqual({ cancelled: true });
      const finished = await waitFor(() => events.slice(before).find((event) => event.type === 'finished' && event.runKey === started.runKey), 30_000, 50);
      expect(finished.type === 'finished' && finished.summary).toMatchObject({ cancelled: true, failure: null });
      expect(describeRun(finished.type === 'finished' && finished.summary !== null ? finished.summary : ({} as RunSummary))).toMatchObject({ title: 'Lauf abgebrochen', chip: 'Abgebrochen', text: 'Der nächste Lauf setzt sauber fort.' });
      await waitFor(() => !isAlive(call.pid), 15_000, 100);
      env.env['FAKE_CLAUDE_MODE'] = 'analysis';
      const resumed = await run({ name: 'capture', mode: 'full' });
      expect(resumed.summary.exitCode).toBe(0);
    });
  });

  it('startet auf eigene Faust nie einen Befehl mit Claude (AK-10-15, AK-10-50)', async () => {
    for (const entry of services.queue.log()) {
      if (entry.trigger === 'auto') expect(['status', 'schedule status']).toContain(entry.command);
    }
    // Every run with Claude was started by the user.
    expect(services.queue.log().filter((entry) => entry.ai && entry.event === 'started').every((entry) => entry.trigger === 'user')).toBe(true);
  });

  it('kopiert den Pfad nur im Main-Prozess (Zwischenablage), nicht an den Renderer', async () => {
    const result = await services.copyFilePath(project.repositoryId, { kind: 'workLog', snapshotId: 'S000002' });
    expect(result).toEqual({ ok: true, value: { opened: true } });
    expect(clipboard.at(-1)).toMatch(/logs[\\/]S000002\.md$/);
  });
});
