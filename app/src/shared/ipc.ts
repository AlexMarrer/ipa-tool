import type { AppState, IpaResult, Project, ProjectList, ProjectsChange, RunEvent, VersionInfo } from './types';
import type { LockState, RunInput, StartOutcome } from './run';
import type { DayIndex, DayView, EvidenceGroup, FileRef, FinalFileView, JournalDraftView, OverviewView, ReferenceIndex, RemoveResult, WorkLogView } from './views';

/**
 * Channels of the IPC interface. The groups implemented so far are projects, run (cancel, events), system, app,
 * day, snapshot, journal, notes (reference index), overview and shell (open, reveal, copy, external link).
 * The remaining methods of spec §3.9 (run.start, config, schedule, ...) arrive with their packages.
 */
export const IPC_CHANNELS = {
  projectsList: 'ipa:projects:list',
  projectsStatus: 'ipa:projects:status',
  projectsChanged: 'ipa:projects:changed',
  runStart: 'ipa:run:start',
  runState: 'ipa:run:state',
  runCancel: 'ipa:run:cancel',
  runEvent: 'ipa:run:event',
  snapshotEvidenceList: 'ipa:snapshot:evidenceList',
  configScanText: 'ipa:config:scanText',
  systemVersions: 'ipa:system:versions',
  systemDataRoot: 'ipa:system:dataRoot',
  appGetState: 'ipa:app:getState',
  appSetState: 'ipa:app:setState',
  dayLoad: 'ipa:day:load',
  dayIndex: 'ipa:day:index',
  snapshotWorkLog: 'ipa:snapshot:workLog',
  journalRead: 'ipa:journal:read',
  journalFinals: 'ipa:journal:finals',
  journalFinalize: 'ipa:journal:finalize',
  journalRemove: 'ipa:journal:remove',
  notesReferences: 'ipa:notes:references',
  overviewLoad: 'ipa:overview:load',
  shellOpen: 'ipa:shell:open',
  shellReveal: 'ipa:shell:reveal',
  shellCopy: 'ipa:shell:copy',
  shellCopyPath: 'ipa:shell:copyPath',
  shellOpenExternal: 'ipa:shell:openExternal',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Channels the renderer may invoke (request/response). */
export const INVOKE_CHANNELS: readonly IpcChannel[] = [
  IPC_CHANNELS.projectsList,
  IPC_CHANNELS.projectsStatus,
  IPC_CHANNELS.runStart,
  IPC_CHANNELS.runState,
  IPC_CHANNELS.snapshotEvidenceList,
  IPC_CHANNELS.configScanText,
  IPC_CHANNELS.runCancel,
  IPC_CHANNELS.systemVersions,
  IPC_CHANNELS.systemDataRoot,
  IPC_CHANNELS.appGetState,
  IPC_CHANNELS.appSetState,
  IPC_CHANNELS.dayLoad,
  IPC_CHANNELS.dayIndex,
  IPC_CHANNELS.snapshotWorkLog,
  IPC_CHANNELS.journalRead,
  IPC_CHANNELS.journalFinals,
  IPC_CHANNELS.journalFinalize,
  IPC_CHANNELS.journalRemove,
  IPC_CHANNELS.notesReferences,
  IPC_CHANNELS.overviewLoad,
  IPC_CHANNELS.shellOpen,
  IPC_CHANNELS.shellReveal,
  IPC_CHANNELS.shellCopy,
  IPC_CHANNELS.shellCopyPath,
  IPC_CHANNELS.shellOpenExternal,
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
    /** Starts one of the actions of package 12 on the user's request. Never called by the app on its own. */
    start(repositoryId: string, input: RunInput): Promise<IpaResult<StartOutcome>>;
    /** Runs of the app and a foreign run from the lock file, to lock buttons (spec §3.7). */
    state(repositoryId: string): Promise<IpaResult<LockState>>;
    cancel(runKey: string): Promise<IpaResult<{ cancelled: boolean }>>;
    onEvent(listener: (event: RunEvent) => void): Unsubscribe;
  };
  config: {
    /** Detector names that hit in a text, never the value; used before a reason is sent (spec §8.9). */
    scanText(repositoryId: string, text: string): Promise<IpaResult<{ detectors: string[] }>>;
  };
  system: {
    versions(): Promise<IpaResult<VersionInfo>>;
    dataRoot(): Promise<IpaResult<{ path: string }>>;
  };
  app: {
    getState(): Promise<IpaResult<AppState>>;
    setState(patch: Partial<Pick<AppState, 'window' | 'selection'>>): Promise<IpaResult<AppState>>;
  };
  day: {
    load(repositoryId: string, day: string): Promise<IpaResult<DayView>>;
    index(repositoryId: string): Promise<IpaResult<DayIndex>>;
  };
  snapshot: {
    /** `null` when the snapshot does not exist. */
    workLog(repositoryId: string, snapshotId: string): Promise<IpaResult<WorkLogView | null>>;
    evidenceList(repositoryId: string): Promise<IpaResult<EvidenceGroup[]>>;
  };
  journal: {
    /** The list of drafts of a day is part of `day.load`. */
    read(repositoryId: string, file: string): Promise<IpaResult<JournalDraftView | null>>;
    /** Files in `journal/final/` that belong to the day (name starts with the day). */
    finals(repositoryId: string, day: string): Promise<IpaResult<FinalFileView[]>>;
    /** Copies a draft to `journal/final/<day>.md` on the user's request; never overwrites (numbered if the name is taken). */
    finalize(repositoryId: string, draftFile: string): Promise<IpaResult<{ file: string }>>;
    /** Moves a draft (with its record) or a final file to the recycle bin. */
    remove(repositoryId: string, kind: 'draft' | 'final', file: string): Promise<IpaResult<RemoveResult>>;
  };
  notes: {
    references(repositoryId: string): Promise<IpaResult<ReferenceIndex>>;
  };
  overview: {
    load(repositoryId: string): Promise<IpaResult<OverviewView>>;
  };
  shell: {
    /** Opens a file with the standard program; resolves to `false` if it does not exist. */
    open(repositoryId: string, ref: FileRef): Promise<IpaResult<{ opened: boolean }>>;
    reveal(repositoryId: string, ref: FileRef): Promise<IpaResult<{ opened: boolean }>>;
    copy(text: string): Promise<IpaResult<{ copied: true }>>;
    /** Copies the path of a file; the main process resolves it, the renderer never sees it. */
    copyPath(repositoryId: string, ref: FileRef): Promise<IpaResult<{ opened: boolean }>>;
    /** Only `http:` and `https:`; the renderer asks the user first (spec §11.1). */
    openExternal(url: string): Promise<IpaResult<{ opened: true }>>;
  };
}

declare global {
  interface Window {
    ipa: IpaApi;
  }
}
