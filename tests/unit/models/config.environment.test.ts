// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect, beforeAll } from 'vitest';
import Ajv from 'ajv';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../../../schemas/v1/override-config.schema.json', import.meta.url);

describe('override-config schema — environment property', () => {
  let validate: ReturnType<Ajv['compile']>;

  beforeAll(async () => {
    const schemaJson = JSON.parse(await readFile(schemaPath, 'utf-8'));
    const ajv = new Ajv({ strict: false });
    validate = ajv.compile(schemaJson);
  });

  it('accepts environment with namePrefix only', () => {
    const valid = validate({ environment: { namePrefix: 'dev-' } });
    expect(valid).toBe(true);
  });

  it('accepts environment with all fields', () => {
    const valid = validate({
      environment: {
        namePrefix: 'dev-',
        nameSuffix: '-dev',
        apiPathPrefix: 'dev/',
        appliesTo: ['Api', 'Product'],
      },
    });
    expect(valid).toBe(true);
  });

  it('accepts config without environment (back-compat)', () => {
    const valid = validate({ namedValues: [{ name: 'nv1', properties: { value: 'x' } }] });
    expect(valid).toBe(true);
  });

  it('rejects namePrefix with invalid character (e.g. "@")', () => {
    const valid = validate({ environment: { namePrefix: 'dev@' } });
    expect(valid).toBe(false);
  });

  it('rejects nameSuffix with invalid character (e.g. " ")', () => {
    const valid = validate({ environment: { nameSuffix: 'dev env' } });
    expect(valid).toBe(false);
  });

  it('rejects appliesTo containing an unknown resource type', () => {
    const valid = validate({ environment: { appliesTo: ['Api', 'UnknownType'] } });
    expect(valid).toBe(false);
  });

  it('rejects unknown property at root (additionalProperties: false)', () => {
    const valid = validate({ unknownTopLevelProp: 'value' });
    expect(valid).toBe(false);
  });

  it('rejects unknown property inside environment (additionalProperties: false)', () => {
    const valid = validate({ environment: { namePrefix: 'dev-', bogus: true } });
    expect(valid).toBe(false);
  });
});
