// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T031: Resource publisher service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishResource } from '../../../src/services/resource-publisher.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { PublishConfig } from '../../../src/models/config.js';
import { KeyVaultAccessError } from '../../../src/services/keyvault-checker.js';
import { LogLevel } from '../../../src/lib/logger.js';

// Mock keyvault-checker so resource-publisher tests don't need an Azure environment
const mockCheckKeyVaultSecretAccess = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/services/keyvault-checker.js', () => ({
  checkKeyVaultSecretAccess: (...args: unknown[]) => mockCheckKeyVaultSecretAccess(...args),
  KeyVaultAccessError: class KeyVaultAccessError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'KeyVaultAccessError';
    }
  },
}));

function createMockClient() {
  return {
    listResources: async function* () {},
    getResource: vi.fn(),
    putResource: vi.fn().mockResolvedValue(undefined),
    deleteResource: vi.fn(),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn(),
  };
}

function createMockStore() {
  return {
    writeResource: vi.fn(),
    writeContent: vi.fn(),
    writeAssociation: vi.fn(),
    readResource: vi.fn(),
    readContent: vi.fn().mockResolvedValue(undefined),
    readAssociation: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    deleteResource: vi.fn(),
  };
}

const testContext: ApimServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apim-1',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

const testConfig: PublishConfig = {
  service: testContext,
  sourceDir: '/source',
  dryRun: false,
  deleteUnmatched: false,
  logLevel: LogLevel.INFO,
};

function generatedSubscriptionId(fill: string): string {
  return fill.repeat(24);
}

