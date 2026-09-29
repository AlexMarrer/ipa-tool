import { describe, expect, it } from 'vitest';
import { LIVE_SCHEMA } from '../../src/claude/doctor.js';
import { checkOutputSchema, MAX_OUTPUT_SCHEMA_CHARS, OutputSchemaError, prepareOutputSchema } from '../../src/claude/output-schema.js';

/** Shaped like the analysis output of spec.md §9.7. */
const VALID = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'unknowns'],
  properties: {
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'evidence'],
      properties: {
        text: { type: 'string', minLength: 1 },
        evidence: { type: 'array', minItems: 1, items: { $ref: '#/definitions/id' } },
      },
    },
    unknowns: { type: 'array', items: { type: 'string' } },
    result: { type: 'string', enum: ['passed', 'failed', 'unknown'] },
  },
  definitions: { id: { type: 'string', pattern: '^(E[0-9]{3,}|N[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}|C[0-9]{2,})$' } },
};

describe('Ausgabeschemas für Claude (spec.md §8.4, AK-05-08)', () => {
  it('akzeptiert ein gültiges draft-07-Schema und serialisiert es kompakt', () => {
    expect(checkOutputSchema(VALID)).toEqual([]);
    expect(prepareOutputSchema(VALID)).toBe(JSON.stringify(VALID));
    expect(prepareOutputSchema(LIVE_SCHEMA)).toBe('{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}');
  });

  it('lehnt format, $schema und $id ab, auch verschachtelt', () => {
    const nested = structuredClone(VALID) as Record<string, any>; // `any`: the test builds variants of a plain JSON object.
    nested['properties']['summary']['properties']['text']['format'] = 'date-time';
    expect(checkOutputSchema(nested).join(' ')).toContain('/properties/summary/properties/text: format ist nicht erlaubt');
    expect(checkOutputSchema({ ...VALID, $schema: 'http://json-schema.org/draft-07/schema#' }).join(' ')).toContain('/: $schema ist nicht erlaubt');
    expect(checkOutputSchema({ ...VALID, $id: 'urn:ipa:analysis' }).join(' ')).toContain('$id ist nicht erlaubt');
    const inItems = { type: 'array', items: { anyOf: [{ type: 'string', format: 'email' }, { type: 'null' }] } };
    expect(checkOutputSchema(inItems).join(' ')).toContain('/items/anyOf/0: format ist nicht erlaubt');
    const inDefinitions = { ...VALID, definitions: { id: { type: 'string', format: 'uri' } } };
    expect(checkOutputSchema(inDefinitions).join(' ')).toContain('/definitions/id: format ist nicht erlaubt');
    expect(() => prepareOutputSchema(nested)).toThrow(OutputSchemaError);
  });

  it('erlaubt eine Eigenschaft, die format heisst', () => {
    const schema = { type: 'object', properties: { format: { type: 'string' } }, additionalProperties: false };
    expect(checkOutputSchema(schema)).toEqual([]);
  });

  it('lehnt Schemas ab 8000 Zeichen ab und akzeptiert kürzere', () => {
    const withLength = (length: number) => {
      const skeleton = JSON.stringify({ type: 'string', description: '' }).length;
      return { type: 'string', description: 'x'.repeat(length - skeleton) };
    };
    expect(JSON.stringify(withLength(MAX_OUTPUT_SCHEMA_CHARS - 1)).length).toBe(7999);
    expect(checkOutputSchema(withLength(MAX_OUTPUT_SCHEMA_CHARS - 1))).toEqual([]);
    expect(checkOutputSchema(withLength(MAX_OUTPUT_SCHEMA_CHARS)).join(' ')).toContain('kompakt 8000 Zeichen');
    expect(() => prepareOutputSchema(withLength(9000))).toThrow('weniger als 8000');
  });

  it('lehnt ungültige Schemas und Nicht-Objekte ab', () => {
    expect(checkOutputSchema({ type: 'strng' }).join(' ')).toContain('kein gültiges JSON Schema draft-07');
    expect(checkOutputSchema({ type: 'object', gibtEsNicht: true }).join(' ')).toContain('kein gültiges JSON Schema draft-07');
    expect(checkOutputSchema([])).toEqual(['das Schema muss ein JSON-Objekt sein']);
    expect(checkOutputSchema(null)).toEqual(['das Schema muss ein JSON-Objekt sein']);
  });
});
