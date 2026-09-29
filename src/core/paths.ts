/**
 * Pfadnormalisierung (spec.md §2.3, §5.4). Intern verwenden Pfade immer `/`.
 * Unter Windows wird der Laufwerksbuchstabe gross geschrieben, und Vergleiche
 * unterscheiden nicht zwischen Gross- und Kleinschreibung.
 */
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { errnoCode } from './errors.js';

/** Backslashes → `/`, Laufwerksbuchstabe gross, ohne abschliessenden `/` (ausser bei Wurzeln). */
export function toPortablePath(input: string): string {
  let result = input.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(result)) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  const isRoot = result === '/' || /^[A-Z]:\/$/.test(result);
  if (!isRoot && result.length > 1) {
    result = result.replace(/\/+$/, '');
  }
  return result;
}

/** Schlüssel für Pfadvergleiche: portabel, unter Windows in Kleinbuchstaben. */
export function comparisonKey(input: string, platform: NodeJS.Platform = process.platform): string {
  const portable = toPortablePath(input);
  return platform === 'win32' ? portable.toLowerCase() : portable;
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return comparisonKey(a, platform) === comparisonKey(b, platform);
}

/** `child` liegt in `parent` oder ist gleich `parent`. */
export function isSameOrInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
  const childKey = comparisonKey(child, platform);
  const parentKey = comparisonKey(parent, platform);
  if (childKey === parentKey) return true;
  const prefix = parentKey.endsWith('/') ? parentKey : `${parentKey}/`;
  return childKey.startsWith(prefix);
}

/** `child` liegt echt in `parent`. */
export function isStrictlyInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
  return isSameOrInside(child, parent, platform) && !samePath(child, parent, platform);
}

/**
 * Relativer Pfad mit `/` von `parent` zu `child`, oder `null`, wenn `child` nicht echt in `parent` liegt.
 * Die Schreibweise des relativen Teils stammt aus `child`.
 */
export function relativeInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!isStrictlyInside(child, parent, platform)) return null;
  const portableChild = toPortablePath(child);
  const portableParent = toPortablePath(parent);
  const prefixLength = portableParent.endsWith('/') ? portableParent.length : portableParent.length + 1;
  return portableChild.slice(prefixLength);
}

/**
 * Kanonischer absoluter Pfad: `realpath` des nächsten existierenden Vorfahren,
 * ergänzt um den noch nicht existierenden Rest, portabel geschrieben.
 */
export async function canonicalizePath(input: string): Promise<string> {
  const absolute = path.resolve(input);
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const real = await realpath(current);
      const joined = missing.length === 0 ? real : path.join(real, ...[...missing].reverse());
      return toPortablePath(joined);
    } catch (error) {
      const code = errnoCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        // realpath ist für manche Laufwerke nicht verfügbar; dann gilt der lexikalische Pfad.
        return toPortablePath(absolute);
      }
      const parent = path.dirname(current);
      if (parent === current) return toPortablePath(absolute);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}
