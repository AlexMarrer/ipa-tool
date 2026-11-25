/**
 * Assignments `path=value` for `ipa config set` and the protection of fields that must not change
 * (package 09 §4.2).
 */
import { isDeepStrictEqual } from 'node:util';
import type { Config } from '../core/config.js';
import { EXIT, IpaError } from '../core/errors.js';
import type { ConfigFinding } from './inspect.js';

const PATH_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;

export interface Assignment {
  path: string;
  segments: string[];
  value: unknown;
}

export interface ConfigChange {
  path: string;
  before: unknown;
  after: unknown;
}

/** `path=value`: the value is JSON, and text if it is not valid JSON (`claude.model=opus`). */
export function parseAssignment(argument: string): Assignment {
  const separator = argument.indexOf('=');
  const path = separator < 0 ? argument : argument.slice(0, separator);
  if (separator < 0 || !PATH_PATTERN.test(path)) {
    // The value is never echoed: it may be a credential that was typed into the wrong field.
    const shown = path.length > 60 ? `${path.slice(0, 60)} …` : path;
    const subject = separator < 0 ? 'Die Angabe' : `"${shown}"`;
    throw new IpaError('assignment_invalid', EXIT.usage, `${subject} ist keine gültige Zuweisung. Erwartet wird pfad=wert, zum Beispiel claude.maxTurns=5.`);
  }
  const text = argument.slice(separator + 1);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  return { path, segments: path.split('.'), value };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownPath(path: string): IpaError {
  return new IpaError('config_path_unknown', EXIT.usage, `Den Pfad ${path} gibt es in config.json nicht.`);
}

/** The value at a path of field names; arrays are read as a whole. */
export function readPath(config: unknown, path: string): unknown {
  if (!PATH_PATTERN.test(path)) throw unknownPath(path);
  let current: unknown = config;
  for (const segment of path.split('.')) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) throw unknownPath(path);
    current = current[segment];
  }
  return current;
}

/** Applies the assignments to a copy; every path except the last field has to exist. */
export function applyAssignments(config: unknown, assignments: readonly Assignment[]): { candidate: unknown; changes: ConfigChange[] } {
  const candidate = structuredClone(config);
  const changes: ConfigChange[] = [];
  for (const assignment of assignments) {
    let parent: unknown = candidate;
    for (const segment of assignment.segments.slice(0, -1)) {
      if (!isObject(parent) || !Object.hasOwn(parent, segment)) throw unknownPath(assignment.path);
      parent = parent[segment];
    }
    const last = assignment.segments.at(-1)!;
    if (!isObject(parent)) throw unknownPath(assignment.path);
    // Copies: a later assignment inside the same object must not rewrite an earlier record.
    changes.push({
      path: assignment.path,
      before: Object.hasOwn(parent, last) ? structuredClone(parent[last]) : null,
      after: structuredClone(assignment.value),
    });
    parent[last] = assignment.value;
  }
  return { candidate, changes };
}

const IMMUTABLE_PATHS: { path: string; pointer: string }[] = [
  { path: 'schemaVersion', pointer: '/schemaVersion' },
  { path: 'repositoryId', pointer: '/repositoryId' },
  { path: 'repository', pointer: '/repository/path' },
  { path: 'timezone', pointer: '/timezone' },
];

/** Fields that cannot change after `init`; the time zone decides which day existing data belongs to. */
export function immutableFindings(before: unknown, candidate: unknown): ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  for (const { path, pointer } of IMMUTABLE_PATHS) {
    const old = isObject(before) ? before[path] : undefined;
    const next = isObject(candidate) ? candidate[path] : undefined;
    if (!isDeepStrictEqual(old, next)) {
      findings.push({
        severity: 'error',
        code: 'config_immutable',
        path: pointer,
        label: 'Fehler',
        message: `${path} lässt sich nach ipa init nicht ändern.`,
      });
    }
  }
  return findings;
}

/** `claude.allowPaidUsage` goes from not true (or missing) to true. */
export function enablesPaidUsage(before: unknown, candidate: unknown): boolean {
  const flag = (config: unknown): unknown => (isObject(config) && isObject(config['claude']) ? config['claude']['allowPaidUsage'] : undefined);
  return flag(before) !== true && flag(candidate) === true;
}

/** The settings that a registered task is built from. */
export function scheduleSettingsChanged(before: Config, after: Config): boolean {
  const key = (config: Config): string => JSON.stringify([config.schedule, config.limits.maxRunSeconds, config.claude.timeoutSeconds]);
  return key(before) !== key(after);
}
