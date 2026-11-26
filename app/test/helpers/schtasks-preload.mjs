// Stand-in for the Windows Task Scheduler in the tests of the app (AK-10-55). It is loaded into the CLI process with
// `NODE_OPTIONS=--import=<this file>` and answers the `schtasks` calls of the CLI from a state file, so no test touches
// the real Task Scheduler. The state lives in the file named by IPA_TEST_SCHTASKS_STATE, because every CLI call is its own process.
import childProcess from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const stateFile = process.env.IPA_TEST_SCHTASKS_STATE;
const logFile = process.env.IPA_TEST_SCHTASKS_LOG;
const original = childProcess.execFile;

const pad = (value) => String(value).padStart(2, '0');
const german = (date) => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

function load() {
  if (!stateFile || !existsSync(stateFile)) return { xml: null, nextRun: null, lastRun: null, lastResult: 0, failures: {} };
  return JSON.parse(readFileSync(stateFile, 'utf8'));
}
const save = (state) => stateFile && writeFileSync(stateFile, JSON.stringify(state));

function answer(args) {
  const state = load();
  const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
  const failed = (message) => ({ exitCode: 1, stdout: '', stderr: `${message}\r\n` });
  const name = args[args.indexOf('/TN') + 1] ?? 'ipa-assistant';
  const forced = state.failures?.[args.slice(0, 2).join(' ')] ?? state.failures?.[args[0]];
  if (forced) return forced;
  const [verb] = args;
  if (verb === '/Query') {
    if (state.xml === null) return args.includes('/XML') || args.includes('/V') ? failed('FEHLER: Das System kann die angegebene Datei nicht finden.') : ok('"\\Microsoft\\Windows\\Defrag\\ScheduledDefrag","N/A","Bereit"\r\n');
    if (args.includes('/XML')) {
      const exported = state.xml
        .replace(/<!--[\s\S]*?-->\s*/, '')
        .replace(/(<StartBoundary>)\d{4}-\d{2}-\d{2}/g, '$12019-05-17')
        .replace('</RegistrationInfo>', `<URI>\\${name}</URI>\n  </RegistrationInfo>`)
        .replace('<Priority>7</Priority>', '<Priority>7</Priority>\n    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>');
      return ok(exported);
    }
    if (args.includes('/V')) {
      const date = (value) => (value === null ? 'Nicht zutreffend' : german(new Date(value)));
      const columns = ['TEST', `\\${name}`, date(state.nextRun), 'Bereit', 'Interaktiv/Hintergrund', date(state.lastRun), String(state.lastResult), 'Autor', 'cmd'];
      return ok(`${columns.map((column) => `"${column}"`).join(',')}\r\n`);
    }
    return ok(`"\\${name}","N/A","Bereit"\r\n`);
  }
  if (verb === '/Create') {
    const bytes = readFileSync(args[args.indexOf('/XML') + 1]);
    if (bytes[0] !== 0xff || bytes[1] !== 0xfe) return failed('FEHLER: Die Datei ist kein UTF-16.');
    if (state.xml !== null && !args.includes('/F')) return failed('FEHLER: Die Aufgabe existiert bereits.');
    state.xml = bytes.subarray(2).toString('utf16le').replace(/\r\n/g, '\n');
    state.nextRun = new Date(Date.now() + 3_600_000).toISOString();
    save(state);
    return ok('ERFOLG: Die geplante Aufgabe wurde erfolgreich erstellt.\r\n');
  }
  if (state.xml === null) return failed('FEHLER: Das System kann die angegebene Datei nicht finden.');
  if (verb === '/Change') {
    state.xml = state.xml.replace(/(<Settings>[\s\S]*?<Enabled>)(?:true|false)(<\/Enabled>)/, `$1${args.includes('/ENABLE')}$2`);
    save(state);
    return ok('ERFOLG\r\n');
  }
  if (verb === '/Delete') {
    state.xml = null;
    save(state);
    return ok('ERFOLG\r\n');
  }
  if (verb === '/Run') {
    state.lastRun = new Date().toISOString();
    save(state);
    return ok('ERFOLG: Die geplante Aufgabe wurde ausgeführt.\r\n');
  }
  return failed(`FEHLER: unbekannter Aufruf ${String(verb)}`);
}

childProcess.execFile = function patched(file, args, options, callback) {
  if (file !== 'schtasks') return original.call(this, file, args, options, callback);
  const result = answer(args);
  if (logFile) appendFileSync(logFile, `${JSON.stringify(args)}\n`);
  const error = result.exitCode === 0 ? null : Object.assign(new Error('schtasks'), { code: result.exitCode });
  setImmediate(() => callback(error, Buffer.from(result.stdout, 'latin1'), Buffer.from(result.stderr, 'latin1')));
  return { kill: () => true };
};
syncBuiltinESMExports();
