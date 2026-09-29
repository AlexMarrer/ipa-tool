/**
 * Evaluation of Claude's answer in the order of spec.md §13.3. Messages are German and never contain
 * model text, input or stderr content (I-12); the raw output stays available to the caller.
 */
import type { ProcessResult } from './process.js';
import type { ClaudeErrorCode } from './types.js';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Figures taken over from the envelope (spec.md §13.3). */
export interface EnvelopeFigures {
  models: string[];
  costUsd: number | null;
  durationMs: number | null;
}

export type Failure = { ok: false; errorCode: ClaudeErrorCode; message: string; figures: EnvelopeFigures };

export type Evaluation = { ok: true; structuredOutput: Record<string, unknown>; figures: EnvelopeFigures } | Failure;

const NO_FIGURES: EnvelopeFigures = { models: [], costUsd: null, durationMs: null };

const AUTH_TEXT = /log ?in|api key|auth|credential|unauthori[sz]ed|\b401\b|\b403\b/i;
const AUTH_HINT =
  ' Die Anmeldung wurde offenbar abgelehnt: claude einmal in einem normalen Terminal starten oder claude auth login ausführen, danach ipa doctor wiederholen.';

/** The whole stdout must be exactly one JSON object (A-03); surrounding whitespace is allowed. */
export function parseSingleJsonObject(stdout: string): Record<string, unknown> | null {
  const text = stdout.charCodeAt(0) === 0xfeff ? stdout.slice(1) : stdout;
  if (text.trim() === '') return null;
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function envelopeFigures(envelope: Record<string, unknown> | null): EnvelopeFigures {
  if (envelope === null) return NO_FIGURES;
  const usage = envelope['modelUsage'];
  const cost = envelope['total_cost_usd'];
  const duration = envelope['duration_ms'];
  return {
    models: isPlainObject(usage) ? Object.keys(usage).filter((name) => name !== '') : [],
    costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
    durationMs: typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
  };
}

/** Only identifiers like `error_max_turns` appear in messages, never free text. */
function label(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_./-]{1,60}$/.test(value) ? value : value === undefined ? 'fehlt' : 'unbekannt';
}

function fail(errorCode: ClaudeErrorCode, message: string, figures: EnvelopeFigures = NO_FIGURES): Failure {
  return { ok: false, errorCode, message, figures };
}

/** Step 1 of §13.3. `not_executable` covers for example EINVAL for a `.cmd` file (A-05). */
export function startFailure(spawnError: string, command: readonly string[]): Failure {
  const program = command[0] ?? '';
  if (spawnError === 'ENOENT') {
    return fail(
      'not_found',
      `Claude Code wurde nicht gefunden (Befehl "${program}"). Claude Code installieren oder in config.json unter ` +
        'claude.command den absoluten Pfad der ausführbaren Datei eintragen.',
    );
  }
  return fail(
    'not_executable',
    `Claude Code liess sich nicht starten (${spawnError}, Befehl "${program}"). Ohne Shell starten nur ausführbare ` +
      'Dateien: statt eines npm-Wrappers wie claude.cmd in claude.command die claude.exe oder ' +
      '["<pfad zu node.exe>", "<pfad zur cli.js von Claude Code>"] eintragen.',
  );
}

function timeoutFailure(timeoutSeconds: number, authRejected: boolean): Failure {
  return fail(
    'timeout',
    `Claude hat nicht innerhalb von ${timeoutSeconds} s geantwortet; der Prozess wurde beendet.${authRejected ? AUTH_HINT : ''}`,
  );
}

function withoutResult(proc: ProcessResult, what: string): Failure {
  // An empty stdout together with a failed exit is `nonzero_exit`, otherwise §13.3 step 3 applies (spec.md §18).
  if (proc.stdout.trim() === '' && proc.exitCode !== 0) {
    const how = proc.exitCode === null ? `durch das Signal ${proc.signal ?? 'unbekannt'}` : `mit Exit-Code ${proc.exitCode}`;
    return fail('nonzero_exit', `Claude endete ${how} ohne auswertbares Ergebnis.`);
  }
  return fail(
    'invalid_envelope',
    `${what} (${proc.stdout.length} Zeichen auf stdout, Exit-Code ${proc.exitCode ?? 'keiner'}). Die Rohausgabe bleibt zur Diagnose erhalten.`,
  );
}

