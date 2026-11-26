import { describe, expect, it } from 'vitest';
import { createProgressMapper } from '../../src/main/run/progress';

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 26, 10, 0, seconds));

function mapper(files: Record<string, string> = {}, max = 3) {
  return createProgressMapper({ readText: async (file) => files[file] ?? null, maxAnalysesPerRun: max });
}
const texts = (lines: { text: string }[]) => lines.map((line) => line.text);

describe('Live-Zeilen aus Dateiereignissen (spec §3.5)', () => {
  it('zeigt Beginn, Aufnahme und Geheimnisprüfung', async () => {
    const m = mapper({
      lock: JSON.stringify({ pid: 1, hostname: 'h', command: 'capture', runId: 'R1', startedAt: 'x' }),
      'snapshots/S000006/manifest.json': JSON.stringify({ fileStates: [1, 2, 3, 4], filterDecisions: [{ decision: 'withheld' }, { decision: 'included' }] }),
    });
    expect(texts(await m.handlePath('lock', at(0)))).toEqual(['Lauf gestartet (capture)']);
    expect(texts(await m.handlePath('snapshots/.tmp-S000006-abc/x', at(1)))).toEqual(['Arbeitsstand prüfen']);
    expect(texts(await m.handlePath('snapshots/S000006/manifest.json', at(2)))).toEqual([
      'Snapshot S000006 gespeichert, 4 Dateizustände',
      'Geheimnisprüfung: 1 Einheit(en) zurückgehalten',
    ]);
  });

  it('erkennt den Snapshot auch, wenn nur der umbenannte Ordner gemeldet wird', async () => {
    const m = mapper({ 'snapshots/S000007/manifest.json': JSON.stringify({ fileStates: [1, 2], filterDecisions: [] }) });
    expect(texts(await m.handlePath('snapshots/S000007', at(0)))).toEqual(['Snapshot S000007 gespeichert, 2 Dateizustände', 'Geheimnisprüfung: keine Verdachtsfälle']);
    // The folder event and the file event describe the same snapshot: reported once.
    expect(await m.handlePath('snapshots/S000007/manifest.json', at(1))).toEqual([]);
  });

  it('meldet fehlende Verdachtsfälle', async () => {
    const m = mapper({ 'snapshots/S000002/manifest.json': JSON.stringify({ fileStates: [1], filterDecisions: [] }) });
    expect(texts(await m.handlePath('snapshots/S000002/manifest.json', at(0)))).toContain('Geheimnisprüfung: keine Verdachtsfälle');
  });

  it('zählt Claude-Aufrufe des Laufs und zeigt Antwort und Ausgang jedes Versuchs', async () => {
    const m = mapper({
      'analyses/S000006/attempt-1/outcome.json': JSON.stringify({ outcome: 'timeout', errorCode: 'timeout' }),
      'analyses/S000006/attempt-2/outcome.json': JSON.stringify({ outcome: 'success', errorCode: null }),
    });
    expect(texts(await m.handlePath('analyses/S000006/attempt-1', at(0)))).toEqual(['Analyse S000006: Claude-Aufruf 1 von 3 gestartet']);
    expect(texts(await m.handlePath('analyses/S000006/attempt-1/response.json', at(1)))).toEqual(['Analyse S000006: Antwort von Claude erhalten']);
    expect(texts(await m.handlePath('analyses/S000006/attempt-1/outcome.json', at(2)))).toEqual([
      'Analyse S000006: Versuch 1 nicht abgeschlossen (Zeitüberschreitung beim KI-Schritt)',
    ]);
    expect(texts(await m.handlePath('analyses/S000006/attempt-2/input.json', at(3)))).toEqual(['Analyse S000006: Claude-Aufruf 2 von 3 gestartet']);
    expect(texts(await m.handlePath('analyses/S000006/attempt-2/outcome.json', at(4)))).toEqual(['Analyse S000006: Versuch 2 abgeschlossen']);
    expect(texts(await m.handlePath('analyses/S000006/complete.json', at(5)))).toEqual(['Analyse S000006: abgeschlossen']);
  });

  it('zeigt Journal-Schritte und das Ende des Laufs', async () => {
    const m = mapper();
    expect(texts(await m.handlePath('journal/runs/R20261126T100000Z-ab12/input.json', at(0)))).toEqual(['Journal: Eingabe gebaut']);
    expect(texts(await m.handlePath('journal/drafts/2026-11-26-R1.md', at(1)))).toEqual(['Journal: Entwurf geschrieben']);
    expect(m.finish(at(2), 0, false).text).toBe('Lauf beendet, Exit-Code 0');
    expect(m.finish(at(2), null, true).text).toBe('Lauf abgebrochen');
  });

  it('meldet Ereignisse nur einmal, auch wenn der Beobachter sie wiederholt', async () => {
    const m = mapper({ lock: JSON.stringify({ command: 'capture' }) });
    expect(await m.handlePath('lock', at(0))).toHaveLength(1);
    expect(await m.handlePath('lock', at(1))).toHaveLength(0);
    expect(await m.handlePath('analyses/S000002/attempt-1/response.json', at(2))).toHaveLength(2);
    expect(await m.handlePath('analyses/S000002/attempt-1/response.json', at(3))).toHaveLength(0);
  });

  it('ignoriert unbekannte Pfade', async () => {
    expect(await mapper().handlePath('state.json', at(0))).toEqual([]);
    expect(await mapper().handlePath('notes/2026-11-26.jsonl', at(0))).toEqual([]);
  });

  it('meldet nach 15 s ohne Ereignis, dass auf Claude gewartet wird, einmal und gedämpft', async () => {
    const m = mapper();
    await m.handlePath('analyses/S000006/attempt-1', at(0));
    expect(m.idle(at(10))).toEqual([]);
    const waiting = m.idle(at(16));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ text: 'Analyse S000006: wartet auf Antwort von Claude …', muted: true });
    expect(m.idle(at(40))).toEqual([]);
  });

  it('wartet nicht, wenn die Antwort schon da ist', async () => {
    const m = mapper();
    await m.handlePath('analyses/S000006/attempt-1', at(0));
    await m.handlePath('analyses/S000006/attempt-1/response.json', at(1));
    expect(m.idle(at(60))).toEqual([]);
  });

  it('enthält nie Inhalte aus Dateien, Notizen, Gründen oder Antworten (I-12)', async () => {
    const secret = 'sk-ant-api03-GEHEIM-NIE-ANZEIGEN';
    const m = mapper({
      lock: JSON.stringify({ command: 'capture', reason: secret }),
      'snapshots/S000002/manifest.json': JSON.stringify({ fileStates: [], filterDecisions: [{ decision: 'withheld', path: secret, reason: secret }], note: secret }),
      'analyses/S000002/attempt-1/outcome.json': JSON.stringify({ outcome: 'error_result', errorCode: 'error_result', message: secret }),
      'ai-usage.jsonl': `${JSON.stringify({ outcome: 'success', durationMs: 4200, prompt: secret })}\n`,
    });
    const lines = [
      ...(await m.handlePath('lock', at(0))),
      ...(await m.handlePath('snapshots/S000002/manifest.json', at(1))),
      ...(await m.handlePath('analyses/S000002/attempt-1/outcome.json', at(2))),
      ...(await m.handlePath('ai-usage.jsonl', at(3))),
    ];
    expect(lines.length).toBeGreaterThan(3);
    expect(JSON.stringify(lines)).not.toContain(secret);
    expect(lines.map((line) => line.text)).toContain('Claude-Aufruf beendet in 4 s (success)');
  });
});
