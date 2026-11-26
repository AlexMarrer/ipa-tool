import { APP_ERROR_MESSAGES } from '../../shared/messages';
import { IPC_CHANNELS, type IpcChannel } from '../../shared/ipc';
import { THEME_CHOICES, type AppState, type ThemeChoice } from '../../shared/types';
import { sanitizeAppState } from '../app-state';
import { AppError } from '../cli/errors';
import type { ReaderResult, Services } from '../services';
import { InvalidInput, input } from './guard';

export type Handler = (argument: unknown) => Promise<unknown>;

const SELECTION_KEYS = ['repositoryId', 'section', 'day'];
const WINDOW_KEYS = ['x', 'y', 'width', 'height', 'maximized'];

function onlyKeys(value: unknown, allowed: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidInput('Objekt erwartet.');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new InvalidInput(`Unbekanntes Feld: ${key}`);
  }
  return value as Record<string, unknown>;
}

/** Validates a state patch; only window and selection can change (spec AD-08). */
export function parseStatePatch(value: unknown): { window?: Partial<AppState['window']>; selection?: Partial<AppState['selection']>; theme?: ThemeChoice } {
  const patch = onlyKeys(value, ['window', 'selection', 'theme']);
  const result: { window?: Partial<AppState['window']>; selection?: Partial<AppState['selection']>; theme?: ThemeChoice } = {};
  if (patch['theme'] !== undefined) {
    if (typeof patch['theme'] !== 'string' || !(THEME_CHOICES as readonly string[]).includes(patch['theme'])) throw new InvalidInput('Darstellung erwartet.');
    result.theme = patch['theme'] as ThemeChoice;
  }
  if (patch['window'] !== undefined) {
    const raw = onlyKeys(patch['window'], WINDOW_KEYS);
    const clean = sanitizeAppState({ window: raw }).window;
    const picked: Partial<AppState['window']> = {};
    for (const key of Object.keys(raw)) (picked as Record<string, unknown>)[key] = (clean as Record<string, unknown>)[key];
    result.window = picked;
  }
  if (patch['selection'] !== undefined) {
    const raw = onlyKeys(patch['selection'], SELECTION_KEYS);
    const clean = sanitizeAppState({ selection: raw }).selection;
    const picked: Partial<AppState['selection']> = {};
    for (const key of Object.keys(raw)) (picked as Record<string, unknown>)[key] = (clean as Record<string, unknown>)[key];
    result.selection = picked;
  }
  return result;
}

function unwrap<T>(result: ReaderResult<T>): T {
  if (!result.ok) throw new AppError('project_unknown');
  return result.value;
}

