// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T026: Secret redaction service
 */

import { describe, it, expect } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ResourceDescriptor } from '../../../src/models/types.js';
import { redactSecrets, REDACTION_MARKER } from '../../../src/services/secret-redactor.js';

describe('secret-redactor', () => {
  describe('redactSecrets', () => {
    it('should not modify non-NamedValue resources', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      const json = { properties: { secret: true, value: 'sensitive' } };
      expect(redactSecrets(descriptor, json)).toBe(json);
    });

    it('should not modify NamedValues without secret flag', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-value'],
      };
      const json = { properties: { secret: false, value: 'public-value' } };
      expect(redactSecrets(descriptor, json)).toBe(json);
    });

    it('should not modify NamedValues without properties', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-value'],
      };
      const json = { name: 'my-value' };
      expect(redactSecrets(descriptor, json)).toBe(json);
    });

    it('should redact secret NamedValue values', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-secret'],
      };
      const json = {
        name: 'my-secret',
        properties: {
          displayName: 'My Secret',
          secret: true,
          value: 'super-secret-value',
        },
      };

      const result = redactSecrets(descriptor, json);

      // Should not mutate original
      expect((json.properties as Record<string, unknown>).value).toBe('super-secret-value');

      // Result should have redacted value
      const resultProps = result.properties as Record<string, unknown>;
      expect(resultProps.value).toBe(REDACTION_MARKER);
      expect(resultProps.secret).toBe(true);
      expect(resultProps.displayName).toBe('My Secret');
    });

    it('should preserve KeyVault-backed NamedValues', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['kv-secret'],
      };
      const json = {
        name: 'kv-secret',
        properties: {
          secret: true,
          keyVault: {
            secretIdentifier: 'https://myvault.vault.azure.net/secrets/my-secret',
          },
        },
      };

      const result = redactSecrets(descriptor, json);
      // KeyVault references should be returned as-is
      expect(result).toBe(json);
    });

    it('should create a deep clone for redacted output', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-secret'],
      };
      const json = {
        name: 'my-secret',
        properties: {
          secret: true,
          value: 'secret',
          nested: { deep: 'value' },
        },
      };

      const result = redactSecrets(descriptor, json);
      // Verify it's a different object
      expect(result).not.toBe(json);
      // Verify nested objects are also cloned
      const resultNested = (result.properties as Record<string, unknown>).nested as Record<string, unknown>;
      expect(resultNested).not.toBe((json.properties as Record<string, unknown>).nested);
    });
  });
});
