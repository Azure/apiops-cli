/**
 * Unit tests for T022: API-specific extraction and T023: Product-specific extraction
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { extractApiResources } from '../../../src/services/api-extractor.js';
import { extractProductResources } from '../../../src/services/product-extractor.js';

const testContext: ApimServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apim-1',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

function createMockClient(overrides: Record<string, unknown> = {}) {
  const resources: Record<string, Record<string, unknown>[]> = {};
  return {
    listResources: async function* (_ctx: ApimServiceContext, type: ResourceType) {
      const typeResources = resources[type] ?? [];
      for (const r of typeResources) {
        yield r;
      }
    },
    getResource: vi.fn().mockResolvedValue(undefined),
    putResource: vi.fn(),
    deleteResource: vi.fn(),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn().mockResolvedValue(undefined),
    _resources: resources,
    ...overrides,
  };
}

function createMockStore() {
  return {
    writeResource: vi.fn().mockResolvedValue(undefined),
    writeContent: vi.fn().mockResolvedValue(undefined),
    writeAssociation: vi.fn().mockResolvedValue(undefined),
    readResource: vi.fn().mockResolvedValue(undefined),
    readContent: vi.fn().mockResolvedValue(undefined),
    readAssociation: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    deleteResource: vi.fn().mockResolvedValue(undefined),
  };
}

describe('api-extractor', () => {
  describe('extractApiResources', () => {
    it('should extract API specification', async () => {
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue({
          content: '{"openapi": "3.0.0"}',
          format: 'json',
        }),
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['pet-store'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'pet-store', properties: {} },
        '/output'
      );

      expect(result.specification).toBe(true);
      expect(store.writeContent).toHaveBeenCalled();
    });

    it('should handle missing specification gracefully', async () => {
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'my-api' },
        '/output'
      );

      expect(result.specification).toBe(false);
    });

    it('should skip specification export for WebSocket APIs without calling the client', async () => {
      const getApiSpecification = vi.fn();
      const client = createMockClient({
        getApiSpecification,
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['ws-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'ws-api', properties: { type: 'websocket' } },
        '/output'
      );

      expect(result.specification).toBe(false);
      expect(getApiSpecification).not.toHaveBeenCalled();
      expect(store.writeContent).not.toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), 'specification', expect.anything()
      );
    });

    it('should skip specification export for WebSocket APIs regardless of type casing', async () => {
      const getApiSpecification = vi.fn();
      const client = createMockClient({
        getApiSpecification,
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['ws-api'] },
        { name: 'ws-api', properties: { type: 'WebSocket' } },
        '/output'
      );

      expect(result.specification).toBe(false);
      expect(getApiSpecification).not.toHaveBeenCalled();
    });

    it('should skip specification export for synthetic GraphQL APIs (schema via ApiSchema)', async () => {
      const getApiSpecification = vi.fn();
      const client = createMockClient({
        getApiSpecification,
        listResources: async function* (_ctx: ApimServiceContext, type: ResourceType) {
          if (type === ResourceType.ApiSchema) {
            yield { name: 'default', properties: { contentType: 'application/vnd.ms-azure-apim.graphql.schema' } };
          }
        },
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['synthetic-gql'] },
        { name: 'synthetic-gql', properties: { type: 'graphql' } },
        '/output'
      );

      expect(result.specification).toBe(false);
      expect(getApiSpecification).not.toHaveBeenCalled();
      expect(store.writeContent).not.toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), 'specification', expect.anything()
      );
    });

    it('should extract specification for pass-through GraphQL APIs (no GraphQL schema resource)', async () => {
      const getApiSpecification = vi.fn().mockResolvedValue({
        content: 'type Query { hello: String }',
        format: 'graphql',
      });
      const client = createMockClient({
        getApiSpecification,
        // listResources yields nothing for ApiSchema → pass-through GraphQL
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['linked-gql'] },
        { name: 'linked-gql', properties: { type: 'graphql' } },
        '/output'
      );

      expect(result.specification).toBe(true);
      expect(getApiSpecification).toHaveBeenCalledWith(testContext, 'linked-gql', 'graphql');
      expect(store.writeContent).toHaveBeenCalledWith(
        '/output',
        expect.objectContaining({ nameParts: ['linked-gql'] }),
        'type Query { hello: String }',
        'specification',
        'graphql'
      );
    });

    it('should extract API policy and collect content', async () => {
      const policyContent = '<policies><inbound><base /></inbound></policies>';
      const client = createMockClient({
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.ApiPolicy) {
            return { name: 'policy', properties: { value: policyContent } };
          }
          return undefined;
        }),
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'my-api' },
        '/output'
      );

      expect(result.policies).toContain(policyContent);
      // Verify the descriptor used the API name, not 'policy'
      expect(client.getResource).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: ResourceType.ApiPolicy, nameParts: ['my-api'] })
      );
    });

    it('should propagate write errors from store.writeContent instead of treating as no policy', async () => {
      const policyContent = '<policies><inbound><base /></inbound></policies>';
      const writeError = new Error('Disk full');
      const client = createMockClient({
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.ApiPolicy) {
            return { name: 'policy', properties: { value: policyContent } };
          }
          return undefined;
        }),
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();
      store.writeContent = vi.fn().mockRejectedValue(writeError);
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      await expect(
        extractApiResources(
          client, store, testContext, apiDescriptor,
          { name: 'my-api' },
          '/output'
        )
      ).rejects.toThrow('Disk full');
    });

    it('should return no policy when getResource returns undefined (missing policy)', async () => {
      const client = createMockClient({
        getResource: vi.fn().mockResolvedValue(undefined),
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'my-api' },
        '/output'
      );

      expect(result.policies).toHaveLength(0);
      expect(store.writeContent).not.toHaveBeenCalled();
    });

    it('should use api name as wiki descriptor name', async () => {
      const client = createMockClient({
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.ApiWiki) {
            return { name: 'default', properties: {} };
          }
          return undefined;
        }),
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'my-api' },
        '/output'
      );

      expect(result.wiki).toBe(true);
      // Verify the descriptor used the API name, not 'default'
      expect(client.getResource).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: ResourceType.ApiWiki, nameParts: ['my-api'] })
      );
    });

    it('should extract API revisions', async () => {
      const client = createMockClient({
        listApiRevisions: async function* () {
          yield { apiRevision: '2', apiId: '/apis/my-api;rev=2' };
          yield { apiRevision: '3', apiId: '/apis/my-api;rev=3' };
        },
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.Api && (desc.nameParts[0] ?? '').includes(';rev=')) {
            return { name: desc.nameParts[0] ?? '', properties: {} };
          }
          return undefined;
        }),
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['my-api'] },
        { name: 'my-api' },
        '/output'
      );

      expect(result.revisions).toHaveLength(2);
    });

    it('should skip revision 1 (main API)', async () => {
      const client = createMockClient({
        listApiRevisions: async function* () {
          yield { apiRevision: '1', apiId: '/apis/my-api' };
          yield { apiRevision: '2', apiId: '/apis/my-api;rev=2' };
        },
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if ((desc.nameParts[0] ?? '').includes(';rev=')) {
            return { name: desc.nameParts[0] ?? '', properties: {} };
          }
          return undefined;
        }),
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['my-api'] },
        { name: 'my-api' },
        '/output'
      );

      // Only revision 2 should be extracted (revision 1 = main API)
      expect(result.revisions).toHaveLength(1);
      expect(result.revisions[0]?.descriptor.nameParts[0]).toBe('my-api;rev=2');
    });
  });
});

describe('product-extractor', () => {
  describe('extractProductResources', () => {
    it('should extract product API associations', async () => {
      const client = createMockClient();
      // Override listResources to return APIs for ProductApi type
      client.listResources = async function* (_ctx, type) {
        if (type === ResourceType.ProductApi) {
          yield { name: 'api-1' };
          yield { name: 'api-2' };
        }
      };
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();

      const productDescriptor: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['starter'],
      };

      const result = await extractProductResources(
        client, store, testContext, productDescriptor, '/output'
      );

      expect(result.apis).toEqual(['api-1', 'api-2']);
      expect(store.writeAssociation).toHaveBeenCalled();
    });

    it('should extract product group associations', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx, type) {
        if (type === ResourceType.ProductGroup) {
          yield { name: 'group-1' };
        }
      };
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();

      const result = await extractProductResources(
        client, store, testContext,
        { type: ResourceType.Product, nameParts: ['starter'] },
        '/output'
      );

      expect(result.groups).toEqual(['group-1']);
    });

    it('should extract product policy', async () => {
      const policyContent = '<policies><inbound></inbound></policies>';
      const client = createMockClient();
      client.listResources = async function* () {};
      client.getResource = vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
        if (desc.type === ResourceType.ProductPolicy) {
          return { name: 'policy', properties: { value: policyContent } };
        }
        return undefined;
      });
      const store = createMockStore();

      const result = await extractProductResources(
        client, store, testContext,
        { type: ResourceType.Product, nameParts: ['starter'] },
        '/output'
      );

      expect(result.policy).toBe(policyContent);
      expect(result.policies).toContain(policyContent);
    });

    it('should propagate write errors from store.writeContent for product policy', async () => {
      const policyContent = '<policies><inbound></inbound></policies>';
      const writeError = new Error('Permission denied');
      const client = createMockClient();
      client.listResources = async function* () {};
      client.getResource = vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
        if (desc.type === ResourceType.ProductPolicy) {
          return { name: 'policy', properties: { value: policyContent } };
        }
        return undefined;
      });
      const store = createMockStore();
      store.writeContent = vi.fn().mockRejectedValue(writeError);

      await expect(
        extractProductResources(
          client, store, testContext,
          { type: ResourceType.Product, nameParts: ['starter'] },
          '/output'
        )
      ).rejects.toThrow('Permission denied');
    });

    it('should handle product with no associations', async () => {
      const client = createMockClient();
      client.listResources = async function* () {};
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();

      const result = await extractProductResources(
        client, store, testContext,
        { type: ResourceType.Product, nameParts: ['empty-product'] },
        '/output'
      );

      expect(result.apis).toEqual([]);
      expect(result.groups).toEqual([]);
      expect(result.policy).toBeUndefined();
      expect(result.wiki).toBe(false);
    });

    it('should extract product wiki', async () => {
      const client = createMockClient();
      client.listResources = async function* () {};
      client.getResource = vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
        if (desc.type === ResourceType.ProductWiki) {
          return { name: 'default', properties: { documents: [] } };
        }
        return undefined;
      });
      const store = createMockStore();

      const result = await extractProductResources(
        client, store, testContext,
        { type: ResourceType.Product, nameParts: ['starter'] },
        '/output'
      );

      expect(result.wiki).toBe(true);
      // Verify the descriptor used the product name, not 'default'
      expect(client.getResource).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: ResourceType.ProductWiki, nameParts: ['starter'] })
      );
    });
  });
});
