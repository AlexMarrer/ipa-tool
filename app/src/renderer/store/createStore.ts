import { useSyncExternalStore } from 'react';

export interface Store<T> {
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
  setState: (update: (previous: T) => T) => void;
}

/** Minimal store for `useSyncExternalStore` (spec §3.1: no state library). */
export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setState(update) {
      const next = update(state);
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

export function useStoreState<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
