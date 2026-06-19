// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for API-specific extraction and Product-specific extraction
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { FilterConfig } from '../../../src/models/config.js';
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
    patchResource: vi.fn().mockResolvedValue(undefined),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn().mockResolvedValue(undefined),
    validatePreFlight: vi.fn().mockResolvedValue(undefined),
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

    it('should extract API operations', async () => {
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource: vi.fn().mockResolvedValue(undefined),
      });

      // Mock listResources to return operations
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.ApiOperation) {
          yield { name: 'get-user', properties: {} };
          yield { name: 'create-user', properties: {} };
        }
      };

      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'my-api', properties: {} },
        '/output'
      );

      expect(result.operations.length).toBe(2);
      expect(result.operationPolicies.length).toBe(0);
    });

    it('should extract operation policies for operations', async () => {
      const operationPolicyContent = '<policies><inbound><rate-limit /></inbound></policies>';
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.ApiOperationPolicy) {
            return { name: 'policy', properties: { value: operationPolicyContent } };
          }
          return undefined;
        }),
      });

      // Mock listResources to return one operation
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.ApiOperation) {
          yield { name: 'get-user', properties: {} };
        }
      };

      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'my-api', properties: {} },
        '/output'
      );

      expect(result.operations.length).toBe(1);
      expect(result.operationPolicies.length).toBe(1);
      expect(result.policies).toContain(operationPolicyContent);
    });

    it('should extract GraphQL resolvers for graphql-type APIs', async () => {
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource: vi.fn().mockResolvedValue(undefined),
      });

      // Mock listResources to return a resolver
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.GraphQLResolver) {
          yield { name: 'Query.hello', properties: {} };
        }
      };

      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['graphql-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'graphql-api', properties: { type: 'graphql' } },
        '/output'
      );

      expect(result.resolvers.length).toBe(1);
      expect(result.resolverPolicies.length).toBe(0);
    });

    it('should extract resolver policies for GraphQL resolvers', async () => {
      const resolverPolicyContent = '<policies><inbound><set-backend-service /></inbound></policies>';
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.GraphQLResolverPolicy) {
            return { name: 'policy', properties: { value: resolverPolicyContent } };
          }
          return undefined;
        }),
      });

      // Mock listResources to return a resolver
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.GraphQLResolver) {
          yield { name: 'Query.hello', properties: {} };
        }
      };

      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['graphql-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'graphql-api', properties: { type: 'graphql' } },
        '/output'
      );

      expect(result.resolvers.length).toBe(1);
      expect(result.resolverPolicies.length).toBe(1);
      expect(result.policies).toContain(resolverPolicyContent);
    });

    it('should skip resolver extraction for non-GraphQL APIs', async () => {
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource: vi.fn().mockResolvedValue(undefined),
      });

      // Mock listResources - should not be called for GraphQLResolver
      const listResourcesSpy = vi.fn(async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.GraphQLResolver) {
          throw new Error('Should not list resolvers for non-GraphQL API');
        }
        yield* [];
      });
      client.listResources = listResourcesSpy;

      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['http-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'http-api', properties: { type: 'http' } },
        '/output'
      );

      expect(result.resolvers).toEqual([]);
      expect(result.resolverPolicies).toEqual([]);
    });

    it('should extract wiki with documents array and write markdown JSON', async () => {
      const documents = [
        { documentationId: 'doc-1', title: 'Getting Started' },
        { documentationId: 'doc-2', title: 'Reference' },
      ];
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.ApiWiki) {
            return { name: 'default', properties: { documents } };
          }
          return undefined;
        }),
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['documented-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'documented-api' },
        '/output'
      );

      expect(result.wiki).toBe(true);
      // writeResource should have been called with a _markdownContent field
      expect(store.writeResource).toHaveBeenCalledWith(
        '/output',
        expect.objectContaining({ type: ResourceType.ApiWiki }),
        expect.objectContaining({ _markdownContent: expect.stringContaining('Getting Started') })
      );
    });

    it('should return wiki=false and not throw when getResource throws for wiki', async () => {
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.ApiWiki) {
            throw new Error('403 Forbidden');
          }
          return undefined;
        }),
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

      expect(result.wiki).toBe(false);
    });

    it('should return specification=false and not throw when getApiSpecification throws', async () => {
      const client = createMockClient({
        getApiSpecification: vi.fn().mockRejectedValue(new Error('Network error')),
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['flaky-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        { name: 'flaky-api', properties: {} },
        '/output'
      );

      expect(result.specification).toBe(false);
    });

    it('should record error status when an individual revision getResource throws', async () => {
      const client = createMockClient({
        listApiRevisions: async function* () {
          yield { apiRevision: '2' };
        },
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.Api && (desc.nameParts[0] ?? '').includes(';rev=')) {
            throw new Error('revision fetch failed');
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

      expect(result.revisions).toHaveLength(1);
      expect(result.revisions[0]?.status).toBe('error');
    });

    it('should return empty revisions and not throw when listApiRevisions throws', async () => {
      const client = createMockClient({
        // eslint-disable-next-line require-yield
        listApiRevisions: async function* () {
          throw new Error('list revisions failed');
        },
        getResource: vi.fn().mockResolvedValue(undefined),
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['my-api'] },
        { name: 'my-api' },
        '/output'
      );

      expect(result.revisions).toHaveLength(0);
    });

    it('should skip revision when getResource returns undefined (revision not found)', async () => {
      const client = createMockClient({
        listApiRevisions: async function* () {
          yield { apiRevision: '2' };
        },
        getResource: vi.fn().mockResolvedValue(undefined),
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['my-api'] },
        { name: 'my-api' },
        '/output'
      );

      // Revision listed but getResource returned undefined — not added to results
      expect(result.revisions).toHaveLength(0);
      expect(store.writeResource).not.toHaveBeenCalled();
    });

    it('should skip revision when revision has no revision number', async () => {
      const client = createMockClient({
        listApiRevisions: async function* () {
          yield { someOtherField: 'value' }; // no apiRevision or revisionNumber
          yield { apiRevision: '3' };
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

      // Only revision 3 extracted; the revision with no number was skipped
      expect(result.revisions).toHaveLength(1);
      expect(result.revisions[0]?.descriptor.nameParts[0]).toBe('my-api;rev=3');
    });

    it('should return no policy when policy JSON has no value field', async () => {
      const client = createMockClient({
        getResource: vi.fn().mockImplementation(async (_ctx: unknown, desc: ResourceDescriptor) => {
          if (desc.type === ResourceType.ApiPolicy) {
            // properties exists but value is absent
            return { name: 'policy', properties: {} };
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

      expect(result.policies).toHaveLength(0);
      expect(store.writeContent).not.toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), 'policy'
      );
    });

    it('should skip revision that does not match filter apis', async () => {
      const filter: FilterConfig = { apis: ['other-api'] };
      const client = createMockClient({
        listApiRevisions: async function* () {
          yield { apiRevision: '2' };
        },
        getResource: vi.fn().mockResolvedValue({ name: 'my-api;rev=2', properties: {} }),
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['my-api'] },
        { name: 'my-api', properties: {} },
        '/output',
        filter
      );

      // Revision filtered out — writeResource should not be called for it
      expect(result.revisions).toHaveLength(0);
    });

    it('should skip specification export for MCP APIs without calling the client', async () => {
      const getApiSpecification = vi.fn();
      const client = createMockClient({
        getApiSpecification,
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['mcp-api'] },
        { name: 'mcp-api', properties: { type: 'mcp' } },
        '/output'
      );

      expect(result.specification).toBe(false);
      expect(getApiSpecification).not.toHaveBeenCalled();
      expect(store.writeContent).not.toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), 'specification', expect.anything()
      );
    });

    it('should skip specification export for MCP APIs regardless of type casing', async () => {
      const getApiSpecification = vi.fn();
      const client = createMockClient({
        getApiSpecification,
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['mcp-api'] },
        { name: 'mcp-api', properties: { type: 'MCP' } },
        '/output'
      );

      expect(result.specification).toBe(false);
      expect(getApiSpecification).not.toHaveBeenCalled();
    });

    it('should skip specification export for A2A APIs without calling the client', async () => {
      const getApiSpecification = vi.fn();
      const client = createMockClient({
        getApiSpecification,
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();

      const result = await extractApiResources(
        client, store, testContext,
        { type: ResourceType.Api, nameParts: ['a2a-api'] },
        { name: 'a2a-api', properties: { type: 'a2a' } },
        '/output'
      );

      expect(result.specification).toBe(false);
      expect(getApiSpecification).not.toHaveBeenCalled();
    });

    it('should not call ARM for MCP child resource (data is embedded on the API)', async () => {
      // ARM does not serve apis/{id}/mcpServers/default for MCP APIs; all
      // configuration lives on the API resource itself. The extractor must
      // therefore never query the (non-existent) child endpoint.
      const getResource = vi.fn().mockResolvedValue(undefined);
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource,
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor,
        {
          name: 'my-api',
          properties: {
            type: 'mcp',
          },
        },
        '/output'
      );

      expect(result.mcpServer).toBe(false);
      expect(getResource).not.toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.McpServer })
      );
      expect(store.writeResource).not.toHaveBeenCalledWith(
        '/output',
        expect.objectContaining({ type: ResourceType.McpServer }),
        expect.anything()
      );
    });

    it('should keep embedded MCP configuration in apiInformation.json without writing a sidecar file', async () => {
      const client = createMockClient({
        getApiSpecification: vi.fn().mockResolvedValue(undefined),
        getResource: vi.fn().mockResolvedValue(undefined),
      });
      const store = createMockStore();
      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      const apiJson = {
        name: 'my-api',
        properties: {
          type: 'mcp',
          mcpProperties: { serverUrl: 'https://example.com/mcp' },
          mcpTools: [{ name: 'invokeTool' }],
        },
      };

      const result = await extractApiResources(
        client, store, testContext, apiDescriptor, apiJson, '/output'
      );

      expect(result.mcpServer).toBe(false);
      expect(client.getResource).not.toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.McpServer })
      );
      expect(store.writeResource).not.toHaveBeenCalledWith(
        '/output',
        expect.objectContaining({ type: ResourceType.McpServer, nameParts: ['my-api'] }),
        expect.anything()
      );
    });

    it('should return mcpServer=false and not throw when MCP server getResource returns undefined', async () => {
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

      expect(result.mcpServer).toBe(false);
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

  describe('extractProductResources - tags', () => {
    it('extracts and writes tags.json when tags exist', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx, type) {
        if (type === ResourceType.ProductTag) {
          yield { name: 'v1' };
          yield { name: 'production' };
        }
      };
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();

      const result = await extractProductResources(
        client, store, testContext,
        { type: ResourceType.Product, nameParts: ['starter'] },
        '/output'
      );

      expect(result.tags).toContain('v1');
      expect(result.tags).toContain('production');
      expect(store.writeAssociation).toHaveBeenCalledWith(
        '/output',
        expect.objectContaining({ type: ResourceType.Product, nameParts: ['starter'] }),
        'tags',
        expect.arrayContaining(['v1', 'production'])
      );
    });

    it('handles empty tag list: writeAssociation not called for tags, result.tags is empty', async () => {
      const client = createMockClient();
      client.listResources = async function* () {};
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();

      const result = await extractProductResources(
        client, store, testContext,
        { type: ResourceType.Product, nameParts: ['starter'] },
        '/output'
      );

      expect(result.tags).toEqual([]);
      const tagsCalls = (store.writeAssociation.mock.calls as unknown[][]).filter(
        (c) => c[2] === 'tags'
      );
      expect(tagsCalls).toHaveLength(0);
    });

    it('handles tag extraction error gracefully: result.tags is empty, no exception', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx, type) {
        if (type === ResourceType.ProductTag) {
          throw new Error('APIM listing tags failed');
        }
        yield* ([] as Array<Record<string, unknown>>);
      };
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();

      const result = await extractProductResources(
        client, store, testContext,
        { type: ResourceType.Product, nameParts: ['starter'] },
        '/output'
      );

      expect(result.tags).toEqual([]);
    });
  });
});
