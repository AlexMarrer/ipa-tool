// A fake Claude whose behaviour a test changes while the app runs: the mode is read from the file named by
// FAKE_MODE_FILE at every call. `slow` answers like `analysis`, but the model call itself takes SLOW_MS (a run to cancel);
// `--version` and `auth status` always answer at once, so the readiness check passes.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.env.FAKE_MODE_FILE;
let mode = process.env.FAKE_CLAUDE_MODE ?? 'analysis';
if (file !== undefined && existsSync(file)) mode = readFileSync(file, 'utf8').trim() || mode;

const isModelCall = process.argv.includes('-p') || process.argv.includes('--print');
if (mode === 'slow') {
  if (isModelCall) await new Promise((resolve) => setTimeout(resolve, Number(process.env.SLOW_MS ?? '60000')));
  mode = 'analysis';
}
process.env.FAKE_CLAUDE_MODE = mode;
const fake = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test', 'helpers', 'fake-claude.mjs');
await import(new URL(`file:///${fake.replace(/\\/g, '/')}`).href);
