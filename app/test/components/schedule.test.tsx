import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/renderer/layout/AppShell';
import { createAppStore } from '../../src/renderer/store/appStore';
import type { ConfigPreview, RunHistoryEntry, ScheduleView } from '../../src/shared/config';
import type { RunSummary } from '../../src/shared/run';
import { createFakeApi, defaultPlan, project, type FakeApiOptions } from './fakeApi';

const REPO = 'alpha-111111';

const summaryOf = (overrides: Partial<RunSummary> = {}): RunSummary => ({ command: 'schedule install', exitCode: 0, outcome: 'ok', runId: 'R20261126T100000Z-d2e8', errors: [], warnings: [], output: '', failure: null, cancelled: false, result: null, lock: null, ...overrides });

async function mount(options: FakeApiOptions = {}) {
  const fake = createFakeApi({ projects: [project()], state: { repositoryId: REPO, section: 'schedule' }, ...options });
  const app = createAppStore(fake.api);
  render(<AppShell app={app} api={fake.api} />);
  await act(async () => app.actions.init());
  /** Answers the `run.start` the app just made. */
  const answer = (summary: RunSummary, runKey = 'k1') =>
    act(() => fake.emitRun({ type: 'finished', runKey, repositoryId: REPO, exitCode: summary.exitCode, cancelled: false, notice: null, failure: null, summary }));
  return { ...fake, app, answer };
}
const lastStart = (view: Awaited<ReturnType<typeof mount>>) => (view.api.run.start as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, unknown];
const status = (overrides: Partial<ScheduleView>): FakeApiOptions => ({ schedule: overrides });

describe('Zeitplan: Zustandskarte (AK-10-52)', () => {
  it.each([
    ['not_installed', 'Nicht eingerichtet', 'Für dieses Projekt läuft keine Windows-Aufgabe. Erfasst wird nur mit Jetzt erfassen.'],
    ['active', 'Aktiv', 'Die Windows-Aufgabe läuft nach Plan.'],
    ['paused', 'Pausiert', 'Es werden keine Läufe ausgelöst, bis du fortsetzt.'],
    ['stale', 'Veraltet', 'Trigger oder Pfade passen nicht mehr zur Konfiguration.'],
    ['error', 'Fehler', 'Die Aufgabe konnte nicht gelesen werden. Details in den Windows-Aufgaben.'],
  ] as const)('zeigt den Zustand %s mit Chip und Satz', async (state, label, text) => {
    await mount(status({ state }));
    const card = await screen.findByRole('region', { name: 'Zustand der Aufgabe' });
    expect(within(card).getByText(label)).toBeInTheDocument();
    expect(card).toHaveTextContent(text);
    expect(card).toHaveTextContent('ipa-assistant-alpha-111111');
  });

  it('nennt bei "veraltet" die Abweichungen in Klartext und zeigt unbekannte Läufe als "unbekannt"', async () => {
    await mount(status({ state: 'stale', differences: ['triggers', 'execution_time_limit'], nextRun: null, lastRun: null }));
    const card = await screen.findByRole('region', { name: 'Zustand der Aufgabe' });
    expect(card).toHaveTextContent('Zeitplan nicht mehr aktuell: Die Windows-Aufgabe passt nicht mehr zur Konfiguration (Trigger, Zeitlimit). Mit Aktualisieren wird sie angepasst. Bis dahin läuft der alte Plan weiter.');
    expect(card).toHaveTextContent(/Letzter Lauf\s*unbekannt/);
  });

  it('zeigt nächsten und letzten Lauf mit Wochentag, Datum und Zeit in der Zeitzone des Projekts', async () => {
    await mount(status({ state: 'active', nextRun: '2026-11-27T10:00:00+01:00', lastRun: '2026-11-26T08:00:00+01:00' }));
    const card = await screen.findByRole('region', { name: 'Zustand der Aufgabe' });
    expect(card).toHaveTextContent(/Nächster Lauf\s*Fr, 27\.11\.2026 10:00/);
    expect(card).toHaveTextContent(/Letzter Lauf\s*Do, 26\.11\.2026 08:00/);
  });

  it('zeigt den Fehlerzustand mit dem Detail des CLI, nie einen Absturz', async () => {
    await mount(status({ state: 'error', detail: 'Zugriff verweigert (schtasks)' }));
    expect(await screen.findByText('Zugriff verweigert (schtasks)')).toBeInTheDocument();
  });

  it('erklärt, dass der Zeitplan nur unter Windows verwaltet wird', async () => {
    await mount(status({ state: null, taskName: null, plan: null, problem: { kind: 'unsupported', message: 'Dieser Befehl braucht Windows.' } }));
    expect(await screen.findByText('Der Zeitplan wird nur unter Windows verwaltet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Einrichten' })).toBeNull();
  });

  it('hat je Zustand genau die richtige Hauptaktion', async () => {
    for (const [state, primary] of [['not_installed', 'Einrichten'], ['stale', 'Aktualisieren'], ['paused', 'Fortsetzen']] as const) {
      const view = await mount(status({ state }));
      const actions = await screen.findByRole('group', { name: 'Aktionen des Zeitplans' });
      expect(within(actions).getByRole('button', { name: primary })).toHaveClass('btn--primary');
      document.body.innerHTML = '';
      view.app.actions.dispose();
    }
    await mount(status({ state: 'active' }));
    const actions = await screen.findByRole('group', { name: 'Aktionen des Zeitplans' });
    expect(actions.querySelector('.btn--primary')).toBeNull();
  });
});

