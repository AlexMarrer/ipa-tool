import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/renderer/layout/AppShell';
import { createAppStore } from '../../src/renderer/store/appStore';
import { todayIn } from '../../src/shared/dates';
import type { RunResultView, RunSummary } from '../../src/shared/run';
import type { DayView, EvidenceGroup, OverviewView, SnapshotView, WorkLogView } from '../../src/shared/views';
import { createFakeApi, emptyDay, project, type FakeApiOptions } from './fakeApi';

const REPO = 'alpha-111111';
const TODAY = todayIn('Europe/Zurich');
const SECRET = 'sk-ant-api03-GEHEIMER-WERT-NIE-ANZEIGEN';

const summaryOf = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  command: 'capture',
  exitCode: 0,
  outcome: 'ok',
  runId: 'R20261126T100000Z-d2e8',
  errors: [],
  warnings: [],
  output: '',
  failure: null,
  cancelled: false,
  result: null,
  lock: null,
  ...overrides,
});

const captureResult = (overrides: Partial<Extract<RunResultView, { kind: 'capture' }>> = {}): RunResultView => ({
  kind: 'capture',
  capture: 'created',
  snapshot: { id: 'S000006', commits: 2, evidence: 12, fileStates: 4 },
  outsideWindow: false,
  analysis: { claudeCalls: 1, completed: [{ snapshotId: 'S000006', mode: 'ai' }], failed: [], open: [] },
  retry: null,
  halt: null,
  ...overrides,
});

const snap = (id: string, overrides: Partial<SnapshotView> = {}): SnapshotView => ({
  id,
  kind: 'work',
  capturedAt: `${TODAY}T10:00:00+01:00`,
  observedPeriod: { from: `${TODAY}T12:00:00+01:00`, to: `${TODAY}T14:00:00+01:00` },
  branch: 'main',
  commits: 2,
  evidence: 12,
  status: 'complete',
  attempts: { failed: 0, max: 3 },
  lastErrorCode: null,
  aiMode: 'ai',
  dayAttribution: 'day',
  withheld: { count: 0, detectors: [] },
  gaps: [],
  runId: 'R20261126T100000Z-d2e8',
  time: '14:00',
  ...overrides,
});

const overview = (overrides: Partial<OverviewView> = {}): OverviewView => ({
  halt: null,
  claude: { checkedAt: null, ok: null, version: null, problem: null },
  lastRun: null,
  lastSnapshot: null,
  analysedUpTo: null,
  analyses: { pending: 0, failed: 0, blocked: 0, exhausted: 0, complete: 0, skipped: 0, notRequired: 0 },
  withheld: { units: 0, notes: 0 },
  notesToday: 0,
  schedule: null,
  recentDays: [],
  timezone: 'Europe/Zurich',
  inconsistent: false,
  ...overrides,
});

async function mount(options: FakeApiOptions = {}, selection: FakeApiOptions['state'] = {}) {
  const fake = createFakeApi({ projects: [project()], state: { repositoryId: REPO, section: 'overview', ...selection }, ...options });
  const app = createAppStore(fake.api);
  render(<AppShell app={app} api={fake.api} />);
  await act(async () => app.actions.init());
  /** Ends the run the last `run.start` started. */
  const finish = (summary: RunSummary, runKey = 'k1') =>
    act(() => fake.emitRun({ type: 'finished', runKey, repositoryId: REPO, exitCode: summary.exitCode, cancelled: summary.cancelled, notice: summary.exitCode === 3 ? 'lock_held' : null, failure: summary.failure, summary }));
  const started = (label = 'capture', ai = true, panel = true) =>
    act(() => fake.emitRun({ type: 'started', runKey: 'k1', repositoryId: REPO, label, cancellable: true, ai, panel, startedAt: new Date().toISOString() }));
  return { ...fake, app, finish, started };
}

const lastStart = (view: Awaited<ReturnType<typeof mount>>) => (view.api.run.start as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, unknown];

