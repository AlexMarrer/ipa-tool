import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/renderer/layout/AppShell';
import { createAppStore } from '../../src/renderer/store/appStore';
import type { InitOutcome, ProjectCheck, UsageRow } from '../../src/shared/project';
import type { RunSummary } from '../../src/shared/run';
import { createFakeApi, project, type FakeApiOptions } from './fakeApi';

const REPO = 'alpha-111111';
const check = (overrides: Partial<ProjectCheck> = {}, repository: Partial<ProjectCheck['repository']> = {}): ProjectCheck => ({
  repoPath: 'C:/repos/neu',
  dataRoot: { path: 'C:/daten', writable: true, exists: true, detail: null },
  repository: { isMainFolder: true, insideRepository: false, branch: 'main', head: '3c7d9a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ...repository },
  existing: null,
  gitVersion: '2.47.1',
  claude: null,
  ...overrides,
});

async function mount(options: FakeApiOptions = {}, page: 'add-project' | 'system' = 'add-project') {
  const fake = createFakeApi({ projects: [project()], state: { repositoryId: REPO }, ...options });
  const app = createAppStore(fake.api);
  render(<AppShell app={app} api={fake.api} />);
  await act(async () => app.actions.init());
  act(() => app.actions.selectPage(page));
  const user = userEvent.setup();
  return { ...fake, app, user };
}
type View = Awaited<ReturnType<typeof mount>>;
const choose = async (view: View) => view.user.click(await screen.findByRole('button', { name: 'Ordner wählen …' }));
const next = (view: View) => view.user.click(screen.getByRole('button', { name: 'Weiter' }));

describe('Assistent: Schritt 1 (AK-10-69)', () => {
  it('zeigt Schritt 1 von 4 und sperrt Weiter, bis ein Ordner geprüft ist', async () => {
    await mount();
    expect(await screen.findByText('Schritt 1 von 4: Ordner wählen')).toBeInTheDocument();
    expect(screen.getByText('Wähle den Hauptordner des Git-Repositorys, das du begleiten willst. Das Tool liest nur und verändert das Repository nie.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
  });

  it('zeigt die Prüfliste mit Datenwurzel, Git-Repository, Branch und HEAD, Git-Version und Claude', async () => {
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check() });
    await choose(view);
    const list = await screen.findByRole('list', { name: 'Prüfung des Ordners' });
    expect(list).toHaveTextContent('Datenwurzel');
    expect(list).toHaveTextContent('Beschreibbar · C:/daten');
    expect(list).toHaveTextContent('Ja · Branch main · HEAD 3c7d9a4');
    expect(list).toHaveTextContent(/Schon eingerichtet\s*Nein/);
    expect(list).toHaveTextContent('git 2.47.1');
    expect(list).toHaveTextContent('Wird nach dem Einrichten geprüft (init prüft Claude ohne Modellaufruf)');
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled();
  });

  it('zeigt den Stand von Claude aus der neuesten Prüfung', async () => {
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check({ claude: { ok: true, version: '2.1.4', authMethod: 'claude.ai', checkedAt: '2026-11-26T07:52:00Z' } }) });
    await choose(view);
    expect(await screen.findByRole('list', { name: 'Prüfung des Ordners' })).toHaveTextContent('Bereit · Claude Code 2.1.4 · Anmeldung über claude.ai');
  });

  it('lehnt einen Ordner ohne Git ab, sperrt Weiter und nennt den Grund', async () => {
    const view = await mount({ folder: 'C:/ohne', projectCheck: check({}, { isMainFolder: false, branch: null, head: null }) });
    await choose(view);
    expect(await screen.findByText('Dieser Ordner ist kein Git-Repository')).toBeInTheDocument();
    expect(screen.getByText(/Wähle den Hauptordner des Repositorys, also den Ordner, der/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
    expect(screen.getByText('Weiter gesperrt: Die Prüfung ist nicht bestanden.')).toBeInTheDocument();
  });

  it('erkennt ein bereits eingerichtetes Repository und wechselt zum Projekt', async () => {
    const view = await mount({ folder: 'C:/repos/alpha', projectCheck: check({ existing: { repositoryId: REPO } }) });
    await choose(view);
    expect(await screen.findByText('Dieses Repository ist bereits eingerichtet')).toBeInTheDocument();
    expect(screen.getByText('Ein Repository lässt sich nur einmal hinzufügen. Wechsle zum bestehenden Projekt.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
    await view.user.click(screen.getByRole('button', { name: `Zu ${REPO} wechseln` }));
    expect(view.app.store.getSnapshot().selection).toMatchObject({ repositoryId: REPO, page: 'overview' });
  });

  it('meldet eine nicht beschreibbare Datenwurzel mit Erneut prüfen und Ordner öffnen', async () => {
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check({ dataRoot: { path: 'C:/daten', writable: false, exists: true, detail: 'Nicht beschreibbar (EACCES).' } }) });
    await choose(view);
    expect(await screen.findByText('Das Tool kann in der Datenwurzel nichts speichern')).toBeInTheDocument();
    expect(screen.getByText(/Prüfe die Schreibrechte dieses Ordners und starte die Prüfung danach neu\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
    await view.user.click(screen.getByRole('button', { name: 'Ordner öffnen' }));
    expect(view.api.system.openDataRoot).toHaveBeenCalled();
    await view.user.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    await waitFor(() => expect(view.api.project.check).toHaveBeenCalledTimes(2));
  });

  it('nimmt nichts auf, wenn der Ordnerdialog abgebrochen wird', async () => {
    const view = await mount({ folder: null });
    await choose(view);
    expect(view.api.project.check).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
  });
});

describe('Assistent: Schritte 2 und 3 (AK-10-70, AK-10-71)', () => {
  const toStep2 = async (view: View) => {
    await choose(view);
    await screen.findByRole('list', { name: 'Prüfung des Ordners' });
    await next(view);
  };

  it('bietet die Zeitzone mit Standard Europe/Zurich, durchsuchbar, nur echte Namen', async () => {
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check() });
    await toStep2(view);
    expect(screen.getByText('Schritt 2 von 4: Einstellungen')).toBeInTheDocument();
    expect(screen.getByText('Europe/Zurich', { selector: 'strong' })).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: 'Zeitzone des Projekts' });
    await view.user.type(search, 'tokyo');
    expect(within(screen.getByRole('listbox', { name: 'Zeitzonen' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['Asia/Tokyo']);
    await view.user.selectOptions(screen.getByRole('listbox', { name: 'Zeitzonen' }), 'Asia/Tokyo');
    expect(screen.getByText('Asia/Tokyo', { selector: 'strong' })).toBeInTheDocument();
    await view.user.clear(search);
    await view.user.type(search, 'gibtesnicht');
    expect(screen.getByText('Keine Zeitzone gefunden. Versuche einen anderen Suchbegriff.')).toBeInTheDocument();
  });

  it('zeigt bei Arbeitsbereich im Repository den .gitignore-Hinweis mit Kopieren', async () => {
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check() });
    await toStep2(view);
    expect(screen.getByRole('radio', { name: /Standard \(empfohlen\)/ })).toBeChecked();
    await view.user.click(screen.getByRole('radio', { name: /Im Repository/ }));
    expect(screen.getByText(/Sonst erscheint der Arbeitsbereich im Repository als Änderung\./)).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Kopieren' }));
    expect(view.api.shell.copy).toHaveBeenCalledWith('.ipa/');
  });

  it('fasst in Schritt 3 zusammen und ändert das Repository nicht', async () => {
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check() });
    await toStep2(view);
    await next(view);
    const summary = await screen.findByRole('region', { name: 'Bestätigen' });
    expect(screen.getByText('Schritt 3 von 4: Bestätigen')).toBeInTheDocument();
    expect(summary).toHaveTextContent('C:/repos/neu');
    expect(summary).toHaveTextContent('Europe/Zurich');
    expect(summary).toHaveTextContent('S000001 · Ausgangslage, zählt nicht als Arbeit');
    expect(summary).toHaveTextContent('Der Ausgangs-Snapshot gilt nie als Arbeit.');
    expect(screen.getAllByText('Das Repository selbst wird nicht verändert.').length).toBeGreaterThan(0);
    expect(view.api.project.init).not.toHaveBeenCalled();
    await view.user.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(screen.getByText('Schritt 2 von 4: Einstellungen')).toBeInTheDocument();
  });

  it('richtet mit Zeitzone und Arbeitsbereich ein und zeigt das Ergebnis mit Claude-Prüfung', async () => {
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check() });
    await toStep2(view);
    await view.user.click(screen.getByRole('radio', { name: /Im Repository/ }));
    await next(view);
    await view.user.click(screen.getByRole('button', { name: 'Projekt einrichten' }));
    await waitFor(() => expect(view.api.project.init).toHaveBeenCalledWith({ timezone: 'Europe/Zurich', workspace: 'repository' }));
    const result = await screen.findByRole('region', { name: 'Ergebnis' });
    expect(screen.getByText('Schritt 4 von 4: Ergebnis')).toBeInTheDocument();
    expect(screen.getByText('Projekt eingerichtet')).toBeInTheDocument();
    expect(result).toHaveTextContent('neu-123456');
    expect(result).toHaveTextContent('S000001 · Ausgangslage');
    expect(result).toHaveTextContent('Bereit');
    expect(view.api.projects.list).toHaveBeenCalledTimes(2);
  });

  it('zeigt eine Warnung statt eines Fehlers, wenn Claude nicht bereit ist, und führt zu System', async () => {
    const outcome: InitOutcome = { exitCode: 0, errors: [], warnings: [], failure: null, result: { created: true, repositoryId: 'neu-123456', workspacePath: 'C:/w', workspaceMode: 'default', timezone: 'Europe/Zurich', baselineSnapshotId: 'S000001', claude: { checked: true, ok: false, cliVersion: null, problems: 'Die Anmeldung fehlt.' } } };
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check(), initOutcome: outcome });
    await toStep2(view);
    await next(view);
    await view.user.click(screen.getByRole('button', { name: 'Projekt einrichten' }));
    const banner = (await screen.findByText('Claude ist nicht bereit', { selector: '.banner__title' })).closest('.banner') as HTMLElement;
    expect(banner).toHaveTextContent('Die Anmeldung fehlt. Der Arbeitsbereich ist in beiden Fällen vollständig.');
    await view.user.click(within(banner).getByRole('button', { name: 'System öffnen' }));
    expect(view.app.store.getSnapshot().selection.page).toBe('system');
  });

  it('bleibt beim ersten Projekt im Ergebnis stehen, auch wenn die Projektliste dabei neu geladen wird', async () => {
    const view = await mount({ projects: [], folder: 'C:/repos/neu', projectCheck: check() });
    const init = view.api.project.init as ReturnType<typeof vi.fn>;
    const original = init.getMockImplementation() as ((...args: unknown[]) => unknown) | undefined;
    init.mockImplementation(async (...args: unknown[]) => {
      // The CLI has written the registry: the next list contains the project and the selection moves to it.
      view.setProjects([project({ repositoryId: 'neu-123456' })]);
      return original?.(...args);
    });
    await toStep2(view);
    await next(view);
    await view.user.click(screen.getByRole('button', { name: 'Projekt einrichten' }));
    expect(await screen.findByText('Projekt eingerichtet')).toBeInTheDocument();
    await waitFor(() => expect(view.app.store.getSnapshot().selection.repositoryId).toBe('neu-123456'));
    expect(screen.getByText('Schritt 4 von 4: Ergebnis')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zum Projekt' })).toBeInTheDocument();
  });

  it('bietet den Zeitplan an, ohne ihn einzurichten', async () => {
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check() });
    await toStep2(view);
    await next(view);
    await view.user.click(screen.getByRole('button', { name: 'Projekt einrichten' }));
    const offer = await screen.findByRole('region', { name: 'Zeitplan' });
    expect(offer).toHaveTextContent('Ein Zeitplan lässt das Tool regelmässig erfassen und analysieren, auch wenn die App geschlossen ist.');
    await view.user.click(within(offer).getByRole('button', { name: 'Zeitplan einrichten' }));
    expect(view.app.store.getSnapshot().selection.page).toBe('schedule');
    expect(view.api.run.start).not.toHaveBeenCalled();
  });

  it('wechselt mit Zum Projekt zur Übersicht des neuen Projekts', async () => {
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check() });
    await toStep2(view);
    await next(view);
    await view.user.click(screen.getByRole('button', { name: 'Projekt einrichten' }));
    await view.user.click(await screen.findByRole('button', { name: 'Zum Projekt' }));
    expect(view.app.store.getSnapshot().selection).toMatchObject({ repositoryId: 'neu-123456', page: 'overview' });
  });

  it('zeigt bei einem Fehler des CLI die Meldung (Exit-Code 2) und bietet Zurück an', async () => {
    const outcome: InitOutcome = { exitCode: 2, errors: [{ code: 'init_mismatch', message: 'Der Arbeitsbereich gehört zu einer anderen Zeitzone (UTC).' }], warnings: [], failure: null, result: null };
    const view = await mount({ folder: 'C:/repos/neu', projectCheck: check(), initOutcome: outcome });
    await toStep2(view);
    await next(view);
    await view.user.click(screen.getByRole('button', { name: 'Projekt einrichten' }));
    expect(await screen.findByText('Der Arbeitsbereich gehört zu einer anderen Zeitzone (UTC).')).toBeInTheDocument();
    expect(screen.getByText('Das Projekt wurde nicht eingerichtet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeInTheDocument();
  });
});

