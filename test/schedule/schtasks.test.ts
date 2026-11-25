import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSchtasksRunner, foldToAscii, parseCsv } from '../../src/schedule/schtasks.js';
import { TOOL_ROOT } from '../helpers/workspace.js';

// The runner is tested with a stand-in program; no test starts the real `schtasks` (AK-09-16).
const STANDIN = path.join(TOOL_ROOT, 'test', 'helpers', 'schtasks-standin.mjs');
const standin = (mode: string, timeoutMs?: number) =>
  createSchtasksRunner({ command: process.execPath, prefixArgs: [STANDIN, mode], ...(timeoutMs === undefined ? {} : { timeoutMs }) });

describe('Runner für schtasks (AK-09-16)', () => {
  it('übergibt die Argumente ohne Shell unverändert', async () => {
    const args = ['/Create', '/XML', 'C:\\Temp\\mit Leerzeichen\\aufgabe.xml', '/TN', 'ipa-assistant-x', '&', '"zitiert"', '%PATH%', '$(x)'];
    const result = await standin('args').run(args);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });

  it('liefert Exit-Code und Text auch bei einem Fehler, und ersetzt Zeichen ausserhalb von ASCII', async () => {
    const failed = await standin('exit').run(['3']);
    expect(failed).toMatchObject({ exitCode: 3, stdout: '' });
    expect(failed.stderr).toContain('FEHLER: Das System kann die angegebene Datei nicht finden.');

    const oem = await standin('oem').run([]);
    expect(oem.exitCode).toBe(0);
    expect(oem.stdout).toBe('N?chste\r\n');
    expect(oem.stderr).toBe('FEHLER: Zugriff verweigert ?\r\n');
  });

  it('weist ein fehlendes Programm und eine Zeitüberschreitung ab, statt einen Exit-Code zu erfinden', async () => {
    await expect(createSchtasksRunner({ command: 'ipa-gibt-es-nicht-xyz' }).run([])).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(standin('hang', 300).run([])).rejects.toMatchObject({ killed: true });
  });

  it('ersetzt in foldToAscii alles ausser druckbarem ASCII und Zeilenumbrüchen', () => {
    expect(foldToAscii('Ä-ü€\u{1F600}x\ty\r\n')).toBe('?-???x\ty\r\n');
  });
});

describe('CSV der Aufgabenplanung', () => {
  it('liest Werte in Anführungszeichen mit Komma und verdoppelten Anführungszeichen', () => {
    expect(parseCsv('"a","b, c","d ""e"" f",""\r\n\r\n"x"\n')).toEqual([['a', 'b, c', 'd "e" f', ''], ['x']]);
    expect(parseCsv('')).toEqual([]);
  });
});
