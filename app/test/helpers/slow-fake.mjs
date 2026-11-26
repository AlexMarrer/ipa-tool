// A slow fake Claude: waits SLOW_MS before it behaves like the fake of the CLI tests. Used to watch live lines.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Only the model call is slow; `--version` and `auth status` answer at once, so the readiness check passes.
const isModelCall = process.argv.includes('-p') || process.argv.includes('--print');
const delay = isModelCall ? Number(process.env.SLOW_MS ?? '2000') : 0;
if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
const fake = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test', 'helpers', 'fake-claude.mjs');
await import(new URL(`file:///${fake.replace(/\\/g, '/')}`).href);