describe('resource-publisher', () => {
  describe('publishResource', () => {
    beforeEach(() => {
      mockCheckKeyVaultSecretAccess.mockClear();
      mockCheckKeyVaultSecretAccess.mockResolvedValue(undefined);
    });
    it('should return skipped when resource not found in store', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readResource.mockResolvedValue(null);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-nv'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('skipped');
      expect(result.action).toBe('noop');
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should return success and call putResource on success', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const resourceJson = {
        name: 'my-nv',
        properties: { value: 'test-value' },
      };
      store.readResource.mockResolvedValue(resourceJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-nv'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('success');
      expect(result.action).toBe('put');
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        descriptor,
        expect.objectContaining({ name: 'my-nv' })
      );
    });

    it('should return failed when putResource throws', async () => {
      const client = createMockClient();
      client.putResource.mockRejectedValue(new Error('Network error'));
      const store = createMockStore();
      store.readResource.mockResolvedValue({ name: 'test' });

      const descriptor: ResourceDescriptor = {
        type: ResourceType.Backend,
        nameParts: ['my-backend'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('failed');
      expect(result.action).toBe('noop');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Network error');
    });

    it('should apply overrides before PUT', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const resourceJson = {
        name: 'my-nv',
        properties: { value: 'original' },
      };
      store.readResource.mockResolvedValue(resourceJson);

      const configWithOverrides: PublishConfig = {
        ...testConfig,
        overrides: {
          namedValues: {
            'my-nv': {
              value: 'overridden',
            },
          },
        },
      };

      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-nv'],
      };

      await publishResource(client, store, testContext, descriptor, configWithOverrides);

      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        descriptor,
        expect.objectContaining({
          properties: expect.objectContaining({ value: 'overridden' }),
        })
      );
    });

    it('should preserve opaque JSON properties', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const resourceJson = {
        name: 'my-backend',
        properties: {
          url: 'https://api.example.com',
          protocol: 'http',
          customField: 'custom-value',
          nestedObject: {
            prop1: 'val1',
            prop2: 'val2',
          },
        },
      };
      store.readResource.mockResolvedValue(resourceJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.Backend,
        nameParts: ['my-backend'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      const putCall = client.putResource.mock.calls[0];
      const putJson = putCall[2] as Record<string, unknown>;
      expect(putJson.properties).toHaveProperty('customField', 'custom-value');
      expect(putJson.properties).toHaveProperty('nestedObject');
      expect(((putJson.properties as Record<string, unknown>)).nestedObject).toHaveProperty('prop1', 'val1');
    });

    it('should publish policy content for policy resources without calling readResource', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readContent.mockResolvedValue({
        content: '<policies><inbound><base /></inbound></policies>',
      });

      const descriptor: ResourceDescriptor = {
        type: ResourceType.ServicePolicy,
        nameParts: [],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('success');
      expect(result.action).toBe('put');
      expect(store.readResource).not.toHaveBeenCalled();
      const putCall = client.putResource.mock.calls[0];
      const putJson = putCall[2] as Record<string, unknown>;
      expect(putJson.properties).toHaveProperty('value', '<policies><inbound><base /></inbound></policies>');
      expect(putJson.properties).toHaveProperty('format', 'rawxml');
    });

    it('should return skipped for policy resource when no policy.xml exists', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readContent.mockResolvedValue(undefined);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['my-api'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('skipped');
      expect(result.action).toBe('noop');
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should handle association resources (ProductApi)', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockResolvedValue(['api-1', 'api-2']);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.ProductApi,
        nameParts: ['my-product'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('success');
      // readAssociation must be called with a Product descriptor, not ProductApi
      expect(store.readAssociation).toHaveBeenCalledWith(
        testConfig.sourceDir,
        expect.objectContaining({ type: ResourceType.Product, nameParts: ['my-product'] }),
        'apis'
      );
      expect(client.putResource).toHaveBeenCalledTimes(2);
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductApi, nameParts: ['my-product', 'api-1'] }),
        {}
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductApi, nameParts: ['my-product', 'api-2'] }),
        {}
      );
    });

    it('should handle association resources (ProductGroup)', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockResolvedValue(['group-1']);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.ProductGroup,
        nameParts: ['my-product'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('success');
      // readAssociation must be called with a Product descriptor, not ProductGroup
      expect(store.readAssociation).toHaveBeenCalledWith(
        testConfig.sourceDir,
        expect.objectContaining({ type: ResourceType.Product, nameParts: ['my-product'] }),
        'groups'
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductGroup, nameParts: ['my-product', 'group-1'] }),
        {}
      );
    });

    it('should handle association resources (GatewayApi)', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockResolvedValue(['api-1']);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.GatewayApi,
        nameParts: ['my-gateway'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('success');
      // readAssociation must be called with a Gateway descriptor, not GatewayApi
      expect(store.readAssociation).toHaveBeenCalledWith(
        testConfig.sourceDir,
        expect.objectContaining({ type: ResourceType.Gateway, nameParts: ['my-gateway'] }),
        'apis'
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.GatewayApi, nameParts: ['my-gateway', 'api-1'] }),
        {}
      );
    });

    it('should strip properties.value from KeyVault-backed NamedValue PUT payload', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const resourceJson = {
        name: 'kv-secret',
        properties: {
          secret: true,
          displayName: 'kv-secret',
          value: '*** REDACTED ***',
          keyVault: {
            secretIdentifier: 'https://myvault.vault.azure.net/secrets/my-secret',
          },
        },
      };
      store.readResource.mockResolvedValue(resourceJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['kv-secret'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      const putCall = client.putResource.mock.calls[0];
      const putJson = putCall[2] as Record<string, unknown>;
      const props = putJson.properties as Record<string, unknown>;
      expect(props).not.toHaveProperty('value');
      expect(props).toHaveProperty('keyVault');
      expect(props.secret).toBe(true);
    });

    it('should preserve properties.value for plain (non-KeyVault) NamedValues', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const resourceJson = {
        name: 'plain-nv',
        properties: {
          value: 'my-plain-value',
          displayName: 'plain-nv',
        },
      };
      store.readResource.mockResolvedValue(resourceJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['plain-nv'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      const putCall = client.putResource.mock.calls[0];
      const putJson = putCall[2] as Record<string, unknown>;
      const props = putJson.properties as Record<string, unknown>;
      expect(props).toHaveProperty('value', 'my-plain-value');
    });

    it('should call checkKeyVaultSecretAccess for KeyVault-backed NamedValues', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const kvNv = {
        name: 'kv-nv',
        properties: {
          secret: true,
          keyVault: {
            secretIdentifier: 'https://myvault.vault.azure.net/secrets/my-secret',
            identityClientId: 'my-mi-client-id',
          },
        },
      };
      store.readResource.mockResolvedValue(kvNv);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['kv-nv'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      expect(mockCheckKeyVaultSecretAccess).toHaveBeenCalledWith(
        'https://myvault.vault.azure.net/secrets/my-secret',
        'my-mi-client-id',
        { subscriptionId: 'sub-1', resourceGroup: 'rg-1', serviceName: 'apim-1' }
      );
    });

    it('should pass undefined identityClientId for system-assigned identity', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const kvNv = {
        name: 'kv-nv',
        properties: {
          secret: true,
          keyVault: {
            secretIdentifier: 'https://myvault.vault.azure.net/secrets/my-secret',
          },
        },
      };
      store.readResource.mockResolvedValue(kvNv);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['kv-nv'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      expect(mockCheckKeyVaultSecretAccess).toHaveBeenCalledWith(
        'https://myvault.vault.azure.net/secrets/my-secret',
        undefined,
        { subscriptionId: 'sub-1', resourceGroup: 'rg-1', serviceName: 'apim-1' }
      );
    });

    it('should return failed when KeyVault access check throws KeyVaultAccessError', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const kvNv = {
        name: 'kv-nv',
        properties: {
          secret: true,
          keyVault: {
            secretIdentifier: 'https://myvault.vault.azure.net/secrets/my-secret',
            identityClientId: 'my-mi-client-id',
          },
        },
      };
      store.readResource.mockResolvedValue(kvNv);

      mockCheckKeyVaultSecretAccess.mockRejectedValueOnce(
        new KeyVaultAccessError(
          "user-assigned managed identity 'my-mi-client-id' lacks 'get' permission"
        )
      );

      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['kv-nv'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('failed');
      expect(result.action).toBe('noop');
      expect(result.error?.message).toContain("lacks 'get' permission");
      // PUT should NOT be attempted when access check fails
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should NOT call checkKeyVaultSecretAccess for plain NamedValues', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readResource.mockResolvedValue({
        name: 'plain-nv',
        properties: { value: 'hello' },
      });

      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['plain-nv'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      expect(mockCheckKeyVaultSecretAccess).not.toHaveBeenCalled();
    });

    it('should handle wiki resources', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readContent.mockResolvedValue({
        content: '# Wiki Content',
        format: 'markdown',
      });

      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiWiki,
        nameParts: ['my-api'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('success');
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        descriptor,
        expect.objectContaining({
          properties: expect.objectContaining({
            documents: expect.arrayContaining([
              expect.objectContaining({
                documentId: 'default',
                content: '# Wiki Content',
              }),
            ]),
          }),
        })
      );
    });

    it('should strip full ARM scope prefix when publishing a Subscription', async () => {
      // APIM stores scope as a full ARM path on GET but requires a relative
      // APIM path on PUT.  The publisher must normalise scope before sending.
      const client = createMockClient();
      const store = createMockStore();

      // APIM returns scope as an ARM resource ID (no https:// prefix)
      const armScopePrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';

      const subscriptionJson = {
        name: 'master',
        properties: {
          displayName: 'Master subscription',
          scope: `${armScopePrefix}/apis`,
          state: 'active',
        },
      };
      store.readResource.mockResolvedValue(subscriptionJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.Subscription,
        nameParts: ['master'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('success');
      const putCall = client.putResource.mock.calls[0];
      const putJson = putCall[2] as Record<string, unknown>;
      const props = putJson.properties as Record<string, unknown>;
      // Scope must be the APIM-relative path, not the full ARM path
      expect(props.scope).toBe('/apis');
    });

    it('should strip full ARM scope for product-scoped Subscription', async () => {
      const client = createMockClient();
      const store = createMockStore();

      const armScopePrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';

      const subscriptionJson = {
        name: 'sub-1',
        properties: {
          scope: `${armScopePrefix}/products/my-product`,
          state: 'active',
        },
      };
      store.readResource.mockResolvedValue(subscriptionJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.Subscription,
        nameParts: ['sub-1'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      const putCall = client.putResource.mock.calls[0];
      const putJson = putCall[2] as Record<string, unknown>;
      const props = putJson.properties as Record<string, unknown>;
      expect(props.scope).toBe('/products/my-product');
    });

    it('should leave scope unchanged when it is already a relative APIM path', async () => {
      const client = createMockClient();
      const store = createMockStore();

      const subscriptionJson = {
        name: 'sub-1',
        properties: {
          scope: '/apis/my-api',
          state: 'active',
        },
      };
      store.readResource.mockResolvedValue(subscriptionJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.Subscription,
        nameParts: ['sub-1'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      const putCall = client.putResource.mock.calls[0];
      const putJson = putCall[2] as Record<string, unknown>;
      const props = putJson.properties as Record<string, unknown>;
      expect(props.scope).toBe('/apis/my-api');
    });

    it('should skip subscription with root scope (master subscription)', async () => {
      // The master subscription has scope as the service root, which results in
      // "/" after ARM path stripping. This is invalid and the subscription should be skipped.
      const client = createMockClient();
      const store = createMockStore();

      const armScopePrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';

      const subscriptionJson = {
        name: 'master',
        properties: {
          displayName: 'Master subscription',
          scope: armScopePrefix, // service root, results in "/" after stripping
          state: 'active',
        },
      };
      store.readResource.mockResolvedValue(subscriptionJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.Subscription,
        nameParts: ['master'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('skipped');
      expect(result.action).toBe('noop');
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should skip auto-generated product subscription with empty displayName', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const autoGeneratedId = generatedSubscriptionId('a');

      const armScopePrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';

      const subscriptionJson = {
        name: autoGeneratedId,
        properties: {
          ownerId: `${armScopePrefix}/users/1`,
          scope: `${armScopePrefix}/products/starter`,
          displayName: null,
          state: 'active',
        },
      };
      store.readResource.mockResolvedValue(subscriptionJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.Subscription,
        nameParts: [autoGeneratedId],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('skipped');
      expect(result.action).toBe('noop');
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should skip auto-generated product subscription when displayName is set', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const autoGeneratedId = generatedSubscriptionId('b');

      const armScopePrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';

      const subscriptionJson = {
        name: autoGeneratedId,
        properties: {
          scope: `${armScopePrefix}/products/starter`,
          displayName: 'Starter access',
          state: 'active',
        },
      };
      store.readResource.mockResolvedValue(subscriptionJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.Subscription,
        nameParts: [autoGeneratedId],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('skipped');
      expect(result.action).toBe('noop');
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should publish user-defined product subscription', async () => {
      const client = createMockClient();
      const store = createMockStore();

      const armScopePrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';

      const subscriptionJson = {
        name: 'team-a-product-sub',
        properties: {
          scope: `${armScopePrefix}/products/starter`,
          displayName: 'Team A starter product',
          state: 'active',
        },
      };
      store.readResource.mockResolvedValue(subscriptionJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.Subscription,
        nameParts: ['team-a-product-sub'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('success');
      expect(result.action).toBe('put');
      expect(client.putResource).toHaveBeenCalledTimes(1);
    });

    describe('ApiOperation text normalization', () => {
      it('sets displayName and description to empty string when omitted', async () => {
        const client = createMockClient();
        const store = createMockStore();
        store.readResource.mockResolvedValue({
          name: 'get-orders',
          properties: {
            method: 'GET',
            urlTemplate: '/orders',
            responses: [],
          },
        });

        const descriptor: ResourceDescriptor = {
          type: ResourceType.ApiOperation,
          nameParts: ['orders-api', 'get-orders'],
        };

        await publishResource(client, store, testContext, descriptor, testConfig);

        const putCall = client.putResource.mock.calls[0];
        const putJson = putCall[2] as Record<string, unknown>;
        const props = putJson.properties as Record<string, unknown>;
        expect(props.displayName).toBe('');
        expect(props.description).toBe('');
      });

      it('preserves displayName and description when present', async () => {
        const client = createMockClient();
        const store = createMockStore();
        store.readResource.mockResolvedValue({
          name: 'get-orders',
          properties: {
            displayName: 'Get orders',
            description: 'Returns orders',
            method: 'GET',
            urlTemplate: '/orders',
            responses: [],
          },
        });

        const descriptor: ResourceDescriptor = {
          type: ResourceType.ApiOperation,
          nameParts: ['orders-api', 'get-orders'],
        };

        await publishResource(client, store, testContext, descriptor, testConfig);

        const putCall = client.putResource.mock.calls[0];
        const putJson = putCall[2] as Record<string, unknown>;
        const props = putJson.properties as Record<string, unknown>;
        expect(props.displayName).toBe('Get orders');
        expect(props.description).toBe('Returns orders');
      });
    });

    describe('API revision handling', () => {
      it('injects sourceApiId for revision APIs', async () => {
        const client = createMockClient();
        const store = createMockStore();
        store.readResource.mockResolvedValue({
          name: 'my-api;rev=2',
          properties: { path: '/api', displayName: 'My API' },
        });

        const descriptor: ResourceDescriptor = {
          type: ResourceType.Api,
          nameParts: ['my-api;rev=2'],
        };

        await publishResource(client, store, testContext, descriptor, testConfig);

        const putCall = client.putResource.mock.calls[0];
        const putJson = putCall[2] as Record<string, unknown>;
        const props = putJson.properties as Record<string, unknown>;
        expect(props).toHaveProperty('sourceApiId');
        expect(props.sourceApiId as string).toContain('/apis/my-api');
        expect(props.sourceApiId as string).not.toContain(';rev=');
      });

      it('strips null properties for revision APIs', async () => {
        const client = createMockClient();
        const store = createMockStore();
        store.readResource.mockResolvedValue({
          name: 'my-api;rev=2',
          properties: { path: '/api', nullField: null, contact: null },
        });

        const descriptor: ResourceDescriptor = {
          type: ResourceType.Api,
          nameParts: ['my-api;rev=2'],
        };

        await publishResource(client, store, testContext, descriptor, testConfig);

        const putCall = client.putResource.mock.calls[0];
        const putJson = putCall[2] as Record<string, unknown>;
        const props = putJson.properties as Record<string, unknown>;
        expect(props).not.toHaveProperty('nullField');
        expect(props).not.toHaveProperty('contact');
        expect(props).toHaveProperty('path', '/api');
      });

      it('does not inject sourceApiId for non-revision APIs', async () => {
        const client = createMockClient();
        const store = createMockStore();
        store.readResource.mockResolvedValue({
          name: 'my-api',
          properties: { path: '/api' },
        });

        const descriptor: ResourceDescriptor = {
          type: ResourceType.Api,
          nameParts: ['my-api'],
        };

        await publishResource(client, store, testContext, descriptor, testConfig);

        const putCall = client.putResource.mock.calls[0];
        const putJson = putCall[2] as Record<string, unknown>;
        const props = putJson.properties as Record<string, unknown>;
        expect(props).not.toHaveProperty('sourceApiId');
      });

      it('sourceApiId uses correct context values in full ARM path', async () => {
        const client = createMockClient();
        const store = createMockStore();
        store.readResource.mockResolvedValue({
          name: 'orders-api;rev=3',
          properties: { path: '/orders' },
        });

        const descriptor: ResourceDescriptor = {
          type: ResourceType.Api,
          nameParts: ['orders-api;rev=3'],
        };

        await publishResource(client, store, testContext, descriptor, testConfig);

        const putCall = client.putResource.mock.calls[0];
        const putJson = putCall[2] as Record<string, unknown>;
        const props = putJson.properties as Record<string, unknown>;
        const expectedSourceApiId =
          `/subscriptions/${testContext.subscriptionId}/resourceGroups/${testContext.resourceGroup}/providers/Microsoft.ApiManagement/service/${testContext.serviceName}/apis/orders-api`;
        expect(props.sourceApiId).toBe(expectedSourceApiId);
      });

      it('defaults revision isCurrent to false when missing', async () => {
        const client = createMockClient();
        const store = createMockStore();
        store.readResource.mockResolvedValue({
          name: 'orders-api;rev=2',
          properties: { path: '/orders' },
        });

        const descriptor: ResourceDescriptor = {
          type: ResourceType.Api,
          nameParts: ['orders-api;rev=2'],
        };

        await publishResource(client, store, testContext, descriptor, testConfig);

        const putCall = client.putResource.mock.calls[0];
        const putJson = putCall[2] as Record<string, unknown>;
        const props = putJson.properties as Record<string, unknown>;
        expect(props).toHaveProperty('isCurrent', false);
      });

      it('preserves revision isCurrent when explicitly provided', async () => {
        const client = createMockClient();
        const store = createMockStore();
        store.readResource.mockResolvedValue({
          name: 'orders-api;rev=2',
          properties: { path: '/orders', isCurrent: true },
        });

        const descriptor: ResourceDescriptor = {
          type: ResourceType.Api,
          nameParts: ['orders-api;rev=2'],
        };

        await publishResource(client, store, testContext, descriptor, testConfig);

        const putCall = client.putResource.mock.calls[0];
        const putJson = putCall[2] as Record<string, unknown>;
        const props = putJson.properties as Record<string, unknown>;
        expect(props).toHaveProperty('isCurrent', true);
      });
    });
  });

  describe('ApiRelease normalization', () => {
    it('should rewrite properties.apiId from source ARM path to target ARM path', async () => {
      const client = createMockClient();
      const store = createMockStore();

      // Release extracted from source service with source ARM coordinates
      const sourceArmPrefix =
        '/subscriptions/src-sub/resourceGroups/src-rg/providers/Microsoft.ApiManagement/service/src-apim';
      const releaseJson = {
        name: 'release-1',
        properties: {
          apiId: `${sourceArmPrefix}/apis/my-api;rev=2`,
          notes: 'Promoted rev 2',
        },
      };
      store.readResource.mockResolvedValue(releaseJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiRelease,
        nameParts: ['my-api', 'release-1'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      const putCall = client.putResource.mock.calls[0];
      const putJson = putCall[2] as Record<string, unknown>;
      const props = putJson.properties as Record<string, unknown>;
      // apiId must reference the TARGET service (sub-1 / rg-1 / apim-1)
      const targetArmPrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';
      expect(props.apiId).toBe(`${targetArmPrefix}/apis/my-api;rev=2`);
    });

    it('should leave apiId unchanged when /apis/ segment is absent', async () => {
      const client = createMockClient();
      const store = createMockStore();

      const releaseJson = {
        name: 'release-2',
        properties: {
          apiId: 'some-opaque-value',
          notes: '',
        },
      };
      store.readResource.mockResolvedValue(releaseJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiRelease,
        nameParts: ['my-api', 'release-2'],
      };

      await publishResource(client, store, testContext, descriptor, testConfig);

      const putCall = client.putResource.mock.calls[0];
      const putJson = putCall[2] as Record<string, unknown>;
      const props = putJson.properties as Record<string, unknown>;
      expect(props.apiId).toBe('some-opaque-value');
    });

    it('should handle release without apiId without error', async () => {
      const client = createMockClient();
      const store = createMockStore();

      const releaseJson = {
        name: 'release-3',
        properties: { notes: 'no apiId' },
      };
      store.readResource.mockResolvedValue(releaseJson);

      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiRelease,
        nameParts: ['my-api', 'release-3'],
      };

      const result = await publishResource(client, store, testContext, descriptor, testConfig);

      expect(result.status).toBe('success');
      expect(client.putResource).toHaveBeenCalledOnce();
    });
  });
});

