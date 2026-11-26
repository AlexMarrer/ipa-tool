import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandlers, parseStatePatch } from '../../src/main/ipc/handlers';
import { isTrustedSender } from '../../src/main/ipc/guard';
import { registerIpc } from '../../src/main/ipc/register';
import { EVENT_CHANNELS, INVOKE_CHANNELS, IPC_CHANNELS } from '../../src/shared/ipc';
import type { Services } from '../../src/main/services';

describe('Absenderprüfung (AK-10-04)', () => {
  const main = { frameUrl: 'app://app/index.html', webContentsId: 7, isMainFrame: true };

  it('vertraut nur dem Hauptframe des Hauptfensters mit dem App-Protokoll', () => {
    expect(isTrustedSender(main, 7)).toBe(true);
    expect(isTrustedSender({ ...main, webContentsId: 8 }, 7)).toBe(false);
    expect(isTrustedSender({ ...main, isMainFrame: false }, 7)).toBe(false);
    expect(isTrustedSender({ ...main, frameUrl: undefined }, 7)).toBe(false);
    expect(isTrustedSender({ ...main, frameUrl: 'https://example.com/' }, 7)).toBe(false);
    expect(isTrustedSender({ ...main, frameUrl: 'app://andere/index.html' }, 7)).toBe(false);
    expect(isTrustedSender({ ...main, frameUrl: 'file:///C:/x.html' }, 7)).toBe(false);
    expect(isTrustedSender(main, undefined)).toBe(false);
  });

  it('lässt den Entwicklungsserver nur zu, wenn er konfiguriert ist', () => {
    const dev = { ...main, frameUrl: 'http://localhost:5173/' };
    expect(isTrustedSender(dev, 7)).toBe(false);
    expect(isTrustedSender(dev, 7, 'http://localhost:5173')).toBe(true);
    expect(isTrustedSender({ ...main, frameUrl: 'http://localhost:9999/' }, 7, 'http://localhost:5173')).toBe(false);
  });
});

