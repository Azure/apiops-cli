/**
 * Unit tests for T032: API publisher with revision handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishApi } from '../../../src/services/api-publisher.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { PublishConfig } from '../../../src/models/config.js';
import { LogLevel } from '../../../src/lib/logger.js';

// Mock resource-publisher so we can verify call sequence
const mockPublishResource = vi.fn();
vi.mock('../../../src/services/resource-publisher.js', () => ({
  publishResource: (...args: unknown[]) => mockPublishResource(...args),
}));

// Mock override-merger
vi.mock('../../../src/services/override-merger.js', () => ({
  applyOverrides: vi.fn((descriptor, json) => json),
}));

// Mock parallel-runner
const mockRunParallel = vi.fn();
vi.mock('../../../src/lib/parallel-runner.js', () => ({
  runParallel: (...args: unknown[]) => mockRunParallel(...args),
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

function createMockStore(resources: ResourceDescriptor[] = []) {
  return {
    writeResource: vi.fn(),
    writeContent: vi.fn(),
    writeAssociation: vi.fn(),
    readResource: vi.fn().mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) => {
      if (descriptor.type === ResourceType.Api && !descriptor.name.includes(';rev=')) {
        return { name: descriptor.name, properties: {} };
      }
      return null;
    }),
    readContent: vi.fn().mockResolvedValue(undefined),
    readAssociation: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue(resources),
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

describe('api-publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublishResource.mockResolvedValue({
      descriptor: { type: ResourceType.Api, name: 'test-api' },
      status: 'success',
      action: 'put',
    });
    mockRunParallel.mockResolvedValue(undefined);
  });

  describe('publishApi', () => {
    it('should publish root API first', async () => {
      const client = createMockClient();
      const store = createMockStore([]);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        apiDescriptor,
        expect.objectContaining({ name: 'orders-api' })
      );
    });

    it('should return failed result when root API publish fails', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      store.readResource.mockResolvedValue(null);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('skipped');
    });

    it('should publish revisions in numeric order after root API', async () => {
      const client = createMockClient();
      const revisions = [
        { type: ResourceType.Api, name: 'orders-api;rev=3' },
        { type: ResourceType.Api, name: 'orders-api;rev=1' },
        { type: ResourceType.Api, name: 'orders-api;rev=2' },
      ];
      const store = createMockStore(revisions);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // publishResource should be called for each revision in numeric order
      expect(mockPublishResource).toHaveBeenCalledTimes(3);
      
      // Extract the descriptor.name from each call
      const calls = mockPublishResource.mock.calls;
      expect(calls[0][3].name).toBe('orders-api;rev=1');
      expect(calls[1][3].name).toBe('orders-api;rev=2');
      expect(calls[2][3].name).toBe('orders-api;rev=3');
    });

    it('should skip non-matching revisions when filtering by API name', async () => {
      const client = createMockClient();
      const revisions = [
        { type: ResourceType.Api, name: 'orders-api;rev=2' },
        { type: ResourceType.Api, name: 'other-api;rev=2' },
      ];
      const store = createMockStore(revisions);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Only orders-api;rev=2 should be published
      expect(mockPublishResource).toHaveBeenCalledTimes(1);
      expect(mockPublishResource.mock.calls[0][3].name).toBe('orders-api;rev=2');
    });

    it('should publish API child resources in parallel', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, name: 'policy-1', parent: 'orders-api' },
        { type: ResourceType.ApiTag, name: 'tag-1', parent: 'orders-api' },
        { type: ResourceType.ApiOperation, name: 'get-orders', parent: 'orders-api' },
        { type: ResourceType.ApiSchema, name: 'schema-1', parent: 'orders-api' },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // runParallel should be called with tasks for all children
      expect(mockRunParallel).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
        ]),
        5
      );
    });

    it('should publish operation policies as grandchildren', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiOperation, name: 'get-orders', parent: 'orders-api' },
        { 
          type: ResourceType.ApiOperationPolicy, 
          name: 'orders-api',
          parent: 'get-orders',
          grandparent: 'orders-api',
        },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Both operation and operation policy should be in parallel tasks
      expect(mockRunParallel).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(Function),
          expect.any(Function),
        ]),
        5
      );
    });

    it('should publish GraphQL resolver policies as grandchildren', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.GraphQLResolver, name: 'Query.user', parent: 'graphql-api' },
        { 
          type: ResourceType.GraphQLResolverPolicy, 
          name: 'graphql-api',
          parent: 'Query.user',
          grandparent: 'graphql-api',
        },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'graphql-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Both resolver and resolver policy should be in parallel tasks
      expect(mockRunParallel).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(Function),
          expect.any(Function),
        ]),
        5
      );
    });

    it('should ignore children from other APIs', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, name: 'policy-1', parent: 'orders-api' },
        { type: ResourceType.ApiTag, name: 'tag-2', parent: 'other-api' },
        { type: ResourceType.ApiOperation, name: 'get-users', parent: 'other-api' },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Only orders-api policy should be published
      expect(mockRunParallel).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(Function)]),
        5
      );
      const tasks = mockRunParallel.mock.calls[0][0] as Array<() => Promise<unknown>>;
      expect(tasks).toHaveLength(1);
    });

    it('should publish all API child resource types', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, name: 'policy', parent: 'orders-api' },
        { type: ResourceType.ApiTag, name: 'tag', parent: 'orders-api' },
        { type: ResourceType.ApiDiagnostic, name: 'diag', parent: 'orders-api' },
        { type: ResourceType.ApiOperation, name: 'op', parent: 'orders-api' },
        { type: ResourceType.ApiSchema, name: 'schema', parent: 'orders-api' },
        { type: ResourceType.ApiRelease, name: 'release', parent: 'orders-api' },
        { type: ResourceType.ApiTagDescription, name: 'tagdesc', parent: 'orders-api' },
        { type: ResourceType.ApiWiki, name: 'wiki', parent: 'orders-api' },
        { type: ResourceType.GraphQLResolver, name: 'resolver', parent: 'orders-api' },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // All 9 child types should be in parallel tasks
      expect(mockRunParallel).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
        ]),
        5
      );
    });

    it('should handle empty API (no revisions, no children)', async () => {
      const client = createMockClient();
      const store = createMockStore([]);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'empty-api',
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(client.putResource).toHaveBeenCalledTimes(1);
    });

    it('should extract revision number from API name correctly', async () => {
      const client = createMockClient();
      const revisions = [
        { type: ResourceType.Api, name: 'orders-api;rev=10' },
        { type: ResourceType.Api, name: 'orders-api;rev=2' },
        { type: ResourceType.Api, name: 'orders-api;rev=100' },
      ];
      const store = createMockStore(revisions);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Should be sorted numerically: rev=2, rev=10, rev=100
      const calls = mockPublishResource.mock.calls;
      expect(calls[0][3].name).toBe('orders-api;rev=2');
      expect(calls[1][3].name).toBe('orders-api;rev=10');
      expect(calls[2][3].name).toBe('orders-api;rev=100');
    });

    it('should apply overrides to root API before publishing', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      store.readResource.mockResolvedValue({ 
        name: 'orders-api',
        properties: { serviceUrl: 'http://old.example.com' },
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      const configWithOverrides: PublishConfig = {
        ...testConfig,
        overrides: {
          apis: {
            'orders-api': { serviceUrl: 'http://new.example.com' },
          },
        },
      };

      await publishApi(client, store, testContext, apiDescriptor, configWithOverrides);

      expect(client.putResource).toHaveBeenCalled();
    });

    it('should return failed result on exception', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      client.putResource.mockRejectedValue(new Error('Network error'));

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('failed');
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('Network error');
    });

    it('should handle non-Error exceptions', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      client.putResource.mockRejectedValue('String error');

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('failed');
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('String error');
    });

    it('should use concurrency limit of 5 for parallel child publishing', async () => {
      const client = createMockClient();
      const children = Array.from({ length: 20 }, (_, i) => ({
        type: ResourceType.ApiOperation,
        name: `op-${i}`,
        parent: 'orders-api',
      }));
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'orders-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Verify concurrency limit is 5
      expect(mockRunParallel).toHaveBeenCalledWith(expect.any(Array), 5);
    });

    it('should handle API with workspace attribute', async () => {
      const client = createMockClient();
      const store = createMockStore([]);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'workspace-api',
        workspace: 'ws-1',
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(result.descriptor.workspace).toBe('ws-1');
    });

    it('should handle revisions with same numeric prefix but different lengths', async () => {
      const client = createMockClient();
      const revisions = [
        { type: ResourceType.Api, name: 'api;rev=2' },
        { type: ResourceType.Api, name: 'api;rev=20' },
        { type: ResourceType.Api, name: 'api;rev=200' },
      ];
      const store = createMockStore(revisions);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      const calls = mockPublishResource.mock.calls;
      expect(calls[0][3].name).toBe('api;rev=2');
      expect(calls[1][3].name).toBe('api;rev=20');
      expect(calls[2][3].name).toBe('api;rev=200');
    });

    it('should not publish children before root API succeeds', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, name: 'policy', parent: 'failed-api' },
      ];
      const store = createMockStore(children);
      client.putResource.mockRejectedValue(new Error('Root API PUT failed'));

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'failed-api',
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('failed');
      // runParallel should not be called for children
      expect(mockRunParallel).not.toHaveBeenCalled();
    });

    it('should include operation policies with correct grandparent', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiOperation, name: 'get-items', parent: 'shop-api' },
        { 
          type: ResourceType.ApiOperationPolicy,
          name: 'shop-api',
          parent: 'get-items',
          grandparent: 'shop-api',
        },
        { 
          type: ResourceType.ApiOperationPolicy,
          name: 'other-api',
          parent: 'get-items',
          grandparent: 'other-api',
        },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'shop-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Should only publish operation and operation policy with matching grandparent
      const tasks = mockRunParallel.mock.calls[0][0] as Array<() => Promise<unknown>>;
      expect(tasks).toHaveLength(2);
    });

    it('should include resolver policies with correct grandparent', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.GraphQLResolver, name: 'Query.item', parent: 'gql-api' },
        { 
          type: ResourceType.GraphQLResolverPolicy,
          name: 'gql-api',
          parent: 'Query.item',
          grandparent: 'gql-api',
        },
        { 
          type: ResourceType.GraphQLResolverPolicy,
          name: 'other-api',
          parent: 'Query.item',
          grandparent: 'other-api',
        },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'gql-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Should only publish resolver and resolver policy with matching grandparent
      const tasks = mockRunParallel.mock.calls[0][0] as Array<() => Promise<unknown>>;
      expect(tasks).toHaveLength(2);
    });

    it('should inject spec format and value when specification file exists', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      store.readResource.mockResolvedValue({
        name: 'petstore',
        properties: { displayName: 'Pet Store', path: 'petstore' },
      });
      store.readContent.mockResolvedValue({
        content: 'openapi: "3.0.0"\ninfo:\n  title: Pet Store',
        format: 'yaml',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'petstore',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        apiDescriptor,
        expect.objectContaining({
          properties: expect.objectContaining({
            displayName: 'Pet Store',
            path: 'petstore',
            format: 'openapi',
            value: 'openapi: "3.0.0"\ninfo:\n  title: Pet Store',
          }),
        })
      );
    });

    it('should use openapi+json format for JSON specs', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      store.readResource.mockResolvedValue({
        name: 'petstore',
        properties: { path: 'petstore' },
      });
      store.readContent.mockResolvedValue({
        content: '{"openapi":"3.0.0"}',
        format: 'json',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'petstore',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        apiDescriptor,
        expect.objectContaining({
          properties: expect.objectContaining({
            format: 'openapi+json',
          }),
        })
      );
    });

    it('should skip ApiSchema and ApiOperation children when spec was imported', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, name: 'policy-1', parent: 'petstore' },
        { type: ResourceType.ApiTag, name: 'tag-1', parent: 'petstore' },
        { type: ResourceType.ApiOperation, name: 'get-pets', parent: 'petstore' },
        { type: ResourceType.ApiSchema, name: 'schema-1', parent: 'petstore' },
      ];
      const store = createMockStore(children);
      store.readResource.mockResolvedValue({
        name: 'petstore',
        properties: { path: 'petstore' },
      });
      store.readContent.mockResolvedValue({
        content: 'openapi: "3.0.0"',
        format: 'yaml',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'petstore',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Only ApiPolicy and ApiTag should be published (2 tasks), not ApiOperation/ApiSchema
      const tasks = mockRunParallel.mock.calls[0][0] as Array<() => Promise<unknown>>;
      expect(tasks).toHaveLength(2);
    });

    it('should publish all children when no specification file exists', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, name: 'policy-1', parent: 'petstore' },
        { type: ResourceType.ApiOperation, name: 'get-pets', parent: 'petstore' },
        { type: ResourceType.ApiSchema, name: 'schema-1', parent: 'petstore' },
      ];
      const store = createMockStore(children);
      // readContent returns undefined — no spec file
      store.readContent.mockResolvedValue(undefined);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'petstore',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // All 3 children should be published
      const tasks = mockRunParallel.mock.calls[0][0] as Array<() => Promise<unknown>>;
      expect(tasks).toHaveLength(3);
    });

    it('should not inject spec for GraphQL format', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiSchema, name: 'schema-1', parent: 'gql-api' },
      ];
      const store = createMockStore(children);
      store.readResource.mockResolvedValue({
        name: 'gql-api',
        properties: { path: 'gql', type: 'graphql' },
      });
      store.readContent.mockResolvedValue({
        content: 'type Query { hello: String }',
        format: 'graphql',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'gql-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // GraphQL: no format/value injected, so schema children are still published
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        apiDescriptor,
        expect.not.objectContaining({
          properties: expect.objectContaining({ format: expect.anything() }),
        })
      );
      const tasks = mockRunParallel.mock.calls[0][0] as Array<() => Promise<unknown>>;
      expect(tasks).toHaveLength(1); // schema-1 still published
    });

    it('should use wsdl format for WSDL specs', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      store.readResource.mockResolvedValue({
        name: 'soap-api',
        properties: { path: 'soap' },
      });
      store.readContent.mockResolvedValue({
        content: '<wsdl:definitions>...</wsdl:definitions>',
        format: 'wsdl',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'soap-api',
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        apiDescriptor,
        expect.objectContaining({
          properties: expect.objectContaining({
            format: 'wsdl',
          }),
        })
      );
    });
  });
});
