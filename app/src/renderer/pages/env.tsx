import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { IpaApi } from '../../shared/ipc';
import type { IpaError, IpaResult } from '../../shared/types';
import type { AppActions, Focus } from '../store/appStore';
import type { RefInfo } from '../markdown/plugins';
import type { ReferenceIndex } from '../../shared/views';
import type { LockState } from '../../shared/run';
import { unavailableReason, type ActionKind } from '../store/locks';

/** What every page needs: the API, the project, its zone and the counter that says "load again". */
export interface PageEnv {
  api: IpaApi;
  repositoryId: string;
  timezone: string | null;
  dataVersion: number;
  actions: AppActions;
  focus: Focus | null;
  locks: LockState | undefined;
  /** `false` when the last check found Claude not ready; `null` when unknown. */
  claudeReady: boolean | null;
}

const Context = createContext<PageEnv | null>(null);

export function PageEnvProvider({ value, children }: { value: PageEnv; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Why an action is unavailable right now, or `null` (spec §3.7). */
export function actionReason(env: PageEnv, action: ActionKind): string | null {
  return unavailableReason(action, env.locks, env.claudeReady);
}

export function usePageEnv(): PageEnv {
  const env = useContext(Context);
  if (env === null) throw new Error('PageEnvProvider fehlt');
  return env;
}

export interface Loaded<T> {
  data: T | null;
  /** `true` only until the first result; later loads keep showing the old data (no flicker). */
  loading: boolean;
  error: IpaError | null;
}

/**
 * Loads data through the API and again whenever `deps` or the data version change. The previous result stays
 * visible while the next one loads (spec AK-10-34: updates without a reset).
 */
export function useLoad<T>(load: () => Promise<IpaResult<T>>, deps: readonly unknown[]): Loaded<T> {
  const { dataVersion } = usePageEnv();
  const [state, setState] = useState<Loaded<T>>({ data: null, loading: true, error: null });
  const counter = useRef(0);
  useEffect(() => {
    const mine = ++counter.current;
    let live = true;
    void load().then((result) => {
      if (!live || mine !== counter.current) return;
      setState(result.ok ? { data: result.value, loading: false, error: null } : (previous) => ({ data: previous.data, loading: false, error: result.error }));
    });
    return () => {
      live = false;
    };
    // `load` is rebuilt every render; the explicit dependencies decide when to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, dataVersion]);
  return state;
}

/** Turns a reference chip into a jump: a note to its day and tab, evidence to the work log (spec §11.4). */
export function jumpToReference(env: PageEnv, index: ReferenceIndex | null, ref: RefInfo): void {
  if (index === null) return;
  if (ref.kind === 'note') {
    const day = index.notes[ref.id];
    if (day !== undefined) env.actions.openDay(day, 'notes', { noteId: ref.id });
  } else if (ref.kind === 'evidence' && ref.snapshotId !== null) {
    const day = index.snapshots[ref.snapshotId];
    if (day !== undefined) env.actions.openDay(day, 'workLogs', { snapshotId: ref.snapshotId, evidence: ref.id });
  }
}