/** The request handlers behind the channels; the renderer reaches nothing else (spec §3.9, AK-10-04). */
export function createHandlers(services: Services): Record<Exclude<IpcChannel, typeof IPC_CHANNELS.projectsChanged | typeof IPC_CHANNELS.runEvent>, Handler> {
  return {
    [IPC_CHANNELS.runStart]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'input']);
      return services.startRun(input.string(v['repositoryId'], 80), input.runInput(v['input']));
    },
    [IPC_CHANNELS.runState]: async (argument) => services.runState(input.string(argument, 80)),
    [IPC_CHANNELS.snapshotEvidenceList]: async (argument) => unwrap(await services.loadEvidenceList(input.string(argument, 80))),
    [IPC_CHANNELS.configScanText]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'text']);
      return unwrap(await services.scanText(input.string(v['repositoryId'], 80), input.text(v['text'], 20_000)));
    },
    [IPC_CHANNELS.projectChooseFolder]: async (argument) => {
      input.none(argument);
      return services.chooseFolder();
    },
    [IPC_CHANNELS.projectCheck]: async (argument) => {
      input.none(argument);
      return unwrap(await services.checkChosenFolder());
    },
    [IPC_CHANNELS.projectInit]: async (argument) => unwrap(await services.initChosenFolder(input.initInput(argument))),
    [IPC_CHANNELS.systemStatus]: async (argument) => {
      input.none(argument);
      return unwrap(await services.systemStatus());
    },
    [IPC_CHANNELS.systemUsage]: async (argument) => unwrap(await services.loadUsage(input.usageRange(argument))),
    [IPC_CHANNELS.systemOpenDataRoot]: async (argument) => {
      input.none(argument);
      return services.openDataRoot();
    },
    [IPC_CHANNELS.systemCopyDataRoot]: async (argument) => {
      input.none(argument);
      return services.copyDataRoot();
    },
    [IPC_CHANNELS.configRead]: async (argument) => unwrap(await services.loadConfig(input.string(argument, 80))),
    [IPC_CHANNELS.configPreview]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'changes']);
      return unwrap(await services.previewConfig(input.string(v['repositoryId'], 80), input.configChanges(v['changes'])));
    },
    [IPC_CHANNELS.configTestPath]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'include', 'exclude', 'path']);
      return unwrap(await services.testPath(input.string(v['repositoryId'], 80), input.patterns(v['include']), input.patterns(v['exclude']), input.string(v['path'], 1000)));
    },
    [IPC_CHANNELS.configChooseFile]: async (argument) => unwrap(await services.chooseFile(input.string(argument, 80))),
    [IPC_CHANNELS.scheduleStatus]: async (argument) => unwrap(await services.loadSchedule(input.string(argument, 80))),
    [IPC_CHANNELS.scheduleRuns]: async (argument) => unwrap(await services.loadRunHistory(input.string(argument, 80))),
    [IPC_CHANNELS.dayLoad]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'day']);
      return unwrap(await services.loadDay(input.string(v['repositoryId'], 80), input.day(v['day'])));
    },
    [IPC_CHANNELS.dayIndex]: async (argument) => unwrap(await services.loadDayIndex(input.string(argument, 80))),
    [IPC_CHANNELS.snapshotWorkLog]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'snapshotId']);
      return unwrap(await services.loadWorkLog(input.string(v['repositoryId'], 80), input.string(v['snapshotId'], 20)));
    },
    [IPC_CHANNELS.journalRead]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'file']);
      return unwrap(await services.loadJournal(input.string(v['repositoryId'], 80), input.string(v['file'], 60)));
    },
    [IPC_CHANNELS.journalFinals]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'day']);
      return unwrap(await services.loadFinals(input.string(v['repositoryId'], 80), input.day(v['day'])));
    },
    [IPC_CHANNELS.journalFinalize]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'file']);
      return unwrap(await services.finalizeDraft(input.string(v['repositoryId'], 80), input.string(v['file'], 60)));
    },
    [IPC_CHANNELS.journalRemove]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'kind', 'file']);
      if (v['kind'] !== 'draft' && v['kind'] !== 'final') throw new InvalidInput('Entwurf oder Endfassung erwartet.');
      return unwrap(await services.removeJournalFile(input.string(v['repositoryId'], 80), v['kind'], input.string(v['file'], 120)));
    },
    [IPC_CHANNELS.notesReferences]: async (argument) => unwrap(await services.loadReferences(input.string(argument, 80))),
    [IPC_CHANNELS.overviewLoad]: async (argument) => unwrap(await services.loadOverview(input.string(argument, 80))),
    [IPC_CHANNELS.shellOpen]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'ref']);
      return unwrap(await services.openFile(input.string(v['repositoryId'], 80), input.fileRef(v['ref'])));
    },
    [IPC_CHANNELS.shellReveal]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'ref']);
      return unwrap(await services.revealFile(input.string(v['repositoryId'], 80), input.fileRef(v['ref'])));
    },
    [IPC_CHANNELS.shellCopyPath]: async (argument) => {
      const v = input.fields(argument, ['repositoryId', 'ref']);
      return unwrap(await services.copyFilePath(input.string(v['repositoryId'], 80), input.fileRef(v['ref'])));
    },
    [IPC_CHANNELS.shellCopy]: async (argument) => {
      services.copyText(input.text(argument));
      return { copied: true };
    },
    [IPC_CHANNELS.shellOpenExternal]: async (argument) => {
      await services.openExternal(input.httpUrl(argument));
      return { opened: true };
    },
    [IPC_CHANNELS.projectsList]: async (argument) => {
      input.none(argument);
      return services.loadProjects();
    },
    [IPC_CHANNELS.projectsStatus]: async (argument) => {
      const repositoryId = input.string(argument, 80);
      const project = await services.loadProject(repositoryId);
      if (project === null) throw new InvalidInput(APP_ERROR_MESSAGES.project_unknown);
      return project;
    },
    [IPC_CHANNELS.runCancel]: async (argument) => {
      const runKey = input.string(argument, 40);
      return services.queue.cancel(runKey);
    },
    [IPC_CHANNELS.systemVersions]: async (argument) => {
      input.none(argument);
      return services.versions();
    },
    [IPC_CHANNELS.systemDataRoot]: async (argument) => {
      input.none(argument);
      return { path: services.dataRoot ?? '' };
    },
    [IPC_CHANNELS.appGetState]: async (argument) => {
      input.none(argument);
      return services.appState.get();
    },
    [IPC_CHANNELS.appSetState]: async (argument) => {
      const patch = parseStatePatch(argument);
      const state = await services.appState.update(patch);
      if (patch.selection?.repositoryId !== undefined) services.watchProject(state.selection.repositoryId);
      if (patch.theme !== undefined) services.applyTheme(state.theme);
      return state;
    },
  };
}
