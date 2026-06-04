// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
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
      if (descriptor.type === ResourceType.Api && !(descriptor.nameParts[0] ?? '').includes(';rev=')) {
        return { name: descriptor.nameParts[0] ?? '', properties: {} };
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
      descriptor: { type: ResourceType.Api, nameParts: ['test-api'] },
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
        nameParts: ['orders-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        apiDescriptor,
        expect.objectContaining({ name: 'orders-api' })
      );
    });

    it('should publish McpServer as a standard child resource without merging into root API payload', async () => {
      const client = createMockClient();
      const mcpChild = { type: ResourceType.McpServer, nameParts: ['orders-api'] };
      const store = createMockStore([mcpChild]);
      store.readResource.mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.Api) {
          return { name: descriptor.nameParts[0] ?? '', properties: { type: 'mcp' } };
        }
        if (descriptor.type === ResourceType.McpServer) {
          return {
            name: 'default',
            properties: {
              mcpProperties: { serverUrl: 'https://example.com/mcp' },
              mcpTools: [{ name: 'invokeTool' }],
            },
          };
        }
        return null;
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Root API PUT should NOT contain MCP properties — they stay in the McpServer child
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      const properties = payload.properties as Record<string, unknown> | undefined;
      expect(properties).not.toHaveProperty('mcpProperties');
    });

    it('should include McpServer child in publish tasks (standard child, not skipped)', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.McpServer, nameParts: ['orders-api'] },
        { type: ResourceType.ApiPolicy, nameParts: ['orders-api'] },
      ];
      const store = createMockStore(children);
      store.readResource.mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.Api) {
          return { name: descriptor.nameParts[0] ?? '', properties: { type: 'mcp' } };
        }
        if (descriptor.type === ResourceType.McpServer) {
          return {
            name: 'default',
            properties: { mcpProperties: { serverUrl: 'https://example.com/mcp' } },
          };
        }
        return null;
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      const tasks = mockRunParallel.mock.calls[0][0] as Array<() => Promise<unknown>>;
      // Both McpServer and ApiPolicy should be included — McpServer is a standard child
      expect(tasks).toHaveLength(2);
    });

    it('should not inject specification import fields for A2A APIs', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      store.readResource.mockResolvedValue({
        name: 'a2a-api',
        properties: {
          type: 'a2a',
          path: 'ks/a2a',
          protocols: ['https'],
        },
      });
      store.readContent.mockResolvedValue({
        content: 'openapi: "3.0.0"',
        format: 'yaml',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['a2a-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      const properties = payload.properties as Record<string, unknown>;
      expect(properties).not.toHaveProperty('format');
      expect(properties).not.toHaveProperty('value');
      expect(properties).not.toHaveProperty('apiType');
    });

    it('should return failed result when root API publish fails', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      store.readResource.mockResolvedValue(null);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('skipped');
    });

    it('should publish revisions in numeric order after root API', async () => {
      const client = createMockClient();
      const revisions = [
        { type: ResourceType.Api, nameParts: ['orders-api;rev=3'] },
        { type: ResourceType.Api, nameParts: ['orders-api;rev=1'] },
        { type: ResourceType.Api, nameParts: ['orders-api;rev=2'] },
      ];
      const store = createMockStore(revisions);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // publishResource should be called for each revision in numeric order
      expect(mockPublishResource).toHaveBeenCalledTimes(3);
      
      // Extract the descriptor.name from each call
      const calls = mockPublishResource.mock.calls;
      expect(calls[0][3].nameParts[0]).toBe('orders-api;rev=1');
      expect(calls[1][3].nameParts[0]).toBe('orders-api;rev=2');
      expect(calls[2][3].nameParts[0]).toBe('orders-api;rev=3');

      // Root API is only replayed when source marks it current (isCurrent=true).
      // Default mock root payload has no isCurrent flag, so only the initial PUT runs.
      expect(client.putResource).toHaveBeenCalledTimes(1);
    });

    it('should replay root API without re-importing specification after revisions', async () => {
      const client = createMockClient();
      const revisions = [{ type: ResourceType.Api, nameParts: ['orders-api;rev=2'] }];
      const store = createMockStore(revisions);
      store.readResource.mockResolvedValue({
        name: 'orders-api',
        properties: { path: 'orders', isCurrent: true },
      });
      store.readContent.mockResolvedValue({
        content: 'openapi: "3.0.0"',
        format: 'yaml',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Spec is only read/injected on the first root publish.
      expect(store.readContent).toHaveBeenCalledTimes(1);
      expect(client.putResource).toHaveBeenCalledTimes(2);

      const firstPayload = client.putResource.mock.calls[0][2] as Record<string, unknown>;
      const secondPayload = client.putResource.mock.calls[1][2] as Record<string, unknown>;
      const firstProps = firstPayload.properties as Record<string, unknown>;
      const secondProps = secondPayload.properties as Record<string, unknown>;

      expect(firstProps).toHaveProperty('format', 'openapi');
      expect(firstProps).toHaveProperty('value', 'openapi: "3.0.0"');
      expect(secondProps).not.toHaveProperty('format');
      expect(secondProps).not.toHaveProperty('value');
    });

    it('should not replay root API when source root is not current', async () => {
      const client = createMockClient();
      const revisions = [{ type: ResourceType.Api, nameParts: ['orders-api;rev=2'] }];
      const store = createMockStore(revisions);
      store.readResource.mockResolvedValue({
        name: 'orders-api',
        properties: {
          isCurrent: false,
          apiRevision: '2',
          serviceUrl: 'https://src-revisioned-backend-v2.example.com/api',
        },
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Root is not current in source, so no root alignment replay is performed.
      expect(client.putResource).toHaveBeenCalledTimes(1);
      const alignedPayload = client.putResource.mock.calls[0][2] as Record<string, unknown>;
      const alignedProps = alignedPayload.properties as Record<string, unknown>;

      expect(alignedProps).toHaveProperty('apiRevision', '2');
      expect(alignedProps).toHaveProperty('serviceUrl', 'https://src-revisioned-backend-v2.example.com/api');
      expect(alignedProps).not.toHaveProperty('format');
      expect(alignedProps).not.toHaveProperty('value');
    });

    it('should align active revision from source when active revision is 1', async () => {
      const client = createMockClient();
      const revisions = [{ type: ResourceType.Api, nameParts: ['orders-api;rev=2'] }];
      const store = createMockStore(revisions);
      store.readResource.mockResolvedValue({
        name: 'orders-api',
        properties: {
          isCurrent: true,
          apiRevision: '1',
          serviceUrl: 'https://src-revisioned-backend.example.com/api',
        },
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Second root PUT is the explicit active-revision alignment pass.
      expect(client.putResource).toHaveBeenCalledTimes(2);
      const alignedPayload = client.putResource.mock.calls[1][2] as Record<string, unknown>;
      const alignedProps = alignedPayload.properties as Record<string, unknown>;

      expect(alignedProps).toHaveProperty('apiRevision', '1');
      expect(alignedProps).toHaveProperty('serviceUrl', 'https://src-revisioned-backend.example.com/api');
      expect(alignedProps).not.toHaveProperty('format');
      expect(alignedProps).not.toHaveProperty('value');
    });

    it('should skip non-matching revisions when filtering by API name', async () => {
      const client = createMockClient();
      const revisions = [
        { type: ResourceType.Api, nameParts: ['orders-api;rev=2'] },
        { type: ResourceType.Api, nameParts: ['other-api;rev=2'] },
      ];
      const store = createMockStore(revisions);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Only orders-api;rev=2 should be published
      expect(mockPublishResource).toHaveBeenCalledTimes(1);
      expect(mockPublishResource.mock.calls[0][3].nameParts[0]).toBe('orders-api;rev=2');
    });

    it('should publish API child resources in parallel', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, nameParts: ['orders-api'] },
        { type: ResourceType.ApiTag, nameParts: ['orders-api', 'tag-1'] },
        { type: ResourceType.ApiOperation, nameParts: ['orders-api', 'get-orders'] },
        { type: ResourceType.ApiSchema, nameParts: ['orders-api', 'schema-1'] },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
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
        { type: ResourceType.ApiOperation, nameParts: ['orders-api', 'get-orders'] },
        { 
          type: ResourceType.ApiOperationPolicy, 
          nameParts: ['orders-api', 'get-orders'],
        },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
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
        { type: ResourceType.GraphQLResolver, nameParts: ['graphql-api', 'Query.user'] },
        { 
          type: ResourceType.GraphQLResolverPolicy, 
          nameParts: ['graphql-api', 'Query.user'],
        },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['graphql-api'],
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
        { type: ResourceType.ApiPolicy, nameParts: ['orders-api'] },
        { type: ResourceType.ApiTag, nameParts: ['other-api', 'tag-2'] },
        { type: ResourceType.ApiOperation, nameParts: ['other-api', 'get-users'] },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
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
        { type: ResourceType.ApiPolicy, nameParts: ['orders-api'] },
        { type: ResourceType.ApiTag, nameParts: ['orders-api', 'tag'] },
        { type: ResourceType.ApiDiagnostic, nameParts: ['orders-api', 'diag'] },
        { type: ResourceType.ApiOperation, nameParts: ['orders-api', 'op'] },
        { type: ResourceType.ApiSchema, nameParts: ['orders-api', 'schema'] },
        { type: ResourceType.ApiRelease, nameParts: ['orders-api', 'release'] },
        { type: ResourceType.ApiTagDescription, nameParts: ['orders-api', 'tagdesc'] },
        { type: ResourceType.ApiWiki, nameParts: ['orders-api'] },
        { type: ResourceType.GraphQLResolver, nameParts: ['orders-api', 'resolver'] },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
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
        nameParts: ['empty-api'],
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(client.putResource).toHaveBeenCalledTimes(1);
    });

    it('should extract revision number from API name correctly', async () => {
      const client = createMockClient();
      const revisions = [
        { type: ResourceType.Api, nameParts: ['orders-api;rev=10'] },
        { type: ResourceType.Api, nameParts: ['orders-api;rev=2'] },
        { type: ResourceType.Api, nameParts: ['orders-api;rev=100'] },
      ];
      const store = createMockStore(revisions);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Should be sorted numerically: rev=2, rev=10, rev=100
      const calls = mockPublishResource.mock.calls;
      expect(calls[0][3].nameParts[0]).toBe('orders-api;rev=2');
      expect(calls[1][3].nameParts[0]).toBe('orders-api;rev=10');
      expect(calls[2][3].nameParts[0]).toBe('orders-api;rev=100');
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
        nameParts: ['orders-api'],
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
        nameParts: ['orders-api'],
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
        nameParts: ['orders-api'],
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
        nameParts: ['orders-api', `op-${i}`],
      }));
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders-api'],
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
        nameParts: ['workspace-api'],
        workspace: 'ws-1',
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(result.descriptor.workspace).toBe('ws-1');
    });

    it('should handle revisions with same numeric prefix but different lengths', async () => {
      const client = createMockClient();
      const revisions = [
        { type: ResourceType.Api, nameParts: ['api;rev=2'] },
        { type: ResourceType.Api, nameParts: ['api;rev=20'] },
        { type: ResourceType.Api, nameParts: ['api;rev=200'] },
      ];
      const store = createMockStore(revisions);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      const calls = mockPublishResource.mock.calls;
      expect(calls[0][3].nameParts[0]).toBe('api;rev=2');
      expect(calls[1][3].nameParts[0]).toBe('api;rev=20');
      expect(calls[2][3].nameParts[0]).toBe('api;rev=200');
    });

    it('should not publish children before root API succeeds', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, nameParts: ['failed-api'] },
      ];
      const store = createMockStore(children);
      client.putResource.mockRejectedValue(new Error('Root API PUT failed'));

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['failed-api'],
      };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('failed');
      // runParallel should not be called for children
      expect(mockRunParallel).not.toHaveBeenCalled();
    });

    it('should include operation policies with correct grandparent', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiOperation, nameParts: ['shop-api', 'get-items'] },
        { 
          type: ResourceType.ApiOperationPolicy,
          nameParts: ['shop-api', 'get-items'],
        },
        { 
          type: ResourceType.ApiOperationPolicy,
          nameParts: ['other-api', 'get-items'],
        },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['shop-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Parents (operations) are published first, then grandchildren (policies)
      // Should be 2 calls: first for parent resources, second for grandchildren
      expect(mockRunParallel).toHaveBeenCalledTimes(2);
      const parentTasks = mockRunParallel.mock.calls[0][0] as Array<() => Promise<unknown>>;
      const grandchildTasks = mockRunParallel.mock.calls[1][0] as Array<() => Promise<unknown>>;
      expect(parentTasks).toHaveLength(1); // Only the operation with matching API
      expect(grandchildTasks).toHaveLength(1); // Only the policy with matching API
    });

    it('should include resolver policies with correct grandparent', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.GraphQLResolver, nameParts: ['gql-api', 'Query.item'] },
        { 
          type: ResourceType.GraphQLResolverPolicy,
          nameParts: ['gql-api', 'Query.item'],
        },
        { 
          type: ResourceType.GraphQLResolverPolicy,
          nameParts: ['other-api', 'Query.item'],
        },
      ];
      const store = createMockStore(children);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['gql-api'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Parents (resolvers) are published first, then grandchildren (policies)
      // Should be 2 calls: first for parent resources, second for grandchildren
      expect(mockRunParallel).toHaveBeenCalledTimes(2);
      const parentTasks = mockRunParallel.mock.calls[0][0] as Array<() => Promise<unknown>>;
      const grandchildTasks = mockRunParallel.mock.calls[1][0] as Array<() => Promise<unknown>>;
      expect(parentTasks).toHaveLength(1); // Only the resolver with matching API
      expect(grandchildTasks).toHaveLength(1); // Only the policy with matching API
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
        nameParts: ['petstore'],
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
        nameParts: ['petstore'],
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

    it('should set imported operation descriptions to null when OpenAPI operation omits description', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      store.readResource.mockResolvedValue({
        name: 'petstore',
        properties: { path: 'petstore' },
      });
      store.readContent.mockResolvedValue({
        content: [
          'openapi: 3.0.1',
          'paths:',
          '  /agent-card:',
          '    get:',
          '      operationId: get-agent-card',
          '      summary: Get agent card',
        ].join('\n'),
        format: 'yaml',
      });
      client.getResource.mockResolvedValue({
        name: 'petstore/get-agent-card',
        properties: {
          displayName: 'get-agent-card',
          description: 'Get agent card',
          method: 'GET',
          urlTemplate: '/agent-card',
        },
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['petstore'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(client.getResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.ApiOperation,
          nameParts: ['petstore', 'get-agent-card'],
        })
      );

      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.ApiOperation,
          nameParts: ['petstore', 'get-agent-card'],
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            description: null,
          }),
        })
      );
    });

    it('should skip ApiSchema and ApiOperation children when spec was imported', async () => {
      const client = createMockClient();
      // Use auto-generated 24-char hex schema ID - these are skipped during spec import
      const children = [
        { type: ResourceType.ApiPolicy, nameParts: ['petstore', 'policy-1'] },
        { type: ResourceType.ApiTag, nameParts: ['petstore', 'tag-1'] },
        { type: ResourceType.ApiOperation, nameParts: ['petstore', 'get-pets'] },
        { type: ResourceType.ApiSchema, nameParts: ['petstore', '69f15c3c10a45d29d855583a'] },
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
        nameParts: ['petstore'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // Only ApiPolicy and ApiTag should be published (2 tasks total across tiers)
      // ApiOperation is skipped (no schema refs), auto-generated ApiSchema is skipped
      const totalTasks = mockRunParallel.mock.calls.reduce((sum, call) => {
        const tasks = call[0] as unknown[];
        return sum + tasks.length;
      }, 0);
      expect(totalTasks).toBe(2);
    });

    it('should re-publish operations with schema references even when spec was imported', async () => {
      const client = createMockClient();
      // Use auto-generated 24-char hex schema ID - these are skipped during spec import
      const children = [
        { type: ResourceType.ApiPolicy, nameParts: ['petstore', 'policy-1'] },
        { type: ResourceType.ApiOperation, nameParts: ['petstore', 'create-item'] },
        { type: ResourceType.ApiOperation, nameParts: ['petstore', 'get-items'] },
        { type: ResourceType.ApiSchema, nameParts: ['petstore', '69f15c3c10a45d29d855583a'] },
      ];
      const store = createMockStore(children);

      // Root API resource
      store.readResource.mockImplementation(async (_dir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.Api) {
          return { name: 'petstore', properties: { path: 'petstore' } };
        }
        if (
          descriptor.type === ResourceType.ApiOperation &&
          (descriptor.nameParts[1] ?? '') === 'create-item'
        ) {
          // create-item has a schema reference in request representations
          return {
            name: 'create-item',
            properties: {
              request: {
                representations: [{ contentType: 'application/json', schemaId: 'my-schema', typeName: 'Item' }],
              },
            },
          };
        }
        // get-items has no schema refs
        return null;
      });
      store.readContent.mockResolvedValue({
        content: 'openapi: "3.0.0"',
        format: 'yaml',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['petstore'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // ApiPolicy (1) + create-item operation re-published (1) = 2 tasks total
      // Auto-generated ApiSchema and get-items (no schema ref) must be excluded
      const totalTasks = mockRunParallel.mock.calls.reduce((sum, call) => {
        const tasks = call[0] as unknown[];
        return sum + tasks.length;
      }, 0);
      expect(totalTasks).toBe(2);
    });

    it('should still re-publish explicitly named schemas in incremental mode after spec import', async () => {
      const client = createMockClient();
      // 'my-explicit-schema' is not a 24-char hex ID so it must be re-published
      const children = [
        { type: ResourceType.ApiSchema, nameParts: ['petstore', 'my-explicit-schema'] },
        { type: ResourceType.ApiSchema, nameParts: ['petstore', '69f15c3c10a45d29d855583a'] },
      ];
      const store = createMockStore(children);
      store.readResource.mockImplementation(async (_dir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.Api) {
          return { name: 'petstore', properties: { path: 'petstore' } };
        }
        return null;
      });
      store.readContent.mockResolvedValue({ content: 'openapi: "3.0.0"', format: 'yaml' });

      const apiDescriptor: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['petstore'] };
      const incrementalConfig: PublishConfig = { ...testConfig, commitId: 'abc123' };

      await publishApi(client, store, testContext, apiDescriptor, incrementalConfig);

      // Only the explicit schema should be published (auto-generated hex ID is skipped)
      const totalTasks = mockRunParallel.mock.calls.reduce((sum, call) => {
        const tasks = call[0] as unknown[];
        return sum + tasks.length;
      }, 0);
      expect(totalTasks).toBe(1);
    });

    it('should not re-publish schema-reference operations in incremental mode after spec import', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, nameParts: ['petstore', 'policy-1'] },
        { type: ResourceType.ApiOperation, nameParts: ['petstore', 'create-item'] },
      ];
      const store = createMockStore(children);

      store.readResource.mockImplementation(async (_dir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.Api) {
          return { name: 'petstore', properties: { path: 'petstore' } };
        }
        if (
          descriptor.type === ResourceType.ApiOperation &&
          (descriptor.nameParts[1] ?? '') === 'create-item'
        ) {
          return {
            name: 'create-item',
            properties: {
              request: {
                representations: [{ contentType: 'application/json', schemaId: 'my-schema' }],
              },
            },
          };
        }
        return null;
      });
      store.readContent.mockResolvedValue({
        content: 'openapi: "3.0.0"',
        format: 'yaml',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['petstore'],
      };

      const incrementalConfig: PublishConfig = {
        ...testConfig,
        commitId: 'abc123',
      };

      await publishApi(client, store, testContext, apiDescriptor, incrementalConfig);

      // Only ApiPolicy should be published as child. The schema-ref operation
      // must be skipped in incremental mode to preserve imported spec metadata.
      const totalTasks = mockRunParallel.mock.calls.reduce((sum, call) => {
        const tasks = call[0] as unknown[];
        return sum + tasks.length;
      }, 0);
      expect(totalTasks).toBe(1);
    });

    it('should skip operation republish in incremental mode when operation description is null', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiOperation, nameParts: ['src-a2a-runtime-mock', 'get-agent-card'] },
      ];
      const store = createMockStore(children);

      store.readResource.mockImplementation(async (_dir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.Api) {
          return { name: 'src-a2a-runtime-mock', properties: { path: 'a2a/mock' } };
        }
        if (
          descriptor.type === ResourceType.ApiOperation &&
          (descriptor.nameParts[1] ?? '') === 'get-agent-card'
        ) {
          return {
            name: 'get-agent-card',
            properties: {
              displayName: 'Get agent card',
              description: null,
              method: 'GET',
              urlTemplate: '/agent/card',
              responses: [],
            },
          };
        }
        return null;
      });

      store.readContent.mockResolvedValue({
        content: 'openapi: "3.0.0"',
        format: 'yaml',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['src-a2a-runtime-mock'],
      };

      const incrementalConfig: PublishConfig = {
        ...testConfig,
        commitId: 'abc123',
      };

      await publishApi(client, store, testContext, apiDescriptor, incrementalConfig);

      // With spec import + incremental mode, operation artifacts are not re-published.
      // This narrow assertion discriminates the branch that can allow description drift.
      const totalTasks = mockRunParallel.mock.calls.reduce((sum, call) => {
        const tasks = call[0] as unknown[];
        return sum + tasks.length;
      }, 0);
      expect(totalTasks).toBe(0);
    });

    it('should re-publish operations with schema references in response representations', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiOperation, nameParts: ['petstore', 'get-item'] },
      ];
      const store = createMockStore(children);

      store.readResource.mockImplementation(async (_dir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.Api) {
          return { name: 'petstore', properties: { path: 'petstore' } };
        }
        if (descriptor.type === ResourceType.ApiOperation) {
          return {
            name: 'get-item',
            properties: {
              responses: [
                {
                  statusCode: 200,
                  representations: [{ contentType: 'application/json', schemaId: 'item-schema', typeName: 'Item' }],
                },
              ],
            },
          };
        }
        return null;
      });
      store.readContent.mockResolvedValue({
        content: 'openapi: "3.0.0"',
        format: 'yaml',
      });

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['petstore'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // get-item has schema refs in response → re-published (1 task total)
      const totalTasks = mockRunParallel.mock.calls.reduce((sum, call) => {
        const tasks = call[0] as unknown[];
        return sum + tasks.length;
      }, 0);
      expect(totalTasks).toBe(1);
    });

    it('should publish all children when no specification file exists', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiPolicy, nameParts: ['petstore', 'policy-1'] },
        { type: ResourceType.ApiOperation, nameParts: ['petstore', 'get-pets'] },
        { type: ResourceType.ApiSchema, nameParts: ['petstore', 'schema-1'] },
      ];
      const store = createMockStore(children);
      // readContent returns undefined — no spec file
      store.readContent.mockResolvedValue(undefined);

      const apiDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['petstore'],
      };

      await publishApi(client, store, testContext, apiDescriptor, testConfig);

      // All 3 children should be published (across tiers)
      const totalTasks = mockRunParallel.mock.calls.reduce((sum, call) => {
        const tasks = call[0] as unknown[];
        return sum + tasks.length;
      }, 0);
      expect(totalTasks).toBe(3);
    });

    it('should return skipped when root API resource file does not exist', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      store.readResource.mockResolvedValue(null);
      store.readContent.mockResolvedValue({ content: 'openapi: "3.0.0"', format: 'yaml' });

      const apiDescriptor: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['missing-api'] };

      const result = await publishApi(client, store, testContext, apiDescriptor, testConfig);

      expect(result.status).toBe('skipped');
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should not inject spec for GraphQL format', async () => {
      const client = createMockClient();
      const children = [
        { type: ResourceType.ApiSchema, nameParts: ['gql-api', 'schema-1'] },
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
        nameParts: ['gql-api'],
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
        nameParts: ['soap-api'],
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
