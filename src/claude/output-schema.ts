/**
 * Output schemas that go to Claude with `--json-schema` (spec.md §8.4, A-02): JSON Schema draft-07
 * without `format`, `$schema` and `$id`, compact shorter than 8000 characters so that the command line
 * stays below the Windows limit.
 */
import { Ajv } from 'ajv';
import { isPlainObject } from './envelope.js';

export const MAX_OUTPUT_SCHEMA_CHARS = 8000;

// Before 2.1.205 Claude Code silently ignores a schema it considers invalid, and `format` makes it invalid (A-02).
const FORBIDDEN_KEYWORDS = ['format', '$schema', '$id'] as const;

// Keywords whose value is a schema, an array of schemas or a map of schemas (draft-07).
const SCHEMA_KEYWORDS = ['additionalItems', 'additionalProperties', 'contains', 'propertyNames', 'if', 'then', 'else', 'not'];
const SCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf'];
const SCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties', 'definitions'];

/** A programming error: the schema is fixed in the code. No process is started. */
export class OutputSchemaError extends Error {
  readonly code = 'output_schema_invalid';

  constructor(problems: readonly string[]) {
    super(`Ungültiges Ausgabeschema für Claude: ${problems.join('; ')}`);
    this.name = 'OutputSchemaError';
  }
}

/** Walks only schema positions, so a property named `format` in `properties` is allowed. */
function forbiddenKeywords(schema: unknown, pointer: string, problems: string[]): void {
  if (Array.isArray(schema)) {
    schema.forEach((item, index) => forbiddenKeywords(item, `${pointer}/${index}`, problems));
    return;
  }
  if (!isPlainObject(schema)) return;
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (keyword in schema) problems.push(`${pointer === '' ? '/' : pointer}: ${keyword} ist nicht erlaubt`);
  }
  for (const keyword of SCHEMA_KEYWORDS) {
    if (keyword in schema) forbiddenKeywords(schema[keyword], `${pointer}/${keyword}`, problems);
  }
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    if (keyword in schema) forbiddenKeywords(schema[keyword], `${pointer}/${keyword}`, problems);
  }
  if ('items' in schema) forbiddenKeywords(schema['items'], `${pointer}/items`, problems);
  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const map = schema[keyword];
    if (!isPlainObject(map)) continue;
    for (const [name, sub] of Object.entries(map)) forbiddenKeywords(sub, `${pointer}/${keyword}/${name}`, problems);
  }
  const dependencies = schema['dependencies'];
  if (isPlainObject(dependencies)) {
    for (const [name, sub] of Object.entries(dependencies)) {
      if (!Array.isArray(sub)) forbiddenKeywords(sub, `${pointer}/dependencies/${name}`, problems);
    }
  }
}

/** All violations of spec.md §8.4; empty if the schema may go to Claude. */
export function checkOutputSchema(schema: unknown): string[] {
  if (!isPlainObject(schema)) return ['das Schema muss ein JSON-Objekt sein'];
  const problems: string[] = [];
  forbiddenKeywords(schema, '', problems);
  try {
    // The same Ajv options as the schema registry (spec.md §8.4); strict mode also rejects unknown keywords.
    new Ajv({ strict: true, allErrors: true, allowUnionTypes: true }).compile(schema);
  } catch (error) {
    problems.push(`kein gültiges JSON Schema draft-07 (${error instanceof Error ? error.message : String(error)})`);
  }
  const length = JSON.stringify(schema).length;
  if (length >= MAX_OUTPUT_SCHEMA_CHARS) {
    problems.push(`kompakt ${length} Zeichen, erlaubt sind weniger als ${MAX_OUTPUT_SCHEMA_CHARS}`);
  }
  return problems;
}

/** Compact serialisation for `--json-schema`; throws `OutputSchemaError` for a schema that violates §8.4. */
export function prepareOutputSchema(schema: unknown): string {
  const problems = checkOutputSchema(schema);
  if (problems.length > 0) throw new OutputSchemaError(problems);
  return JSON.stringify(schema);
}
