import { execFile } from 'node:child_process';

export type KillTree = (pid: number) => Promise<void>;

/**
 * Ends a process and all its children (spec §3.6). The CLI handles no signals and Claude runs as its child,
 * so `child.kill()` would leave Claude running. `taskkill /T /F` ends the whole tree.
 */
export const killProcessTree: KillTree = (pid) =>
  new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Exit code 128 means the process is already gone; any other failure is ignored as well, the caller
      // checks the outcome through the process exit.
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
      return;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
    resolve();
  });
