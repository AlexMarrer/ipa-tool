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
    const names = Object.values(IPC_CHANNELS).join(' ').replace(/ipa:shell:(open|reveal|copyPath|copy|openExternal)/g, '');
    expect(names).not.toMatch(/env|path|open|exec|spawn|readFile|shell/i);
    expect(Object.values(IPC_CHANNELS).some((channel) => /run:start|spawn|exec/i.test(channel))).toBe(false);
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
    expect(() => parseStatePatch({ config: {} })).toThrow();
    expect(() => parseStatePatch({ window: { evil: 1 } })).toThrow();
  });
});
