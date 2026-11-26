import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RunEvent } from '../../shared/types';
import { createWatcher, type Watcher } from '../watch/watcher';
import { createProgressMapper } from './progress';

export interface LiveSessionOptions {
  workspacePath: string;
  maxAnalysesPerRun: number;
  emit: (event: RunEvent) => void;
  runKey: string;
  /** Start of the run in milliseconds; files changed since then are caught up when the watcher starts. */
  sinceMs: number;
  now?: () => Date;
  /** Debounce of the watcher; short, so the lines follow the files closely. */
  debounceMs?: number;
  idleCheckMs?: number;
}

export interface LiveSession {
  /** Stops watching and sends the closing line. */
  finish(exitCode: number | null, cancelled: boolean): Promise<void>;
}

async function names(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

/**
 * Live lines of one run, derived from file events in the workspace (spec §3.5, AD-06). The lines contain names and
 * counters only. If watching fails the run display stays correct: title, run time and end come from the process.
 *
 * The watcher starts a moment after the process, so the session first catches up on files changed since the start of
 * the run, in the order of their modification times; the time of a line is the time of its file.
 */
export function startLiveSession(options: LiveSessionOptions): LiveSession {
  const now = options.now ?? (() => new Date());
  const ws = options.workspacePath;
  const readText = async (relative: string): Promise<string | null> => {
    try {
      return await readFile(path.join(ws, relative), 'utf8');
    } catch {
      return null;
    }
  };
  const mapper = createProgressMapper({ readText, maxAnalysesPerRun: options.maxAnalysesPerRun });
  let chain: Promise<void> = Promise.resolve();
  let closed = false;

  // File times and event times come from different clocks; a line never carries an earlier time than the one before.
  let lastAt = 0;
  const push = (lines: { at: string; text: string; muted?: boolean }[]): void => {
    for (const line of lines) {
      lastAt = Math.max(lastAt, Date.parse(line.at));
      options.emit({ type: 'live', runKey: options.runKey, line: { ...line, at: new Date(lastAt).toISOString() } });
    }
  };
  const mtimeOf = async (relative: string): Promise<Date | null> => {
    try {
      return new Date((await stat(path.join(ws, relative))).mtimeMs);
    } catch {
      return null;
    }
  };

  async function catchUp(): Promise<void> {
    const found: { relative: string; at: Date }[] = [];
    const consider = async (relative: string): Promise<void> => {
      const at = await mtimeOf(relative);
      if (at !== null && at.getTime() >= options.sinceMs - 100) found.push({ relative, at });
    };
    await consider('lock');
    for (const name of await names(path.join(ws, 'snapshots'))) {
      await consider(name.startsWith('.tmp-') ? `snapshots/${name}` : `snapshots/${name}/manifest.json`);
    }
    for (const id of await names(path.join(ws, 'analyses'))) {
      await consider(`analyses/${id}/complete.json`);
      for (const attempt of (await names(path.join(ws, 'analyses', id))).filter((name) => name.startsWith('attempt-'))) {
        await consider(`analyses/${id}/${attempt}`);
        await consider(`analyses/${id}/${attempt}/response.json`);
        await consider(`analyses/${id}/${attempt}/outcome.json`);
      }
    }
    for (const run of await names(path.join(ws, 'journal', 'runs'))) await consider(`journal/runs/${run}`);
    for (const draft of await names(path.join(ws, 'journal', 'drafts'))) if (draft.endsWith('.md')) await consider(`journal/drafts/${draft}`);
    found.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const { relative, at } of found) {
      if (closed) return;
      push(await mapper.handlePath(relative, at));
    }
  }

  chain = chain.then(catchUp);
  const watcher: Watcher = createWatcher({
    root: ws,
    debounceMs: options.debounceMs ?? 150,
    pollMs: 2_000,
    pollFiles: ['lock', 'ai-usage.jsonl'],
    onPaths: (paths) => {
      // Events are handled one after another so lines keep the order of the files.
      chain = chain.then(async () => {
        for (const relative of paths) {
          if (closed) return;
          push(await mapper.handlePath(relative, (await mtimeOf(relative)) ?? now()));
        }
      });
    },
  });
  const idle = setInterval(() => {
    if (!closed) push(mapper.idle(now()));
  }, options.idleCheckMs ?? 3_000);
  idle.unref();

  return {
    async finish(exitCode, cancelled) {
      // A last watcher batch can still be pending; let the chain drain before the closing line.
      await new Promise((resolve) => setTimeout(resolve, (options.debounceMs ?? 150) + 50));
      await chain;
      closed = true;
      watcher.close();
      clearInterval(idle);
      push([mapper.finish(now(), exitCode, cancelled)]);
    },
  };
}
