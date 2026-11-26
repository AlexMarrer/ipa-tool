import { EDITABLE_PATHS, type ConfigChange, type ConfigFile, type ConfigFinding, type ScheduleConfig } from '../../../shared/config';

/** `/schedule/windowStart` of the CLI as `schedule.windowStart`. */
export const pointerToPath = (pointer: string): string => pointer.split('/').filter((part) => part !== '').join('.');

export function getPath(source: unknown, dotted: string): unknown {
  let current: unknown = source;
  for (const part of dotted.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** A copy of `source` with the value at `dotted` replaced; every level on the way is copied, nothing is mutated. */
export function setPath<T>(source: T, dotted: string, value: unknown): T {
  const parts = dotted.split('.');
  const apply = (node: unknown, index: number): unknown => {
    const copy = { ...((typeof node === 'object' && node !== null ? node : {}) as Record<string, unknown>) };
    const key = parts[index] as string;
    copy[key] = index === parts.length - 1 ? value : apply(copy[key], index + 1);
    return copy;
  };
  return apply(source, 0) as T;
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((key) => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** The paths of the draft that differ from the saved file: exactly what `ipa config set` gets (AK-10-68). */
export function diffChanges(base: ConfigFile, draft: ConfigFile, only: readonly string[] = EDITABLE_PATHS): ConfigChange[] {
  const changes: ConfigChange[] = [];
  for (const path of only) {
    const before = getPath(base, path);
    const after = getPath(draft, path);
    // `allowPaidUsage` may be missing in the file, which means false.
    if (path === 'claude.allowPaidUsage' && (before ?? false) === (after ?? false)) continue;
    if (!same(before, after)) changes.push({ path, value: after === undefined ? null : after });
  }
  return changes;
}

/** Findings that belong to a field: the same path or a path below it (`/paths/include/0` belongs to `paths.include`). */
export function findingsFor(findings: readonly ConfigFinding[], dotted: string): ConfigFinding[] {
  return findings.filter((finding) => {
    const path = pointerToPath(finding.path);
    return path === dotted || path.startsWith(`${dotted}.`);
  });
}

/** "Versuche pro Snapshot: ganze Zahl, mindestens 1. Der Wert 0 ist nicht erlaubt." (spec §8.11); `null` when the text is a valid number. */
export function integerError(label: string, text: string, minimum: number, maximum?: number): string | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return `${label}: ganze Zahl, mindestens ${minimum}. «${trimmed === '' ? 'leer' : trimmed}» ist keine ganze Zahl.`;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < minimum) return `${label}: ganze Zahl, mindestens ${minimum}. Der Wert ${trimmed} ist nicht erlaubt.`;
  if (maximum !== undefined && value > maximum) return `${label}: ganze Zahl, höchstens ${maximum}. Der Wert ${trimmed} ist nicht erlaubt.`;
  return null;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClock = (value: string): boolean => CLOCK.test(value);

export interface ScheduleErrors {
  workdays?: string;
  windowStart?: string;
  windowEnd?: string;
  intervalMinutes?: string;
  extraRunTimes?: string;
  any: boolean;
}

/** Quick check of an obvious mistake before the CLI is asked (spec §8.10); the CLI stays the authority for the rest. */
export function scheduleErrors(draft: { workdays: readonly string[]; windowStart: string; windowEnd: string; intervalMinutes: string; extraRunTimes: readonly string[] }): ScheduleErrors {
  const errors: ScheduleErrors = { any: false };
  if (draft.workdays.length === 0) errors.workdays = 'Mindestens ein Arbeitstag nötig. Ohne Arbeitstage lässt sich der Zeitplan nicht speichern.';
  if (!isClock(draft.windowStart)) errors.windowStart = `Beginn «${draft.windowStart}» ist keine gültige Uhrzeit. Bitte im Format HH:MM eingeben, zum Beispiel 08:00.`;
  if (!isClock(draft.windowEnd)) errors.windowEnd = `Ende «${draft.windowEnd}» ist keine gültige Uhrzeit. Bitte im Format HH:MM eingeben, zum Beispiel 18:00.`;
  if (errors.windowStart === undefined && errors.windowEnd === undefined && draft.windowStart >= draft.windowEnd) errors.windowEnd = 'Das Ende muss nach dem Beginn liegen.';
  if (!/^\d+$/.test(draft.intervalMinutes.trim()) || Number(draft.intervalMinutes) < 1 || Number(draft.intervalMinutes) > 1440) {
    errors.intervalMinutes = 'Das Intervall muss eine ganze Zahl über 0 sein (Minuten).';
  }
  const badExtra = draft.extraRunTimes.find((time) => !isClock(time));
  if (badExtra !== undefined) errors.extraRunTimes = `Zusatzlauf «${badExtra}» ist keine gültige Uhrzeit. Erlaubt sind 00:00 bis 23:59.`;
  else if (new Set(draft.extraRunTimes).size !== draft.extraRunTimes.length) errors.extraRunTimes = 'Jeder Zusatzlauf darf nur einmal vorkommen.';
  errors.any = Object.keys(errors).some((key) => key !== 'any');
  return errors;
}

export function toScheduleConfig(draft: { workdays: ScheduleConfig['workdays']; windowStart: string; windowEnd: string; intervalMinutes: string; extraRunTimes: string[] }): ScheduleConfig {
  return { workdays: draft.workdays, windowStart: draft.windowStart, windowEnd: draft.windowEnd, intervalMinutes: Number(draft.intervalMinutes), extraRunTimes: [...draft.extraRunTimes].sort() };
}

/** Bytes as the user thinks of them: `262144` is "256 KiB". Exact for every value, so there are no rounding errors (AK-10-64). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576 && bytes % 1_048_576 === 0) return `${bytes / 1_048_576} MiB`;
  if (bytes >= 1_024 && bytes % 1_024 === 0) return `${bytes / 1_024} KiB`;
  return `${bytes} B`;
}

export type LimitUnit = 'B' | 'KiB' | 'MiB' | 's' | 'ms' | 'x';
const FACTOR: Record<LimitUnit, number> = { B: 1, KiB: 1_024, MiB: 1_048_576, s: 1, ms: 1, x: 1 };

/** Converts the entered number and unit to the stored value; `null` if the result is not a whole number of the base unit. */
export function toBase(text: string, unit: LimitUnit): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  // Work with integers: scale the decimal part instead of multiplying floats.
  const [whole = '0', fraction = ''] = trimmed.split('.');
  const scale = 10 ** fraction.length;
  const scaled = Number(whole) * scale + Number(fraction === '' ? '0' : fraction);
  const total = scaled * FACTOR[unit];
  return Number.isSafeInteger(total) && total % scale === 0 ? total / scale : null;
}

export const fromBase = (value: number, unit: LimitUnit): string => String(value / FACTOR[unit]);
