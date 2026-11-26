import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/renderer/layout/AppShell';
import { createAppStore } from '../../src/renderer/store/appStore';
import type { ConfigPreview } from '../../src/shared/config';
import type { RunSummary } from '../../src/shared/run';
import { createFakeApi, defaultConfig, project, type FakeApiOptions } from './fakeApi';

const REPO = 'alpha-111111';
const summaryOf = (overrides: Partial<RunSummary> = {}): RunSummary => ({ command: 'config set', exitCode: 0, outcome: 'ok', runId: 'R20261126T100000Z-d2e8', errors: [], warnings: [], output: '', failure: null, cancelled: false, result: { kind: 'config', valid: true, findings: [], changedPaths: [], written: true }, lock: null, ...overrides });

async function mount(options: FakeApiOptions = {}) {
  const fake = createFakeApi({ projects: [project()], state: { repositoryId: REPO, section: 'config' }, ...options });
  const app = createAppStore(fake.api);
  render(<AppShell app={app} api={fake.api} />);
  await act(async () => app.actions.init());
  const answer = (summary: RunSummary, runKey = 'k1') =>
    act(() => fake.emitRun({ type: 'finished', runKey, repositoryId: REPO, exitCode: summary.exitCode, cancelled: false, notice: null, failure: null, summary }));
  const user = userEvent.setup();
  const group = async (name: string) => user.click(within(await screen.findByRole('navigation', { name: 'Gruppen der Konfiguration' })).getByRole('button', { name: new RegExp(`^${name}`) }));
  return { ...fake, app, answer, user, group };
}
type View = Awaited<ReturnType<typeof mount>>;
const lastStart = (view: View) => (view.api.run.start as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, { changes?: { path: string; value: unknown }[]; confirmPaidUsage?: boolean }];
const save = (view: View) => view.user.click(screen.getByRole('button', { name: 'Speichern' }));

