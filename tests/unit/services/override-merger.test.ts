/**
 * Unit tests for T033: Override merger service
 */

import { describe, it, expect } from 'vitest';
import { applyOverrides } from '../../../src/services/override-merger.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ResourceDescriptor } from '../../../src/models/types.js';
import { OverrideConfig } from '../../../src/models/config.js';

describe('override-merger', () => {
  describe('applyOverrides', () => {
    const baseDescriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      nameParts: ['my-nv'],
    };

    const baseJson = {
      name: 'my-nv',
      properties: {
        value: 'original-value',
        displayName: 'Original',
      },
    };

    it('should return original json when no overrides config', () => {
      const result = applyOverrides(baseDescriptor, baseJson, undefined);
      expect(result).toEqual(baseJson);
      expect(result).not.toBe(baseJson); // Should be a new object
    });

    it('should return original json when override config is empty', () => {
      const emptyConfig: OverrideConfig = {};
      const result = applyOverrides(baseDescriptor, baseJson, emptyConfig);
      expect(result).toEqual(baseJson);
    });

    it('should apply namedValue overrides by name (case-insensitive)', () => {
      const overrideConfig: OverrideConfig = {
        namedValues: {
          'my-nv': {
            properties: {
              value: 'overridden-value',
            },
          },
        },
      };

      const result = applyOverrides(baseDescriptor, baseJson, overrideConfig);
      expect(result.properties).toHaveProperty('value', 'overridden-value');
      expect(result.properties).toHaveProperty('displayName', 'Original');
    });

    it('should match override keys case-insensitively', () => {
      const overrideConfig: OverrideConfig = {
        namedValues: {
          'MY-NV': {
            properties: {
              value: 'case-insensitive-match',
            },
          },
        },
      };

      const result = applyOverrides(baseDescriptor, baseJson, overrideConfig);
      expect(result.properties).toHaveProperty('value', 'case-insensitive-match');
    });

    it('should apply backend url override', () => {
      const backendDescriptor: ResourceDescriptor = {
        type: ResourceType.Backend,
        nameParts: ['my-backend'],
      };

      const backendJson = {
        name: 'my-backend',
        properties: {
          url: 'https://original.example.com',
          protocol: 'http',
        },
      };

      const overrideConfig: OverrideConfig = {
        backends: {
          'my-backend': {
            properties: {
              url: 'https://overridden.example.com',
            },
          },
        },
      };

      const result = applyOverrides(backendDescriptor, backendJson, overrideConfig);
      expect(result.properties).toHaveProperty('url', 'https://overridden.example.com');
      expect(result.properties).toHaveProperty('protocol', 'http');
    });

    it('should apply api serviceUrl override', () => {
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      const apiJson = {
        name: 'my-api',
        properties: {
          serviceUrl: 'https://original-api.example.com',
          path: 'api',
        },
      };

      const overrideConfig: OverrideConfig = {
        apis: {
          'my-api': {
            properties: {
              serviceUrl: 'https://overridden-api.example.com',
            },
          },
        },
      };

      const result = applyOverrides(apiDescriptor, apiJson, overrideConfig);
      expect(result.properties).toHaveProperty('serviceUrl', 'https://overridden-api.example.com');
      expect(result.properties).toHaveProperty('path', 'api');
    });

    it('should deep-merge nested objects (not shallow)', () => {
      const overrideConfig: OverrideConfig = {
        namedValues: {
          'my-nv': {
            properties: {
              keyVault: {
                secretIdentifier: 'https://vault.azure.net/secrets/my-secret',
              },
            },
          },
        },
      };

      const jsonWithKeyVault = {
        name: 'my-nv',
        properties: {
          value: 'original',
          keyVault: {
            identityClientId: 'client-123',
          },
        },
      };

      const result = applyOverrides(baseDescriptor, jsonWithKeyVault, overrideConfig);
      expect(result.properties).toHaveProperty('keyVault');
      expect(((result.properties as Record<string, unknown>)).keyVault).toHaveProperty('identityClientId', 'client-123');
      expect(((result.properties as Record<string, unknown>)).keyVault).toHaveProperty(
        'secretIdentifier',
        'https://vault.azure.net/secrets/my-secret'
      );
    });

    it('should return new object (immutable)', () => {
      const overrideConfig: OverrideConfig = {
        namedValues: {
          'my-nv': {
            value: 'new-value',
          },
        },
      };

      const result = applyOverrides(baseDescriptor, baseJson, overrideConfig);
      expect(result).not.toBe(baseJson);
      expect(baseJson.properties).toHaveProperty('value', 'original-value'); // Original unchanged
    });

    it('should handle unknown resource type gracefully', () => {
      const unknownDescriptor: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['my-product'],
      };

      const productJson = {
        name: 'my-product',
        properties: {
          displayName: 'Product',
        },
      };

      const overrideConfig: OverrideConfig = {
        namedValues: {
          'some-nv': { value: 'test' },
        },
      };

      const result = applyOverrides(unknownDescriptor, productJson, overrideConfig);
      expect(result).toEqual(productJson);
    });

    it('should handle missing override for resource name', () => {
      const overrideConfig: OverrideConfig = {
        namedValues: {
          'other-nv': {
            value: 'other-value',
          },
        },
      };

      const result = applyOverrides(baseDescriptor, baseJson, overrideConfig);
      expect(result).toEqual(baseJson);
    });

    it('should replace arrays (not merge)', () => {
      const overrideConfig: OverrideConfig = {
        namedValues: {
          'my-nv': {
            properties: {
              tags: ['env:prod', 'region:us'],
            },
          },
        },
      };

      const jsonWithTags = {
        name: 'my-nv',
        properties: {
          value: 'val',
          tags: ['env:dev'],
        },
      };

      const result = applyOverrides(baseDescriptor, jsonWithTags, overrideConfig);
      expect(((result.properties as Record<string, unknown>)).tags).toEqual(['env:prod', 'region:us']);
    });

    it('should override primitives completely', () => {
      const overrideConfig: OverrideConfig = {
        namedValues: {
          'my-nv': {
            properties: {
              displayName: 'New Display Name',
            },
          },
        },
      };

      const result = applyOverrides(baseDescriptor, baseJson, overrideConfig);
      expect(result.properties).toHaveProperty('displayName', 'New Display Name');
    });

    it('should apply logger overrides', () => {
      const loggerDescriptor: ResourceDescriptor = {
        type: ResourceType.Logger,
        nameParts: ['my-logger'],
      };

      const loggerJson = {
        name: 'my-logger',
        properties: {
          loggerType: 'applicationInsights',
          resourceId: '/subscriptions/old/...',
        },
      };

      const overrideConfig: OverrideConfig = {
        loggers: {
          'my-logger': {
            properties: {
              resourceId: '/subscriptions/new/...',
            },
          },
        },
      };

      const result = applyOverrides(loggerDescriptor, loggerJson, overrideConfig);
      expect(result.properties).toHaveProperty('resourceId', '/subscriptions/new/...');
    });

    it('should apply diagnostic overrides', () => {
      const diagnosticDescriptor: ResourceDescriptor = {
        type: ResourceType.Diagnostic,
        nameParts: ['my-diagnostic'],
      };

      const diagnosticJson = {
        name: 'my-diagnostic',
        properties: {
          loggerId: '/loggers/old-logger',
        },
      };

      const overrideConfig: OverrideConfig = {
        diagnostics: {
          'my-diagnostic': {
            properties: {
              loggerId: '/loggers/new-logger',
            },
          },
        },
      };

      const result = applyOverrides(diagnosticDescriptor, diagnosticJson, overrideConfig);
      expect(result.properties).toHaveProperty('loggerId', '/loggers/new-logger');
    });
  });
});