/** Steps 4 and 6 of §13.3 for an evaluable result object. */
function evaluateResult(result: Record<string, unknown>): Evaluation {
  const figures = envelopeFigures(result);
  const isError = result['is_error'] === true;
  if (result['type'] !== 'result' || result['subtype'] !== 'success' || isError) {
    const status = typeof result['api_error_status'] === 'number' ? `, HTTP ${result['api_error_status']}` : '';
    const auth = isError && typeof result['result'] === 'string' && AUTH_TEXT.test(result['result']) ? AUTH_HINT : '';
    return fail(
      'error_result',
      `Claude meldet einen Fehler (type ${label(result['type'])}, subtype ${label(result['subtype'])}, is_error ${String(isError)}${status}).${auth}`,
      figures,
    );
  }
  const output = result['structured_output'];
  if (!isPlainObject(output)) {
    return fail('missing_structured_output', 'Die Antwort von Claude enthält kein structured_output als Objekt.', figures);
  }
  return { ok: true, structuredOutput: output, figures };
}

/** `--output-format json` (spec.md §13.3). */
export function evaluateEnvelope(proc: ProcessResult, command: readonly string[], timeoutSeconds: number): Evaluation {
  if (proc.spawnError !== null) return startFailure(proc.spawnError, command);
  if (proc.timedOut) return timeoutFailure(timeoutSeconds, false);
  const envelope = parseSingleJsonObject(proc.stdout);
  if (envelope === null) return withoutResult(proc, 'Die Ausgabe von Claude ist kein einzelnes JSON-Objekt');
  return evaluateResult(envelope);
}

export interface StreamSummary {
  /** Event `system/init`; `null` if it is missing. */
  init: { tools: string[]; mcpServers: string[] } | null;
  /** The last event of type `result`. */
  result: Record<string, unknown> | null;
  /** `error` of every `system/api_retry` event, for example `authentication_failed`. */
  apiRetryErrors: string[];
  invalidLines: number;
}

/** `--output-format stream-json --verbose` of the live check: one JSON event per line. */
export function parseStreamJson(stdout: string): StreamSummary {
  const summary: StreamSummary = { init: null, result: null, apiRetryErrors: [], invalidLines: 0 };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      summary.invalidLines += 1;
      continue;
    }
    if (!isPlainObject(event)) continue;
    if (event['type'] === 'system' && event['subtype'] === 'init') {
      const tools = Array.isArray(event['tools']) ? event['tools'].map(String) : [];
      const servers = Array.isArray(event['mcp_servers'])
        ? event['mcp_servers'].map((server) => (isPlainObject(server) ? String(server['name']) : String(server)))
        : [];
      summary.init = { tools, mcpServers: servers };
    } else if (event['type'] === 'system' && event['subtype'] === 'api_retry') {
      summary.apiRetryErrors.push(typeof event['error'] === 'string' ? event['error'] : 'unknown');
    } else if (event['type'] === 'result') {
      summary.result = event;
    }
  }
  return summary;
}

/** Stream variant of §13.3; an early abort after rejected logins counts as `error_result`. */
export function evaluateStream(proc: ProcessResult, summary: StreamSummary, command: readonly string[], timeoutSeconds: number): Evaluation {
  const authRejected = summary.apiRetryErrors.includes('authentication_failed');
  if (proc.spawnError !== null) return startFailure(proc.spawnError, command);
  if (proc.aborted) {
    return fail('error_result', `Claude meldet wiederholt authentication_failed; der Aufruf wurde abgebrochen.${AUTH_HINT}`);
  }
  if (proc.timedOut) return timeoutFailure(timeoutSeconds, authRejected);
  if (summary.result === null) return withoutResult(proc, 'Die Ausgabe von Claude enthält kein Ergebnis-Ereignis');
  return evaluateResult(summary.result);
}
