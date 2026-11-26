import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, type IpaApi, type Unsubscribe } from '../shared/ipc';
import type { ProjectsChange, RunEvent } from '../shared/types';

function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  // The raw event (with `sender`) never reaches the renderer.
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => void ipcRenderer.removeListener(channel, wrapped);
}

/** The only surface of the renderer (spec §3.9): no `ipcRenderer`, no Node, no paths to open. */
const api: IpaApi = {
  projects: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList),
    status: (repositoryId) => ipcRenderer.invoke(IPC_CHANNELS.projectsStatus, repositoryId),
    onChanged: (listener) => subscribe<ProjectsChange>(IPC_CHANNELS.projectsChanged, listener),
  },
  run: {
    cancel: (runKey) => ipcRenderer.invoke(IPC_CHANNELS.runCancel, runKey),
    onEvent: (listener) => subscribe<RunEvent>(IPC_CHANNELS.runEvent, listener),
  },
  system: {
    versions: () => ipcRenderer.invoke(IPC_CHANNELS.systemVersions),
    dataRoot: () => ipcRenderer.invoke(IPC_CHANNELS.systemDataRoot),
  },
  app: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.appGetState),
    setState: (patch) => ipcRenderer.invoke(IPC_CHANNELS.appSetState, patch),
  },
};

contextBridge.exposeInMainWorld('ipa', api);
