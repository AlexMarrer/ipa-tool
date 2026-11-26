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
    start: (repositoryId, input) => ipcRenderer.invoke(IPC_CHANNELS.runStart, { repositoryId, input }),
    state: (repositoryId) => ipcRenderer.invoke(IPC_CHANNELS.runState, repositoryId),
    cancel: (runKey) => ipcRenderer.invoke(IPC_CHANNELS.runCancel, runKey),
    onEvent: (listener) => subscribe<RunEvent>(IPC_CHANNELS.runEvent, listener),
  },
  config: {
    scanText: (repositoryId, text) => ipcRenderer.invoke(IPC_CHANNELS.configScanText, { repositoryId, text }),
  },
  system: {
    versions: () => ipcRenderer.invoke(IPC_CHANNELS.systemVersions),
    dataRoot: () => ipcRenderer.invoke(IPC_CHANNELS.systemDataRoot),
  },
  app: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.appGetState),
    setState: (patch) => ipcRenderer.invoke(IPC_CHANNELS.appSetState, patch),
  },
  day: {
    load: (repositoryId, day) => ipcRenderer.invoke(IPC_CHANNELS.dayLoad, { repositoryId, day }),
    index: (repositoryId) => ipcRenderer.invoke(IPC_CHANNELS.dayIndex, repositoryId),
  },
  snapshot: {
    workLog: (repositoryId, snapshotId) => ipcRenderer.invoke(IPC_CHANNELS.snapshotWorkLog, { repositoryId, snapshotId }),
    evidenceList: (repositoryId) => ipcRenderer.invoke(IPC_CHANNELS.snapshotEvidenceList, repositoryId),
  },
  journal: {
    read: (repositoryId, file) => ipcRenderer.invoke(IPC_CHANNELS.journalRead, { repositoryId, file }),
    finals: (repositoryId, day) => ipcRenderer.invoke(IPC_CHANNELS.journalFinals, { repositoryId, day }),
    finalize: (repositoryId, draftFile) => ipcRenderer.invoke(IPC_CHANNELS.journalFinalize, { repositoryId, file: draftFile }),
    remove: (repositoryId, kind, file) => ipcRenderer.invoke(IPC_CHANNELS.journalRemove, { repositoryId, kind, file }),
  },
  notes: {
    references: (repositoryId) => ipcRenderer.invoke(IPC_CHANNELS.notesReferences, repositoryId),
  },
  overview: {
    load: (repositoryId) => ipcRenderer.invoke(IPC_CHANNELS.overviewLoad, repositoryId),
  },
  shell: {
    open: (repositoryId, ref) => ipcRenderer.invoke(IPC_CHANNELS.shellOpen, { repositoryId, ref }),
    reveal: (repositoryId, ref) => ipcRenderer.invoke(IPC_CHANNELS.shellReveal, { repositoryId, ref }),
    copy: (text) => ipcRenderer.invoke(IPC_CHANNELS.shellCopy, text),
    copyPath: (repositoryId, ref) => ipcRenderer.invoke(IPC_CHANNELS.shellCopyPath, { repositoryId, ref }),
    openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.shellOpenExternal, url),
  },
};

contextBridge.exposeInMainWorld('ipa', api);
