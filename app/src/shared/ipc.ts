import type { AppState, IpaResult, Project, ProjectList, ProjectsChange, RunEvent, VersionInfo } from './types';

/**
 * Channels of the IPC interface. Paket 10 implements the groups it needs; the remaining methods of
 * spec §3.9 (day, snapshot, journal, config, schedule, shell, run.start, ...) arrive with their packages.
 */
export const IPC_CHANNELS = {
  projectsList: 'ipa:projects:list',
  projectsStatus: 'ipa:projects:status',
  projectsChanged: 'ipa:projects:changed',
  runCancel: 'ipa:run:cancel',
  runEvent: 'ipa:run:event',
  systemVersions: 'ipa:system:versions',
  systemDataRoot: 'ipa:system:dataRoot',
  appGetState: 'ipa:app:getState',
  appSetState: 'ipa:app:setState',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Channels the renderer may invoke (request/response). */
export const INVOKE_CHANNELS: readonly IpcChannel[] = [
  IPC_CHANNELS.projectsList,
  IPC_CHANNELS.projectsStatus,
  IPC_CHANNELS.runCancel,
  IPC_CHANNELS.systemVersions,
  IPC_CHANNELS.systemDataRoot,
  IPC_CHANNELS.appGetState,
  IPC_CHANNELS.appSetState,
];

/** Channels main pushes to the renderer. */
export const EVENT_CHANNELS: readonly IpcChannel[] = [IPC_CHANNELS.projectsChanged, IPC_CHANNELS.runEvent];

export type Unsubscribe = () => void;

/** The only object the renderer sees as `window.ipa` (spec §3.9). */
export interface IpaApi {
  projects: {
    list(): Promise<IpaResult<ProjectList>>;
    status(repositoryId: string): Promise<IpaResult<Project>>;
    onChanged(listener: (change: ProjectsChange) => void): Unsubscribe;
  };
  run: {
    cancel(runKey: string): Promise<IpaResult<{ cancelled: boolean }>>;
    onEvent(listener: (event: RunEvent) => void): Unsubscribe;
  };
  system: {
    versions(): Promise<IpaResult<VersionInfo>>;
    dataRoot(): Promise<IpaResult<{ path: string }>>;
  };
  app: {
    getState(): Promise<IpaResult<AppState>>;
    setState(patch: Partial<Pick<AppState, 'window' | 'selection'>>): Promise<IpaResult<AppState>>;
  };
}

declare global {
  interface Window {
    ipa: IpaApi;
  }
}
