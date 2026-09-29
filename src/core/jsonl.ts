/**
 * JSONL-Dateien: ein validierter Datensatz pro Zeile (spec.md §8.5).
 */
import { appendFile, open, readFile } from 'node:fs/promises';
import { errnoCode, EXIT, IpaError } from './errors.js';
import { stripBom } from './json.js';
import { formatIssues, type SchemaId, unsupportedSchemaVersion, validate } from './schemas.js';

export interface InvalidLine {
  /** Zeilennummer, beginnend bei 1. */
  line: number;
  error: string;
}

export interface JsonlReadResult<T> {
  records: T[];
  invalid: InvalidLine[];
}

/**
 * Validiert den Datensatz und hängt ihn mit einem einzigen `appendFile`-Aufruf an.
 * Endet die Datei nach einem Abbruch ohne Zeilenumbruch, wird die angefangene Zeile zuerst
 * abgeschlossen, damit der neue Datensatz eine eigene gültige Zeile erhält.
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
 * Liefert die gültigen Datensätze und die ungültigen Zeilen mit Zeilennummer.
 * Eine fehlende Datei ergibt eine leere Liste. Eine unvollständige letzte Zeile gilt als ungültig.
 * Leere Zeilen werden übersprungen.
 */
export async function readJsonl<T>(filePath: string, schemaId: SchemaId): Promise<JsonlReadResult<T>> {
  let text: string;
  try {
    text = stripBom(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return { records: [], invalid: [] };
    throw error;
  }
  const records: T[] = [];
  const invalid: InvalidLine[] = [];
  if (text.length === 0) return { records, invalid };

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
    records.push(value as T);
  });
  return { records, invalid };
}
