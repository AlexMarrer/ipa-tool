/**
 * Schema registry, Ajv in draft-07 mode (spec.md §8.4).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { TOOL_ROOT } from './tool.js';

export const SCHEMA_IDS = ['config', 'state', 'registry', 'run-record', 'manifest', 'note'] as const;
export type SchemaId = (typeof SCHEMA_IDS)[number];

/** V1 has no migration (D-18). */
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface SchemaIssue {
  /** JSON pointer such as `/limits/maxFileBytes`; `/` is the root. */
  path: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; issues: SchemaIssue[] };

// `allowUnionTypes` permits `"type": ["string", "null"]` in strict mode (spec.md §18).
const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true });
const validators = new Map<SchemaId, ValidateFunction>();

export function schemaFilePath(id: SchemaId): string {
  return path.join(TOOL_ROOT, 'schemas', `${id}.schema.json`);
}

export function loadSchema(id: SchemaId): Record<string, unknown> {
  return JSON.parse(readFileSync(schemaFilePath(id), 'utf8')) as Record<string, unknown>;
}

function validatorFor(id: SchemaId): ValidateFunction {
  let validator = validators.get(id);
  if (validator === undefined) {
    validator = ajv.compile(loadSchema(id));
    validators.set(id, validator);
  }
  return validator;
}

export function validate(id: SchemaId, value: unknown): ValidationResult {
  const validator = validatorFor(id);
  if (validator(value)) return { ok: true };
  return { ok: false, issues: (validator.errors ?? []).map(toIssue) };
}

/** The schema version of a value if it is higher than the supported one (D-18), otherwise `null`. */
export function unsupportedSchemaVersion(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' && Number.isInteger(version) && version > SUPPORTED_SCHEMA_VERSION
    ? version
    : null;
}

export function formatIssues(issues: readonly SchemaIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
}

function joinPointer(base: string, property: string): string {
  const escaped = property.replace(/~/g, '~0').replace(/\//g, '~1');
  return `${base}/${escaped}`;
}

function toIssue(error: ErrorObject): SchemaIssue {
  const at = error.instancePath === '' ? '/' : error.instancePath;
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'required': {
      const missing = String(params['missingProperty']);
      return { path: joinPointer(error.instancePath, missing), message: 'Pflichtfeld fehlt' };
    }
    case 'additionalProperties': {
      const extra = String(params['additionalProperty']);
      return { path: joinPointer(error.instancePath, extra), message: 'unbekanntes Feld' };
    }
    case 'type':
      return { path: at, message: `muss vom Typ ${String(params['type'])} sein` };
    case 'const':
      return { path: at, message: `muss den Wert ${JSON.stringify(params['allowedValue'])} haben` };
    case 'enum': {
      const allowed = Array.isArray(params['allowedValues']) ? params['allowedValues'] : [];
      return { path: at, message: `muss einer dieser Werte sein: ${allowed.map((v) => JSON.stringify(v)).join(', ')}` };
    }
    case 'pattern':
      return { path: at, message: 'hat nicht das erwartete Format' };
    case 'minimum':
      return { path: at, message: `muss mindestens ${String(params['limit'])} sein` };
    case 'maximum':
      return { path: at, message: `darf höchstens ${String(params['limit'])} sein` };
    case 'minLength':
      return { path: at, message: `muss mindestens ${String(params['limit'])} Zeichen lang sein` };
    case 'maxLength':
      return { path: at, message: `darf höchstens ${String(params['limit'])} Zeichen lang sein` };
    case 'minItems':
      return { path: at, message: `muss mindestens ${String(params['limit'])} Einträge enthalten` };
    case 'maxItems':
      return { path: at, message: `darf höchstens ${String(params['limit'])} Einträge enthalten` };
    case 'uniqueItems':
      return { path: at, message: 'darf keine doppelten Einträge enthalten' };
    case 'if':
      return { path: at, message: 'verletzt eine bedingte Regel' };
    default:
      return { path: at, message: error.message ?? `verletzt die Regel ${error.keyword}` };
  }
}