describe('Konfiguration: Gerüst (AK-10-58)', () => {
  it('zeigt die acht Gruppen mit den Marken "erweitert" und "nur lesen" und öffnet config.json', async () => {
    const view = await mount();
    const nav = await screen.findByRole('navigation', { name: 'Gruppen der Konfiguration' });
    expect(within(nav).getAllByRole('button').map((button) => button.textContent)).toEqual(['Claude', 'Kostenschutz', 'Zeitplan', 'Dateifilter', 'Secrets', 'Kontext', 'Limitserweitert', 'Infonur lesen']);
    expect(within(nav).getByRole('button', { name: 'Claude' })).toHaveAttribute('aria-current', 'true');
    await view.user.click(screen.getByRole('button', { name: 'config.json öffnen' }));
    expect(view.api.shell.open).toHaveBeenCalledWith(REPO, { kind: 'config' });
  });

  it('startet ohne Änderungen mit gesperrtem Speichern und sagt, ab wann Änderungen gelten', async () => {
    await mount();
    const bar = await screen.findByRole('region', { name: 'Speichern' });
    expect(within(bar).getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: 'Verwerfen' })).toBeDisabled();
    expect(bar).toHaveTextContent('Änderungen gelten ab dem nächsten Lauf.');
  });

  it('weist bei laufendem Lauf darauf hin, dass die Änderung erst für den nächsten gilt', async () => {
    await mount({ lock: { own: [{ runKey: 'k9', label: 'capture', ai: true, cancellable: true, kind: 'write' }], foreign: null } });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Speichern' })).toHaveTextContent('Ein Lauf ist aktiv. Die Änderung gilt erst für den nächsten Lauf.'));
  });

  it('prüft Änderungen vor dem Speichern mit dem CLI und zeigt Befunde in Klartext am Feld', async () => {
    const preview = (changes: { path: string }[]): ConfigPreview => ({
      valid: !changes.some((change) => change.path === 'claude.maxAttemptsPerSnapshot'),
      findings: changes.some((change) => change.path === 'claude.maxAttemptsPerSnapshot') ? [{ severity: 'error', code: 'config_rule', path: '/claude/maxAttemptsPerSnapshot', message: 'muss mindestens 2 sein' }] : [],
      schedulePlan: null,
      failure: null,
    });
    const view = await mount({ preview });
    const field = await screen.findByRole('textbox', { name: /Versuche pro Snapshot/ });
    await view.user.clear(field);
    await view.user.type(field, '1');
    expect(await screen.findByText('muss mindestens 2 sein')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Speichern' })).toHaveTextContent('1 Fehler');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(view.api.run.start).not.toHaveBeenCalled();
  });

  it('speichert nur die geänderten Pfade und zeigt danach "gilt ab dem nächsten Lauf"', async () => {
    const view = await mount();
    const turns = await screen.findByRole('textbox', { name: /Maximale Gesprächsrunden/ });
    await view.user.clear(turns);
    await view.user.type(turns, '7');
    expect(screen.getByRole('region', { name: 'Speichern' })).toHaveTextContent('Ungespeicherte Änderungen');
    await save(view);
    await waitFor(() => expect(lastStart(view)[1]).toEqual({ name: 'configSet', changes: [{ path: 'claude.maxTurns', value: 7 }] }));
    await view.answer(summaryOf());
    expect(await screen.findByText('Gespeichert. Die Änderung gilt ab dem nächsten Lauf.')).toBeInTheDocument();
  });

  it('zeigt Fehler des CLI beim Speichern und lässt die Änderungen stehen', async () => {
    const view = await mount();
    const turns = await screen.findByRole('textbox', { name: /Maximale Gesprächsrunden/ });
    await view.user.clear(turns);
    await view.user.type(turns, '7');
    await save(view);
    await view.answer(summaryOf({ exitCode: 2, outcome: 'usage_error', errors: [{ code: 'config_rule', message: 'Die Konfiguration ist ungültig.' }], result: null }));
    expect(await screen.findByText(/Die Konfiguration ist ungültig\./)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Maximale Gesprächsrunden/ })).toHaveValue('7');
  });

  it('verwirft die Änderungen', async () => {
    const view = await mount();
    const turns = await screen.findByRole('textbox', { name: /Maximale Gesprächsrunden/ });
    await view.user.clear(turns);
    await view.user.type(turns, '9');
    await view.user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(screen.getByRole('textbox', { name: /Maximale Gesprächsrunden/ })).toHaveValue('5');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  it('zeigt bei ungültiger config.json die Befunde von config check und lässt nichts speichern', async () => {
    await mount({ config: { state: 'invalid', config: null, findings: [{ severity: 'error', code: 'config_rule', path: '/claude/maxTurns', message: 'muss mindestens 1 sein' }] } });
    expect(await screen.findByText('config.json ist nicht gültig')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Befunde von config check' })).toHaveTextContent('muss mindestens 1 sein');
    expect(screen.queryByRole('region', { name: 'Speichern' })).toBeNull();
    expect(screen.getByRole('button', { name: 'config.json öffnen' })).toBeInTheDocument();
  });
});

describe('Konfiguration: konkurrierende Änderungen (AK-10-67)', () => {
  async function dirty() {
    const view = await mount();
    const turns = await screen.findByRole('textbox', { name: /Maximale Gesprächsrunden/ });
    await view.user.clear(turns);
    await view.user.type(turns, '8');
    const changed = defaultConfig({ claude: { ...defaultConfig().claude, maxAttemptsPerSnapshot: 4 } });
    (view.api.config.read as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: true, value: { state: 'ok', config: changed, findings: [], signature: '2:2', workspaceInRepository: null, repoPath: 'C:/repos/alpha', workspacePath: 'C:/daten/ws', claude: null } }));
    act(() => view.emitChanged({ repositoryId: REPO, reason: 'workspace' }));
    return view;
  }

  it('fragt bei einer von Hand geänderten Datei, wenn ungespeicherte Änderungen offen sind, und lädt auf Wunsch neu', async () => {
    const view = await dirty();
    const dialog = await screen.findByRole('dialog', { name: 'Die Datei wurde zwischenzeitlich geändert' });
    await view.user.click(within(dialog).getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Versuche pro Snapshot/ })).toHaveValue('4'));
    expect(screen.getByRole('textbox', { name: /Maximale Gesprächsrunden/ })).toHaveValue('5');
  });

  it('behält auf Wunsch die eigenen Änderungen auf dem neuen Stand der Datei', async () => {
    const view = await dirty();
    const dialog = await screen.findByRole('dialog', { name: 'Die Datei wurde zwischenzeitlich geändert' });
    await view.user.click(within(dialog).getByRole('button', { name: 'Meine Änderungen behalten' }));
    expect(screen.getByRole('textbox', { name: /Maximale Gesprächsrunden/ })).toHaveValue('8');
    await save(view);
    // Only the user's own path is sent; the hand edit of the file is not touched.
    await waitFor(() => expect(lastStart(view)[1].changes).toEqual([{ path: 'claude.maxTurns', value: 8 }]));
  });

  it('übernimmt eine Änderung der Datei still, wenn nichts Ungespeichertes offen ist', async () => {
    const view = await mount();
    await screen.findByRole('textbox', { name: /Versuche pro Snapshot/ });
    const changed = defaultConfig({ claude: { ...defaultConfig().claude, maxAttemptsPerSnapshot: 6 } });
    (view.api.config.read as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: true, value: { state: 'ok', config: changed, findings: [], signature: '3:3', workspaceInRepository: null, repoPath: 'C:/repos/alpha', workspacePath: 'C:/daten/ws', claude: null } }));
    act(() => view.emitChanged({ repositoryId: REPO, reason: 'workspace' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Versuche pro Snapshot/ })).toHaveValue('6'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('führt config_changed beim Speichern zum selben Dialog', async () => {
    const view = await mount();
    const turns = await screen.findByRole('textbox', { name: /Maximale Gesprächsrunden/ });
    await view.user.clear(turns);
    await view.user.type(turns, '8');
    await save(view);
    await view.answer(summaryOf({ exitCode: 2, outcome: 'usage_error', errors: [{ code: 'config_changed', message: 'Die Datei wurde geändert.' }], result: null }));
    expect(await screen.findByRole('dialog', { name: 'Die Datei wurde zwischenzeitlich geändert' })).toBeInTheDocument();
  });
});

