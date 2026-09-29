/**
 * Läuft vor jeder Testdatei: übernimmt die Test-Umgebung aus dem globalen Setup und bricht ab,
 * falls die Datenwurzel nicht auf das Temp-Verzeichnis zeigt.
 */
import path from 'node:path';
import { inject } from 'vitest';

const root = inject('ipaTestRoot');
Object.assign(process.env, inject('ipaTestEnv'));

const home = process.env['IPA_ASSISTANT_HOME'] ?? '';
const relative = path.relative(root, home);
if (home === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error(`IPA_ASSISTANT_HOME zeigt nicht in das Test-Verzeichnis: ${home}`);
}
