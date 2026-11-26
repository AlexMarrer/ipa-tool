import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INVOKE_CHANNELS, IPC_CHANNELS } from '../../src/shared/ipc';

const exposed: Record<string, unknown> = {};
const invoke = vi.fn(async () => ({ ok: true, value: null }));
const on = vi.fn();
const removeListener = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => void (exposed[name] = api) },
  ipcRenderer: { invoke, on, removeListener },
}));

describe('Preload: window.ipa (AK-10-04)', () => {
  beforeEach(async () => {
    vi.resetModules();
    invoke.mockClear();
    on.mockClear();
    await import('../../src/preload/index');
  });

  const api = () => exposed['ipa'] as Record<string, Record<string, (...args: unknown[]) => unknown>>;

  it('stellt genau window.ipa mit den Gruppen aus §3.9 bereit und sonst nichts', () => {
    expect(Object.keys(exposed)).toEqual(['ipa']);
    expect(Object.keys(api()).sort()).toEqual(['app', 'config', 'day', 'journal', 'notes', 'overview', 'projects', 'run', 'schedule', 'shell', 'snapshot', 'system']);
    expect(Object.keys(api()['projects'] ?? {}).sort()).toEqual(['list', 'onChanged', 'status']);
    expect(Object.keys(api()['run'] ?? {}).sort()).toEqual(['cancel', 'onEvent', 'start', 'state']);
    expect(Object.keys(api()['config'] ?? {}).sort()).toEqual(['chooseFile', 'preview', 'read', 'scanText', 'testPath']);
    expect(Object.keys(api()['schedule'] ?? {}).sort()).toEqual(['runs', 'status']);
    expect(Object.keys(api()['system'] ?? {}).sort()).toEqual(['dataRoot', 'versions']);
    expect(Object.keys(api()['app'] ?? {}).sort()).toEqual(['getState', 'setState']);
    expect(Object.keys(api()['day'] ?? {}).sort()).toEqual(['index', 'load']);
    expect(Object.keys(api()['snapshot'] ?? {}).sort()).toEqual(['evidenceList', 'workLog']);
    expect(Object.keys(api()['journal'] ?? {}).sort()).toEqual(['finalize', 'finals', 'read', 'remove']);
    expect(Object.keys(api()['notes'] ?? {})).toEqual(['references']);
    expect(Object.keys(api()['overview'] ?? {})).toEqual(['load']);
    expect(Object.keys(api()['shell'] ?? {}).sort()).toEqual(['copy', 'copyPath', 'open', 'openExternal', 'reveal']);
    expect(JSON.stringify(Object.keys(exposed))).not.toMatch(/ipcRenderer|process|require/);
  });

  it('ruft jede Methode nur über einen freigegebenen Kanal auf', async () => {
    const a = api();
    await a['projects']?.['list']?.();
    await a['projects']?.['status']?.('p-123456');
    await a['run']?.['cancel']?.('k1');
    await a['run']?.['start']?.('p-123456', { name: 'doctor' });
    await a['run']?.['state']?.('p-123456');
    await a['config']?.['scanText']?.('p-123456', 'Text');
    await a['config']?.['read']?.('p-123456');
    await a['config']?.['preview']?.('p-123456', [{ path: 'claude.maxTurns', value: 3 }]);
    await a['config']?.['testPath']?.('p-123456', { include: ['**'], exclude: [], path: 'a.ts' });
    await a['config']?.['chooseFile']?.('p-123456');
    await a['schedule']?.['status']?.('p-123456');
    await a['schedule']?.['runs']?.('p-123456');
    await a['snapshot']?.['evidenceList']?.('p-123456');
    await a['system']?.['versions']?.();
    await a['system']?.['dataRoot']?.();
    await a['app']?.['getState']?.();
    await a['app']?.['setState']?.({ selection: { day: '2026-11-26' } });
    await a['day']?.['load']?.('p-123456', '2026-11-26');
    await a['day']?.['index']?.('p-123456');
    await a['snapshot']?.['workLog']?.('p-123456', 'S000002');
    await a['journal']?.['read']?.('p-123456', '2026-11-26-R20261126T100000Z-ab12');
    await a['journal']?.['finals']?.('p-123456', '2026-11-26');
    await a['journal']?.['finalize']?.('p-123456', '2026-11-26-R20261126T100000Z-ab12');
    await a['journal']?.['remove']?.('p-123456', 'draft', '2026-11-26-R20261126T100000Z-ab12');
    await a['notes']?.['references']?.('p-123456');
    await a['overview']?.['load']?.('p-123456');
    await a['shell']?.['open']?.('p-123456', { kind: 'journalFinalFolder' });
    await a['shell']?.['reveal']?.('p-123456', { kind: 'workspaceFolder' });
    await a['shell']?.['copy']?.('Text');
    await a['shell']?.['copyPath']?.('p-123456', { kind: 'workspaceFolder' });
    await a['shell']?.['openExternal']?.('https://example.com/');
    const channels = invoke.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(new Set(channels)).toEqual(new Set(INVOKE_CHANNELS));
  });

  it('gibt Ereignisse ohne das rohe Event weiter und lässt sich abmelden', () => {
    const listener = vi.fn();
    const stop = (api()['projects']?.['onChanged'] as (cb: (payload: unknown) => void) => () => void)(listener);
    const [channel, wrapped] = on.mock.calls[0] as unknown as [string, (event: unknown, payload: unknown) => void];
    expect(channel).toBe(IPC_CHANNELS.projectsChanged);
    wrapped({ sender: 'geheim' }, { repositoryId: 'a' });
    expect(listener).toHaveBeenCalledWith({ repositoryId: 'a' });
    stop();
    expect(removeListener).toHaveBeenCalledWith(channel, wrapped);
  });
});
