/**
 * Validated JSON files (spec.md §8.4, §8.5).
 */
import { readFile } from 'node:fs/promises';
import { errnoCode, EXIT, IpaError } from './errors.js';
import { writeFileAtomic } from './fs-write.js';
import { formatIssues, type SchemaId, unsupportedSchemaVersion, validate } from './schemas.js';

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Position of a JSON syntax error without any excerpt of the content (I-12). */
export function describeJsonSyntaxError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) return `Zeile ${lineColumn[1]}, Spalte ${lineColumn[2]}`;
  const position = /position (\d+)/.exec(message);
  if (position) return `Zeichen ${position[1]}`;
  return 'Position unbekannt';
}

/**
 * Missing, unreadable or invalid files and a higher `schemaVersion` raise `IpaError` with exit
 * code 2 (D-18).
 */
export async function readJsonValidated<T>(filePath: string, schemaId: SchemaId): Promise<T> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'ENOENT') {
      throw new IpaError('file_not_found', EXIT.usage, `Datei fehlt: ${filePath}`, { cause: error });
    }
    throw new IpaError('file_unreadable', EXIT.usage, `Datei nicht lesbar: ${filePath} (${code ?? 'unbekannter Fehler'})`, {
      cause: error,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(stripBom(text));
  } catch (error) {
    throw new IpaError('json_invalid', EXIT.usage, `Kein gültiges JSON in ${filePath} (${describeJsonSyntaxError(error)})`, {
      cause: error,
    });
  }
  const version = unsupportedSchemaVersion(value);
  if (version !== null) {
    throw new IpaError(
      'schema_version_unsupported',
      EXIT.usage,
      `${filePath} hat die unbekannte Schemaversion ${version}. Diese Version des Tools liest nur Schemaversion 1 und migriert keine Daten.`,
    );
  }
  const result = validate(schemaId, value);
  if (!result.ok) {
    throw new IpaError('schema_invalid', EXIT.usage, `Ungültige Datei ${filePath}: ${formatIssues(result.issues)}`);
  }
  return value as T;
}

/**
 * An invalid value is a programming error (exit code 1); the file then stays unchanged.
 */
export async function writeJsonAtomic(filePath: string, value: unknown, schemaId: SchemaId): Promise<void> {
  const result = validate(schemaId, value);
  if (!result.ok) {
    throw new IpaError(
      'record_invalid',
      EXIT.internal,
      `Interner Fehler: Der Datensatz für ${schemaId} ist ungültig: ${formatIssues(result.issues)}`,
    );
  }
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