describe('Registrierung der Kanäle (AK-10-04)', () => {
  type Listener = (event: unknown, argument: unknown) => Promise<unknown>;
  const ipcMain = { listeners: new Map<string, Listener>(), handle: vi.fn(), removeHandler: vi.fn() };
  const services = {
    loadProjects: vi.fn(async () => ({ registry: { state: 'ok', path: '', detail: null }, projects: [] })),
    loadProject: vi.fn(async (id: string) => (id === 'p-123456' ? { repositoryId: id } : null)),
    queue: { cancel: vi.fn(async () => ({ cancelled: true })) },
    versions: vi.fn(async () => ({ app: '1' })),
    dataRoot: 'C:/daten',
    appState: { get: vi.fn(() => ({})), update: vi.fn(async () => ({ selection: { repositoryId: null } })) },
    watchProject: vi.fn(),
  } as unknown as Services;
  const rejected: string[] = [];

  const event = (url: string | undefined, id = 1, main = true) => {
    const frame = {};
    return { senderFrame: url === undefined ? null : { url, ...frame }, sender: { id, mainFrame: main ? undefined : {} } };
  };

  beforeEach(() => {
    ipcMain.listeners.clear();
    rejected.length = 0;
    ipcMain.handle.mockImplementation((channel: string, listener: Listener) => void ipcMain.listeners.set(channel, listener));
    registerIpc({
      ipcMain,
      handlers: createHandlers(services),
      mainWebContentsId: () => 1,
      onRejected: (channel, reason) => rejected.push(`${channel}:${reason}`),
    });
  });

  /** Builds an event whose frame is the main frame of its web contents. */
  const trusted = (url: string, id = 1) => {
    const frame = { url };
    return { senderFrame: frame, sender: { id, mainFrame: frame } };
  };

  it('registriert genau die Aufrufkanäle und keinen Ereigniskanal', () => {
    expect([...ipcMain.listeners.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort());
    for (const channel of EVENT_CHANNELS) expect(ipcMain.listeners.has(channel)).toBe(false);
  });

  it('beantwortet Nachrichten des Hauptfensters mit { ok, value }', async () => {
    const answer = await ipcMain.listeners.get(IPC_CHANNELS.projectsList)?.(trusted('app://app/index.html'), undefined);
    expect(answer).toMatchObject({ ok: true, value: { projects: [] } });
    expect(await ipcMain.listeners.get(IPC_CHANNELS.systemDataRoot)?.(trusted('app://app/index.html'), undefined)).toEqual({ ok: true, value: { path: 'C:/daten' } });
  });

  it('lehnt Nachrichten fremder Quellen ab, ohne den Dienst aufzurufen', async () => {
    const listener = ipcMain.listeners.get(IPC_CHANNELS.projectsList);
    for (const bad of [trusted('https://example.com/'), trusted('app://app/index.html', 2), event('app://app/index.html', 1, false), event(undefined)]) {
      expect(await listener?.(bad, undefined)).toMatchObject({ ok: false, error: { code: 'untrusted_sender' } });
    }
    expect(services.loadProjects).toHaveBeenCalledTimes(0);
    expect(rejected).toHaveLength(4);
  });

  it('prüft die Eingabe jedes Kanals', async () => {
    const send = (channel: string, argument: unknown) => ipcMain.listeners.get(channel)?.(trusted('app://app/index.html'), argument);
    expect(await send(IPC_CHANNELS.projectsStatus, 42)).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(await send(IPC_CHANNELS.projectsStatus, 'x'.repeat(500))).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(await send(IPC_CHANNELS.projectsStatus, 'unbekannt')).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(await send(IPC_CHANNELS.projectsStatus, 'p-123456')).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.projectsList, { extra: 1 })).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(await send(IPC_CHANNELS.runCancel, { runKey: 'k1' })).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.appSetState, 'kein Objekt')).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.appSetState, { selection: { repositoryId: 'a' }, projectConfig: { allowPaidUsage: true } })).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.appSetState, { selection: { password: 'x' } })).toMatchObject({ ok: false });
  });

  it('liefert keinen Kanal für Pfade, Umgebungsvariablen oder rohe Befehle', () => {
    // `shell` opens by kind and id and the app opens only links after confirmation; neither takes a path.
    // `system:openDataRoot` opens the data root and takes nothing; the folder of the wizard is chosen in the system dialog.
    // `config:testPath` takes a repository path to test against the filter, and only answers allowed or not.
    const names = Object.values(IPC_CHANNELS).join(' ').replace(/ipa:shell:(open|reveal|copyPath|copy|openExternal)/g, '').replace(/ipa:config:testPath/, '').replace(/ipa:system:openDataRoot/, '');
    expect(names).not.toMatch(/env|path|open|exec|spawn|readFile|shell/i);
    expect(Object.values(IPC_CHANNELS).some((channel) => /spawn|exec|command/i.test(channel))).toBe(false);
  });

  it('nimmt beim Start eines Laufs nur die Aktionen aus §4.1 mit geprüften Feldern an', async () => {
    const send = (channel: string, argument: unknown) => ipcMain.listeners.get(channel)?.(trusted('app://app/index.html'), argument);
    const started: unknown[] = [];
    (services as unknown as Record<string, unknown>)['startRun'] = vi.fn(async (_id: string, request: unknown) => {
      started.push(request);
      return { ok: true, value: { ok: true, runKey: 'k1' } };
    });
    const start = (request: unknown) => send(IPC_CHANNELS.runStart, { repositoryId: 'p-123456', input: request });
    const good: unknown[] = [
      { name: 'capture', mode: 'full' },
      { name: 'capture', mode: 'noAnalysis' },
      { name: 'capture', mode: 'retry', retrySnapshotId: 'S000002' },
      { name: 'journal' },
      { name: 'journal', day: '2026-11-26', noAi: true },
      { name: 'skip', snapshotId: 'S000002', reason: 'Bewusst ausgelassen' },
      { name: 'baseline', reason: 'Neuer Branch', force: true },
      { name: 'doctor' },
      { name: 'note', text: '--Käse "mit" Zeilen\nund & Sonderzeichen' },
      { name: 'note', text: 'x', type: 'decision', day: '2026-11-26', minutes: 30, timeKind: 'estimated', delay: 5, reason: 'r', alternatives: ['a', 'b'], refs: ['S000002:E001'] },
      { name: 'note', text: 'x', type: 'activity', start: '09:30', end: '10:15', timeKind: 'measured' },
    ];
    for (const request of good) expect(await start(request), JSON.stringify(request)).toMatchObject({ ok: true });
    expect(started).toEqual(good);

    const bad: unknown[] = [
      'capture',
      { name: 'schedule' },
      { name: 'config' },
      { name: 'capture', mode: 'full', extra: 1 },
      { name: 'capture', mode: 'retry' },
      { name: 'capture', mode: 'retry', retrySnapshotId: '../S000002' },
      { name: 'capture', mode: 'full', retrySnapshotId: 'S000002' },
      { name: 'capture', mode: 'alles' },
      { name: 'journal', day: '26.11.2026' },
      { name: 'journal', noAi: 'ja' },
      { name: 'skip', snapshotId: 'S000002', reason: '   ' },
      { name: 'skip', snapshotId: 'S2', reason: 'x' },
      { name: 'skip', snapshotId: 'S000002', reason: 'x'.repeat(2001) },
      { name: 'baseline', reason: '' },
      { name: 'doctor', fix: true },
      { name: 'note', text: '' },
      { name: 'note', text: 'x'.repeat(8001) },
      { name: 'note', text: 'x', type: 'geheim' },
      { name: 'note', text: 'x', minutes: 0 },
      { name: 'note', text: 'x', minutes: 1.5 },
      { name: 'note', text: 'x', minutes: 1441 },
      { name: 'note', text: 'x', start: '25:00' },
      { name: 'note', text: 'x', timeKind: 'ungefähr' },
      { name: 'note', text: 'x', refs: ['S000002'] },
      { name: 'note', text: 'x', refs: ['--ref'] },
      { name: 'note', text: 'x', alternatives: new Array(21).fill('a') },
      { name: 'note', text: 'x', path: 'C:/x' },
      { name: 'note', text: 'x', args: ['--force'] },
    ];
    for (const request of bad) expect(await start(request), JSON.stringify(request)).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(started).toHaveLength(good.length);
    expect(await send(IPC_CHANNELS.runStart, { repositoryId: 'p-123456', input: good[0], cwd: 'C:/' })).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.runStart, 'capture')).toMatchObject({ ok: false });
  });

  it('prüft Projekt und Text bei Zustand, Belegliste und Geheimnisprüfung', async () => {
    const send = (channel: string, argument: unknown) => ipcMain.listeners.get(channel)?.(trusted('app://app/index.html'), argument);
    const fake = services as unknown as Record<string, unknown>;
    fake['runState'] = vi.fn(async () => ({ ok: true, value: { own: [], foreign: null } }));
    fake['loadEvidenceList'] = vi.fn(async () => ({ ok: true, value: [] }));
    fake['scanText'] = vi.fn(async () => ({ ok: true, value: { detectors: [] } }));
    expect(await send(IPC_CHANNELS.runState, 'p-123456')).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.runState, 42)).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.snapshotEvidenceList, 'p-123456')).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.snapshotEvidenceList, { repositoryId: 'p' })).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.configScanText, { repositoryId: 'p-123456', text: 'ein Grund' })).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.configScanText, { repositoryId: 'p-123456', text: 'x'.repeat(20_001) })).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.configScanText, { repositoryId: 'p-123456', text: 'x', extra: 1 })).toMatchObject({ ok: false });
  });

  it('prüft Konfiguration und Zeitplan: nur freigegebene Felder, JSON-Werte, keine Pfade des Systems', async () => {
    const send = (channel: string, argument: unknown) => ipcMain.listeners.get(channel)?.(trusted('app://app/index.html'), argument);
    const fake = services as unknown as Record<string, unknown>;
    for (const name of ['loadConfig', 'previewConfig', 'testPath', 'chooseFile', 'loadSchedule', 'loadRunHistory']) fake[name] = vi.fn(async () => ({ ok: true, value: {} }));
    expect(await send(IPC_CHANNELS.configRead, 'p-123456')).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.configRead, 42)).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.scheduleStatus, 'p-123456')).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.scheduleRuns, 'p-123456')).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.configChooseFile, 'p-123456')).toMatchObject({ ok: true });
    const preview = (changes: unknown) => send(IPC_CHANNELS.configPreview, { repositoryId: 'p-123456', changes });
    expect(await preview([{ path: 'schedule.intervalMinutes', value: 60 }])).toMatchObject({ ok: true });
    expect(await preview([{ path: 'claude.model', value: null }, { path: 'paths.include', value: ['src/**'] }])).toMatchObject({ ok: true });
    for (const bad of [[], 'x', [{ path: 'timezone', value: 'UTC' }], [{ path: 'repository.path', value: 'C:/x' }], [{ path: 'claude.command', value: ['x'] }], [{ path: 'schemaVersion', value: 2 }], [{ path: 'claude', value: {} }], [{ path: 'claude.maxTurns', value: 1 }, { path: 'claude.maxTurns', value: 2 }], [{ path: 'claude.maxTurns', value: 1, extra: 1 }], [{ path: 'claude.maxTurns', value: () => 1 }], [{ path: 'claude.maxTurns', value: undefined }], [{ path: 'claude.maxTurns', value: Number.NaN }], [{ path: 'claude.model', value: 'x'.repeat(60_000) }], [{ path: 'paths.include', value: [[[[[['tief']]]]]] }], new Array(31).fill({ path: 'claude.maxTurns', value: 1 })]) {
      expect(await preview(bad), JSON.stringify(bad)).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    }
    const test = (extra: Record<string, unknown>) => send(IPC_CHANNELS.configTestPath, { repositoryId: 'p-123456', include: ['**'], exclude: ['*.log'], path: 'src/a.ts', ...extra });
    expect(await test({})).toMatchObject({ ok: true });
    for (const bad of [{ include: 'x' }, { exclude: [''] }, { exclude: [42] }, { include: new Array(201).fill('a') }, { path: 'x'.repeat(1001) }, { cwd: 'C:/' }]) expect(await test(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
  });

  it('startet Konfiguration und Zeitplan nur als getippte Aktion; die Bestätigung nur zum Schalter', async () => {
    const send = (argument: unknown) => ipcMain.listeners.get(IPC_CHANNELS.runStart)?.(trusted('app://app/index.html'), { repositoryId: 'p-123456', input: argument });
    (services as unknown as Record<string, unknown>)['startRun'] = vi.fn(async () => ({ ok: true, value: { ok: true, runKey: 'k1' } }));
    for (const good of [
      { name: 'configSet', changes: [{ path: 'claude.maxTurns', value: 3 }] },
      { name: 'configSet', changes: [{ path: 'claude.allowPaidUsage', value: true }], confirmPaidUsage: true },
      { name: 'configSet', changes: [{ path: 'claude.allowPaidUsage', value: false }] },
      { name: 'scheduleInstall' },
      { name: 'scheduleInstall', update: true },
      { name: 'schedulePause' },
      { name: 'scheduleResume' },
      { name: 'scheduleRemove' },
      { name: 'scheduleRun' },
    ]) expect(await send(good), JSON.stringify(good)).toMatchObject({ ok: true });
    for (const bad of [
      { name: 'configSet', changes: [{ path: 'claude.maxTurns', value: 3 }], confirmPaidUsage: true },
      { name: 'configSet', changes: [{ path: 'claude.allowPaidUsage', value: false }], confirmPaidUsage: true },
      { name: 'configSet', changes: [{ path: 'claude.allowPaidUsage', value: true }], confirmPaidUsage: 'ja' },
      { name: 'configSet', changes: [{ path: 'claude.allowPaidUsage', value: true }], dryRun: false },
      { name: 'configSet' },
      { name: 'scheduleInstall', update: 'ja' },
      { name: 'scheduleRun', os: 'linux' },
      { name: 'schedulePause', args: ['--force'] },
      { name: 'configCheck' },
    ]) expect(await send(bad), JSON.stringify(bad)).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });

  it('prüft Assistent und System: keine Pfade vom Renderer, Zeitzone aus der Laufzeit, feste Zeiträume', async () => {
    const send = (channel: string, argument: unknown) => ipcMain.listeners.get(channel)?.(trusted('app://app/index.html'), argument);
    const fake = services as unknown as Record<string, unknown>;
    for (const name of ['chooseFolder', 'checkChosenFolder', 'initChosenFolder', 'systemStatus', 'loadUsage', 'openDataRoot', 'copyDataRoot']) fake[name] = vi.fn(async () => ({ ok: true, value: {} }));
    for (const channel of [IPC_CHANNELS.projectChooseFolder, IPC_CHANNELS.projectCheck, IPC_CHANNELS.systemStatus, IPC_CHANNELS.systemOpenDataRoot, IPC_CHANNELS.systemCopyDataRoot]) {
      expect(await send(channel, undefined), channel).toMatchObject({ ok: true });
      // The folder and the data root are never named by the renderer.
      expect(await send(channel, { path: 'C:/Windows' }), channel).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    }
    expect(await send(IPC_CHANNELS.projectInit, { timezone: 'Europe/Zurich', workspace: 'default' })).toMatchObject({ ok: true });
    for (const bad of [{ timezone: 'Mars/Olympus', workspace: 'default' }, { timezone: 'Europe/Zurich', workspace: 'default', repoPath: 'C:/x' }, { timezone: 'Europe/Zurich', workspace: 'C:/x' }, 'Europe/Zurich']) {
      expect(await send(IPC_CHANNELS.projectInit, bad), JSON.stringify(bad)).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    }
    for (const range of ['7', '30', 'all']) expect(await send(IPC_CHANNELS.systemUsage, range), range).toMatchObject({ ok: true });
    for (const bad of ['1', 7, '../x', undefined]) expect(await send(IPC_CHANNELS.systemUsage, bad), String(bad)).toMatchObject({ ok: false });
  });

  it('prüft Endfassung und Löschen: nur Entwurf oder Endfassung, nie ein Pfad', async () => {
    const send = (channel: string, argument: unknown) => ipcMain.listeners.get(channel)?.(trusted('app://app/index.html'), argument);
    const fake = services as unknown as Record<string, unknown>;
    fake['loadFinals'] = vi.fn(async () => ({ ok: true, value: [] }));
    fake['finalizeDraft'] = vi.fn(async () => ({ ok: true, value: { file: '2026-11-26.md' } }));
    fake['removeJournalFile'] = vi.fn(async () => ({ ok: true, value: { removed: true, problem: null } }));
    expect(await send(IPC_CHANNELS.journalFinals, { repositoryId: 'p-123456', day: '2026-11-26' })).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.journalFinals, { repositoryId: 'p-123456', day: '../x' })).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.journalFinalize, { repositoryId: 'p-123456', file: '2026-11-26-R20261126T100000Z-ab12' })).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.journalFinalize, { repositoryId: 'p-123456', file: 'x', target: 'C:/x' })).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.journalRemove, { repositoryId: 'p-123456', kind: 'final', file: '2026-11-26.md' })).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.journalRemove, { repositoryId: 'p-123456', kind: 'draft', file: '2026-11-26-R20261126T100000Z-ab12' })).toMatchObject({ ok: true });
    for (const kind of ['workLog', 'config', 'path', undefined, 42]) {
      expect(await send(IPC_CHANNELS.journalRemove, { repositoryId: 'p-123456', kind, file: 'x' }), String(kind)).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    }
    expect(await send(IPC_CHANNELS.journalRemove, { repositoryId: 'p-123456', kind: 'final', file: 'x'.repeat(200) })).toMatchObject({ ok: false });
    expect(fake['removeJournalFile']).toHaveBeenCalledTimes(2);
  });

  it('prüft die Eingaben der Leseansichten und der Shell', async () => {
    const send = (channel: string, argument: unknown) => ipcMain.listeners.get(channel)?.(trusted('app://app/index.html'), argument);
    const readers = services as unknown as Record<string, ReturnType<typeof vi.fn>>;
    for (const name of ['loadDay', 'loadDayIndex', 'loadWorkLog', 'loadJournal', 'loadReferences', 'loadOverview', 'openFile', 'revealFile', 'copyFilePath', 'copyText', 'openExternal']) {
      readers[name] = vi.fn(async () => ({ ok: true, value: name === 'openFile' || name === 'revealFile' || name === 'copyFilePath' ? { opened: true } : {} }));
    }
    // Day and project id are validated; extra fields are refused.
    expect(await send(IPC_CHANNELS.dayLoad, { repositoryId: 'p-123456', day: '2026-11-26' })).toMatchObject({ ok: true });
    expect(await send(IPC_CHANNELS.dayLoad, { repositoryId: 'p-123456', day: '26.11.2026' })).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(await send(IPC_CHANNELS.dayLoad, { repositoryId: 'p-123456', day: '2026-11-26', path: 'C:/x' })).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.dayLoad, '2026-11-26')).toMatchObject({ ok: false });
    // Files are referenced by kind and id, never by path.
    const open = (ref: unknown) => send(IPC_CHANNELS.shellOpen, { repositoryId: 'p-123456', ref });
    expect(await open({ kind: 'workLog', snapshotId: 'S000002' })).toMatchObject({ ok: true });
    expect(await open({ kind: 'journalFinalFolder' })).toMatchObject({ ok: true });
    expect(await open({ kind: 'workLog', snapshotId: 'S000002', path: 'C:/Windows/system32/cmd.exe' })).toMatchObject({ ok: false });
    expect(await open({ kind: 'path', path: 'C:/Windows/system32/cmd.exe' })).toMatchObject({ ok: false });
    expect(await open('C:/Windows/system32/cmd.exe')).toMatchObject({ ok: false });
    // External links: only http and https.
    const external = (url: unknown) => send(IPC_CHANNELS.shellOpenExternal, url);
    expect(await external('https://example.com/seite')).toMatchObject({ ok: true });
    expect(await external('http://example.com/')).toMatchObject({ ok: true });
    for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<script>1</script>', 'vbscript:x', 'ms-msdt:/id', '//example.com', 'kein link', 42]) {
      expect(await external(bad), String(bad)).toMatchObject({ ok: false });
    }
    expect(await send(IPC_CHANNELS.shellCopy, 42)).toMatchObject({ ok: false });
    expect(await send(IPC_CHANNELS.shellCopy, 'Text')).toMatchObject({ ok: true });
  });
});

describe('Zustand patchen (AD-08)', () => {
  it('lässt nur Fenster und Auswahl zu und bereinigt Werte', () => {
    expect(parseStatePatch({ selection: { section: 'day', day: '2026-11-26' } })).toEqual({ selection: { section: 'day', day: '2026-11-26' } });
    expect(parseStatePatch({ window: { width: 10 } })).toEqual({ window: { width: 1100 } });
    for (const theme of ['system', 'light', 'dark']) expect(parseStatePatch({ theme })).toEqual({ theme });
    for (const bad of ['Dunkel', '', 'auto', 1, null, ['dark']]) expect(() => parseStatePatch({ theme: bad }), String(bad)).toThrow();
    expect(() => parseStatePatch({ config: {} })).toThrow();
    expect(() => parseStatePatch({ window: { evil: 1 } })).toThrow();
  });
});