const row = (id: string, overrides: Partial<UsageRow> = {}): UsageRow => ({
  repositoryId: REPO,
  runId: `R2026112${id}T100000Z-ab0${id}`,
  day: '2026-11-26',
  time: '10:42',
  startedAt: new Date(Date.now() - Number(id) * 3_600_000).toISOString(),
  purpose: 'analysis',
  durationMs: 109_000,
  models: ['claude-sonnet-5-5'],
  outcome: 'success',
  costUsd: null,
  ...overrides,
});

describe('System: Claude (AK-10-72)', () => {
  const doctorSummary = (overrides: Record<string, unknown> = {}): RunSummary => ({
    command: 'doctor',
    exitCode: 0,
    outcome: 'ok',
    runId: 'R20261126T100000Z-d2e8',
    errors: [],
    warnings: [],
    output: '',
    failure: null,
    cancelled: false,
    lock: null,
    result: { kind: 'doctor', ok: true, checkedAt: '2026-11-26T10:00:00Z', git: { found: true, version: '2.47.1' }, claude: { found: true, version: '2.1.4', loggedIn: true, authMethod: 'claude.ai' }, billing: { detected: false, allowPaidUsage: false, blocked: false, sources: [] }, findings: [], ...overrides } as never,
  });
  const answer = (view: View, summary: RunSummary) => act(() => view.emitRun({ type: 'finished', runKey: 'k1', repositoryId: REPO, exitCode: summary.exitCode, cancelled: false, notice: null, failure: null, summary }));

  it('zeigt Zustand, Version und Anmeldeart und prüft ohne Modellaufruf', async () => {
    const view = await mount({}, 'system');
    const claude = await screen.findByRole('region', { name: 'Claude' });
    expect(claude).toHaveTextContent('bereit');
    expect(claude).toHaveTextContent('Claude Code 2.1.4');
    expect(claude).toHaveTextContent('Anmeldung über claude.ai');
    await view.user.click(within(claude).getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalledWith(REPO, { name: 'doctor' }));
    await answer(view, doctorSummary());
    await waitFor(() => expect(view.api.system.status).toHaveBeenCalledTimes(2));
  });

  it('zeigt den nicht-bereit-Zustand mit Abhilfe und sperrt den Live-Test', async () => {
    const view = await mount({ systemStatus: { check: { checkedAt: '2026-11-26T07:52:00Z', ok: false, claude: { found: true, version: '2.1.4', loggedIn: false, authMethod: null }, git: { found: true, version: '2.47.1' }, liveCheck: null } } }, 'system');
    const claude = await screen.findByRole('region', { name: 'Claude' });
    expect(claude).toHaveTextContent('nicht bereit');
    expect(claude).toHaveTextContent('Claude ist nicht angemeldet. Aufnehmen funktioniert weiter, Analysen und Journal mit KI sind gesperrt. Melde dich in Claude Code an und prüfe danach erneut.');
    const live = within(claude).getByRole('button', { name: /Live-Test/ });
    expect(live).toBeDisabled();
    expect(live).toHaveAccessibleDescription('Erst möglich, wenn Claude bereit ist.');
    expect(view.api.run.start).not.toHaveBeenCalled();
  });

  it('verlangt vor dem Live-Test zwei Schritte und nennt "zwei kurze Testaufrufe"', async () => {
    const view = await mount({}, 'system');
    const live = await screen.findByRole('button', { name: /Live-Test.*Claude/ });
    expect(live.querySelector('[data-icon="spark"]')).not.toBeNull();
    await view.user.click(live);
    const dialog = screen.getByRole('dialog', { name: 'Live-Test starten?' });
    expect(dialog).toHaveTextContent('zwei kurze Testaufrufe');
    expect(dialog).toHaveTextContent('Bei einer Anmeldung über Abo wird nichts abgerechnet.');
    expect(dialog).toHaveTextContent('keine Daten aus deinen Projekten');
    expect(dialog).not.toHaveTextContent('einen kurzen Testaufruf');
    await view.user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(view.api.run.start).not.toHaveBeenCalled();
    await view.user.click(live);
    await view.user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Weiter' }));
    const second = screen.getByRole('dialog', { name: 'Live-Test wirklich starten?' });
    const start = within(second).getByRole('button', { name: /Live-Test starten/ });
    expect(start).toBeDisabled();
    await view.user.click(within(second).getByRole('checkbox'));
    await view.user.click(start);
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalledWith(REPO, { name: 'doctor', live: true }));
    await answer(view, doctorSummary({ live: { ok: true } }));
    expect(await screen.findByText('Der Live-Test ist bestanden.')).toBeInTheDocument();
  });

  it('sperrt den Live-Test ohne Projekt und sagt, wann geprüft wird', async () => {
    await mount({ projects: [], systemStatus: { check: null } }, 'system');
    expect(await screen.findByText('Noch nicht geprüft')).toBeInTheDocument();
    expect(screen.getByText(/Claude wird nach dem Einrichten des ersten Projekts geprüft/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Live-Test/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Prüfen' })).toBeDisabled();
  });

  it('prüft im Kontext des gewählten Projekts, wenn es mehrere gibt', async () => {
    const view = await mount({ projects: [project(), project({ repositoryId: 'beta-222222' })] }, 'system');
    await view.user.selectOptions(await screen.findByRole('combobox', { name: 'Projekt für die Prüfung' }), 'beta-222222');
    await view.user.click(within(screen.getByRole('region', { name: 'Claude' })).getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalledWith('beta-222222', { name: 'doctor' }));
  });
});

describe('System: Git, Kostenschutz, Daten, Version (AK-10-73)', () => {
  const area = async (view: View, name: string) => view.user.click(within(await screen.findByRole('navigation', { name: 'Bereiche des Systems' })).getByRole('button', { name }));

  it('zeigt Git mit Version und dem Hinweis, dass es nie verändert', async () => {
    const view = await mount({}, 'system');
    await area(view, 'Git');
    const git = screen.getByRole('region', { name: 'Git' });
    expect(git).toHaveTextContent('Gefunden');
    expect(git).toHaveTextContent('git 2.47.1');
    expect(git).toHaveTextContent('Es verändert Repositorys nie.');
  });

  it('zeigt beim Kostenschutz erst "noch nicht geprüft", dann nichts erkannt oder den Befund nur mit Namen', async () => {
    const view = await mount({}, 'system');
    await area(view, 'Kostenschutz');
    expect(screen.getByText('Noch nicht geprüft')).toBeInTheDocument();
    await area(view, 'Claude');
    await view.user.click(within(screen.getByRole('region', { name: 'Claude' })).getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalled());
    act(() =>
      view.emitRun({
        type: 'finished',
        runKey: 'k1',
        repositoryId: REPO,
        exitCode: 0,
        cancelled: false,
        notice: null,
        failure: null,
        summary: { command: 'doctor', exitCode: 0, outcome: 'ok', runId: null, errors: [], warnings: [], output: '', failure: null, cancelled: false, lock: null, result: { kind: 'doctor', ok: true, checkedAt: 'x', git: { found: true, version: '2' }, claude: { found: true, version: '1', loggedIn: true, authMethod: 'api' }, billing: { detected: true, allowPaidUsage: false, blocked: true, sources: ['ANTHROPIC_API_KEY'] }, findings: [] } },
      }),
    );
    await area(view, 'Kostenschutz');
    const cost = await screen.findByRole('region', { name: 'Kostenschutz' });
    expect(cost).toHaveTextContent('Kostenpflichtiger Weg erkannt');
    expect(within(cost).getByRole('list', { name: 'Erkannte Namen' })).toHaveTextContent('ANTHROPIC_API_KEY');
    expect(cost).toHaveTextContent('Variablen entfernen.');
    expect(cost).toHaveTextContent('Oder bewusst erlauben.');
    await view.user.click(within(cost).getByRole('button', { name: 'Kostenschutz in der Konfiguration öffnen' }));
    expect(view.app.store.getSnapshot()).toMatchObject({ configGroup: 'cost' });
    expect(view.app.store.getSnapshot().selection.page).toBe('config');
  });

  it('zeigt nichts erkannt als ruhigen Hinweis', async () => {
    const view = await mount({}, 'system');
    await view.user.click(within(await screen.findByRole('region', { name: 'Claude' })).getByRole('button', { name: 'Prüfen' }));
    await waitFor(() => expect(view.api.run.start).toHaveBeenCalled());
    act(() =>
      view.emitRun({
        type: 'finished',
        runKey: 'k1',
        repositoryId: REPO,
        exitCode: 0,
        cancelled: false,
        notice: null,
        failure: null,
        summary: { command: 'doctor', exitCode: 0, outcome: 'ok', runId: null, errors: [], warnings: [], output: '', failure: null, cancelled: false, lock: null, result: { kind: 'doctor', ok: true, checkedAt: 'x', git: { found: true, version: '2' }, claude: { found: true, version: '1', loggedIn: true, authMethod: 'claude.ai' }, billing: { detected: false, allowPaidUsage: false, blocked: false, sources: [] }, findings: [] } },
      }),
    );
    await area(view, 'Kostenschutz');
    expect(await screen.findByText('Kein kostenpflichtiger Weg erkannt')).toBeInTheDocument();
  });

  it('zeigt die Datenwurzel mit Öffnen, Kopieren und dem Hinweis, dass nichts gesichert wird', async () => {
    const view = await mount({ systemStatus: { workspacesInRepository: ['im-repo-123456'] } }, 'system');
    await area(view, 'Daten');
    const data = screen.getByRole('region', { name: 'Daten' });
    expect(data).toHaveTextContent('Datenwurzel C:/daten');
    expect(data).toHaveTextContent('Das Tool sichert nichts.');
    expect(data).toHaveTextContent('im-repo-123456');
    await view.user.click(within(data).getByRole('button', { name: 'Ordner öffnen' }));
    expect(view.api.system.openDataRoot).toHaveBeenCalled();
    await view.user.click(within(data).getByRole('button', { name: 'Pfad kopieren' }));
    expect(view.api.system.copyDataRoot).toHaveBeenCalled();
  });

  it('zeigt App, CLI und Node und kopiert die Angaben', async () => {
    const view = await mount({}, 'system');
    await area(view, 'Version');
    const version = screen.getByRole('region', { name: 'Version' });
    expect(version).toHaveTextContent('IPA Assistant 0.1.0');
    expect(version).toHaveTextContent('ipa 0.1.0');
    expect(version).toHaveTextContent('Node (mitgeliefert)');
    await view.user.click(within(version).getByRole('button', { name: 'Kopieren' }));
    expect(view.api.shell.copy).toHaveBeenCalledWith(expect.stringContaining('CLI ipa 0.1.0'));
  });
});

describe('System: Verbrauch (AK-10-74)', () => {
  const open = async (usage: UsageRow[]) => {
    const view = await mount({ usage }, 'system');
    await view.user.click(within(await screen.findByRole('navigation', { name: 'Bereiche des Systems' })).getByRole('button', { name: 'Verbrauch' }));
    return view;
  };

  it('zeigt Aufrufe je Tag mit Zweck, Dauer, Modell, Ergebnis und Richtwert, "–" für unbekannt', async () => {
    await open([row('1'), row('2', { purpose: 'journal', costUsd: 0.12 }), row('3', { outcome: 'claude_error' })]);
    const usage = screen.getByRole('region', { name: 'Verbrauch' });
    expect(usage).toHaveTextContent('3 Aufrufe · Richtwert 0.12 USD');
    const table = within(usage).getByRole('table', { name: /Aufrufe am 2026-11-26/ });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Zeit', 'Projekt', 'Zweck', 'Dauer', 'Modell', 'Ergebnis', 'Richtwert']);
    expect(table).toHaveTextContent('Analyse');
    expect(table).toHaveTextContent('Journal');
    expect(table).toHaveTextContent('1 min 49 s');
    expect(table).toHaveTextContent('claude-sonnet-5-5');
    expect(table).toHaveTextContent('Fehler von Claude');
    expect(table).toHaveTextContent('0.12 USD');
    expect(table).toHaveTextContent('–');
    expect(usage).toHaveTextContent('Ein Richtwert ist keine Rechnung.');
  });

  it('wählt den Zeitraum und zeigt einen Leerzustand', async () => {
    const view = await open([row('1', { startedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() })]);
    expect(await screen.findByText('Keine Claude-Aufrufe in diesem Zeitraum.')).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: '30 Tage' }));
    await waitFor(() => expect(view.api.system.usage).toHaveBeenLastCalledWith('30'));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Alle' }));
    await waitFor(() => expect(view.api.system.usage).toHaveBeenLastCalledWith('all'));
  });

  it('zeigt kein Prompt und keine Antwort', async () => {
    await open([row('1')]);
    expect(document.body.textContent).not.toMatch(/prompt|inputSha256|Antworttext/i);
  });
});