describe('Jetzt erfassen (AK-10-38, AK-10-50)', () => {
  it('startet capture mit der Hauptaktion und capture --no-analysis über das Menü', async () => {
    const user = userEvent.setup();
    const view = await mount();
    await user.click(screen.getByRole('button', { name: /Jetzt erfassen.*Claude/ }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'capture', mode: 'full' }]));
    await view.started();
    await view.finish(summaryOf({ result: captureResult() }));
    expect(await screen.findByText('Snapshot S000006 gespeichert und analysiert. Die Analyse ist abgeschlossen.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Weitere Optionen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Nur aufnehmen' }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'capture', mode: 'noAnalysis' }]));
  });

  it('trägt die KI-Markierung genau an den Buttons, die Claude aufrufen', async () => {
    const user = userEvent.setup();
    await mount();
    const spark = (element: HTMLElement) => element.querySelector('[data-icon="spark"]') !== null;
    expect(spark(screen.getByRole('button', { name: /Jetzt erfassen/ }))).toBe(true);
    expect(screen.getByRole('button', { name: /Jetzt erfassen/ })).toHaveAccessibleName(/ruft Claude auf/);
    expect(spark(screen.getByRole('button', { name: /Neue Notiz/ }))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Weitere Optionen' }));
    expect(spark(screen.getByRole('menuitem', { name: 'Nur aufnehmen' }))).toBe(false);
  });

  it('sperrt bei fremdem Lauf, nennt den Grund und lässt Notizen zu', async () => {
    const view = await mount({ lock: { own: [], foreign: { command: 'capture', startedAt: '16:20' } } });
    const capture = screen.getByRole('button', { name: /Jetzt erfassen.*Claude/ });
    expect(capture).toBeDisabled();
    expect(capture).toHaveAccessibleDescription(/Ein anderer Lauf ist aktiv/);
    expect(screen.getByRole('button', { name: 'Weitere Optionen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Neue Notiz/ })).toBeEnabled();
    expect(within(screen.getByRole('region', { name: 'Laufanzeige' })).getByText(/Ein anderer Lauf ist aktiv \(capture, seit/)).toBeInTheDocument();
    expect(view.api.run.start).not.toHaveBeenCalled();
  });

  it('sperrt nur die KI-Aktion, wenn Claude nicht bereit ist, und lässt Nur aufnehmen zu', async () => {
    const user = userEvent.setup();
    await mount({ projects: [project({ claudeReady: false })] });
    const capture = screen.getByRole('button', { name: /Jetzt erfassen.*Claude/ });
    expect(capture).toBeDisabled();
    expect(capture).toHaveAccessibleDescription(/Claude ist nicht bereit/);
    expect(screen.getByRole('button', { name: 'Weitere Optionen' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Weitere Optionen' }));
    expect(screen.getByRole('menuitem', { name: 'Nur aufnehmen' })).toBeEnabled();
  });

  it('zeigt eine abgelehnte Anfrage als Hinweis, nicht als Fehler', async () => {
    const user = userEvent.setup();
    const view = await mount();
    view.api.run.start = vi.fn(async () => ({ ok: true as const, value: { ok: false as const, reason: 'write_run_active', message: 'Ein Lauf ist aktiv. Dieser Befehl ist gesperrt, bis er endet.' } }));
    await user.click(screen.getByRole('button', { name: /Jetzt erfassen.*Claude/ }));
    expect(await screen.findByText('Ein Lauf ist aktiv. Dieser Befehl ist gesperrt, bis er endet.')).toBeInTheDocument();
    expect(screen.getByText('Nicht gestartet')).toBeInTheDocument();
  });
});

describe('Laufanzeige: Ergebnisse (AK-10-36, AK-10-38)', () => {
  it('zeigt Erfolg mit Dauer, Snapshot, gekürzter Lauf-ID, Exit-Code und eingeklappter Ausgabe', async () => {
    const user = userEvent.setup();
    const view = await mount();
    await view.started();
    act(() => view.emitRun({ type: 'live', runKey: 'k1', line: { at: new Date().toISOString(), text: 'Snapshot S000006 gespeichert, 4 Dateizustände' } }));
    expect(document.querySelector('.runpanel__meta')).toHaveTextContent('Snapshot S000006');
    await view.finish(summaryOf({ output: 'Hinweis des CLI', result: captureResult() }));
    const panel = screen.getByRole('region', { name: 'Laufanzeige' });
    expect(within(panel).getByText('Lauf beendet')).toBeInTheDocument();
    expect(within(panel).getByText('Erfolg')).toBeInTheDocument();
    expect(panel).toHaveTextContent('Exit-Code 0: Erfolg');
    expect(within(panel).getByText('…d2e8')).toHaveAttribute('title', 'R20261126T100000Z-d2e8');
    expect(within(panel).queryByText('Hinweis des CLI')).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Ausgabe' }));
    expect(within(panel).getByText('Hinweis des CLI')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Schliessen' }));
    expect(within(panel).getByText('Kein Lauf aktiv.')).toBeInTheDocument();
  });

  it('zeigt Exit-Code 6 mit Chip, Klartext ohne erfundene Versuchszahl und führt zu den Work-Logs', async () => {
    const user = userEvent.setup();
    const view = await mount({ days: { [TODAY]: emptyDay(TODAY) } });
    await view.started();
    await view.finish(
      summaryOf({
        exitCode: 6,
        outcome: 'analysis_failed',
        errors: [{ code: 'analysis_failed', message: 'Die Analyse von S000006 ist nicht abgeschlossen.' }],
        result: captureResult({ analysis: { claudeCalls: 1, completed: [], failed: [{ snapshotId: 'S000006', code: 'timeout' }], open: [] } }),
      }),
    );
    const panel = screen.getByRole('region', { name: 'Laufanzeige' });
    expect(within(panel).getByText('KI-Schritt nicht abgeschlossen', { selector: '.chip' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('Snapshot S000006 ist gespeichert. Die Analyse wurde nicht abgeschlossen (S000006).');
    expect(panel).not.toHaveTextContent(/Versuch \d+ von/);
    await user.click(within(panel).getByRole('button', { name: 'Zu den Work-Logs' }));
    expect(view.app.store.getSnapshot().selection.page).toBe('day');
    expect(view.app.store.getSnapshot().dayTab).toBe('workLogs');
    expect(view.app.store.getSnapshot().focus?.snapshotId).toBe('S000006');
  });

  it('zeigt Exit-Code 3 als Hinweis mit "Aktiv seit" und unbekannte Codes ohne zu raten', async () => {
    const view = await mount();
    await view.started();
    await view.finish(summaryOf({ exitCode: 3, outcome: 'lock_held', lock: { command: 'capture', startedAt: '16:20' } }));
    const panel = screen.getByRole('region', { name: 'Laufanzeige' });
    expect(within(panel).getByText('Nicht gestartet')).toBeInTheDocument();
    expect(panel).toHaveTextContent('Dieser Start wurde nicht ausgeführt, es wurde nichts verändert.');
    expect(panel).toHaveTextContent('Aktiv seit 16:20');
    act(() => view.app.actions.dismissRun(REPO));
    await view.started();
    await view.finish(summaryOf({ exitCode: 42, errors: [{ code: 'x', message: 'Meldung des CLI' }] }));
    expect(panel).toHaveTextContent('Unbekannter Exit-Code');
    expect(panel).toHaveTextContent('Exit-Code 42');
  });

  it('zeigt kurze Befehle (Notiz, Prüfen) nicht im Panel', async () => {
    const view = await mount();
    await view.started('note', true, false);
    expect(screen.getByText('Kein Lauf aktiv.')).toBeInTheDocument();
  });
});

describe('Neue Notiz (AK-10-45 bis AK-10-48)', () => {
  const open = async (view?: FakeApiOptions) => {
    const user = userEvent.setup();
    const mounted = await mount(view);
    await user.click(screen.getByRole('button', { name: /Neue Notiz/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Neue Notiz' });
    return { user, view: mounted, dialog };
  };
  const save = (name = /Speichern/) => screen.getByRole('button', { name });
  const noteResult = (overrides: Partial<Extract<RunResultView, { kind: 'note' }>> = {}): RunResultView => ({
    kind: 'note',
    noteId: 'N1',
    type: 'activity',
    activityDay: '2026-10-14',
    time: { minutes: 45, basis: 'measured', start: '09:10', end: '09:55' },
    delay: null,
    secretFindings: [],
    ...overrides,
  });

  it('zeigt sechs Typkacheln, den Text mit Fokus und sperrt Speichern ohne Text', async () => {
    const { dialog } = await open();
    expect(within(dialog).getAllByRole('radio').map((tile) => tile.textContent)).toEqual(['Allgemein', 'Tätigkeit', 'Problem', 'Entscheidung', 'Erkenntnis', 'Planung']);
    expect(within(dialog).getByRole('radio', { name: 'Allgemein' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByRole('textbox', { name: /Text/ })).toHaveFocus();
    expect(save()).toBeDisabled();
    expect(dialog).toHaveTextContent('Speichern gesperrt: Der Text fehlt.');
    expect(dialog).toHaveTextContent(/heute/);
  });

  it('speichert mit Strg+Enter, übergibt den Text unverändert und zeigt danach nie den Text', async () => {
    const { user, view, dialog } = await open();
    const text = '--Käse "mit" Zeilen\nund & Sonderzeichen';
    await user.click(within(dialog).getByRole('radio', { name: 'Tätigkeit' }));
    await user.type(within(dialog).getByRole('textbox', { name: /Text/ }), text);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'note', text, type: 'activity', day: TODAY }]));
    act(() => view.emitRun({ type: 'started', runKey: 'k1', repositoryId: REPO, label: 'note', cancellable: false, ai: false, panel: false, startedAt: new Date().toISOString() }));
    await view.finish(summaryOf({ command: 'note', result: noteResult() }));
    const saved = await screen.findByRole('dialog', { name: 'Notiz gespeichert' });
    expect(saved).toHaveTextContent('Tätigkeit · Mittwoch, 14.10. · 09:10 bis 09:55 · gemessen');
    expect(saved).not.toHaveTextContent('Käse');
    expect(saved).not.toHaveTextContent('Zeilen');
    await user.click(within(saved).getByRole('button', { name: 'Im Zeitstrahl ansehen' }));
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-10-14');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bricht mit Esc ab, ohne zu starten', async () => {
    const { user, view } = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(view.api.run.start).not.toHaveBeenCalled();
  });

  it('lässt Zukunftstage nur bei Planung zu und setzt sie beim Typwechsel zurück', async () => {
    const { user, dialog } = await open();
    const picker = () => within(dialog).getByRole('button', { name: /^\w+, \d{2}\.\d{2}\.\d{4}/ });
    const nextMonthDays = async () => {
      await user.click(picker());
      const calendar = screen.getByRole('dialog', { name: 'Kalender' });
      await user.click(within(calendar).getByRole('button', { name: 'Folgemonat' }));
      return within(calendar).getAllByRole('button', { name: /^\w+, \d+\. \S+ \d{4}/ });
    };
    // Any other type: all days of next month are future days and locked.
    const locked = await nextMonthDays();
    expect(locked.length).toBeGreaterThan(27);
    expect(locked.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    await user.keyboard('{Escape}');
    // Planning: the same days are selectable; the label then says how far away the day is.
    await user.click(within(dialog).getByRole('radio', { name: 'Planung' }));
    const unlocked = await nextMonthDays();
    expect(unlocked.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    await user.click(unlocked[0] as HTMLElement);
    expect(picker()).toHaveTextContent(/· in \d+ Tagen?$/);
    // Back to another type: the future day is reset to today.
    await user.click(within(dialog).getByRole('radio', { name: 'Allgemein' }));
    expect(picker()).toHaveTextContent('· heute');
  });

  it('zeigt Zusatzfelder nur beim passenden Typ und verwirft ihre Werte beim Wechsel', async () => {
    const { user, view, dialog } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Mehr Felder' }));
    expect(within(dialog).queryByRole('textbox', { name: 'Grund' })).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: 'Entscheidung' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Grund' }), 'Weil schneller');
    await user.click(within(dialog).getByRole('button', { name: 'Alternative hinzufügen' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Alternative 1' }), 'Variante B');
    await user.click(within(dialog).getByRole('radio', { name: 'Problem' }));
    expect(within(dialog).queryByRole('textbox', { name: 'Grund' })).toBeNull();
    expect(within(dialog).getByRole('textbox', { name: 'Ursache' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Entscheidung' }));
    expect(within(dialog).getByRole('textbox', { name: 'Grund' })).toHaveValue('');
    expect(within(dialog).queryByRole('textbox', { name: 'Alternative 1' })).toBeNull();
    await user.type(within(dialog).getByRole('textbox', { name: 'Grund' }), 'Weil schneller');
    await user.click(within(dialog).getByRole('button', { name: 'Alternative hinzufügen' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Alternative 1' }), 'Variante B');
    await user.type(within(dialog).getByRole('textbox', { name: /Text/ }), 'Entscheid');
    await user.click(save());
    await waitFor(() => expect(lastStart(view)[1]).toMatchObject({ name: 'note', type: 'decision', reason: 'Weil schneller', alternatives: ['Variante B'] }));
  });

  it('verlangt gemessen oder geschätzt, sobald Zeit oder Verzögerung angegeben ist', async () => {
    const { user, view, dialog } = await open();
    await user.type(within(dialog).getByRole('textbox', { name: /Text/ }), 'Arbeit');
    await user.click(within(dialog).getByRole('button', { name: 'Mehr Felder' }));
    expect(within(dialog).queryByRole('radiogroup', { name: 'Gemessen oder geschätzt' })).toBeNull();
    await user.type(within(dialog).getByRole('textbox', { name: 'Minuten' }), '30');
    expect(within(dialog).getByRole('radiogroup', { name: 'Gemessen oder geschätzt' })).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(dialog).toHaveTextContent('Speichern gesperrt: Zeit ohne Basis');
    expect(dialog).toHaveTextContent('Bitte wählen: gemessen oder geschätzt. Ohne Auswahl lässt sich die Notiz nicht speichern.');
    await user.click(within(dialog).getByRole('radio', { name: 'Geschätzt' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Verzögerung' }), '5');
    await user.click(save());
    await waitFor(() => expect(lastStart(view)[1]).toMatchObject({ minutes: 30, timeKind: 'estimated', delay: 5 }));
  });

  it('rechnet Von–bis in Minuten, prüft Uhrzeit und Reihenfolge und kennt nie beides zugleich', async () => {
    const { user, view, dialog } = await open();
    await user.type(within(dialog).getByRole('textbox', { name: /Text/ }), 'Arbeit');
    await user.click(within(dialog).getByRole('button', { name: 'Mehr Felder' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Minuten' }), '30');
    await user.click(within(dialog).getByRole('radio', { name: 'Von–bis' }));
    expect(within(dialog).queryByRole('textbox', { name: 'Minuten' })).toBeNull();
    await user.type(within(dialog).getByRole('textbox', { name: /Von/ }), '9:10');
    expect(dialog).toHaveTextContent('Uhrzeit als HH:MM eingeben');
    await user.clear(within(dialog).getByRole('textbox', { name: /Von/ }));
    await user.type(within(dialog).getByRole('textbox', { name: /Von/ }), '10:00');
    await user.type(within(dialog).getByRole('textbox', { name: /Bis/ }), '09:00');
    expect(dialog).toHaveTextContent('Ende muss nach dem Beginn liegen');
    expect(save()).toBeDisabled();
    await user.clear(within(dialog).getByRole('textbox', { name: /Bis/ }));
    await user.type(within(dialog).getByRole('textbox', { name: /Bis/ }), '10:45');
    expect(dialog).toHaveTextContent('= 45 Minuten');
    expect(dialog).toHaveTextContent('Eine Tätigkeit über Mitternacht erfasst du als zwei Notizen.');
    await user.click(within(dialog).getByRole('radio', { name: 'Gemessen' }));
    await user.click(save());
    await waitFor(() => expect(lastStart(view)[1]).toEqual({ name: 'note', text: 'Arbeit', day: TODAY, start: '10:00', end: '10:45', timeKind: 'measured' }));
  });

  it('wählt Belege aus den Snapshots, durchsucht und gruppiert sie und gibt sie als refs weiter', async () => {
    const evidence: EvidenceGroup[] = [
      { snapshotId: 'S000002', title: 'S000002 · Analyse abgeschlossen', items: [{ ref: 'S000002:E001', id: 'E001', kind: 'state_delta', kindLabel: 'Zustandsänderung', path: 'src/app.ts', omitted: null }, { ref: 'S000002:E002', id: 'E002', kind: 'commit_message', kindLabel: 'Commit-Nachricht', path: null, omitted: null }] },
      { snapshotId: 'S000001', title: 'S000001 · Ausgangslage', items: [{ ref: 'S000001:E001', id: 'E001', kind: 'state_delta', kindLabel: 'Zustandsänderung', path: 'README.md', omitted: null }] },
    ];
    const { user, view, dialog } = await open({ evidence });
    await user.type(within(dialog).getByRole('textbox', { name: /Text/ }), 'Mit Belegen');
    await user.click(within(dialog).getByRole('button', { name: 'Mehr Felder' }));
    await user.click(within(dialog).getByRole('button', { name: /^Belege/ }));
    expect(await within(dialog).findByText('S000002 · Analyse abgeschlossen')).toBeInTheDocument();
    expect(within(dialog).getByText('S000001 · Ausgangslage')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('searchbox', { name: 'Belege durchsuchen' }), 'docker');
    expect(dialog).toHaveTextContent('Keine Belege gefunden. Für «docker» gibt es in den gespeicherten Snapshots keinen Beleg.');
    await user.click(within(dialog).getByRole('button', { name: 'Suche zurücksetzen' }));
    await user.click(within(dialog).getByRole('checkbox', { name: /S000002:E001/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /S000001:E001/ }));
    expect(dialog).toHaveTextContent('2 Belege gewählt');
    await user.click(save());
    await waitFor(() => expect(lastStart(view)[1]).toMatchObject({ refs: ['S000002:E001', 'S000001:E001'] }));
  });

  it('meldet einen möglichen Geheimwert nur mit Detektor und "nie an Claude"', async () => {
    const { user, view, dialog } = await open();
    await user.type(within(dialog).getByRole('textbox', { name: /Text/ }), `api_key = "${SECRET}"`);
    await user.click(save());
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalled());
    await view.finish(summaryOf({ command: 'note', result: noteResult({ type: 'general', activityDay: TODAY, time: null, secretFindings: [{ detector: 'assignment', field: 'text' }] }) }));
    const saved = await screen.findByRole('dialog', { name: 'Notiz gespeichert' });
    expect(saved).toHaveTextContent('Mögliches Zugangsdatum erkannt');
    expect(saved).toHaveTextContent('Zuweisung eines Geheimwerts (assignment)');
    expect(saved).toHaveTextContent('nie an Claude gesendet');
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('zeigt eine Ablehnung des CLI (Exit-Code 2) am Feld und bleibt offen', async () => {
    const { user, view, dialog } = await open();
    await user.type(within(dialog).getByRole('textbox', { name: /Text/ }), 'Etwas');
    await user.click(save());
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalled());
    await view.finish(summaryOf({ command: 'note', exitCode: 2, outcome: 'usage_error', errors: [{ code: 'note_invalid', message: 'Die Notiz ist ungültig.' }] }));
    expect(await within(dialog).findByText('Die Notiz ist ungültig.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Neue Notiz' })).toBeInTheDocument();
  });

  it('lehnt zu lange Texte vor dem Absenden ab', async () => {
    const { user, dialog } = await open();
    const box = within(dialog).getByRole('textbox', { name: /Text/ });
    await user.click(box);
    await user.paste('x'.repeat(8001));
    expect(dialog).toHaveTextContent('Der Text ist zu lang');
    expect(save()).toBeDisabled();
  });
});

const exhaustedDay = (): DayView =>
  emptyDay(TODAY, {
    snapshots: [snap('S000003', { status: 'exhausted', aiMode: 'none', attempts: { failed: 3, max: 3 }, lastErrorCode: 'timeout' }), snap('S000004', { status: 'pending', aiMode: 'none' }), snap('S000005', { status: 'complete' })],
  });
const workLogOf = (snapshot: SnapshotView): WorkLogView => ({ snapshot, state: 'ok', markdown: `# Work-Log ${snapshot.id}`, replacement: false });

describe('Dialoge Erneut versuchen, Überspringen, Ausgangspunkt (AK-10-41 bis AK-10-44)', () => {
  const day = (view?: FakeApiOptions): FakeApiOptions => {
    const days = exhaustedDay();
    return { days: { [TODAY]: days }, workLogs: Object.fromEntries(days.snapshots.map((snapshot) => [snapshot.id, workLogOf(snapshot)])), ...view };
  };
  const openLogs = async (options: FakeApiOptions = {}) => {
    const user = userEvent.setup();
    const view = await mount(day(options), { section: 'day', day: TODAY });
    await user.click(await screen.findByRole('tab', { name: /Work-Logs/ }));
    return { user, view };
  };

  it('bietet Erneut versuchen nur bei erschöpften und Überspringen nur bei offenen Analysen an', async () => {
    const { user } = await openLogs();
    await user.click(await screen.findByRole('button', { name: /S000003/ }));
    expect(await screen.findByRole('button', { name: /Erneut versuchen.*Claude/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Überspringen' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /S000004/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Erneut versuchen/ })).toBeNull());
    expect(screen.getByRole('button', { name: 'Überspringen' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /S000005/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Überspringen' })).toBeNull());
  });

  it('zeigt im Dialog Erneut versuchen Versuche, Fehlerklasse, den korrigierten Hinweis und startet capture --retry', async () => {
    const { user, view } = await openLogs();
    await user.click(await screen.findByRole('button', { name: /S000003/ }));
    await user.click(await screen.findByRole('button', { name: /Erneut versuchen.*Claude/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Analyse erneut versuchen' });
    expect(dialog).toHaveTextContent('Versuche 3 von 3 · alle verbraucht');
    expect(dialog).toHaveTextContent('Zeitüberschreitung beim KI-Schritt');
    expect(dialog).toHaveTextContent('Das löst einen Claude-Aufruf aus.');
    expect(dialog).toHaveTextContent('Zustandsänderungen des Snapshots');
    expect(dialog).not.toHaveTextContent('Diffs werden nie gesendet');
    expect(dialog).toHaveTextContent('Versuch 4, von Hand ausgelöst');
    expect(within(dialog).getByRole('button', { name: /Erneut versuchen.*Claude/ })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: /Erneut versuchen/ }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'capture', mode: 'retry', retrySnapshotId: 'S000003' }]));
  });

  it('verlangt einen Grund zum Überspringen, zeigt die Vorschau und startet skip', async () => {
    const { user, view } = await openLogs();
    await user.click(await screen.findByRole('button', { name: /S000004/ }));
    await user.click(await screen.findByRole('button', { name: 'Überspringen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Analyse überspringen' });
    const confirm = () => within(dialog).getByRole('button', { name: 'Überspringen' });
    expect(confirm()).toBeDisabled();
    expect(dialog).toHaveTextContent('Bestätigen gesperrt: Der Grund fehlt.');
    expect(dialog).toHaveTextContent('S000004 übersprungen. Zeitraum 12:00–14:00 ist nicht analysiert.');
    expect(dialog).toHaveTextContent('Die Lücke steht unter «Offene Analysen und Erfassungslücken».');
    await user.type(within(dialog).getByRole('textbox', { name: /Grund/ }), 'Bewusst ausgelassen');
    await waitFor(() => expect(confirm()).toBeEnabled());
    expect(dialog).toHaveTextContent('Grund: Bewusst ausgelassen');
    await user.click(confirm());
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'skip', snapshotId: 'S000004', reason: 'Bewusst ausgelassen' }]));
  });

  it('prüft den Grund vorab auf Geheimwerte, nennt nur den Detektor und sperrt das Absenden', async () => {
    const { user, view } = await openLogs({ detectors: (text) => (text.includes('api_key') ? ['assignment'] : []) });
    await user.click(await screen.findByRole('button', { name: /S000004/ }));
    await user.click(await screen.findByRole('button', { name: 'Überspringen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Analyse überspringen' });
    await user.type(within(dialog).getByRole('textbox', { name: /Grund/ }), `api_key = "${SECRET}"`);
    await waitFor(() => expect(dialog).toHaveTextContent('Bestätigen gesperrt: Der Grund enthält einen Geheimwert.'));
    expect(dialog).toHaveTextContent('Der Grund wurde nicht übernommen: Er enthält die Zuweisung eines Geheimwerts (Detektor assignment). Der Wert wird weder angezeigt noch gespeichert.');
    expect(within(dialog).getByRole('button', { name: 'Überspringen' })).toBeDisabled();
    // The value is in the field the user typed, never in a message or in the preview.
    expect(within(dialog).getByRole('textbox', { name: /Grund/ })).toHaveAttribute('aria-invalid', 'true');
    // The value stays in the field the user typed in; no message or preview shows it.
    const copy = dialog.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('textarea').forEach((field) => field.remove());
    expect(copy.textContent).not.toContain(SECRET);
    expect(view.api.run.start).not.toHaveBeenCalled();
  });

  it('zeigt den Halt-Dialog mit beiden Ständen und setzt den Ausgangspunkt mit Grund', async () => {
    const user = userEvent.setup();
    const halt = { reason: 'branch_changed' as const, detectedAt: '2026-11-26T10:00:00+01:00', expected: { branch: 'main', head: 'a41c9e2aaaaaaaa' }, observed: { branch: 'feature/x', head: 'b52d0f3bbbbbbbb' }, runId: null };
    const view = await mount({ projects: [project({ status: 'halt' })], overview: overview({ halt }) });
    await user.click((await screen.findAllByRole('button', { name: 'Neuen Ausgangspunkt setzen' }))[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Neuen Ausgangspunkt setzen' });
    await waitFor(() => expect(dialog).toHaveTextContent('b52d0f3'));
    expect(dialog).toHaveTextContent('a41c9e2');
    expect(dialog).toHaveTextContent('Das Repository selbst wird nicht verändert.');
    expect(dialog).toHaveTextContent('Änderungen ab a41c9e2 bis zum neuen Ausgangspunkt werden nicht analysiert.');
    const confirm = () => within(dialog).getByRole('button', { name: 'Ausgangspunkt setzen' });
    expect(confirm()).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /Grund/ }), 'Neuer Branch');
    await waitFor(() => expect(confirm()).toBeEnabled());
    await user.click(confirm());
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'baseline', reason: 'Neuer Branch' }]));
  });

  it('erreicht den Dialog ohne Halt nur über "Trotzdem setzen" im Bereich Erweitert und sendet --force', async () => {
    const user = userEvent.setup();
    const view = await mount({ overview: overview() });
    await user.click(await screen.findByText('Erweitert'));
    await user.click(screen.getByRole('button', { name: 'Trotzdem setzen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neuen Ausgangspunkt setzen' });
    await waitFor(() => expect(dialog).toHaveTextContent('Es ist kein Halt aktiv.'));
    await user.type(within(dialog).getByRole('textbox', { name: /Grund/ }), 'Absicht');
    const confirm = () => within(dialog).getByRole('button', { name: 'Ausgangspunkt setzen' });
    await waitFor(() => expect(confirm()).toBeEnabled());
    await user.click(confirm());
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'baseline', reason: 'Absicht', force: true }]));
  });

  it('zeigt die Ablehnung des CLI (Exit-Code 2) am Grund und lässt den Dialog offen', async () => {
    const { user, view } = await openLogs();
    await user.click(await screen.findByRole('button', { name: /S000004/ }));
    await user.click(await screen.findByRole('button', { name: 'Überspringen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Analyse überspringen' });
    await user.type(within(dialog).getByRole('textbox', { name: /Grund/ }), 'x');
    const confirm = () => within(dialog).getByRole('button', { name: 'Überspringen' });
    await waitFor(() => expect(confirm()).toBeEnabled());
    await user.click(confirm());
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalled());
    await view.finish(summaryOf({ command: 'skip', exitCode: 2, outcome: 'usage_error', errors: [{ code: 'reason_secret', message: 'Der Grund enthält einen möglichen Geheimwert (Detektor assignment).' }] }));
    expect(await within(dialog).findByText('Der Grund enthält einen möglichen Geheimwert (Detektor assignment).')).toBeInTheDocument();
  });
});

describe('Journal erzeugen (AK-10-40)', () => {
  const journalDay = (): DayView =>
    emptyDay(TODAY, { drafts: [{ file: `${TODAY}-R1`, runId: 'R20261126T091500Z-a001', day: TODAY, generatedAt: `${TODAY}T09:15:00+01:00`, mode: 'no_ai', time: '09:15' }] });

  it('startet Journal mit KI und ohne KI für den angezeigten Tag', async () => {
    const user = userEvent.setup();
    const view = await mount({ days: { [TODAY]: journalDay() } }, { section: 'day', day: TODAY });
    await user.click(await screen.findByRole('tab', { name: /Journal/ }));
    await user.click(await screen.findByRole('button', { name: /Journal erzeugen.*Claude/ }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'journal', day: TODAY }]));
    await view.finish(summaryOf({ command: 'journal', result: { kind: 'journal', day: TODAY, mode: 'ai', noAiReason: null, failure: null, draftWritten: true } }));
    await user.click(screen.getByRole('button', { name: 'Ohne KI erzeugen' }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'journal', day: TODAY, noAi: true }]));
    expect(screen.getByRole('button', { name: 'Ohne KI erzeugen' }).querySelector('[data-icon="spark"]')).toBeNull();
  });

  it('zeigt nach Exit-Code 6 den Zustand mit Erneut versuchen und Ohne KI erzeugen, der frühere Entwurf bleibt', async () => {
    const user = userEvent.setup();
    const view = await mount({ days: { [TODAY]: journalDay() } }, { section: 'day', day: TODAY });
    await user.click(await screen.findByRole('tab', { name: /Journal/ }));
    await user.click(await screen.findByRole('button', { name: /Journal erzeugen.*Claude/ }));
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalled());
    await view.finish(summaryOf({ command: 'journal', exitCode: 6, outcome: 'ai_failed', result: { kind: 'journal', day: TODAY, mode: null, noAiReason: null, failure: { code: 'timeout' }, draftWritten: false } }));
    const banner = await screen.findByText('KI-Schritt nicht abgeschlossen', { selector: '.banner__title' });
    const box = banner.closest('.banner') as HTMLElement;
    expect(box).toHaveTextContent('Exit-Code 6. Es wurde kein neuer Entwurf geschrieben.');
    expect(box).toHaveTextContent('Der Entwurf von 09:15 (ohne KI) bleibt unverändert erreichbar.');
    expect(within(box).getByRole('button', { name: /Erneut versuchen.*Claude/ })).toBeEnabled();
    expect(within(box).getByRole('button', { name: 'Ohne KI erzeugen' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Entwürfe' })).toHaveValue(`${TODAY}-R1`);
  });

  it('sperrt Journal erzeugen, solange ein Journal-Lauf aktiv ist', async () => {
    await mount({ days: { [TODAY]: journalDay() }, lock: { own: [{ runKey: 'k9', label: 'journal', ai: true, cancellable: true, kind: 'journal' }], foreign: null } }, { section: 'day', day: TODAY });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /Journal/ }));
    const ai = await screen.findByRole('button', { name: /Journal erzeugen.*Claude/ });
    expect(ai).toBeDisabled();
    expect(ai).toHaveAccessibleDescription(/Journal-Lauf ist aktiv/);
    expect(screen.getByRole('button', { name: 'Ohne KI erzeugen' })).toBeDisabled();
  });
});

describe('Endfassung übernehmen und löschen (spec §8.5, §4.3)', () => {
  const day = (): DayView =>
    emptyDay(TODAY, {
      drafts: [
        { file: `${TODAY}-R20261126T091500Z-a001`, runId: 'R20261126T091500Z-a001', day: TODAY, generatedAt: `${TODAY}T09:15:00+01:00`, mode: 'no_ai', time: '09:15' },
        { file: `${TODAY}-R20261126T104200Z-7f10`, runId: 'R20261126T104200Z-7f10', day: TODAY, generatedAt: `${TODAY}T10:42:00+01:00`, mode: 'ai', time: '10:42' },
      ],
    });
  const open = async (options: FakeApiOptions = {}) => {
    const user = userEvent.setup();
    const view = await mount({ days: { [TODAY]: day() }, ...options }, { section: 'day', day: TODAY });
    await user.click(await screen.findByRole('tab', { name: /Journal/ }));
    return { user, view };
  };

  it('übernimmt den gewählten Entwurf auf Klick als Endfassung und meldet den Dateinamen', async () => {
    const { user, view } = await open();
    await user.click(await screen.findByRole('button', { name: 'Als Endfassung übernehmen' }));
    await waitFor(() => expect(view.api.journal.finalize).toHaveBeenCalledWith(REPO, `${TODAY}-R20261126T104200Z-7f10`));
    expect(await screen.findByText(`Endfassung angelegt: journal/final/${TODAY}.md`)).toBeInTheDocument();
    expect(view.api.journal.remove).not.toHaveBeenCalled();
  });

  it('wählt man einen früheren Entwurf, übernimmt der Button genau diesen', async () => {
    const { user, view } = await open();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Entwürfe' }), `${TODAY}-R20261126T091500Z-a001`);
    await user.click(screen.getByRole('button', { name: 'Als Endfassung übernehmen' }));
    await waitFor(() => expect(view.api.journal.finalize).toHaveBeenCalledWith(REPO, `${TODAY}-R20261126T091500Z-a001`));
  });

  it('löscht einen Entwurf erst nach Rückfrage und nur in den Papierkorb', async () => {
    const { user, view } = await open();
    await user.click(await screen.findByRole('button', { name: 'Entwurf löschen' }));
    const dialog = screen.getByRole('dialog', { name: 'Entwurf löschen?' });
    expect(dialog).toHaveTextContent('Papierkorb');
    expect(view.api.journal.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(view.api.journal.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Entwurf löschen' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Entwurf löschen?' })).getByRole('button', { name: 'In den Papierkorb' }));
    await waitFor(() => expect(view.api.journal.remove).toHaveBeenCalledWith(REPO, 'draft', `${TODAY}-R20261126T104200Z-7f10`));
    expect(await screen.findByText('Entwurf in den Papierkorb verschoben.')).toBeInTheDocument();
  });

  it('listet Endfassungen des Tages, öffnet sie und löscht sie nach Rückfrage in den Papierkorb', async () => {
    const { user, view } = await open({ finals: { [TODAY]: [{ file: `${TODAY}.md`, modifiedAt: `${TODAY}T11:00:00Z` }, { file: `${TODAY} überarbeitet.md`, modifiedAt: `${TODAY}T12:00:00Z` }] } });
    const list = await screen.findByRole('list', { name: 'Endfassungen dieses Tages' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await user.click(within(within(list).getAllByRole('listitem')[0] as HTMLElement).getByRole('button', { name: 'Datei öffnen' }));
    expect(view.api.shell.open).toHaveBeenCalledWith(REPO, { kind: 'journalFinal', file: `${TODAY}.md` });
    await user.click(screen.getByRole('button', { name: `Endfassung ${TODAY}.md löschen` }));
    const dialog = screen.getByRole('dialog', { name: 'Endfassung löschen?' });
    expect(dialog).toHaveTextContent('deine eigene Arbeit');
    expect(view.api.journal.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'In den Papierkorb' }));
    await waitFor(() => expect(view.api.journal.remove).toHaveBeenCalledWith(REPO, 'final', `${TODAY}.md`));
    expect(await screen.findByText('Endfassung in den Papierkorb verschoben.')).toBeInTheDocument();
  });

  it('zeigt eine Meldung statt zu löschen, wenn der Papierkorb nicht geht', async () => {
    const { user, view } = await open();
    view.api.journal.remove = vi.fn(async () => ({ ok: true as const, value: { removed: false, problem: 'Die Datei liess sich nicht in den Papierkorb verschieben. Sie bleibt unverändert.' } }));
    await user.click(await screen.findByRole('button', { name: 'Entwurf löschen' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Entwurf löschen?' })).getByRole('button', { name: 'In den Papierkorb' }));
    expect(await screen.findByText(/Sie bleibt unverändert/)).toBeInTheDocument();
  });

  it('zeigt Endfassungen auch an einem Tag ohne Entwurf', async () => {
    const user = userEvent.setup();
    await mount({ days: { [TODAY]: emptyDay(TODAY) }, finals: { [TODAY]: [{ file: `${TODAY}.md`, modifiedAt: `${TODAY}T11:00:00Z` }] } }, { section: 'day', day: TODAY });
    await user.click(await screen.findByRole('tab', { name: /Journal/ }));
    expect(await screen.findByRole('list', { name: 'Endfassungen dieses Tages' })).toHaveTextContent(`${TODAY}.md`);
    expect(screen.getByText('Noch kein Journal für diesen Tag')).toBeInTheDocument();
  });
});

describe('Prüfen (AK-10-49)', () => {
  const doctor = (overrides: Partial<Extract<RunResultView, { kind: 'doctor' }>> = {}): RunResultView => ({
    kind: 'doctor',
    ok: true,
    checkedAt: '2026-11-26T10:00:00Z',
    git: { found: true, version: '2.47.1' },
    claude: { found: true, version: '2.1.4', loggedIn: true, authMethod: 'claude.ai' },
    billing: { detected: false, allowPaidUsage: false, blocked: false, sources: [] },
    findings: [],
    ...overrides,
  });

  it('prüft aus der Übersicht und zeigt Version und Anmeldeart ohne Modellaufruf', async () => {
    const user = userEvent.setup();
    const view = await mount({ overview: overview({ claude: { checkedAt: null, ok: false, version: null, problem: 'Die Anmeldung fehlt.' } }) });
    await user.click(await screen.findByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'doctor' }]));
    const dialog = await screen.findByRole('dialog', { name: 'Voraussetzungen prüfen' });
    expect(dialog).toHaveTextContent('Dabei wird Claude nicht aufgerufen.');
    await view.finish(summaryOf({ command: 'doctor', result: doctor() }));
    await waitFor(() => expect(dialog).toHaveTextContent('Version 2.1.4'));
    expect(dialog).toHaveTextContent('angemeldet, Art: claude.ai');
    expect(dialog).toHaveTextContent('Version 2.47.1');
  });

  it('listet bei Exit-Code 7 die fehlenden Voraussetzungen mit Abhilfe', async () => {
    const user = userEvent.setup();
    const view = await mount({ projects: [project({ claudeReady: false })] });
    await user.click((await screen.findAllByRole('button', { name: 'Prüfen' }))[0] as HTMLElement);
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalled());
    await view.finish(summaryOf({ command: 'doctor', exitCode: 7, outcome: 'error', result: doctor({ ok: false, claude: { found: true, version: '2.1.4', loggedIn: false, authMethod: null }, findings: ['Claude ist nicht angemeldet. Melde dich mit «claude» an.'] }) }));
    const dialog = await screen.findByRole('dialog', { name: 'Voraussetzungen prüfen' });
    await waitFor(() => expect(dialog).toHaveTextContent('Das fehlt noch'));
    expect(dialog).toHaveTextContent('Claude ist nicht angemeldet. Melde dich mit «claude» an.');
    expect(dialog).toHaveTextContent('nicht angemeldet');
    expect(dialog).toHaveTextContent('Voraussetzungen fehlen');
  });
});