describe('Zeitplan: Formular (AK-10-53)', () => {
  it('zeigt Arbeitstage, Zeitfenster, Intervall und Zusatzläufe aus der Konfiguration in der Zeitzone des Projekts', async () => {
    await mount();
    const form = await screen.findByRole('form', { name: 'Zeitplan bearbeiten' });
    const days = within(within(form).getByRole('group', { name: 'Arbeitstage' })).getAllByRole('button');
    expect(days.map((day) => `${day.textContent}:${day.getAttribute('aria-pressed')}`)).toEqual(['Mo:true', 'Di:true', 'Mi:true', 'Do:true', 'Fr:true', 'Sa:false', 'So:false']);
    expect(within(form).getByRole('textbox', { name: /Zeitfenster von/ })).toHaveValue('08:00');
    expect(within(form).getByRole('textbox', { name: /Zeitfenster bis/ })).toHaveValue('18:00');
    expect(within(form).getByRole('textbox', { name: /Intervall/ })).toHaveValue('120');
    expect(within(form).getByRole('list', { name: 'Zusätzliche Läufe' })).toHaveTextContent('17:45');
    expect(form).toHaveTextContent('Alle Uhrzeiten gelten in der Zeitzone des Projekts: Europe/Zurich');
  });

  it('sperrt leere Arbeitstage mit Meldung am Feld und lässt Einrichten gesperrt', async () => {
    const user = userEvent.setup();
    await mount();
    const form = await screen.findByRole('form', { name: 'Zeitplan bearbeiten' });
    for (const name of ['Mo', 'Di', 'Mi', 'Do', 'Fr']) await user.click(within(form).getByRole('button', { name }));
    expect(form).toHaveTextContent('Mindestens ein Arbeitstag nötig. Ohne Arbeitstage lässt sich der Zeitplan nicht speichern.');
    expect(screen.getByRole('button', { name: 'Einrichten' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zeitplan speichern' })).toBeDisabled();
  });

  it('meldet ungültige Uhrzeiten, die Reihenfolge, das Intervall und Zusatzläufe in Klartext am Feld', async () => {
    const user = userEvent.setup();
    await mount();
    const form = await screen.findByRole('form', { name: 'Zeitplan bearbeiten' });
    const start = within(form).getByRole('textbox', { name: /Zeitfenster von/ });
    await user.clear(start);
    await user.type(start, '8.00');
    expect(form).toHaveTextContent('Beginn «8.00» ist keine gültige Uhrzeit. Bitte im Format HH:MM eingeben, zum Beispiel 08:00.');
    expect(start).toHaveAttribute('aria-invalid', 'true');
    await user.clear(start);
    await user.type(start, '19:00');
    expect(form).toHaveTextContent('Das Ende muss nach dem Beginn liegen.');
    await user.clear(start);
    await user.type(start, '08:00');
    const interval = within(form).getByRole('textbox', { name: /Intervall/ });
    await user.clear(interval);
    await user.type(interval, '0');
    expect(form).toHaveTextContent('Das Intervall muss eine ganze Zahl über 0 sein (Minuten).');
    await user.clear(interval);
    await user.type(interval, '60');
    await user.type(within(form).getByRole('textbox', { name: 'Neuer Zusatzlauf' }), '25:30');
    await user.click(within(form).getByRole('button', { name: 'Hinzufügen' }));
    expect(form).toHaveTextContent('Zusatzlauf «25:30» ist keine gültige Uhrzeit. Erlaubt sind 00:00 bis 23:59.');
  });

  it('speichert nur die geänderten Pfade des Blocks schedule mit config set', async () => {
    const user = userEvent.setup();
    const view = await mount();
    const form = await screen.findByRole('form', { name: 'Zeitplan bearbeiten' });
    const interval = within(form).getByRole('textbox', { name: /Intervall/ });
    await user.clear(interval);
    await user.type(interval, '90');
    expect(screen.getByText('Ungespeicherte Änderungen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Einrichten' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Zeitplan speichern' }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'configSet', changes: [{ path: 'schedule.intervalMinutes', value: 90 }] }]));
  });

  it('verwirft die Änderungen am Formular', async () => {
    const user = userEvent.setup();
    await mount();
    const form = await screen.findByRole('form', { name: 'Zeitplan bearbeiten' });
    await user.click(within(form).getByRole('button', { name: 'Sa' }));
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(within(form).getByRole('button', { name: 'Sa' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Zeitplan: Vorschau (AK-10-54)', () => {
  it('zeigt Startzeiten, die Obergrenze der Claude-Aufrufe und den vorsichtig mitgezählten Lauf am Fensterende', async () => {
    const view = await mount();
    const preview = await screen.findByRole('region', { name: 'Vorschau eines Arbeitstags' });
    await waitFor(() => expect(within(preview).getByRole('list', { name: 'Startzeiten' })).toHaveTextContent('08:00'));
    expect(within(preview).getAllByRole('listitem')).toHaveLength(7);
    expect(preview).toHaveTextContent('Höchstens 35 Claude-Aufrufe pro Arbeitstag');
    expect(preview).toHaveTextContent('7 Läufe × 5 Analysen pro Lauf. Ohne neue Arbeit ruft ein Lauf Claude gar nicht auf.');
    expect(within(preview).getByText('18:00').closest('[aria-describedby]')).not.toBeNull();
    // The app only asks the CLI; it calculates nothing itself.
    const call = (view.api.config.preview as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { path: string }[]];
    expect(call[1].map((change) => change.path)).toEqual(['schedule.workdays', 'schedule.windowStart', 'schedule.windowEnd', 'schedule.intervalMinutes', 'schedule.extraRunTimes']);
  });

  it('fragt entprellt und nur einmal nach schnellen Eingaben', async () => {
    const user = userEvent.setup();
    const view = await mount();
    const form = await screen.findByRole('form', { name: 'Zeitplan bearbeiten' });
    await waitFor(() => expect(view.api.config.preview).toHaveBeenCalledTimes(1));
    const interval = within(form).getByRole('textbox', { name: /Intervall/ });
    await user.clear(interval);
    await user.type(interval, '45');
    await waitFor(() => expect(view.api.config.preview).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(((view.api.config.preview as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, { path: string; value: unknown }[]])[1].find((change) => change.path === 'schedule.intervalMinutes')?.value).toBe(45);
  });

  it('zeigt die Warnungen des CLI', async () => {
    const preview: ConfigPreview = {
      valid: true,
      schedulePlan: { ...defaultPlan, workdays: [...defaultPlan.workdays] },
      failure: null,
      findings: [
        { severity: 'warning', code: 'schedule_extra_outside_window', path: '/schedule/extraRunTimes/0', message: 'Zusatzlauf 19:30 liegt ausserhalb des Zeitfensters 08:00–18:00.' },
        { severity: 'warning', code: 'claude_timeout_exceeds_reserve', path: '/claude/timeoutSeconds', message: 'Der Timeout pro Claude-Aufruf beträgt 900 s und damit mehr als 10 Minuten. Ein Lauf kann entsprechend lange dauern.' },
      ],
    };
    await mount({ preview: () => preview });
    const card = await screen.findByRole('region', { name: 'Vorschau eines Arbeitstags' });
    await waitFor(() => expect(card).toHaveTextContent('Zusatzlauf 19:30 liegt ausserhalb des Zeitfensters 08:00–18:00.'));
    expect(card).toHaveTextContent('Der Timeout pro Claude-Aufruf beträgt 900 s');
  });

  it('zeigt "Keine Startzeiten" bei ungültigen Angaben, ohne das CLI zu fragen', async () => {
    const user = userEvent.setup();
    const view = await mount();
    const form = await screen.findByRole('form', { name: 'Zeitplan bearbeiten' });
    await waitFor(() => expect(view.api.config.preview).toHaveBeenCalledTimes(1));
    const start = within(form).getByRole('textbox', { name: /Zeitfenster von/ });
    await user.clear(start);
    await user.type(start, 'abc');
    expect(await screen.findByText('Keine Startzeiten, solange die Angaben ungültig sind.')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(view.api.config.preview).toHaveBeenCalledTimes(1);
  });
});

describe('Zeitplan: Aktionen (AK-10-55)', () => {
  it('richtet ein und zeigt das Ergebnis aus dem CLI', async () => {
    const user = userEvent.setup();
    const view = await mount();
    await user.click(await screen.findByRole('button', { name: 'Einrichten' }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'scheduleInstall' }]));
    await view.answer(summaryOf({ result: { kind: 'schedule', action: 'install', changed: true, state: 'active', differences: [], detail: null, running: false, insideWindow: true } }));
    expect(await screen.findByText('Die Windows-Aufgabe ist eingerichtet.')).toBeInTheDocument();
  });

  it('zeigt "Schon so" als Hinweis, nicht als Fehler', async () => {
    const user = userEvent.setup();
    const view = await mount(status({ state: 'active' }));
    await user.click(await screen.findByRole('button', { name: 'Pausieren' }));
    await view.answer(summaryOf({ result: { kind: 'schedule', action: 'pause', changed: false, state: 'paused', differences: [], detail: null, running: false, insideWindow: null } }));
    const banner = (await screen.findByText('Schon so', { selector: '.banner__title' })).closest('.banner') as HTMLElement;
    expect(banner).toHaveTextContent('Schon so. Es gab nichts zu ändern.');
    expect(banner).not.toHaveAttribute('role', 'alert');
  });

  it('zeigt Fehler wie schtasks_failed mit der Meldung des CLI', async () => {
    const user = userEvent.setup();
    const view = await mount();
    await user.click(await screen.findByRole('button', { name: 'Einrichten' }));
    await view.answer(summaryOf({ exitCode: 1, outcome: 'error', errors: [{ code: 'schtasks_failed', message: 'schtasks meldete einen Fehler: Zugriff verweigert.' }] }));
    expect(await screen.findByText('schtasks meldete einen Fehler: Zugriff verweigert.')).toBeInTheDocument();
  });

  it('startet Aktualisieren, Fortsetzen und Pausieren mit den passenden Befehlen', async () => {
    const user = userEvent.setup();
    const view = await mount(status({ state: 'stale', differences: ['triggers'] }));
    await user.click(await screen.findByRole('button', { name: 'Aktualisieren' }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'scheduleInstall', update: true }]));
    await view.answer(summaryOf());
    await user.click(await screen.findByRole('button', { name: 'Pausieren' }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'schedulePause' }]));
  });

  it('sperrt Jetzt auslösen bei pausiert und Fehler mit dem Grund und trägt die KI-Markierung', async () => {
    const paused = await mount(status({ state: 'paused' }));
    const button = await screen.findByRole('button', { name: /Jetzt auslösen.*Claude/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Gesperrt: Zeitplan fortsetzen');
    expect(button.querySelector('[data-icon="spark"]')).not.toBeNull();
    document.body.innerHTML = '';
    paused.app.actions.dispose();
    await mount(status({ state: 'error' }));
    expect(await screen.findByRole('button', { name: /Jetzt auslösen.*Claude/ })).toBeDisabled();
  });

  it('weist vor dem Auslösen ausserhalb des Zeitfensters auf outside_window hin', async () => {
    const user = userEvent.setup();
    const view = await mount(status({ state: 'active', insideWindow: false }));
    await user.click(await screen.findByRole('button', { name: /Jetzt auslösen/ }));
    const dialog = screen.getByRole('dialog', { name: 'Ausserhalb des Zeitfensters' });
    expect(dialog).toHaveTextContent('endet ohne Aufnahme');
    expect(view.api.run.start).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Trotzdem auslösen' }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'scheduleRun' }]));
  });

  it('startet Jetzt auslösen innerhalb des Fensters ohne Rückfrage', async () => {
    const user = userEvent.setup();
    const view = await mount(status({ state: 'active', insideWindow: true }));
    await user.click(await screen.findByRole('button', { name: /Jetzt auslösen/ }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'scheduleRun' }]));
  });

  it('löscht erst nach Bestätigung im Dialog', async () => {
    const user = userEvent.setup();
    const view = await mount(status({ state: 'active' }));
    await user.click(await screen.findByRole('button', { name: 'Löschen' }));
    const dialog = screen.getByRole('dialog', { name: 'Zeitplan löschen?' });
    expect(dialog).toHaveTextContent('Die Windows-Aufgabe ipa-assistant-alpha-111111 wird entfernt.');
    expect(dialog).toHaveTextContent('Konfiguration, Snapshots, Notizen und der Lauf-Verlauf bleiben erhalten. Einrichten ist jederzeit wieder möglich.');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(view.api.run.start).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Zeitplan löschen?' })).getByRole('button', { name: 'Zeitplan löschen' }));
    await waitFor(() => expect(lastStart(view)).toEqual([REPO, { name: 'scheduleRemove' }]));
  });

  it('sperrt Jetzt auslösen, solange ein Lauf aktiv ist, und zeigt die Hinweise zur Aufgabe', async () => {
    await mount({ ...status({ state: 'active' }), lock: { own: [], foreign: { command: 'capture', startedAt: '16:20' } } });
    expect(await screen.findByRole('button', { name: /Jetzt auslösen/ })).toBeDisabled();
    expect(screen.getByText('Die Aufgabe läuft nur bei angemeldetem Benutzer. Verpasste Läufe werden nachgeholt.')).toBeInTheDocument();
    expect(screen.getByText('Ein geplanter Lauf erzeugt keine Arbeitszeit. Das Journal bleibt ein manueller Schritt.')).toBeInTheDocument();
  });
});

describe('Zeitplan: Lauf-Verlauf (AK-10-57)', () => {
  const run = (id: string, overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry => ({
    runId: `R20261126T${id}0000Z-ab${id}`,
    command: 'capture',
    startedAt: `2026-11-26T${id}:00:00+01:00`,
    time: `${id}:00`,
    day: '2026-11-26',
    outcome: 'ok',
    exitCode: 0,
    durationMs: 109_000,
    snapshotCreated: 'S000006',
    analysesCompleted: 1,
    analysesFailed: 0,
    ...overrides,
  });

  it('zeigt Zeit, Befehl, Ergebnis, Dauer, Snapshot und Analysen', async () => {
    await mount({ scheduleRuns: [run('10'), run('08', { outcome: 'analysis_failed', exitCode: 6, analysesCompleted: 0, analysesFailed: 1, snapshotCreated: null })] });
    const table = await screen.findByRole('table', { name: 'Lauf-Verlauf' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Zeit', 'Befehl', 'Ergebnis', 'Dauer', 'Snapshot', 'Analysen', 'Lauf']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('26.11. 10:00');
    expect(rows[0]).toHaveTextContent('1 min 49 s');
    expect(rows[0]).toHaveTextContent('1 abgeschlossen · 0 gescheitert');
    expect(rows[1]).toHaveTextContent('Analyse gescheitert');
    expect(within(rows[1] as HTMLElement).getByText('…ab08')).toBeDefined();
  });

  it('zeigt den Leerzustand', async () => {
    await mount({ scheduleRuns: [] });
    expect(await screen.findByText('Noch keine Läufe. Nach dem Einrichten erscheinen hier die geplanten und die manuellen Läufe.')).toBeInTheDocument();
  });
});
