/**
 * Angaben zum ausgelieferten Tool-Paket. Die Pfade gelten für `src/core/` und `dist/core/` gleichermassen.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Wurzel des Tool-Pakets mit `package.json` und `schemas/`. */
export const TOOL_ROOT = fileURLToPath(new URL('../../', import.meta.url));

let cachedVersion: string | undefined;

/** Version aus `package.json`. */
export function toolVersion(): string {
  if (cachedVersion === undefined) {
    const raw = readFileSync(path.join(TOOL_ROOT, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const version = (parsed as { version?: unknown }).version;
    if (typeof version !== 'string' || version.length === 0) {
      throw new Error('package.json enthält keine Version');
    }
    cachedVersion = version;
  }
  return cachedVersion;
}
