import { describe, expect, it } from 'vitest';
import { evaluateEnvelope, evaluateStream, parseSingleJsonObject, parseStreamJson } from '../../src/claude/envelope.js';
import type { ProcessResult } from '../../src/claude/process.js';

const COMMAND = ['claude'];
const MODEL_TEXT = 'GEHEIMER-MODELLTEXT-aus-dem-Code';

function proc(overrides: Partial<ProcessResult>): ProcessResult {
  return {
    spawnError: null,
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    stderrTruncated: false,
    timedOut: false,
    aborted: false,
    durationMs: 800,
    ...overrides,
  };
}

const SUCCESS = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 4321,
  result: MODEL_TEXT,
  structured_output: { summary: { text: 'x', evidence: ['E001'] } },
  total_cost_usd: 0.25,
  modelUsage: { 'claude-opus-4-7': {}, 'claude-haiku-4-5': {} },
};

const json = (value: unknown) => `${JSON.stringify(value)}\n`;

describe('Auswertung des Antwortumschlags (spec.md §13.3, AK-05-02, AK-05-03)', () => {
  it('liefert bei Erfolg structured_output und die Kennzahlen aus dem Umschlag', () => {
    const result = evaluateEnvelope(proc({ stdout: json(SUCCESS) }), COMMAND, 600);
    expect(result).toEqual({
      ok: true,
      structuredOutput: SUCCESS.structured_output,
      figures: { models: ['claude-opus-4-7', 'claude-haiku-4-5'], costUsd: 0.25, durationMs: 4321 },
    });
  });

  it('meldet nicht startbare Programme als not_found oder not_executable', () => {
    const missing = evaluateEnvelope(proc({ spawnError: 'ENOENT', exitCode: null }), COMMAND, 600);
    expect(missing).toMatchObject({ ok: false, errorCode: 'not_found' });
    for (const code of ['EINVAL', 'EACCES', 'ENOEXEC']) {
      const result = evaluateEnvelope(proc({ spawnError: code, exitCode: null }), ['C:/npm/claude.cmd'], 600);
      expect(result).toMatchObject({ ok: false, errorCode: 'not_executable' });
      if (!result.ok) expect(result.message).toContain('claude.cmd');
    }
  });

  it('meldet ein Timeout vor allen anderen Befunden', () => {
    const result = evaluateEnvelope(proc({ timedOut: true, exitCode: null, signal: 'SIGTERM', stdout: json(SUCCESS) }), COMMAND, 7);
    expect(result).toMatchObject({ ok: false, errorCode: 'timeout' });
    if (!result.ok) expect(result.message).toContain('7 s');
  });

  it('meldet zusätzlichen Text neben dem JSON und leeres stdout mit Exit-Code 0 als invalid_envelope', () => {
    for (const stdout of [`Neue Version verfügbar\n${json(SUCCESS)}`, `${json(SUCCESS)}${json(SUCCESS)}`, '{"type":"result",', '[1,2]', '']) {
      expect(evaluateEnvelope(proc({ stdout }), COMMAND, 600), stdout).toMatchObject({ ok: false, errorCode: 'invalid_envelope' });
    }
  });

  it('meldet leeres stdout mit Exit-Code ungleich 0 oder nach einem Signal als nonzero_exit', () => {
    const exit = evaluateEnvelope(proc({ exitCode: 3, stderr: 'Absturz' }), COMMAND, 600);
    expect(exit).toMatchObject({ ok: false, errorCode: 'nonzero_exit' });
    if (!exit.ok) expect(exit.message).toContain('Exit-Code 3');
    const signal = evaluateEnvelope(proc({ exitCode: null, signal: 'SIGKILL' }), COMMAND, 600);
    expect(signal).toMatchObject({ ok: false, errorCode: 'nonzero_exit' });
    if (!signal.ok) expect(signal.message).toContain('SIGKILL');
  });

  it('meldet Fehler-Subtype, is_error und falschen type als error_result, ohne Modelltext', () => {
    const cases = [
      { ...SUCCESS, subtype: 'error_max_turns', is_error: true },
      { ...SUCCESS, is_error: true },
      { ...SUCCESS, type: 'assistant' },
    ];
    for (const envelope of cases) {
      const result = evaluateEnvelope(proc({ stdout: json(envelope), exitCode: 1 }), COMMAND, 600);
      expect(result).toMatchObject({ ok: false, errorCode: 'error_result' });
      if (!result.ok) expect(result.message).not.toContain(MODEL_TEXT);
    }
    const maxTurns = evaluateEnvelope(proc({ stdout: json(cases[0]) }), COMMAND, 600);
    if (!maxTurns.ok) expect(maxTurns.message).toContain('error_max_turns');
    const auth = evaluateEnvelope(proc({ stdout: json({ ...SUCCESS, is_error: true, result: 'Invalid API key · Please run /login' }) }), COMMAND, 600);
    if (!auth.ok) {
      expect(auth.message).toContain('claude auth login');
      expect(auth.message).not.toContain('Invalid API key');
    }
    const odd = evaluateEnvelope(proc({ stdout: json({ ...SUCCESS, subtype: `frei ${MODEL_TEXT}` }) }), COMMAND, 600);
    if (!odd.ok) expect(odd.message).not.toContain(MODEL_TEXT);
  });

  it('meldet fehlendes oder falsches structured_output als missing_structured_output', () => {
    const { structured_output: _omitted, ...withoutOutput } = SUCCESS;
    for (const envelope of [withoutOutput, { ...SUCCESS, structured_output: null }, { ...SUCCESS, structured_output: [1] }, { ...SUCCESS, structured_output: 'x' }]) {
      const result = evaluateEnvelope(proc({ stdout: json(envelope) }), COMMAND, 600);
      expect(result).toMatchObject({ ok: false, errorCode: 'missing_structured_output', figures: { costUsd: 0.25 } });
    }
  });

  it('übernimmt ein auswertbares Ergebnis auch bei Exit-Code ungleich 0', () => {
    expect(evaluateEnvelope(proc({ stdout: json(SUCCESS), exitCode: 1 }), COMMAND, 600)).toMatchObject({ ok: true });
  });

  it('prüft, ob stdout genau ein JSON-Objekt ist (A-03)', () => {
    expect(parseSingleJsonObject(`\uFEFF${json({ a: 1 })}`)).toEqual({ a: 1 });
    expect(parseSingleJsonObject('  {"a":1}  \n')).toEqual({ a: 1 });
    expect(parseSingleJsonObject('null')).toBeNull();
    expect(parseSingleJsonObject('x {"a":1}')).toBeNull();
  });
});

