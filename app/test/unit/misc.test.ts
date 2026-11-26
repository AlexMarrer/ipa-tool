import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitBounds } from '../../src/main/window-bounds';
import { createAppLog } from '../../src/main/log';
import { isDay, shiftDay, todayIn } from '../../src/shared/dates';
import { ANALYSIS_STATUS, EXIT_CODE_MESSAGES, RUN_OUTCOME } from '../../src/shared/messages';

describe('Tage in der Zeitzone des Projekts (AD-11)', () => {
  it('rechnet "heute" in der Zeitzone des Projekts, nicht des Systems', () => {
    const instant = new Date('2026-11-25T23:30:00Z');
    expect(todayIn('Europe/Zurich', instant)).toBe('2026-11-26');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-11-25');
    expect(todayIn(null, instant)).toBe('2026-11-25');
    expect(todayIn('Keine/Zone', instant)).toBe('2026-11-25');
  });

  it('verschiebt Tage über Monats- und Jahresgrenzen', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(() => shiftDay('kein Tag', 1)).toThrow();
  });

  it('erkennt gültige Tage', () => {
    expect(isDay('2026-11-26')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('26.11.2026')).toBe(false);
    expect(isDay(null)).toBe(false);
  });
});

describe('Protokoll der App (spec §12.5)', () => {
  it('schreibt JSON-Zeilen und rotiert bei Überschreiten der Grösse', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ipa-log-'));
    try {
      const log = createAppLog(dir, 200);
      for (let index = 0; index < 20; index += 1) log.write({ event: 'cli_started', command: 'status', index });
      const current = await readFile(log.file, 'utf8');
      const rotated = await readFile(`${log.file}.1`, 'utf8');
      expect(current.length).toBeLessThan(400);
      expect(rotated.split('\n').filter(Boolean).every((line) => JSON.parse(line).event === 'cli_started')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('wirft nie, auch wenn das Verzeichnis nicht beschreibbar ist', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ipa-log-'));
    try {
      const blocked = path.join(dir, 'datei');
      await writeFile(blocked, 'x');
      expect(() => createAppLog(blocked).write({ event: 'x' })).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Fensterposition', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  const saved = { x: 100, y: 80, width: 1300, height: 820, maximized: false };

  it('übernimmt eine sichtbare Position und die Mindestgrösse', () => {
    expect(fitBounds(saved, displays)).toEqual({ x: 100, y: 80, width: 1300, height: 820 });
    expect(fitBounds({ ...saved, width: 300, height: 300 }, displays)).toMatchObject({ width: 1100, height: 700 });
  });

  it('verwirft eine Position ausserhalb aller Bildschirme', () => {
    expect(fitBounds({ ...saved, x: 5000, y: 80 }, displays)).toEqual({ width: 1300, height: 820 });
    expect(fitBounds({ ...saved, x: null, y: null }, displays)).toEqual({ width: 1300, height: 820 });
  });
});

describe('Texte (spec §9)', () => {
  it('hat zu jedem Exit-Code 0 bis 7 eine Meldung mit nächstem Schritt', () => {
    for (let code = 0; code <= 7; code += 1) {
      const entry = EXIT_CODE_MESSAGES[code];
      expect(entry, `Exit-Code ${code}`).toBeDefined();
      expect(entry?.text.length).toBeGreaterThan(20);
    }
    expect(EXIT_CODE_MESSAGES[3]?.level).toBe('info');
  });

  it('hat alle Analyse-Status und Lauf-Ergebnisse', () => {
    expect(Object.keys(ANALYSIS_STATUS).sort()).toEqual(['baseline', 'blocked', 'complete', 'exhausted', 'failed', 'not_required', 'pending', 'skipped']);
    expect(Object.keys(RUN_OUTCOME)).toHaveLength(9);
    expect(ANALYSIS_STATUS.exhausted.tone).toBe('err');
    expect(ANALYSIS_STATUS.complete.tone).toBe('neutral');
  });

  it('verwendet Schweizer Rechtschreibung ohne ß', () => {
    const all = JSON.stringify([EXIT_CODE_MESSAGES, ANALYSIS_STATUS, RUN_OUTCOME]);
    expect(all).not.toContain('ß');
  });
});
