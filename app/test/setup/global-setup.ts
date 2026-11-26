import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The app tests start the built CLI of the repository root (spec §6.2, test mode). */
export default function setup(): void {
  const root = path.resolve(import.meta.dirname, '..', '..', '..');
  if (existsSync(path.join(root, 'dist', 'cli.js'))) return;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error('Das CLI im Wurzelordner liess sich nicht bauen.');
}
