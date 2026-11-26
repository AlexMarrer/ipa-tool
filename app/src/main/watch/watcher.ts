import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

export interface WatcherOptions {
  /** Folder to observe recursively. */
  root: string;
  /** Called with the relative paths (`/` separators) that changed since the last call. */
  onPaths: (paths: string[]) => void;
  /** Called when observation fails or recovers (`fs.watch` can drop out, spec §9.6). */
  onHealth?: (healthy: boolean) => void;
  /** `false` for the data root, where only `registry.json` matters. Default `true`. */
  recursive?: boolean;
  debounceMs?: number;
  pollMs?: number;
  /** Files whose time stamps the poll compares (spec §3.8). */
  pollFiles?: string[];
  /** Replaces `fs.watch`, so tests can simulate lost events. */
  watchFn?: typeof watch;
}

export interface Watcher {
  close(): void;
}

export const DEFAULT_POLL_FILES = ['state.json', 'runs.jsonl', 'lock', 'config.json', 'registry.json'];

async function signature(file: string): Promise<string> {
  try {
    const info = await stat(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return 'absent';
  }
}

/**
 * Observes a folder with `fs.watch` (native recursive on Windows), debounces events and compares time stamps of
 * important files on a slow poll as a safety net against lost events (spec §3.8, AO-12). Read-only.
 */
export function createWatcher(options: WatcherOptions): Watcher {
  const debounceMs = options.debounceMs ?? 300;
  const pollMs = options.pollMs ?? 10_000;
  const pollFiles = options.pollFiles ?? DEFAULT_POLL_FILES;
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  let watcher: FSWatcher | null = null;
  const lastSignature = new Map<string, string>();

  const flush = (): void => {
    timer = null;
    if (closed || pending.size === 0) return;
    const paths = [...pending];
    pending.clear();
    options.onPaths(paths);
  };
  const schedule = (relative: string): void => {
    pending.add(relative);
    if (timer === null) timer = setTimeout(flush, debounceMs);
  };

  try {
    watcher = (options.watchFn ?? watch)(options.root, { recursive: options.recursive ?? true, persistent: false }, (_event, filename) => {
      if (filename === null || filename === undefined) return;
      schedule(String(filename).replace(/\\/g, '/'));
    });
    watcher.on('error', () => options.onHealth?.(false));
  } catch {
    options.onHealth?.(false);
  }

  const poll = async (): Promise<void> => {
    for (const name of pollFiles) {
      const current = await signature(path.join(options.root, name));
      const previous = lastSignature.get(name);
      lastSignature.set(name, current);
      if (previous !== undefined && previous !== current) schedule(name);
    }
  };
  void poll();
  const interval = setInterval(() => void poll(), pollMs);
  interval.unref();

  return {
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      clearInterval(interval);
      watcher?.close();
    },
  };
}
