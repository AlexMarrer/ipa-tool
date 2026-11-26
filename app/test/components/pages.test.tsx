import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/renderer/layout/AppShell';
import { createAppStore } from '../../src/renderer/store/appStore';
import type { DayView, NoteView, OverviewView, RunView, SnapshotView, WorkLogView } from '../../src/shared/views';
import { createFakeApi, emptyDay, project, type FakeApiOptions } from './fakeApi';

const DAY = '2026-11-26';
const NOTE_ID = 'N20261126T081500Z-0c1d';

const snap = (id: string, overrides: Partial<SnapshotView> = {}): SnapshotView => ({
  id,
  kind: 'work',
  capturedAt: '2026-11-26T10:00:00+01:00',
  observedPeriod: { from: '2026-11-26T09:00:00+01:00', to: '2026-11-26T10:00:00+01:00' },
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
  time: '10:00',
  ...overrides,
});

const note = (id: string, overrides: Partial<NoteView> = {}): NoteView => ({
  id,
  type: 'activity',
  text: 'Implementierung der Projektliste',
  activityDay: DAY,
  recordedAt: '2026-11-26T08:15:00+01:00',
  time: { minutes: 45, basis: 'measured', start: null, end: null },
  delay: null,
  reason: null,
  alternatives: [],
  cause: null,
  solution: null,
  refs: [],
  withheld: null,
  displayTime: '08:15',
  ...overrides,
});

const run = (runId: string, outcome: string, overrides: Partial<RunView> = {}): RunView => ({
  runId,
  command: 'capture',
  startedAt: '2026-11-26T11:00:00+01:00',
  outcome,
  exitCode: outcome === 'unstable' ? 5 : 0,
  durationMs: 1200,
  errorCodes: [],
  snapshotCreated: null,
  time: '11:00',
  ...overrides,
});

const noTime = { time: { measured: 0, estimated: 0 }, planned: { measured: 0, estimated: 0 }, delays: { measured: 0, estimated: 0 }, withoutTime: 0 };

/** A rich day: every kind of entry, open statuses, one unclear snapshot, quiet and failed runs. */
function richDay(): DayView {
  const snapshots = [
    snap('S000001', { kind: 'baseline', aiMode: 'deterministic', dayAttribution: 'baseline', commits: 0, evidence: 0, time: '08:00', runId: null }),
    snap('S000002'),
    snap('S000003', { status: 'exhausted', aiMode: 'none', attempts: { failed: 3, max: 3 }, lastErrorCode: 'timeout', time: '11:30', runId: null }),
    snap('S000004', { status: 'pending', aiMode: 'none', time: '12:00', runId: null }),
    snap('S000005', { dayAttribution: 'unclear', observedPeriod: { from: '2026-11-25T16:00:00+01:00', to: '2026-11-26T09:00:00+01:00' }, time: '09:00' }),
  ];
  const notes = [
    note(NOTE_ID, { time: { minutes: 45, basis: 'measured', start: '09:10', end: '09:55' }, text: 'Pair-Programming', refs: ['S000002:E001'] }),
    note('N20261126T090000Z-aaaa', { type: 'problem', text: 'Lock blieb liegen', time: null, delay: { minutes: 20, basis: 'estimated' }, cause: 'Toter Prozess', solution: 'Lock erkannt', displayTime: '09:00' }),
    note('N20261126T100000Z-bbbb', { type: 'plan', text: 'Dialog planen', time: { minutes: 60, basis: 'estimated', start: null, end: null }, displayTime: '10:00' }),
    note('N20261126T110000Z-cccc', { type: 'activity', text: 'api_key = "…"', time: null, withheld: { detectors: ['assignment'], fields: ['text'] }, displayTime: '11:00' }),
  ];
  const runs = [run('R20261126T110000Z-q001', 'ok'), run('R20261126T111000Z-q002', 'unchanged'), run('R20261126T112000Z-f001', 'unstable', { time: '11:20' })];
  return emptyDay(DAY, {
    title: 'Donnerstag, 26. November 2026',
    snapshots,
    notes,
    runs,
    drafts: [
      { file: '2026-11-26-R20261126T094500Z-n001', runId: 'R20261126T094500Z-n001', day: DAY, generatedAt: '2026-11-26T09:45:00+01:00', mode: 'no_ai', time: '09:45' },
      { file: '2026-11-26-R20261126T104200Z-7f10', runId: 'R20261126T104200Z-7f10', day: DAY, generatedAt: '2026-11-26T10:42:00+01:00', mode: 'ai', time: '10:42' },
    ],
    summary: { snapshotCount: 5, noteCount: 4, time: { time: { measured: 45, estimated: 0 }, planned: { measured: 0, estimated: 60 }, delays: { measured: 0, estimated: 20 }, withoutTime: 2 } },
    attention: [
      { id: 'o3', level: 'attention', kind: 'snapshot_open', snapshotId: 'S000003', status: 'exhausted', text: 'S000003: Versuche erschöpft. 3 von 3 Versuchen.', link: 'workLogs' },
      { id: 'o4', level: 'attention', kind: 'snapshot_open', snapshotId: 'S000004', status: 'pending', text: 'S000004: Analyse ausstehend. Noch nicht analysiert.', link: 'workLogs' },
      { id: 'u5', level: 'notice', kind: 'snapshot_unclear', snapshotId: 'S000005', text: 'S000005 überspannt mehrere Tage (25.11. 16:00 – 26.11. 09:00) und zählt an keinem Tag als ausgeführte Arbeit.' },
    ],
    timeline: [
      { kind: 'snapshot', id: 'S000001', time: '08:00' },
      { kind: 'note', id: NOTE_ID, time: '08:15' },
      { kind: 'snapshot', id: 'S000005', time: '09:00' },
      { kind: 'note', id: 'N20261126T090000Z-aaaa', time: '09:00' },
      { kind: 'snapshot', id: 'S000002', time: '10:00' },
      { kind: 'note', id: 'N20261126T100000Z-bbbb', time: '10:00' },
      { kind: 'note', id: 'N20261126T110000Z-cccc', time: '11:00' },
      { kind: 'run', id: 'R20261126T110000Z-q001', time: '11:00' },
      { kind: 'run', id: 'R20261126T111000Z-q002', time: '11:10' },
      { kind: 'run', id: 'R20261126T112000Z-f001', time: '11:20' },
      { kind: 'snapshot', id: 'S000003', time: '11:30' },
      { kind: 'snapshot', id: 'S000004', time: '12:00' },
    ],
  });
}

