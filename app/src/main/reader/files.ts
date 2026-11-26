import { readFile, readdir, stat } from 'node:fs/promises';
import type { SchemaValidator } from '../cli/validator';

/** D-18: V1 knows schema version 1 only; a higher version means the file comes from a newer tool. */
const SUPPORTED_SCHEMA_VERSION = 1;

export type JsonRead<T> =
  | { state: 'ok'; value: T }
  | { state: 'missing' }
  | { state: 'unreadable'; detail: string }
  | { state: 'newer'; version: number };

function newerVersion(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' && Number.isInteger(version) && version > SUPPORTED_SCHEMA_VERSION ? version : null;
}

/** Reads and validates one JSON file. Never throws; a bad file is a state of its own (spec §3.8). */
export async function readJson<T>(validator: SchemaValidator, schemaId: string, file: string): Promise<JsonRead<T>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? { state: 'missing' } : { state: 'unreadable', detail: `Datei nicht lesbar (${code ?? 'unbekannt'}).` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'unreadable', detail: 'Die Datei ist kein gültiges JSON.' };
  }
  const version = newerVersion(parsed);
  if (version !== null) return { state: 'newer', version };
  const outcome = validator.validate(schemaId, parsed);
  return outcome.ok ? { state: 'ok', value: parsed as T } : { state: 'unreadable', detail: `Schemafehler: ${outcome.issues.join('; ')}` };
}

export interface JsonlRead<T> {
  state: 'ok' | 'missing' | 'unreadable';
  items: T[];
  /** Lines that are no valid JSON, break the schema, or end without a line break (tolerant like `readJsonl`). */
  invalid: number;
  /** Lines of a newer schema version. */
  newer: number;
}

/** Reads a JSONL file line by line; an invalid line is counted and skipped, never a failure. */
export async function readJsonl<T>(validator: SchemaValidator, schemaId: string, file: string): Promise<JsonlRead<T>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { state: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable', items: [], invalid: 0, newer: 0 };
  }
  const result: JsonlRead<T> = { state: 'ok', items: [], invalid: 0, newer: 0 };
  const lines = text.split('\n');
  // The last element is empty when the file ends with a line break; otherwise it is an unfinished line.
  const unfinished = lines.pop() ?? '';
  if (unfinished.trim() !== '') result.invalid += 1;
  for (const line of lines) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      result.invalid += 1;
      continue;
    }
    if (newerVersion(parsed) !== null) {
      result.newer += 1;
      continue;
    }
    if (validator.validate(schemaId, parsed).ok) result.items.push(parsed as T);
    else result.invalid += 1;
  }
  return result;
}

export async function readText(file: string): Promise<{ state: 'ok'; text: string } | { state: 'missing' } | { state: 'unreadable' }> {
  try {
    return { state: 'ok', text: await readFile(file, 'utf8') };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? { state: 'missing' } : { state: 'unreadable' };
  }
}

export async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
