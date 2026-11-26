import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ROOT } from '../helpers/env';

const css = readFileSync(path.join(APP_ROOT, 'src', 'renderer', 'theme', 'tokens.css'), 'utf8');

function block(source: string, selector: RegExp): Record<string, string> {
  const match = selector.exec(source);
  if (match === null) throw new Error(`Block nicht gefunden: ${selector}`);
  const tokens: Record<string, string> = {};
  for (const [, name, value] of (match[1] ?? '').matchAll(/--([a-z-]+):\s*([^;]+);/g)) tokens[name as string] = (value as string).trim();
  return tokens;
}

const light = block(css, /:root,\s*\[data-theme='light'\]\s*\{([^}]*)\}/);
const dark = block(css, /\[data-theme='dark'\]\s*\{([^}]*)\}/);
const darkFirstPaint = block(css, /:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/);

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text pairings (WCAG AA 4.5:1), spec §10.3. */
const TEXT_PAIRS: [string, string][] = [
  ['fg', 'bg'], ['fg', 'side'], ['fg', 'surface'], ['fg', 'chip'], ['fg', 'accsoft'],
  ['mut', 'bg'], ['mut', 'side'], ['mut', 'surface'], ['mut', 'chip'],
  ['acctx', 'bg'], ['acctx', 'side'], ['acctx', 'surface'], ['acctx', 'accsoft'],
  ['on-acc', 'acc'],
  ['warn', 'warnbg'], ['warn', 'bg'], ['warn', 'surface'],
  ['err', 'errbg'], ['err', 'bg'], ['err', 'surface'],
  ['fg', 'dlg-bg'], ['fg', 'dlg-surface'], ['fg', 'dlg-chip'],
  ['mut', 'dlg-bg'], ['mut', 'dlg-surface'], ['acctx', 'dlg-bg'], ['err', 'dlg-bg'],
];
/** Controls and focus ring (3:1). */
const CONTROL_PAIRS: [string, string][] = [
  ['acctx', 'bg'], ['acctx', 'side'], ['acctx', 'surface'], ['acctx', 'dlg-bg'], ['acc', 'bg'], ['acc', 'dlg-bg'],
];

describe('Kontrast der Tokens (AK-10-11)', () => {
  for (const [name, tokens] of [['Hell', light], ['Dunkel', dark]] as const) {
    describe(name, () => {
      it.each(TEXT_PAIRS)('Text %s auf %s erreicht 4,5:1', (foreground, background) => {
        const ratio = contrast(tokens[foreground] as string, tokens[background] as string);
        expect(ratio, `${foreground} auf ${background}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      });
      it.each(CONTROL_PAIRS)('Bedienelement %s auf %s erreicht 3:1', (foreground, background) => {
        const ratio = contrast(tokens[foreground] as string, tokens[background] as string);
        expect(ratio, `${foreground} auf ${background}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it('definiert alle Tokens aus §10.1 in beiden Themes', () => {
    const required = ['bg', 'side', 'surface', 'chip', 'fg', 'mut', 'line', 'acc', 'acctx', 'accsoft', 'warn', 'warnbg', 'err', 'errbg', 'scrim', 'dlg-bg', 'dlg-surface', 'dlg-chip', 'dlg-hair', 'page'];
    for (const token of required) {
      expect(light[token], `hell ${token}`).toBeDefined();
      expect(dark[token], `dunkel ${token}`).toBeDefined();
    }
  });

  it('nimmt in §10.1 festgelegte Korrekturwerte (warn und mut hell)', () => {
    expect(light['mut']).toBe('#666a75');
    expect(light['warn']).toBe('#946000');
  });

  it('hält den ersten Anstrich im Dunkelmodus gleich den Dunkel-Tokens', () => {
    for (const [token, value] of Object.entries(darkFirstPaint)) expect(dark[token], token).toBe(value);
  });

  it('verwendet keine festen Farben in Komponenten ausser in den Tokens', () => {
    for (const file of ['components/components.css', 'layout/layout.css', 'theme/typography.css']) {
      const text = readFileSync(path.join(APP_ROOT, 'src', 'renderer', file), 'utf8');
      expect(text, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
