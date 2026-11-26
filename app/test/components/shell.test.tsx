import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/renderer/layout/AppShell';
import { createAppStore } from '../../src/renderer/store/appStore';
import { APP_ROOT } from '../helpers/env';
import { createFakeApi, project, type FakeApiOptions } from './fakeApi';

async function mount(options: FakeApiOptions = {}, storeOptions: Parameters<typeof createAppStore>[1] = {}) {
  const fake = createFakeApi(options);
  const app = createAppStore(fake.api, storeOptions);
  render(<AppShell app={app} api={fake.api} />);
  await act(async () => app.actions.init());
  return { ...fake, app };
}

afterEach(() => vi.useRealTimers());

describe('Projektliste in der Seitenleiste (AK-10-09)', () => {
  it('zeigt "Noch kein Projekt" mit der Hauptaktion, wenn die Liste leer ist', async () => {
    await mount();
    expect(screen.getAllByText('Noch kein Projekt').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Projekt hinzufügen/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('navigation', { name: 'Bereiche' })).toBeNull();
  });

  it('zeigt Name, Kurzhinweis und Status mit Textalternative', async () => {
    await mount({
      projects: [
        project(),
        project({ repositoryId: 'beta-222222', status: 'warning', hint: '2 offene Analysen' }),
        project({ repositoryId: 'gamma-333333', status: 'halt', hint: 'Halt' }),
        project({ repositoryId: 'delta-444444', status: 'error', hint: 'Fehler: Repository fehlt' }),
      ],
      state: { repositoryId: 'alpha-111111' },
    });
    const sidebar = screen.getByRole('navigation', { name: 'Projekte' });
    for (const [name, label] of [['alpha-111111', 'In Ordnung'], ['beta-222222', 'Warnung'], ['gamma-333333', 'Halt'], ['delta-444444', 'Fehler']]) {
      const row = within(sidebar).getByRole('button', { name: new RegExp(name as string) });
      expect(within(row).getByRole('img', { name: label })).toBeInTheDocument();
    }
    expect(within(sidebar).getByText('2 offene Analysen')).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: /alpha-111111/ })).toHaveAttribute('aria-current', 'true');
    // Project names are sans-serif, never monospace (spec §10.2).
    expect(within(sidebar).getByText('alpha-111111')).not.toHaveClass('mono');
  });

  it('zeigt die Projektliste auch bei ungültiger Registry bedienbar mit Fehlerbanner und Pfad', async () => {
    await mount({ registry: { state: 'invalid', path: 'C:/daten/registry.json', detail: 'Schemafehler: /repositories' }, projects: [] });
    expect(screen.getByRole('alert')).toHaveTextContent('Die Projektliste ist nicht lesbar');
    expect(screen.getByText(/C:\/daten\/registry.json/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /System/ })).toBeEnabled();
  });

  it('zeigt ein Projekt mit fehlendem Repository als "nicht lesbar" mit Pfad', async () => {
    await mount({ projects: [project({ status: 'error', hint: 'Fehler: Repository fehlt' })], state: { repositoryId: 'alpha-111111' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Dieses Projekt ist nicht lesbar');
    expect(screen.getByText(/C:\/repos\/alpha/)).toBeInTheDocument();
  });

  it('zeigt bei einem Halt den roten Banner', async () => {
    await mount({ projects: [project({ status: 'halt', hint: 'Halt' })], state: { repositoryId: 'alpha-111111' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Zuordnung angehalten');
  });

  it('lädt neu, wenn die Beobachtung eine Änderung meldet', async () => {
    const view = await mount({ projects: [project()], state: { repositoryId: 'alpha-111111' } });
    expect(screen.getAllByRole('img', { name: 'In Ordnung' }).length).toBeGreaterThan(0);
    view.setProjects([project({ status: 'warning', hint: '1 offene Analyse' })]);
    act(() => view.emitChanged({ repositoryId: 'alpha-111111', reason: 'workspace' }));
    await waitFor(() => expect(screen.getByText('1 offene Analyse')).toBeInTheDocument());
    expect(screen.getAllByRole('img', { name: 'Warnung' }).length).toBeGreaterThan(0);
  });
});

describe('Layout und Navigation (AK-10-10)', () => {
  it('hat Seitenleiste 232 px, Mindestgrösse 1100 x 700 und vier Bereiche', async () => {
    const css = readFileSync(path.join(APP_ROOT, 'src', 'renderer', 'layout', 'layout.css'), 'utf8');
    expect(css).toContain('grid-template-columns: 232px');
    expect(css).toContain('min-width: 1100px');
    expect(css).toContain('min-height: 700px');
    await mount({ projects: [project()], state: { repositoryId: 'alpha-111111' } });
    const nav = screen.getByRole('navigation', { name: 'Bereiche' });
    expect(within(nav).getAllByRole('button').map((button) => button.textContent)).toEqual(['Übersicht', 'Tag', 'Zeitplan', 'Konfiguration']);
    expect(within(nav).getByRole('button', { name: 'Übersicht' })).toHaveAttribute('aria-current', 'page');
  });

  it('wechselt den Bereich, behält Projekt und Tag und speichert die Auswahl', async () => {
    const user = userEvent.setup();
    const view = await mount({ projects: [project(), project({ repositoryId: 'beta-222222' })], state: { repositoryId: 'alpha-111111', day: '2026-11-20' } });
    const nav = screen.getByRole('navigation', { name: 'Bereiche' });
    await user.click(within(nav).getByRole('button', { name: 'Tag' }));
    expect(within(nav).getByRole('button', { name: 'Tag' })).toHaveAttribute('aria-current', 'page');
    await user.click(within(screen.getByRole('navigation', { name: 'Projekte' })).getByRole('button', { name: /beta-222222/ }));
    const selection = view.app.store.getSnapshot().selection;
    expect(selection).toMatchObject({ repositoryId: 'beta-222222', page: 'day', day: '2026-11-20' });
    expect(view.api.app.setState).toHaveBeenLastCalledWith({ selection: { repositoryId: 'beta-222222', section: 'day', day: '2026-11-20' } });
  });

  it('verwirft den Tag beim Projektwechsel, wenn er im neuen Projekt keine Daten hat', async () => {
    const user = userEvent.setup();
    const view = await mount(
      { projects: [project(), project({ repositoryId: 'beta-222222' })], state: { repositoryId: 'alpha-111111', day: '2026-11-20' } },
      { dayHasData: (id) => id !== 'beta-222222' },
    );
    await user.click(within(screen.getByRole('navigation', { name: 'Projekte' })).getByRole('button', { name: /beta-222222/ }));
    expect(view.app.store.getSnapshot().selection.day).toBeNull();
  });

  it('stellt die zuletzt gewählte Auswahl wieder her und fällt bei unbekanntem Projekt auf das erste zurück', async () => {
    const view = await mount({ projects: [project()], state: { repositoryId: 'gelöscht-000000', section: 'schedule' } });
    expect(view.app.store.getSnapshot().selection).toMatchObject({ repositoryId: 'alpha-111111', page: 'schedule' });
    expect(within(screen.getByRole('navigation', { name: 'Bereiche' })).getByRole('button', { name: 'Zeitplan' })).toHaveAttribute('aria-current', 'page');
  });

  it('zeigt System und Projekt hinzufügen als eigene Seiten ohne Bereichsleiste', async () => {
    const user = userEvent.setup();
    await mount({ projects: [project()], state: { repositoryId: 'alpha-111111' } });
    await user.click(screen.getByRole('button', { name: /System/ }));
    expect(screen.getByRole('button', { name: /System/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: 'Bereiche' })).toBeNull();
  });
});

describe('Tastenkürzel (AK-10-10)', () => {
  it('Strg+N verlangt eine neue Notiz, aber nur mit gewähltem Projekt', async () => {
    const user = userEvent.setup();
    const view = await mount({ projects: [project()], state: { repositoryId: 'alpha-111111' } });
    await user.keyboard('{Control>}n{/Control}');
    expect(view.app.store.getSnapshot().newNoteRequests).toBe(1);
  });

  it('Strg+N tut ohne Projekt nichts', async () => {
    const user = userEvent.setup();
    const view = await mount();
    await user.keyboard('{Control>}n{/Control}');
    expect(view.app.store.getSnapshot().newNoteRequests).toBe(0);
  });

  it('← und → wechseln den Tag in der Tagesansicht, in der Zeitzone des Projekts', async () => {
    const user = userEvent.setup();
    const view = await mount({ projects: [project()], state: { repositoryId: 'alpha-111111', section: 'day', day: '2026-11-26' } });
    await user.keyboard('{ArrowLeft}');
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-11-25');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-11-27');
  });

  it('← und → springen vom unbestimmten Tag ausgehend von heute in der Projektzeitzone', async () => {
    const user = userEvent.setup();
    const view = await mount(
      { projects: [project({ timezone: 'Pacific/Auckland' })], state: { repositoryId: 'alpha-111111', section: 'day', day: null } },
      { now: () => new Date('2026-11-26T20:00:00Z') },
    );
    // 20:00 UTC is already the 27th in Auckland.
    await user.keyboard('{ArrowLeft}');
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-11-26');
  });

  it('← und → wirken nicht in anderen Bereichen, nicht in Eingabefeldern und nicht im Dialog', async () => {
    const user = userEvent.setup();
    const view = await mount({ projects: [project()], state: { repositoryId: 'alpha-111111', section: 'overview', day: '2026-11-26' } });
    await user.keyboard('{ArrowLeft}');
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-11-26');

    await act(async () => view.app.actions.selectPage('day'));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await user.keyboard('{ArrowLeft}');
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-11-26');
    input.remove();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    await user.keyboard('{ArrowLeft}');
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-11-26');
    dialog.remove();
  });
});

describe('Kopfzeile und Laufanzeige', () => {
  it('zeigt Neue Notiz und Jetzt erfassen mit KI-Markierung, vorerst gesperrt', async () => {
    await mount({ projects: [project()], state: { repositoryId: 'alpha-111111' } });
    expect(screen.getByRole('heading', { level: 1, name: /alpha-111111/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Neue Notiz/ })).toBeDisabled();
    const capture = screen.getByRole('button', { name: /Jetzt erfassen.*Claude/ });
    expect(capture).toBeDisabled();
    expect(capture.querySelector('[data-icon="spark"]')).not.toBeNull();
  });

  it('zeigt einen laufenden Lauf, fragt vor dem Abbrechen nach und bricht dann ab', async () => {
    const user = userEvent.setup();
    const view = await mount({ projects: [project()], state: { repositoryId: 'alpha-111111' } });
    expect(screen.getByText('Kein Lauf aktiv.')).toBeInTheDocument();
    act(() =>
      view.emitRun({ type: 'started', runKey: 'k1', repositoryId: 'alpha-111111', label: 'capture', cancellable: true, ai: true, startedAt: new Date().toISOString() }),
    );
    act(() => view.emitRun({ type: 'live', runKey: 'k1', line: { at: '2026-11-26T09:00:00Z', text: 'Arbeitsstand prüfen' } }));
    expect(screen.getByText('Arbeitsstand prüfen')).toBeInTheDocument();
    expect(screen.getByText(/läuft/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.getByRole('dialog', { name: 'Lauf wirklich abbrechen?' })).toHaveTextContent('gescheiterter Versuch');
    expect(view.api.run.cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Lauf abbrechen' }));
    expect(view.api.run.cancel).toHaveBeenCalledWith('k1');

    act(() => view.emitRun({ type: 'finished', runKey: 'k1', repositoryId: 'alpha-111111', exitCode: null, cancelled: true, notice: null, failure: null }));
    expect(screen.getByText('Lauf abgebrochen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Schliessen' }));
    expect(screen.getByText('Kein Lauf aktiv.')).toBeInTheDocument();
  });

  it('zeigt Exit-Code 3 als Hinweis in Klartext und sperrt Jetzt erfassen während des Laufs', async () => {
    const view = await mount({ projects: [project()], state: { repositoryId: 'alpha-111111' } });
    act(() => view.emitRun({ type: 'started', runKey: 'k2', repositoryId: 'alpha-111111', label: 'capture', cancellable: true, ai: true, startedAt: new Date().toISOString() }));
    expect(screen.getByRole('button', { name: /Jetzt erfassen.*Claude/ })).toHaveAccessibleDescription(/Ein Lauf ist aktiv\. Jetzt erfassen ist gesperrt, bis er endet\./);
    act(() => view.emitRun({ type: 'finished', runKey: 'k2', repositoryId: 'alpha-111111', exitCode: 3, cancelled: false, notice: 'lock_held', failure: null }));
    expect(screen.getByText('Ein anderer Lauf ist aktiv')).toBeInTheDocument();
  });

  it('klappt die Laufanzeige ein und aus', async () => {
    const user = userEvent.setup();
    await mount({ projects: [project()], state: { repositoryId: 'alpha-111111' } });
    const toggle = screen.getByRole('button', { name: /Läufe/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Kein Lauf aktiv.')).toBeNull();
  });
});

describe('Fehlerrand um jede Seite (AK-10-13)', () => {
  it('zeigt Ladefehler der Projektliste als Banner', async () => {
    await mount({ listResult: { ok: false, error: { code: 'internal', message: 'Unerwarteter Fehler in der App.' } } });
    expect(screen.getByRole('alert')).toHaveTextContent('Die Projekte konnten nicht geladen werden');
  });
});
