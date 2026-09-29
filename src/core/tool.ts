/**
 * The paths hold for `src/core/` and `dist/core/` alike.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Contains `package.json` and `schemas/`. */
export const TOOL_ROOT = fileURLToPath(new URL('../../', import.meta.url));

let cachedVersion: string | undefined;

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