describe('Auswertung von stream-json für die Live-Prüfung', () => {
  const events = [
    { type: 'system', subtype: 'init', tools: ['StructuredOutput'], mcp_servers: [{ name: 'firma', status: 'failed' }, 'lokal'], model: 'm' },
    { type: 'system', subtype: 'api_retry', attempt: 1, error: 'authentication_failed' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput' }] } },
    { ...SUCCESS, structured_output: { ok: true } },
  ];
  const stdout = `${events.map((event) => JSON.stringify(event)).join('\n')}\nkein json\n`;

  it('liest Werkzeuge, MCP-Server, Wiederholungen und das Ergebnis', () => {
    const summary = parseStreamJson(stdout);
    expect(summary.init).toEqual({ tools: ['StructuredOutput'], mcpServers: ['firma', 'lokal'] });
    expect(summary.apiRetryErrors).toEqual(['authentication_failed']);
    expect(summary.result).toMatchObject({ subtype: 'success', structured_output: { ok: true } });
    expect(summary.invalidLines).toBe(1);
    expect(evaluateStream(proc({ stdout }), summary, COMMAND, 180)).toMatchObject({ ok: true, structuredOutput: { ok: true } });
  });

  it('meldet einen Abbruch nach abgelehnter Anmeldung und fehlende Ergebnisse', () => {
    const initOnly = `${JSON.stringify(events[0])}\n`;
    const aborted = evaluateStream(proc({ stdout: initOnly, aborted: true, exitCode: null }), parseStreamJson(initOnly), COMMAND, 180);
    expect(aborted).toMatchObject({ ok: false, errorCode: 'error_result' });
    if (!aborted.ok) expect(aborted.message).toContain('authentication_failed');
    expect(evaluateStream(proc({ stdout: initOnly }), parseStreamJson(initOnly), COMMAND, 180)).toMatchObject({ errorCode: 'invalid_envelope' });
    expect(evaluateStream(proc({ exitCode: 1 }), parseStreamJson(''), COMMAND, 180)).toMatchObject({ errorCode: 'nonzero_exit' });
    const timedOut = evaluateStream(proc({ stdout, timedOut: true }), parseStreamJson(stdout), COMMAND, 180);
    expect(timedOut).toMatchObject({ errorCode: 'timeout' });
    if (!timedOut.ok) expect(timedOut.message).toContain('claude auth login');
  });
});
