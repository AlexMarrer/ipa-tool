/**
 * Runs before every test file: takes over the environment of the global setup and aborts if the data
 * root does not point into the temp folder.
 */
import path from 'node:path';
import { inject } from 'vitest';

const root = inject('ipaTestRoot');
Object.assign(process.env, inject('ipaTestEnv'), inject('ipaWorkerEnv'));

const home = process.env['IPA_ASSISTANT_HOME'] ?? '';
const relative = path.relative(root, home);
if (home === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error(`IPA_ASSISTANT_HOME zeigt nicht in das Test-Verzeichnis: ${home}`);
}