describe('Konfiguration: Gruppe Claude (AK-10-59)', () => {
  it('bietet den Standard ohne Modellnamen, die bekannten Modelle und ein freies Feld', async () => {
    const view = await mount();
    const select = await screen.findByRole('combobox', { name: 'Modell' });
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Standard von Claude Code', 'Claude Fable 5.2', 'Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Haiku 5.5', 'Anderes Modell']);
    expect(screen.getByText('Ohne eigene Wahl übergibt das Tool kein Modell, Claude Code nutzt seinen eigenen Standard.')).toBeInTheDocument();
    await view.user.selectOptions(select, 'claude-opus-5-5');
    expect(screen.getByText('Grössere Modelle verbrauchen in der Regel mehr Kontingent.')).toBeInTheDocument();
    await save(view);
    await waitFor(() => expect(lastStart(view)[1].changes).toEqual([{ path: 'claude.model', value: 'claude-opus-5-5' }]));
  });

  it('schreibt beim Zurück auf den Standard null, also kein --model', async () => {
    const view = await mount({ config: { config: defaultConfig({ claude: { ...defaultConfig().claude, model: 'claude-haiku-5-5' } }) } });
    const select = await screen.findByRole('combobox', { name: 'Modell' });
    expect(select).toHaveValue('claude-haiku-5-5');
    await view.user.selectOptions(select, '');
    await save(view);
    await waitFor(() => expect(lastStart(view)[1].changes).toEqual([{ path: 'claude.model', value: null }]));
  });

  it('nimmt einen freien Modellnamen an', async () => {
    const view = await mount();
    await view.user.selectOptions(await screen.findByRole('combobox', { name: 'Modell' }), 'custom');
    const free = await screen.findByRole('textbox', { name: 'Anderes Modell' });
    expect(screen.getByText('Modellname für neue Modelle eingeben')).toBeInTheDocument();
    await view.user.type(free, 'claude-neu-6');
    await save(view);
    await waitFor(() => expect(lastStart(view)[1].changes).toEqual([{ path: 'claude.model', value: 'claude-neu-6' }]));
  });

  it('prüft die vier Zahlenfelder mit Mindestwert 1 in Klartext und sperrt das Speichern', async () => {
    const view = await mount();
    for (const [label, name] of [['Timeout pro Aufruf', 'Timeout pro Aufruf'], ['Maximale Gesprächsrunden', 'Maximale Gesprächsrunden'], ['Versuche pro Snapshot', 'Versuche pro Snapshot'], ['Analysen pro Lauf', 'Analysen pro Lauf']] as const) {
      const field = await screen.findByRole('textbox', { name: new RegExp(label) });
      await view.user.clear(field);
      await view.user.type(field, '0');
      expect(screen.getByText(`${name}: ganze Zahl, mindestens 1. Der Wert 0 ist nicht erlaubt.`)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
      await view.user.clear(field);
      await view.user.type(field, '2');
    }
    await view.user.clear(screen.getByRole('textbox', { name: /Analysen pro Lauf/ }));
    await view.user.type(screen.getByRole('textbox', { name: /Analysen pro Lauf/ }), '1.5');
    expect(screen.getByText(/ist keine ganze Zahl/)).toBeInTheDocument();
  });

  it('zeigt den Stand der letzten Prüfung aus doctor.json und startet Prüfen', async () => {
    const view = await mount();
    const card = await screen.findByRole('region', { name: 'Prüfung von Claude' });
    expect(card).toHaveTextContent('bereit');
    expect(card).toHaveTextContent('Claude Code 2.1.4');
    expect(card).toHaveTextContent('Anmeldung über claude.ai');
    await view.user.click(within(card).getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(lastStart(view)[1]).toEqual({ name: 'doctor' }));
  });

  it('sagt "Noch nicht geprüft", wenn es keine doctor.json gibt', async () => {
    await mount({ config: { claude: null } });
    expect(await screen.findByText('Noch nicht geprüft')).toBeInTheDocument();
  });
});

describe('Konfiguration: Kostenschutz (AK-10-60)', () => {
  it('zeigt den Gefahrenbereich mit Standard Aus', async () => {
    const view = await mount();
    await view.group('Kostenschutz');
    expect(screen.getByText('Standard ist aus: Claude wird nur über das Abo genutzt.')).toBeInTheDocument();
    const area = screen.getByRole('region', { name: 'Gefahrenbereich' });
    expect(within(area).getByRole('switch')).not.toBeChecked();
    expect(area).toHaveTextContent('Aus');
  });

  it('verlangt zwei Schritte, Kontrollkästchen und «erlauben» und sendet --confirm-paid-usage nur im zweiten', async () => {
    const view = await mount();
    await view.group('Kostenschutz');
    await view.user.click(screen.getByRole('switch'));
    const step1 = screen.getByRole('dialog', { name: /Schritt 1 von 2/ });
    expect(step1).toHaveTextContent('Mit dieser Einstellung darf das Tool Claude auch über kostenpflichtige Wege aufrufen.');
    expect(step1).toHaveTextContent('Läufe nach Zeitplan zählen dazu.');
    expect(view.api.run.start).not.toHaveBeenCalled();
    await view.user.click(within(step1).getByRole('button', { name: 'Weiter' }));
    const step2 = screen.getByRole('dialog', { name: /Schritt 2 von 2/ });
    const confirm = () => within(step2).getByRole('button', { name: 'Kostenpflichtige Nutzung erlauben' });
    expect(confirm()).toBeDisabled();
    await view.user.click(within(step2).getByRole('checkbox'));
    expect(confirm()).toBeDisabled();
    await view.user.type(within(step2).getByRole('textbox'), 'ja');
    expect(confirm()).toBeDisabled();
    await view.user.clear(within(step2).getByRole('textbox'));
    await view.user.type(within(step2).getByRole('textbox'), 'erlauben');
    expect(confirm()).toBeEnabled();
    expect(view.api.run.start).not.toHaveBeenCalled();
    await view.user.click(confirm());
    await waitFor(() => expect(lastStart(view)[1]).toEqual({ name: 'configSet', changes: [{ path: 'claude.allowPaidUsage', value: true }], confirmPaidUsage: true }));
  });

  it('schreibt ohne Bestätigung nichts, wenn der Dialog abgebrochen wird', async () => {
    const view = await mount();
    await view.group('Kostenschutz');
    await view.user.click(screen.getByRole('switch'));
    await view.user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abbrechen' }));
    expect(view.api.run.start).not.toHaveBeenCalled();
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('zeigt eine Ablehnung des CLI im Dialog und lässt ihn offen', async () => {
    const view = await mount();
    await view.group('Kostenschutz');
    await view.user.click(screen.getByRole('switch'));
    await view.user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Weiter' }));
    const dialog = screen.getByRole('dialog', { name: /Schritt 2 von 2/ });
    await view.user.click(within(dialog).getByRole('checkbox'));
    await view.user.type(within(dialog).getByRole('textbox'), 'erlauben');
    await view.user.click(within(dialog).getByRole('button', { name: 'Kostenpflichtige Nutzung erlauben' }));
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalled());
    await view.answer(summaryOf({ exitCode: 2, outcome: 'usage_error', errors: [{ code: 'paid_usage_confirmation_required', message: 'Bestätigung fehlt.' }], result: null }));
    expect(await within(dialog).findByText(/Bestätigung fehlt\./)).toBeInTheDocument();
  });

  it('schaltet ohne Bestätigung und ohne Flag wieder aus, über die Speichern-Leiste', async () => {
    const view = await mount({ config: { config: defaultConfig({ claude: { ...defaultConfig().claude, allowPaidUsage: true } }) } });
    await view.group('Kostenschutz');
    expect(screen.getByRole('switch')).toBeChecked();
    await view.user.click(screen.getByRole('switch'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await save(view);
    await waitFor(() => expect(lastStart(view)[1]).toEqual({ name: 'configSet', changes: [{ path: 'claude.allowPaidUsage', value: false }] }));
  });

  it('zeigt erkannte kostenpflichtige Wege nur mit Namen', async () => {
    const view = await mount();
    await view.group('Kostenschutz');
    await view.user.click(within(screen.getByRole('region', { name: 'Erkannte kostenpflichtige Wege' })).getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalled());
    await view.answer(summaryOf({ command: 'doctor', result: { kind: 'doctor', ok: true, checkedAt: 'x', git: { found: true, version: '2' }, claude: { found: true, version: '1', loggedIn: true, authMethod: 'api' }, billing: { detected: true, allowPaidUsage: false, blocked: true, sources: ['ANTHROPIC_API_KEY'] }, findings: [] } }));
    expect(await screen.findByRole('list', { name: 'Erkannte Namen' })).toHaveTextContent('ANTHROPIC_API_KEY');
  });
});

describe('Konfiguration: Gruppe Zeitplan (AK-10-66)', () => {
  it('fasst den Zeitplan zusammen und verweist auf die Seite Zeitplan', async () => {
    const view = await mount();
    await view.group('Zeitplan');
    await waitFor(() => expect(screen.getByText(/Montag bis Freitag, 08:00 bis 18:00 · Europe\/Zurich · Alle 120 Minuten, zusätzlich 17:45\. Höchstens 35 Claude-Aufrufe pro Arbeitstag\./)).toBeInTheDocument());
    expect(screen.getByText('Es gibt nur eine Stelle für den Zeitplan: den Bereich Zeitplan. Dort lässt er sich bearbeiten, einrichten und pausieren.')).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Zum Zeitplan' }));
    expect(view.app.store.getSnapshot().selection.page).toBe('schedule');
  });

  it('zeigt bei Abweichung "Zeitplan nicht mehr aktuell" mit Aktualisieren', async () => {
    const view = await mount({ schedule: { state: 'stale', differences: ['triggers'] } });
    await view.group('Zeitplan');
    const banner = (await screen.findByText('Zeitplan nicht mehr aktuell', { selector: '.banner__title' })).closest('.banner') as HTMLElement;
    expect(banner).toHaveTextContent('Die Konfiguration wurde geändert, die Windows-Aufgabe läuft noch mit dem alten Plan.');
    await view.user.click(within(banner).getByRole('button', { name: 'Aktualisieren' }));
    await waitFor(() => expect(lastStart(view)[1]).toEqual({ name: 'scheduleInstall', update: true }));
  });
});

describe('Konfiguration: Dateifilter (AK-10-61)', () => {
  it('zeigt Einschliessen und Ausschliessen als Chips mit gesperrtem .git', async () => {
    const view = await mount();
    await view.group('Dateifilter');
    const exclude = screen.getByRole('list', { name: 'Ausschliessen' });
    expect(exclude).toHaveTextContent('.git');
    expect(within(exclude).queryByRole('button', { name: '.git entfernen' })).toBeNull();
    expect(within(exclude).getByText('.git').closest('.chip')).toHaveAttribute('title', 'Immer ausgeschlossen, nicht änderbar');
    expect(within(exclude).getByRole('button', { name: '*.log entfernen' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Einschliessen' })).toHaveTextContent('**');
    expect(screen.getByText('Gesperrte Chips lassen sich nicht entfernen.')).toBeInTheDocument();
  });

  it('sperrt auch den Arbeitsbereich im Repository', async () => {
    const view = await mount({ config: { workspaceInRepository: '.ipa' } });
    await view.group('Dateifilter');
    const exclude = screen.getByRole('list', { name: 'Ausschliessen' });
    expect(within(exclude).getByText('.ipa').closest('.chip')).toHaveAttribute('title', 'Arbeitsbereich im Repository, immer ausgeschlossen');
    expect(within(exclude).queryByRole('button', { name: '.ipa entfernen' })).toBeNull();
  });

  it('fügt Muster hinzu und entfernt sie, gespeichert wird die ganze Liste', async () => {
    const view = await mount();
    await view.group('Dateifilter');
    const include = screen.getByRole('list', { name: 'Einschliessen' }).closest('.field') as HTMLElement;
    await view.user.type(within(include).getByRole('textbox'), 'src/**{Enter}');
    expect(within(include).getByRole('list', { name: 'Einschliessen' })).toHaveTextContent('src/**');
    const exclude = screen.getByRole('list', { name: 'Ausschliessen' });
    await view.user.click(within(exclude).getByRole('button', { name: '*.log entfernen' }));
    await save(view);
    await waitFor(() =>
      expect(lastStart(view)[1].changes).toEqual([
        { path: 'paths.include', value: ['**', 'src/**'] },
        { path: 'paths.exclude', value: ['**/node_modules/**'] },
      ]),
    );
  });

  it('testet einen Pfad auf dem ungespeicherten Entwurf und nennt die Regel', async () => {
    const view = await mount({ testPath: ({ exclude, path }) => (exclude.includes('docs/**') && path.startsWith('docs/') ? { allowed: false, rule: 'docs/**' } : { allowed: true, rule: null }) });
    await view.group('Dateifilter');
    const exclude = screen.getByRole('list', { name: 'Ausschliessen' }).closest('.field') as HTMLElement;
    await view.user.type(within(exclude).getByRole('textbox'), 'docs/**');
    await view.user.click(within(exclude).getByRole('button', { name: '+ Muster' }));
    await view.user.type(screen.getByRole('textbox', { name: 'Pfad im Repository' }), 'docs/readme.md');
    const result = await screen.findByText('wird nicht erfasst');
    expect(result.closest('p')).toHaveTextContent('Regel docs/**');
    expect(view.api.config.testPath).toHaveBeenLastCalledWith(REPO, { include: ['**'], exclude: ['**/node_modules/**', '*.log', 'docs/**'], path: 'docs/readme.md' });
    await view.user.clear(screen.getByRole('textbox', { name: 'Pfad im Repository' }));
    await view.user.type(screen.getByRole('textbox', { name: 'Pfad im Repository' }), 'src/a.ts');
    expect(await screen.findByText('wird erfasst')).toBeInTheDocument();
  });
});

describe('Konfiguration: Secrets (AK-10-62)', () => {
  it('zeigt neun Detektoren als Schalter und warnt beim Abschalten', async () => {
    const view = await mount();
    await view.group('Secrets');
    const list = screen.getByRole('list', { name: 'Detektoren' });
    expect(within(list).getAllByRole('switch')).toHaveLength(9);
    expect(screen.getByText('Treffer werden zurückgehalten, nie angezeigt und nie an Claude gesendet. Angezeigt wird nur der Name des Detektors.')).toBeInTheDocument();
    await view.user.click(within(list).getByRole('switch', { name: /Zuweisung eines Geheimwerts/ }));
    expect(within(list).getByText('Abgeschaltet: Treffer dieses Detektors werden nicht mehr zurückgehalten und können an Claude gehen.')).toBeInTheDocument();
    await save(view);
    await waitFor(() => expect(lastStart(view)[1].changes).toEqual([{ path: 'secrets.disabledDetectors', value: ['assignment'] }]));
  });

  it('prüft eigene Muster auf Gültigkeit, testet sie ohne den Text zu zeigen und blockiert ungültige', async () => {
    const view = await mount({ config: { config: defaultConfig({ secrets: { extraPatterns: ['(unvollständig'], disabledDetectors: [] } }) } });
    await view.group('Secrets');
    expect(await screen.findByText(/Kein gültiger regulärer Ausdruck/, { selector: '.banner *' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Speichern' })).toHaveTextContent('1 Fehler');
    const field = screen.getByRole('textbox', { name: 'Neues Muster (regulärer Ausdruck)' });
    await view.user.type(field, '(offen');
    expect(screen.getByRole('button', { name: 'Neues Muster (regulärer Ausdruck)' })).toBeDisabled();
    await view.user.clear(field);
    await view.user.type(field, 'PROJ-[[0-9]+');
    await view.user.click(screen.getByRole('button', { name: 'Neues Muster (regulärer Ausdruck)' }));
    await view.user.click(within(screen.getByRole('list', { name: 'Reguläre Ausdrücke' })).getByRole('button', { name: '(unvollständig entfernen' }));
    await view.user.type(screen.getByRole('textbox', { name: 'Testtext' }), 'siehe PROJ-123');
    expect(screen.getByRole('list', { name: 'Testergebnis' })).toHaveTextContent('PROJ-[0-9]+: Treffer');
    await view.user.clear(screen.getByRole('textbox', { name: 'Testtext' }));
    await view.user.type(screen.getByRole('textbox', { name: 'Testtext' }), 'nichts');
    expect(screen.getByRole('list', { name: 'Testergebnis' })).toHaveTextContent('kein Treffer');
    expect(screen.getByRole('list', { name: 'Testergebnis' })).not.toHaveTextContent('nichts');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled());
  });
});

describe('Konfiguration: Kontext (AK-10-63)', () => {
  it('wählt Kontextdateien über den Dateidialog und entfernt sie', async () => {
    const view = await mount({ chosenFile: 'docs/aufgabe.md' });
    await view.group('Kontext');
    await view.user.click(screen.getByRole('button', { name: 'Datei wählen …' }));
    expect(await within(screen.getByRole('list', { name: 'Kontextdateien' })).findByText('docs/aufgabe.md')).toBeInTheDocument();
    await save(view);
    await waitFor(() => expect(lastStart(view)[1].changes).toEqual([{ path: 'context.files', value: ['docs/aufgabe.md'] }]));
  });

  it('nimmt nichts auf, wenn der Dateidialog abgebrochen wird', async () => {
    const view = await mount({ chosenFile: null });
    await view.group('Kontext');
    await view.user.click(screen.getByRole('button', { name: 'Datei wählen …' }));
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  it('erfasst Testberichte mit Pfad und Bezeichnung und verlangt beides', async () => {
    const view = await mount();
    await view.group('Kontext');
    await view.user.click(screen.getByRole('button', { name: 'Testbericht hinzufügen' }));
    expect(screen.getByRole('region', { name: 'Speichern' })).toHaveTextContent('1 Fehler');
    await view.user.type(screen.getByRole('textbox', { name: 'Pfad des Testberichts 1' }), 'reports/junit.xml');
    await view.user.type(screen.getByRole('textbox', { name: 'Bezeichnung des Testberichts 1' }), 'Unit-Tests');
    await save(view);
    await waitFor(() => expect(lastStart(view)[1].changes).toEqual([{ path: 'testReports', value: [{ path: 'reports/junit.xml', label: 'Unit-Tests' }] }]));
  });
});

describe('Konfiguration: Limits (AK-10-64)', () => {
  it('zeigt acht Felder mit Einheit und Standard in KiB und MiB', async () => {
    const view = await mount();
    await view.group('Limits');
    for (const [label, value, unit] of [['Grösste Datei', '256', 'KiB'], ['Grösster Snapshot', '10', 'MiB'], ['Grösste Analyse-Eingabe', '512', 'KiB'], ['Grösste Kontextdatei', '128', 'KiB'], ['Wiederholungen bei unruhigem Stand', '3', undefined], ['Wartezeit dazwischen', '2000', undefined], ['Höchstdauer eines Laufs', '1800', undefined]] as const) {
      expect(screen.getByRole('textbox', { name: label }), label).toHaveValue(value);
      if (unit !== undefined) expect(screen.getByRole('combobox', { name: `Einheit: ${label}` })).toHaveValue(unit);
    }
    expect(screen.getAllByRole('textbox')).toHaveLength(8);
    expect(screen.getByText('Standard 256 KiB')).toBeInTheDocument();
    expect(screen.getAllByText(/Standard/).length).toBeGreaterThanOrEqual(8);
  });

  it('rechnet ohne Rundungsfehler um und speichert in Bytes', async () => {
    const view = await mount();
    await view.group('Limits');
    const field = screen.getByRole('textbox', { name: 'Grösste Datei' });
    await view.user.clear(field);
    await view.user.type(field, '1.5');
    await view.user.selectOptions(screen.getByRole('combobox', { name: 'Einheit: Grösste Datei' }), 'MiB');
    await save(view);
    await waitFor(() => expect(lastStart(view)[1].changes).toEqual([{ path: 'limits.maxFileBytes', value: 1_572_864 }]));
  });

  it('lehnt Werte unter dem Mindestwert und Brüche eines Bytes ab', async () => {
    const view = await mount();
    await view.group('Limits');
    const field = screen.getByRole('textbox', { name: 'Grösste Datei' });
    await view.user.clear(field);
    await view.user.type(field, '0');
    expect(screen.getByText(/Grösste Datei: ganze Zahl, mindestens 1\. Der Wert 0 ist nicht erlaubt\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    await view.user.clear(field);
    await view.user.type(field, '0.0001');
    expect(screen.getByRole('region', { name: 'Speichern' })).toHaveTextContent('1 Fehler');
  });

  it('erlaubt 0 bei den Wiederholungen und setzt Felder auf den Standard zurück', async () => {
    const view = await mount({ config: { config: defaultConfig({ limits: { ...defaultConfig().limits, maxRunSeconds: 600 } }) } });
    await view.group('Limits');
    const retries = screen.getByRole('textbox', { name: 'Wiederholungen bei unruhigem Stand' });
    await view.user.clear(retries);
    await view.user.type(retries, '0');
    expect(screen.getByRole('region', { name: 'Speichern' })).toHaveTextContent('Ungespeicherte Änderungen');
    await view.user.click(screen.getByRole('button', { name: 'Höchstdauer eines Laufs auf Standard zurücksetzen' }));
    expect(screen.getByRole('textbox', { name: 'Höchstdauer eines Laufs' })).toHaveValue('1800');
    await save(view);
    await waitFor(() =>
      expect(lastStart(view)[1].changes).toEqual([
        { path: 'limits.stabilityRetries', value: 0 },
        { path: 'limits.maxRunSeconds', value: 1800 },
      ]),
    );
  });
});

describe('Konfiguration: Info (AK-10-65)', () => {
  it('zeigt nur lesbare Angaben mit Kopieren und dem Hinweis zur Zeitzone', async () => {
    const view = await mount();
    await view.group('Info');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    const info = screen.getByRole('region', { name: 'Info' });
    expect(info).toHaveTextContent('alpha-111111');
    expect(info).toHaveTextContent('Europe/Zurich');
    expect(info).toHaveTextContent('Die Zeitzone lässt sich nach der Einrichtung nicht mehr ändern.');
    await view.user.click(screen.getByRole('button', { name: 'Zeitzone kopieren' }));
    expect(view.api.shell.copy).toHaveBeenCalledWith('Europe/Zurich');
  });
});

describe('Sprung aus dem Work-Log (AK-10-25)', () => {
  it('öffnet die Konfiguration bei der Gruppe Limits', async () => {
    const view = await mount();
    act(() => view.app.actions.openConfig('limits'));
    expect(await screen.findByRole('textbox', { name: 'Grösste Datei' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Limits/ })).toHaveAttribute('aria-current', 'true');
  });
});