/** The value next to a label in a `dt`/`dd` list. */
const valueOf = (scope: HTMLElement, label: string): string => (within(scope).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent ?? '').replace(/\s+/g, ' ').trim();

const workLog = (snapshot: SnapshotView, markdown: string, replacement = false): WorkLogView => ({ snapshot, state: replacement ? 'missing' : 'ok', markdown, replacement });

async function mount(options: FakeApiOptions = {}, selection: FakeApiOptions['state'] = {}) {
  const fake = createFakeApi({
    projects: [project()],
    state: { repositoryId: 'alpha-111111', section: 'day', day: DAY, ...selection },
    index: { timezone: 'Europe/Zurich', today: DAY, days: [{ day: '2026-11-24', hasData: true, warning: false }, { day: '2026-11-25', hasData: true, warning: true }, { day: DAY, hasData: true, warning: true }] },
    ...options,
  });
  const app = createAppStore(fake.api, { now: () => new Date('2026-11-26T12:00:00Z') });
  render(<AppShell app={app} api={fake.api} />);
  await act(async () => app.actions.init());
  return { ...fake, app };
}

describe('Tagesansicht (AK-10-20, AK-10-24)', () => {
  it('zeigt Datum mit Wochentag, Zeitzone und die Tabs mit Zählern', async () => {
    await mount({ days: { [DAY]: richDay() } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Donnerstag, 26. November 2026' })).toBeInTheDocument();
    expect(screen.getByText('Zeitzone Europe/Zurich')).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Ansicht des Tages' });
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Zeitstrahl', 'Work-Logs 5', 'Notizen 4', 'Journal 2']);
    expect(within(tabs).getByRole('tab', { name: 'Zeitstrahl' })).toHaveAttribute('aria-selected', 'true');
  });

  it('wechselt den Tag mit den Pfeilen im Kopf und mit Heute', async () => {
    const user = userEvent.setup();
    const view = await mount({ days: { [DAY]: richDay() } });
    await screen.findByRole('heading', { level: 2, name: /26. November/ });
    await user.click(screen.getByRole('button', { name: 'Vortag' }));
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-11-25');
    expect(await screen.findByRole('heading', { level: 2, name: 'Mittwoch, 25. November 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Heute' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Folgetag' }));
    await user.click(screen.getByRole('button', { name: 'Folgetag' }));
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-11-27');
    await user.click(screen.getByRole('button', { name: 'Heute' }));
    expect(view.app.store.getSnapshot().selection.day).toBe(DAY);
    expect(screen.getByRole('button', { name: 'Heute' })).toBeDisabled();
  });

  it('öffnet den Kalender mit Markierungen für Daten und Warnung und wählt einen Tag, Esc schliesst', async () => {
    const user = userEvent.setup();
    const view = await mount({ days: { [DAY]: richDay() } });
    await screen.findByRole('heading', { level: 2, name: /26. November/ });
    await user.click(screen.getByRole('button', { name: 'Kalender' }));
    const calendar = screen.getByRole('dialog', { name: 'Kalender' });
    expect(within(calendar).getByText('November 2026')).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: 'Dienstag, 24. November 2026, Daten vorhanden' })).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: 'Mittwoch, 25. November 2026, Warnung' })).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: /26. November 2026, heute, Warnung/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(calendar).getByText('Tag mit Daten')).toBeInTheDocument();
    expect(within(calendar).getByText('Tag mit Warnung')).toBeInTheDocument();
    await user.click(within(calendar).getByRole('button', { name: 'Vormonat' }));
    expect(within(calendar).getByText('Oktober 2026')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Kalender' })).toBeNull();
    // Esc also works while the focus sits on the calendar switch outside the popover.
    await user.click(screen.getByRole('button', { name: 'Kalender' }));
    screen.getByRole('button', { name: 'Kalender' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Kalender' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Kalender' }));
    await user.click(screen.getByRole('button', { name: 'Mittwoch, 25. November 2026, Warnung' }));
    expect(view.app.store.getSnapshot().selection.day).toBe('2026-11-25');
    expect(screen.queryByRole('dialog', { name: 'Kalender' })).toBeNull();
  });

  it('lässt Zukunftstage wählbar und weist auf Planungsnotizen hin', async () => {
    const user = userEvent.setup();
    await mount({ days: { '2026-11-30': emptyDay('2026-11-30', { isFuture: true, title: 'Montag, 30. November 2026' }) } }, { day: '2026-11-30' });
    expect(await screen.findByText('Dieser Tag liegt in der Zukunft')).toBeInTheDocument();
    expect(screen.getByText(/nur Planungsnotizen/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kalender' }));
    // Days after today stay selectable (planning notes); the grid shows the month of the selected day.
    expect(screen.getByRole('button', { name: /Freitag, 27\. November 2026/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Montag, 30\. November 2026/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Zusammenfassung und Hinweise (AK-10-21, AK-10-23)', () => {
  it('zeigt Zeiten getrennt und nirgends eine Summe, mit Erklärung im Tooltip', async () => {
    const { container } = (await mount({ days: { [DAY]: richDay() } }), { container: document.body });
    const summary = await screen.findByRole('group', { name: 'Zusammenfassung des Tages' });
    expect(summary).toHaveTextContent('Snapshots 5');
    expect(summary).toHaveTextContent('Notizen 4');
    expect(summary).toHaveTextContent('Zeit gemessen 45 min');
    expect(summary).toHaveTextContent('Zeit geschätzt 0 min');
    expect(within(summary).getByRole('button', { name: 'Weitere Angaben zur Zeit' })).toHaveAccessibleDescription(
      'Verzögerung: 20 min, geschätzt. Nie zur Zeit addiert. Geplant: 60 min, geschätzt. Nicht in der Zeit enthalten. 2 Notizen ohne Zeitangabe',
    );
    // No total anywhere in the page (I-07): 45 + 60 + 20 combinations never appear.
    expect(container.textContent).not.toMatch(/\b(65|105|125|80|Gesamt|Summe|insgesamt)\b/);
  });

  it('zeigt das Panel mit Anzahl, Chips, Link und Zur-Kenntnis-Zeilen, die nicht mitzählen', async () => {
    const user = userEvent.setup();
    await mount({ days: { [DAY]: richDay() } });
    const panel = (await screen.findByText('2 Dinge brauchen Aufmerksamkeit')).closest('details') as HTMLElement;
    expect(panel).toHaveAttribute('open');
    expect(within(panel).getByText('Versuche erschöpft')).toBeInTheDocument();
    expect(within(panel).getByText(/3 von 3 Versuchen/)).toBeInTheDocument();
    expect(within(panel).getByText('Zur Kenntnis:')).toBeInTheDocument();
    expect(within(panel).getByText(/zählt an keinem Tag als ausgeführte Arbeit/)).toBeInTheDocument();
    await user.click(within(panel).getAllByRole('button', { name: 'Im Tab Work-Logs öffnen' })[0] as HTMLElement);
    expect(screen.getByRole('tab', { name: /Work-Logs/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('zeigt das Panel nur bei Inhalt', async () => {
    await mount({ days: { [DAY]: emptyDay(DAY) } });
    await screen.findByRole('heading', { level: 2, name: /26. November/ });
    expect(screen.queryByText(/brauchen? Aufmerksamkeit/)).toBeNull();
  });
});

describe('Zeitstrahl (AK-10-22)', () => {
  it('zeigt alle Eintragsarten, alle Snapshots und verbirgt unauffällige Läufe', async () => {
    await mount({ days: { [DAY]: richDay() } });
    const list = await screen.findByRole('list', { name: 'Zeitstrahl' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Snapshot S000001'),
        expect.stringContaining('Ausgangslage'),
        expect.stringContaining('Pair-Programming'),
        expect.stringContaining('Zeit von 09:10 bis 09:55'),
        expect.stringContaining('Verzögerung 20 min'),
        expect.stringContaining('60 min geplant'),
        expect.stringContaining('Snapshot S000003'),
        expect.stringContaining('Versuche erschöpft'),
        expect.stringContaining('Analyse ausstehend'),
        expect.stringContaining('Arbeitsstand unruhig'),
        expect.stringContaining('Exit-Code 5'),
      ]),
    );
    expect(within(list).getByText(/Snapshot S000005 · Tageszuordnung unklar/)).toBeInTheDocument();
    expect(within(list).getByText(/zurückgehalten/)).toBeInTheDocument();
    // Quiet runs are hidden; the failed run is always visible.
    expect(within(list).queryByText('Erfassung ohne Auffälligkeit')).toBeNull();
    expect(within(list).queryByText('Keine neue Arbeit')).toBeNull();
    expect(within(list).getAllByRole('button').filter((row) => row.textContent?.startsWith('11:2'))).toHaveLength(1);
  });

  it('blendet unauffällige Läufe ein und wieder aus', async () => {
    const user = userEvent.setup();
    await mount({ days: { [DAY]: richDay() } });
    await user.click(await screen.findByRole('button', { name: '2 unauffällige Läufe einblenden' }));
    expect(screen.getByText('Erfassung ohne Auffälligkeit')).toBeInTheDocument();
    expect(screen.getByText('Keine neue Arbeit')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unauffällige Läufe ausblenden' }));
    expect(screen.queryByText('Erfassung ohne Auffälligkeit')).toBeNull();
  });

  it('klappt Einträge per Maus und Tastatur auf und zeigt die Details', async () => {
    const user = userEvent.setup();
    await mount({ days: { [DAY]: richDay() } });
    const list = await screen.findByRole('list', { name: 'Zeitstrahl' });
    const problem = within(list).getByRole('button', { name: /Lock blieb liegen/ });
    expect(problem).toHaveAttribute('aria-expanded', 'false');
    await user.click(problem);
    expect(problem).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Ursache Toter Prozess')).toBeInTheDocument();
    expect(screen.getByText('Lösung Lock erkannt')).toBeInTheDocument();
    const unclear = within(list).getByRole('button', { name: /Tageszuordnung unklar/ });
    unclear.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText(/Überspannt mehrere Tage und zählt an keinem Tag als ausgeführte Arbeit/)).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.queryByText(/Überspannt mehrere Tage/)).toBeNull();
  });

  it('zeigt einen leeren Tag mit Hinweis und ohne Aufnahme', async () => {
    await mount({ days: { [DAY]: emptyDay(DAY) } });
    expect(await screen.findByText('Keine Einträge')).toBeInTheDocument();
  });
});

describe('Work-Logs (AK-10-25)', () => {
  const logs = () => {
    const d = richDay();
    const byId = Object.fromEntries(d.snapshots.map((snapshot) => [snapshot.id, snapshot]));
    return {
      day: d,
      workLogs: {
        S000001: workLog(byId['S000001'] as SnapshotView, '# Work-Log S000001: Ausgangslage – keine neu erbrachte Leistung\n\nDieser Snapshot hält den Ausgangszustand des Repositorys fest. Alles ab hier wird gegen ihn verglichen.\n\n## Zusammenfassung\n\nnicht erfasst'),
        S000002: workLog(byId['S000002'] as SnapshotView, '# Work-Log S000002\n\n## Zusammenfassung\n\nDie Liste wurde gebaut [S000002:E001].\n\n## Belege\n\n| ID | Art | Pfad |\n| --- | --- | --- |\n| E001 | state_delta | src/a.ts |'),
        S000003: workLog(byId['S000003'] as SnapshotView, '# Work-Log S000003 (nicht erstellt)\n\n## Zusammenfassung\n\nNicht erstellt. Die Analyse ist nicht abgeschlossen.', true),
        S000004: workLog(byId['S000004'] as SnapshotView, '# Work-Log S000004 (nicht erstellt)', true),
      },
    };
  };

  async function openTab() {
    const { day, workLogs } = logs();
    const user = userEvent.setup();
    const view = await mount({ days: { [DAY]: day }, workLogs, references: { notes: {}, snapshots: { S000002: DAY } } });
    await user.click(await screen.findByRole('tab', { name: /Work-Logs/ }));
    return { ...view, user };
  }

  it('listet die Snapshots mit Status und wählt den ersten mit offener Analyse vor', async () => {
    await openTab();
    const list = await screen.findByRole('navigation', { name: 'Snapshots des Tages' });
    const items = within(list).getAllByRole('button');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Ausgangslage');
    expect(items[2]).toHaveAttribute('aria-current', 'true');
    expect(items[2]).toHaveTextContent('Versuche erschöpft');
    expect(await screen.findByRole('heading', { level: 3, name: 'Work-Log S000003' })).toBeInTheDocument();
  });

  it('zeigt die Ersatzansicht "Nicht erstellt" ohne Etiketten und sperrt Datei öffnen', async () => {
    await openTab();
    expect(await screen.findByText('Nicht erstellt. Die Analyse ist nicht abgeschlossen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Datei öffnen' })).toBeDisabled();
    expect(screen.getByRole('heading', { level: 2, name: 'Zusammenfassung' })).not.toHaveTextContent(/KI|ohne|Tool/);
    expect(screen.getByText('Versuche erschöpft', { selector: '[class*="banner__title"]' })).toBeInTheDocument();
  });

  it('zeigt den Work-Log mit Etiketten, Chips und Art in Klartext und öffnet Dateien über Art und ID', async () => {
    const { user, api } = await openTab();
    await user.click(within(await screen.findByRole('navigation', { name: 'Snapshots des Tages' })).getAllByRole('button')[1] as HTMLElement);
    expect(await screen.findByRole('heading', { level: 2, name: /Zusammenfassung/ })).toHaveTextContent('KI-Entwurf');
    expect(screen.getByRole('heading', { level: 2, name: /Belege/ })).toHaveTextContent('vom Tool');
    expect(screen.getAllByRole('button', { name: 'S000002:E001' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('cell', { name: 'Datei-Zustand' })).toHaveAttribute('title', 'state_delta');
    await user.click(screen.getByRole('button', { name: 'Datei öffnen' }));
    expect(api.shell.open).toHaveBeenCalledWith('alpha-111111', { kind: 'workLog', snapshotId: 'S000002' });
    await user.click(screen.getByRole('button', { name: 'Ordner zeigen' }));
    expect(api.shell.reveal).toHaveBeenCalledWith('alpha-111111', { kind: 'workLog', snapshotId: 'S000002' });
  });

  it('zeigt bei blocked den Hinweis mit Sprung zur Konfiguration', async () => {
    const d = richDay();
    d.snapshots[3] = snap('S000004', { status: 'blocked', aiMode: 'none', time: '12:00', runId: null });
    const user = userEvent.setup();
    const view = await mount({ days: { [DAY]: d }, workLogs: { S000003: workLog(d.snapshots[2] as SnapshotView, 'x', true), S000004: workLog(d.snapshots[3] as SnapshotView, '# Work-Log S000004', true) } });
    await user.click(await screen.findByRole('tab', { name: /Work-Logs/ }));
    await user.click(within(await screen.findByRole('navigation', { name: 'Snapshots des Tages' })).getAllByRole('button')[3] as HTMLElement);
    expect(await screen.findByText(/Eingabe zu gross\. Die Analyse wurde nicht gestartet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zur Konfiguration' }));
    expect(view.app.store.getSnapshot().selection.page).toBe('config');
  });

  it('zeigt die Ausgangslage mit Überschrift und Etikett', async () => {
    const { user } = await openTab();
    await user.click(within(await screen.findByRole('navigation', { name: 'Snapshots des Tages' })).getAllByRole('button')[0] as HTMLElement);
    expect(await screen.findByText(/Ausgangslage – keine neu erbrachte Leistung/)).toBeInTheDocument();
    expect(screen.getByText(/Alles ab hier wird gegen ihn verglichen/)).toBeInTheDocument();
  });
});

describe('Notizen (AK-10-26)', () => {
  async function openNotes(options: FakeApiOptions = {}) {
    const user = userEvent.setup();
    const view = await mount({ days: { [DAY]: richDay() }, references: { notes: { [NOTE_ID]: DAY }, snapshots: { S000002: DAY } }, ...options });
    await user.click(await screen.findByRole('tab', { name: /Notizen/ }));
    return { ...view, user };
  }

  it('zeigt Hinweis, Filter mit Zählern und filtert', async () => {
    const { user } = await openNotes();
    expect(await screen.findByText(/Notizen sind in V1 nicht änderbar\./)).toBeInTheDocument();
    expect(screen.getByText(/Planung zählt nicht zur Zeit/)).toBeInTheDocument();
    const filter = screen.getByRole('group', { name: 'Notizen filtern' });
    expect(within(filter).getAllByRole('button').map((button) => button.textContent)).toEqual(['Alle 4', 'Allgemein 0', 'Tätigkeit 2', 'Problem 1', 'Entscheidung 0', 'Erkenntnis 0', 'Planung 1']);
    await user.click(within(filter).getByRole('button', { name: 'Problem 1' }));
    expect(within(screen.getByRole('list', { name: 'Notizen' })).getAllByRole('button')).toHaveLength(1);
    expect(within(filter).getByRole('button', { name: 'Problem 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('klappt eine Notiz mit allen Feldern auf', async () => {
    const { user } = await openNotes();
    await user.click(await screen.findByRole('button', { name: /Lock blieb liegen/ }));
    const details = screen.getByText('Typ', { selector: 'dt' }).closest('dl') as HTMLElement;
    expect(valueOf(details, 'Typ')).toBe('Problem');
    expect(valueOf(details, 'Tag')).toBe(DAY);
    expect(valueOf(details, 'Zeit')).toBe('nicht angegeben');
    expect(valueOf(details, 'Verzögerung')).toBe('20 Minuten, geschätzt (nie zur Zeit addiert)');
    expect(valueOf(details, 'Ursache')).toBe('Toter Prozess');
    expect(valueOf(details, 'Lösung')).toBe('Lock erkannt');
    expect(valueOf(details, 'Notiz-ID')).toBe('N20261126T090000Z-aaaa');
    expect(valueOf(details, 'Verweise')).toBe('keine');
    expect(valueOf(details, 'Etikett')).toBe('Notiz');
  });

  it('zeigt Zeit von-bis, Basis und Verweise, und ein Verweis springt zum Work-Log', async () => {
    const { user, app } = await openNotes();
    await user.click(await screen.findByRole('button', { name: /Pair-Programming/ }));
    const details = screen.getByText('Typ', { selector: 'dt' }).closest('dl') as HTMLElement;
    expect(valueOf(details, 'Zeit')).toBe('Von 09:10 bis 09:55, 45 Minuten');
    expect(valueOf(details, 'Basis')).toBe('gemessen');
    await user.click(within(details).getByRole('button', { name: 'S000002:E001' }));
    expect(app.store.getSnapshot()).toMatchObject({ dayTab: 'workLogs', focus: { snapshotId: 'S000002', evidence: 'S000002:E001' } });
  });

  it('kennzeichnet zurückgehaltene Notizen mit Detektor und ohne Wert', async () => {
    const { user } = await openNotes();
    const row = await screen.findByRole('button', { name: /api_key/ });
    expect(row).toHaveTextContent('zurückgehalten');
    await user.click(row);
    expect(screen.getByText(/zurückgehalten \(Detektor assignment\)/)).toBeInTheDocument();
  });

  it('zeigt den Leerzustand und meldet beschädigte Zeilen', async () => {
    await openNotes({ days: { [DAY]: emptyDay(DAY, { invalid: { noteLines: 2, runLines: 0, unreadableFiles: [] } }) } });
    expect(await screen.findByText('Keine Notizen an diesem Tag')).toBeInTheDocument();
    expect(screen.getByText(/Notizen mit möglichem Zugangsdatum werden zurückgehalten/)).toBeInTheDocument();
    expect(screen.getByText(/2 beschädigte Zeile\(n\) in notes\/2026-11-26\.jsonl/)).toBeInTheDocument();
  });
});

describe('Journal (AK-10-27)', () => {
  const NEWEST = '2026-11-26-R20261126T104200Z-7f10';
  const OLDER = '2026-11-26-R20261126T094500Z-n001';
  const doc = (mode: 'ai' | 'no_ai', file: string): { draft: DayView['drafts'][number]; state: 'ok'; markdown: string; headings: string[] } => ({
    draft: richDay().drafts.find((candidate) => candidate.file === file) as DayView['drafts'][number],
    state: 'ok',
    markdown: `# Journal-Entwurf ${DAY}\n\n> Entwurf zur persönlichen Prüfung\n\n## Ausgeführte Arbeiten\n\n- Liste gebaut [${NOTE_ID}]\n\n## Zeitaufwand\n\ntext ${mode}`,
    headings: ['Ausgeführte Arbeiten', 'Zeitaufwand'],
  });

  async function openJournal(day: DayView = richDay()) {
    const user = userEvent.setup();
    const view = await mount({
      days: { [DAY]: day },
      journals: { [NEWEST]: doc('ai', NEWEST), [OLDER]: doc('no_ai', OLDER) },
      references: { notes: { [NOTE_ID]: DAY }, snapshots: {} },
    });
    await user.click(await screen.findByRole('tab', { name: /Journal/ }));
    return { ...view, user };
  }

  it('wählt den neuesten Entwurf vor, hält frühere erreichbar und zeigt Etiketten', async () => {
    const { user, api } = await openJournal();
    const picker = await screen.findByRole('combobox', { name: 'Entwürfe' });
    expect(picker).toHaveValue(NEWEST);
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['10:42 · Lauf …7f10 · KI-Entwurf', '09:45 · Lauf …n001 · ohne KI']);
    expect(await screen.findByRole('heading', { level: 2, name: /Ausgeführte Arbeiten/ })).toHaveTextContent('KI-Entwurf');
    expect(screen.getByRole('heading', { level: 3, name: 'Journal · Donnerstag, 26. November 2026' })).toBeInTheDocument();
    expect(screen.getByText(/Entwurf von 10:42/)).toBeInTheDocument();
    await user.selectOptions(picker, OLDER);
    expect(api.journal.read).toHaveBeenLastCalledWith('alpha-111111', OLDER);
    expect(await screen.findByRole('heading', { level: 2, name: /Ausgeführte Arbeiten/ })).toHaveTextContent('ohne KI');
  });

  it('zeigt Hinweisbox, Gliederung und die Aktionen Öffnen, Zeigen, Kopieren', async () => {
    const { user, api } = await openJournal();
    expect(await screen.findByText('Entwurf zur persönlichen Prüfung')).toBeInTheDocument();
    const outline = screen.getByRole('navigation', { name: 'Gliederung' });
    expect(within(outline).getAllByRole('button').map((button) => button.textContent)).toEqual(['Ausgeführte Arbeiten', 'Zeitaufwand']);
    await user.click(screen.getByRole('button', { name: 'Datei öffnen' }));
    expect(api.shell.open).toHaveBeenCalledWith('alpha-111111', { kind: 'journalDraft', file: NEWEST });
    await user.click(screen.getByRole('button', { name: 'Ordner zeigen' }));
    expect(api.shell.reveal).toHaveBeenCalledWith('alpha-111111', { kind: 'journalDraft', file: NEWEST });
    await user.click(screen.getByRole('button', { name: 'Text kopieren' }));
    expect(api.shell.copy).toHaveBeenCalledWith(expect.stringContaining('# Journal-Entwurf'));
    await user.click(screen.getByRole('button', { name: 'Pfad kopieren' }));
    expect(api.shell.copyPath).toHaveBeenCalledWith('alpha-111111', { kind: 'journalDraft', file: NEWEST });
    await user.click(screen.getByRole('button', { name: 'Ordner öffnen' }));
    expect(api.shell.open).toHaveBeenLastCalledWith('alpha-111111', { kind: 'journalFinalFolder' });
    expect(screen.getByText(/Die App schreibt nie dorthin/)).toBeInTheDocument();
  });

  it('springt von einem Notiz-Chip im Journal zur Notiz im Tab Notizen', async () => {
    const { user, app } = await openJournal();
    await user.click(await screen.findByRole('button', { name: NOTE_ID }));
    expect(app.store.getSnapshot()).toMatchObject({ dayTab: 'notes', focus: { noteId: NOTE_ID } });
    expect(await screen.findByRole('list', { name: 'Notizen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pair-Programming/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('zeigt den leeren Zustand ohne Erzeugen-Schaltflächen (kommen mit den Aktionen)', async () => {
    const user = userEvent.setup();
    await mount({ days: { [DAY]: emptyDay(DAY) } });
    await user.click(await screen.findByRole('tab', { name: /Journal/ }));
    expect(await screen.findByText('Noch kein Journal für diesen Tag')).toBeInTheDocument();
    expect(screen.getByText(/Die Endfassung entsteht von Hand unter journal\/final\//)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Journal erzeugen/ })).toBeNull();
  });

  it('meldet eine nicht lesbare Entwurfsdatei, statt abzustürzen', async () => {
    const user = userEvent.setup();
    await mount({ days: { [DAY]: richDay() }, journals: { [NEWEST]: { ...doc('ai', NEWEST), state: 'unreadable', markdown: '' } } });
    await user.click(await screen.findByRole('tab', { name: /Journal/ }));
    expect(await screen.findByText('Datei nicht lesbar')).toBeInTheDocument();
  });
});

describe('Projektübersicht (AK-10-31, AK-10-32)', () => {
  const overview = (overrides: Partial<OverviewView> = {}): OverviewView => ({
    halt: null,
    claude: { checkedAt: '2026-11-26T08:00:00+01:00', ok: true, version: '2.1.201', problem: null },
    lastRun: run('R20261126T112000Z-f001', 'ok', { durationMs: 83_000 }),
    lastSnapshot: { id: 'S000008', time: '2026-11-26T11:30:00+01:00' },
    analysedUpTo: 'S000002',
    analyses: { pending: 2, failed: 0, blocked: 0, exhausted: 1, complete: 3, skipped: 1, notRequired: 1 },
    withheld: { units: 1, notes: 1 },
    notesToday: 4,
    schedule: { state: 'active', nextRun: '27.11.2026 08:00' },
    recentDays: [{ day: '2026-11-26', warning: true }, { day: '2026-11-25', warning: false }],
    timezone: 'Europe/Zurich',
    inconsistent: false,
    ...overrides,
  });

  const open = (value: OverviewView) => mount({ overview: value }, { section: 'overview', day: null });

  it('zeigt alle Kennzahlen aus §8.2', async () => {
    await open(overview());
    expect(await screen.findByRole('region', { name: 'Letzter Lauf' })).toHaveTextContent('26.11.2026 11:00');
    expect(screen.getByRole('region', { name: 'Letzter Lauf' })).toHaveTextContent('1 min 23 s');
    expect(screen.getByRole('region', { name: 'Letzter Snapshot' })).toHaveTextContent('S000008');
    expect(screen.getByRole('region', { name: 'Analyse-Stand' })).toHaveTextContent('Bis S000002 analysiert');
    const analyses = screen.getByRole('region', { name: 'Analysen nach Status' });
    expect(analyses).toHaveTextContent('Analyse ausstehend');
    expect(analyses).toHaveTextContent('Versuche erschöpft');
    expect(analyses).toHaveTextContent('Abgeschlossen 3 · Übersprungen 1');
    expect(screen.getByRole('region', { name: 'Zurückgehalten' })).toHaveTextContent('1 Einheit(en), 1 Notiz(en)');
    expect(screen.getByRole('region', { name: 'Notizen heute' })).toHaveTextContent('4');
    expect(screen.getByRole('region', { name: 'Zeitplan' })).toHaveTextContent('Aktiv');
    expect(screen.getByRole('region', { name: 'Zeitplan' })).toHaveTextContent('27.11.2026 08:00');
  });

  it('springt von den letzten Tagen in die Tagesansicht und vom Zeitplan zur Zeitplan-Seite', async () => {
    const user = userEvent.setup();
    const view = await open(overview());
    await user.click(await screen.findByRole('button', { name: /2026-11-25/ }));
    expect(view.app.store.getSnapshot()).toMatchObject({ selection: { page: 'day', day: '2026-11-25' }, dayTab: 'timeline' });
  });

  it('springt zum Zeitplan', async () => {
    const user = userEvent.setup();
    const view = await open(overview());
    await user.click(await screen.findByRole('button', { name: 'Zum Zeitplan' }));
    expect(view.app.store.getSnapshot().selection.page).toBe('schedule');
  });

  it('zeigt die Claude-Warnung nur bei einem Problem und nichts, wenn Claude bereit ist', async () => {
    const view = await open(overview());
    await screen.findByRole('region', { name: 'Letzter Lauf' });
    expect(screen.queryByText(/Claude ist nicht bereit|Noch nicht geprüft/)).toBeNull();
    view.api.overview.load = vi.fn(async () => ({ ok: true as const, value: overview({ claude: { checkedAt: '2026-11-25T08:00:00+01:00', ok: false, version: '2.1.114', problem: 'Die Anmeldung fehlt.' } }) }));
    act(() => view.emitChanged({ repositoryId: 'alpha-111111', reason: 'workspace' }));
    expect(await screen.findByText('Claude ist nicht bereit')).toBeInTheDocument();
    expect(screen.getByText(/Die Anmeldung fehlt\. Aufnehmen funktioniert weiter, Analysen und Journal mit KI sind gesperrt\./)).toBeInTheDocument();
    expect(screen.getByText(/Version 2\.1\.114/)).toBeInTheDocument();
  });

  it('zeigt "Noch nicht geprüft", wenn Claude nie geprüft wurde', async () => {
    await open(overview({ claude: { checkedAt: null, ok: null, version: null, problem: null } }));
    expect(await screen.findByText('Claude: Noch nicht geprüft')).toBeInTheDocument();
  });

  it.each([
    ['branch_changed', 'Der Branch hat gewechselt', /anderen Branch als bei der letzten Erfassung/],
    ['history_rewritten', 'Die Historie wurde umgeschrieben', /Rebase, Amend oder Reset.*Offene Analysen laufen trotzdem/],
    ['head_missing', 'HEAD fehlt', /nicht mehr vorhanden.*Offene Analysen laufen trotzdem/],
  ] as const)('zeigt den roten Halt-Banner für %s mit Stand, Lauf und Exit-Code', async (reason, title, text) => {
    await open(
      overview({
        halt: {
          reason,
          detectedAt: '2026-11-26T10:05:00+01:00',
          expected: { branch: 'main', head: 'a1b2c3d4e5f6' },
          observed: { branch: reason === 'branch_changed' ? 'feature/neu' : 'main', head: reason === 'head_missing' ? null : '9f8e7d6c5b4a' },
          runId: 'R20261126T100500Z-d2e8',
        },
      }),
    );
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(`Erfassung angehalten: ${title}`);
    expect(banner).toHaveTextContent(text);
    expect(valueOf(banner, 'Erwarteter Stand')).toBe('Branch main, HEAD a1b2c3d');
    expect(valueOf(banner, 'Beobachteter Stand')).toBe(`Branch ${reason === 'branch_changed' ? 'feature/neu' : 'main'}, HEAD ${reason === 'head_missing' ? 'nicht gefunden' : '9f8e7d6'}`);
    expect(valueOf(banner, 'Erkannt')).toBe('von Lauf …d2e8, 26.11.2026 10:05 · Exit-Code 4: Zuordnung angehalten');
    expect(within(banner).getByText('…d2e8')).toHaveAttribute('title', 'R20261126T100500Z-d2e8');
  });

  it('meldet "Analyse-Stand uneinheitlich", wenn die Ableitung von status abweicht', async () => {
    await open(overview({ inconsistent: true }));
    expect(await screen.findByText('Analyse-Stand uneinheitlich')).toBeInTheDocument();
  });
});

describe('Live-Aktualisierung und Fehler (AK-10-34, AK-10-13)', () => {
  it('lädt den Tag nach einer Änderung im Arbeitsbereich neu und zeigt das Neue ohne Neustart', async () => {
    const days: Record<string, DayView> = { [DAY]: emptyDay(DAY) };
    const view = await mount({ days });
    await screen.findByRole('heading', { level: 2, name: /26. November/ });
    expect(screen.getByRole('tab', { name: /Notizen 0/ })).toBeInTheDocument();
    const calls = vi.mocked(view.api.day.load).mock.calls.length;
    days[DAY] = emptyDay(DAY, { notes: [note(NOTE_ID)], summary: { snapshotCount: 0, noteCount: 1, time: noTime } });
    act(() => view.emitChanged({ repositoryId: 'alpha-111111', reason: 'workspace' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Notizen 1/ })).toBeInTheDocument());
    expect(vi.mocked(view.api.day.load).mock.calls.length).toBeGreaterThan(calls);
  });

  it('zeigt einen Ladefehler des Tages als Banner und bleibt bedienbar', async () => {
    const fake = createFakeApi({ projects: [project()], state: { repositoryId: 'alpha-111111', section: 'day', day: DAY } });
    fake.api.day.load = vi.fn(async () => ({ ok: false as const, error: { code: 'project_unknown', message: 'Dieses Projekt ist nicht lesbar.' } }));
    const app = createAppStore(fake.api);
    render(<AppShell app={app} api={fake.api} />);
    await act(async () => app.actions.init());
    expect(await screen.findByText('Der Tag konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Bereiche' })).toBeInTheDocument();
  });

  it('fängt einen Fehler in einem Tab ab, ohne die App mitzureissen', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const bad = richDay();
    (bad as { notes: unknown }).notes = [{ id: 'kaputt' }];
    await mount({ days: { [DAY]: bad } });
    await user.click(await screen.findByRole('tab', { name: /Notizen/ }));
    expect(await screen.findByText('Dieser Tab konnte nicht angezeigt werden')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Bereiche' })).toBeInTheDocument();
    errorLog.mockRestore();
  });
});
