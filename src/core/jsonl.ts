/**
 * JSONL files with one validated record per line (spec.md §8.5).
 */
import { appendFile, open, readFile } from 'node:fs/promises';
import { errnoCode, EXIT, IpaError } from './errors.js';
import { stripBom } from './json.js';
import { formatIssues, type SchemaId, unsupportedSchemaVersion, validate } from './schemas.js';

export interface InvalidLine {
  /** 1-based. */
  line: number;
  error: string;
}

export interface JsonlReadResult<T> {
  records: T[];
  invalid: InvalidLine[];
}

export interface JsonlEntry<T> {
  /** 1-based. */
  line: number;
  record: T;
}

export interface JsonlEntriesResult<T> {
  entries: JsonlEntry<T>[];
  invalid: InvalidLine[];
}

/**
 * Appends with a single `appendFile` call. If an aborted write left the file without a final line
 * break, that line is closed first so the new record gets a valid line of its own.
 */
export async function appendJsonl(filePath: string, record: unknown, schemaId: SchemaId): Promise<void> {
  const result = validate(schemaId, record);
  if (!result.ok) {
    throw new IpaError(
      'record_invalid',
      EXIT.internal,
      `Interner Fehler: Der Datensatz für ${schemaId} ist ungültig: ${formatIssues(result.issues)}`,
    );
  }
  const line = `${JSON.stringify(record)}\n`;
  const separator = (await endsWithoutNewline(filePath)) ? '\n' : '';
  await appendFile(filePath, separator + line, 'utf8');
}

async function endsWithoutNewline(filePath: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return false;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

/**
 * A missing file yields no records, an incomplete last line counts as invalid, empty lines are skipped.
 */
export async function readJsonl<T>(filePath: string, schemaId: SchemaId): Promise<JsonlReadResult<T>> {
  const { entries, invalid } = await readJsonlEntries<T>(filePath, schemaId);
  return { records: entries.map((entry) => entry.record), invalid };
}

/** Like `readJsonl`, with the line number of every valid record for follow-up checks of the caller. */
export async function readJsonlEntries<T>(filePath: string, schemaId: SchemaId): Promise<JsonlEntriesResult<T>> {
  let text: string;
  try {
    text = stripBom(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return { entries: [], invalid: [] };
    throw error;
  }
  const entries: JsonlEntry<T>[] = [];
  const invalid: InvalidLine[] = [];
  if (text.length === 0) return { entries, invalid };

  const complete = text.endsWith('\n');
  const lines = text.split('\n');
  if (complete) lines.pop();

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') return;
    if (!complete && index === lines.length - 1) {
      invalid.push({ line: lineNumber, error: 'unvollständige letzte Zeile' });
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      invalid.push({ line: lineNumber, error: 'kein gültiges JSON' });
      return;
    }
    const version = unsupportedSchemaVersion(value);
    if (version !== null) {
      invalid.push({ line: lineNumber, error: `unbekannte Schemaversion ${version}` });
      return;
    }
    const result = validate(schemaId, value);
    if (!result.ok) {
      invalid.push({ line: lineNumber, error: formatIssues(result.issues) });
      return;
    }
    entries.push({ line: lineNumber, record: value as T });
  });
  return { entries, invalid };
}
