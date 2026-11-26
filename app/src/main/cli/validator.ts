import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';

export type ValidationOutcome = { ok: true } | { ok: false; issues: string[] };

export interface SchemaValidator {
  /** `id` is the file name without `.schema.json`, for example `registry` or `cli-capture`. */
  validate(id: string, value: unknown): ValidationOutcome;
}

/**
 * Validates against the JSON schemas of the CLI (spec §3.1). Same Ajv options as the CLI
 * (docs/implementation/spec.md §8.4).
 */
export function createSchemaValidator(schemasDir: string): SchemaValidator {
  const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true });
  const compiled = new Map<string, ValidateFunction>();

  function validatorFor(id: string): ValidateFunction {
    let validator = compiled.get(id);
    if (validator === undefined) {
      const schema = JSON.parse(readFileSync(path.join(schemasDir, `${id}.schema.json`), 'utf8')) as object;
      validator = ajv.compile(schema);
      compiled.set(id, validator);
    }
    return validator;
  }

  return {
    validate(id, value) {
      const validator = validatorFor(id);
      if (validator(value)) return { ok: true };
      const issues = (validator.errors ?? []).map((error) => `${error.instancePath === '' ? '/' : error.instancePath} ${error.message ?? 'ungültig'}`);
      return { ok: false, issues };
    },
  };
}
