// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Publish orchestration service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ResourceDescriptor, ApimServiceContext } from '../../../src/models/types.js';
import { PublishConfig } from '../../../src/models/config.js';
import { LogLevel } from '../../../src/lib/logger.js';

// Mock service dependencies
vi.mock('../../../src/services/git-diff-service.js');
vi.mock('../../../src/services/dry-run-reporter.js');
vi.mock('../../../src/services/delete-unmatched-service.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/delete-unmatched-service.js')>(
    '../../../src/services/delete-unmatched-service.js'
  );
  return {
    ...actual,
    computeDeleteActions: vi.fn(),
  };
});
vi.mock('../../../src/services/api-publisher.js');
vi.mock('../../../src/services/product-publisher.js');

// Import the module under test and mocked modules
import { runPublish } from '../../../src/services/publish-service.js';
import { computeGitDiff } from '../../../src/services/git-diff-service.js';
import { generateDryRunReport } from '../../../src/services/dry-run-reporter.js';
import { computeDeleteActions } from '../../../src/services/delete-unmatched-service.js';
import { publishApi } from '../../../src/services/api-publisher.js';
import { publishProduct } from '../../../src/services/product-publisher.js';

function createMockClient() {
  return {
    listResources: async function* () {},
    getResource: vi.fn(),
    putResource: vi.fn().mockResolvedValue(undefined),
    patchResource: vi.fn().mockResolvedValue(undefined),
    deleteResource: vi.fn().mockResolvedValue(true),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn(),
    validatePreFlight: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockStore(resources: ResourceDescriptor[] = []) {
  return {
    writeResource: vi.fn(),
    writeContent: vi.fn(),
    writeAssociation: vi.fn(),
    readResource: vi.fn().mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) => {
      return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: {} };
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

describe('publish-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(computeGitDiff).mockResolvedValue({
      changedDescriptors: [],
      deletedDescriptors: [],
    });
    
    vi.mocked(generateDryRunReport).mockResolvedValue({
      actions: [],
      summary: { creates: 0, patches: 0, deletes: 0, skips: 0 },
    });
    
    vi.mocked(computeDeleteActions).mockResolvedValue([]);
    
    vi.mocked(publishApi).mockResolvedValue({
      descriptor: { type: ResourceType.Api, nameParts: ['test-api'] },
      status: 'success',
      action: 'put',
    });

    vi.mocked(publishProduct).mockResolvedValue({
      descriptor: { type: ResourceType.Product, nameParts: ['test-product'] },
      status: 'success',
      action: 'put',
    });
  });

  describe('runPublish', () => {
    it('should call publishResource for each artifact in dependency order', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        { type: ResourceType.Api, nameParts: ['api1'] },
        { type: ResourceType.Backend, nameParts: ['backend1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.totalPuts).toBe(3);
      expect(result.exitCode).toBe(0);
    });

    it('should return exit code 0 when all succeed', async () => {
      const resources = [
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(0);
      expect(result.totalErrors).toBe(0);
    });

    it('should publish only resources matched by a filter', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['keep'] },
        { type: ResourceType.NamedValue, nameParts: ['skip'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: { namedValues: ['keep'] },
        includeTransitive: false,
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(1);
      expect(client.putResource).toHaveBeenCalledTimes(1);
      expect(client.putResource.mock.calls[0]?.[1].nameParts).toEqual(['keep']);
    });

    it('should include an artifact-backed version set transitively', async () => {
      const resources = [
        { type: ResourceType.Api, nameParts: ['orders'] },
        { type: ResourceType.VersionSet, nameParts: ['orders-v1'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      store.readResource.mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.Api) {
          return {
            name: 'orders',
            properties: {
              apiVersionSetId: '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/apiVersionSets/orders-v1',
            },
          };
        }
        return { name: descriptor.nameParts[0] ?? '', properties: {} };
      });

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: { apis: ['orders'], versionSets: [] },
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(2);
      expect(client.putResource.mock.calls.some((call) =>
        call[1].type === ResourceType.VersionSet &&
        call[1].nameParts[0] === 'orders-v1'
      )).toBe(true);
    });

    it('should include every dependency type supported by extract', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['orders'] },
        { type: ResourceType.ApiPolicy, nameParts: ['orders'] },
        { type: ResourceType.NamedValue, nameParts: ['orders-key'] },
        { type: ResourceType.Backend, nameParts: ['orders-backend'] },
        { type: ResourceType.PolicyFragment, nameParts: ['shared-auth'] },
        { type: ResourceType.VersionSet, nameParts: ['orders-v1'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      store.readResource.mockImplementation(async (_sourceDir, descriptor) =>
        descriptor.type === ResourceType.Api
          ? {
              name: 'orders',
              properties: {
                apiVersionSetId:
                  '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/apiVersionSets/orders-v1',
              },
            }
          : { name: descriptor.nameParts[0] ?? '', properties: {} }
      );
      store.readContent.mockImplementation(async (_sourceDir, descriptor) =>
        descriptor.type === ResourceType.ApiPolicy
          ? {
              content: [
                '<policies><inbound>',
                '<set-header name="key"><value>{{orders-key}}</value></set-header>',
                '<set-backend-service backend-id="orders-backend" />',
                '<include-fragment fragment-id="shared-auth" />',
                '</inbound></policies>',
              ].join(''),
              format: 'xml',
            }
          : undefined
      );

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: {
          apis: ['orders'],
          namedValues: [],
          backends: [],
          policyFragments: [],
          versionSets: [],
        },
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(5);
      expect(publishApi).toHaveBeenCalledWith(
        client,
        store,
        testContext,
        expect.objectContaining({ type: ResourceType.Api, nameParts: ['orders'] }),
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ type: ResourceType.ApiPolicy, nameParts: ['orders'] }),
          expect.objectContaining({ type: ResourceType.NamedValue, nameParts: ['orders-key'] }),
          expect.objectContaining({ type: ResourceType.Backend, nameParts: ['orders-backend'] }),
          expect.objectContaining({ type: ResourceType.PolicyFragment, nameParts: ['shared-auth'] }),
          expect.objectContaining({ type: ResourceType.VersionSet, nameParts: ['orders-v1'] }),
        ])
      );
    });

    it('should include only filter-eligible API children in transitive scanning and the publish set', async () => {
      const api: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['orders'] };
      const includedPolicy: ResourceDescriptor = {
        type: ResourceType.ApiOperationPolicy,
        nameParts: ['orders', 'get-orders'],
      };
      const excludedPolicy: ResourceDescriptor = {
        type: ResourceType.ApiOperationPolicy,
        nameParts: ['orders', 'delete-orders'],
      };
      const includedBackend: ResourceDescriptor = {
        type: ResourceType.Backend,
        nameParts: ['included-backend'],
      };
      const excludedBackend: ResourceDescriptor = {
        type: ResourceType.Backend,
        nameParts: ['excluded-backend'],
      };
      const resources = [
        api,
        includedPolicy,
        excludedPolicy,
        includedBackend,
        excludedBackend,
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      store.readContent.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor) => {
          if (descriptor === includedPolicy) {
            return {
              content: '<set-backend-service backend-id="included-backend" />',
              format: 'xml',
            };
          }
          if (descriptor === excludedPolicy) {
            return {
              content: '<set-backend-service backend-id="excluded-backend" />',
              format: 'xml',
            };
          }
          return undefined;
        }
      );

      await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: {
          apis: ['orders'],
          apiSubFilters: {
            orders: { operations: ['get-orders'] },
          },
          backends: [],
        },
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(publishApi).toHaveBeenCalledWith(
        client,
        store,
        testContext,
        api,
        expect.anything(),
        expect.arrayContaining([includedPolicy, includedBackend])
      );
      const allowed = vi.mocked(publishApi).mock.calls[0]?.[5] as ResourceDescriptor[];
      expect(allowed).not.toContainEqual(excludedPolicy);
      expect(allowed).not.toContainEqual(excludedBackend);
    });

    it('should not expand root API children from a revision-only incremental change', async () => {
      const revision: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders;rev=2'],
      };
      const policy: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['orders'],
      };
      const backend: ResourceDescriptor = {
        type: ResourceType.Backend,
        nameParts: ['orders-backend'],
      };
      vi.mocked(computeGitDiff).mockResolvedValueOnce({
        changedDescriptors: [revision],
        deletedDescriptors: [],
      });
      const client = createMockClient();
      const store = createMockStore([revision, policy, backend]);
      store.readContent.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor) =>
          descriptor.type === ResourceType.ApiPolicy
            ? {
                content: '<set-backend-service backend-id="orders-backend" />',
                format: 'xml',
              }
            : undefined
      );

      await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        commitId: 'base',
        filter: { apis: ['orders'], backends: [] },
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        revision,
        expect.anything()
      );
      expect(client.putResource).not.toHaveBeenCalledWith(
        testContext,
        backend,
        expect.anything()
      );
    });

    it('should not scan unrelated resources that share the selected parent name', async () => {
      const resources = [
        { type: ResourceType.Api, nameParts: ['orders'] },
        { type: ResourceType.Product, nameParts: ['orders'] },
        { type: ResourceType.Api, nameParts: ['shipping'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      store.readAssociation.mockImplementation(
        async (_sourceDir: string, descriptor: ResourceDescriptor, associationType: string) =>
          descriptor.type === ResourceType.Product && associationType === 'apis'
            ? [{ name: 'shipping' }]
            : []
      );

      await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: { apis: ['orders'], products: [] },
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(publishApi).toHaveBeenCalledTimes(1);
      expect(publishApi).toHaveBeenCalledWith(
        client,
        store,
        testContext,
        expect.objectContaining({ nameParts: ['orders'] }),
        expect.anything(),
        expect.anything()
      );
    });

    it('should not pull composite API targets from product associations', async () => {
      const resources = [
        { type: ResourceType.Product, nameParts: ['starter'] },
        { type: ResourceType.Api, nameParts: ['legacy-api'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      store.readAssociation.mockResolvedValue([{ name: 'legacy-api' }]);

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: { products: ['starter'], apis: [] },
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(1);
      expect(publishProduct).toHaveBeenCalledTimes(1);
      expect(publishApi).not.toHaveBeenCalled();
    });

    it('should include backend pool members transitively', async () => {
      const resources = [
        { type: ResourceType.Backend, nameParts: ['pool'] },
        { type: ResourceType.Backend, nameParts: ['member'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      store.readResource.mockImplementation(async (_sourceDir, descriptor) =>
        descriptor.nameParts[0] === 'pool'
          ? {
              properties: {
                type: 'Pool',
                pool: {
                  services: [{
                    id: '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/backends/member',
                  }],
                },
              },
            }
          : { properties: {} }
      );

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: { backends: ['pool'] },
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(2);
      expect(client.putResource.mock.calls.some((call) =>
        call[1].type === ResourceType.Backend &&
        call[1].nameParts[0] === 'member'
      )).toBe(true);
    });

    it('should not include transitive dependencies when disabled', async () => {
      const resources = [
        { type: ResourceType.Api, nameParts: ['orders'] },
        { type: ResourceType.VersionSet, nameParts: ['orders-v1'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      store.readResource.mockResolvedValue({
        name: 'orders',
        properties: {
          apiVersionSetId: '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/apiVersionSets/orders-v1',
        },
      });

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: { apis: ['orders'], versionSets: [] },
        includeTransitive: false,
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(1);
      expect(client.putResource.mock.calls.some((call) => call[1].type === ResourceType.VersionSet)).toBe(false);
    });

    it('should intersect incremental changes with a filter', async () => {
      const changedDescriptors = [
        { type: ResourceType.NamedValue, nameParts: ['keep'] },
        { type: ResourceType.NamedValue, nameParts: ['skip'] },
      ];
      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors,
        deletedDescriptors: [],
      });
      const client = createMockClient();
      const store = createMockStore(changedDescriptors);

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: { namedValues: ['keep'] },
        includeTransitive: false,
        commitId: 'abc123',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(1);
      expect(client.putResource.mock.calls[0]?.[1].nameParts).toEqual(['keep']);
    });

    it('should publish an incremental GatewayApi link using the same target context as dry-run', async () => {
      const gatewayAssociation: ResourceDescriptor = {
        type: ResourceType.GatewayApi,
        nameParts: ['edge'],
      };
      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [gatewayAssociation],
        deletedDescriptors: [],
      });
      const client = createMockClient();
      const store = createMockStore([gatewayAssociation]);
      store.readAssociation.mockResolvedValue([{ name: 'orders' }]);

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: {
          gateways: ['edge'],
          apis: ['orders'],
        },
        includeTransitive: false,
        commitId: 'abc123',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(1);
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        {
          type: ResourceType.GatewayApi,
          nameParts: ['edge', 'orders'],
          workspace: undefined,
        },
        {}
      );
    });

    it('should resolve policy dependencies from unchanged child artifacts in incremental mode', async () => {
      const api = { type: ResourceType.Api, nameParts: ['orders'] };
      const apiPolicy = { type: ResourceType.ApiPolicy, nameParts: ['orders'] };
      const backend = { type: ResourceType.Backend, nameParts: ['orders-backend'] };
      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [api],
        deletedDescriptors: [],
      });
      const client = createMockClient();
      const store = createMockStore([api, apiPolicy, backend]);
      store.readContent.mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) =>
        descriptor.type === ResourceType.ApiPolicy
          ? { content: '<set-backend-service backend-id="orders-backend" />' }
          : undefined
      );

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: { apis: ['orders'], backends: [] },
        commitId: 'abc123',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(2);
      expect(client.putResource.mock.calls.some((call) =>
        call[1].type === ResourceType.Backend &&
        call[1].nameParts[0] === 'orders-backend'
      )).toBe(true);
    });

    it('should not resolve dependencies from API operations excluded by a sub-filter', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['orders'] },
        { type: ResourceType.ApiOperationPolicy, nameParts: ['orders', 'get-orders'] },
        { type: ResourceType.ApiOperationPolicy, nameParts: ['orders', 'delete-orders'] },
        { type: ResourceType.Backend, nameParts: ['included-backend'] },
        { type: ResourceType.Backend, nameParts: ['excluded-backend'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      store.readContent.mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type !== ResourceType.ApiOperationPolicy) {
          return undefined;
        }
        const backend = descriptor.nameParts[1] === 'get-orders'
          ? 'included-backend'
          : 'excluded-backend';
        return { content: `<set-backend-service backend-id="${backend}" />` };
      });

      await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: {
          apis: ['orders'],
          apiSubFilters: {
            orders: { operations: ['get-orders'] },
          },
          backends: [],
        },
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      const backendNames = client.putResource.mock.calls
        .filter((call) => call[1].type === ResourceType.Backend)
        .map((call) => call[1].nameParts[0]);
      expect(backendNames).toContain('included-backend');
      expect(backendNames).not.toContain('excluded-backend');
    });

    it('should not resolve dependencies from workspace API operations excluded by a sub-filter', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['orders'], workspace: 'team-a' },
        {
          type: ResourceType.ApiOperationPolicy,
          nameParts: ['orders', 'get-orders'],
          workspace: 'team-a',
        },
        {
          type: ResourceType.ApiOperationPolicy,
          nameParts: ['orders', 'delete-orders'],
          workspace: 'team-a',
        },
        { type: ResourceType.Backend, nameParts: ['included-backend'], workspace: 'team-a' },
        { type: ResourceType.Backend, nameParts: ['excluded-backend'], workspace: 'team-a' },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      store.readContent.mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.type !== ResourceType.ApiOperationPolicy) {
          return undefined;
        }
        const backend = descriptor.nameParts[1] === 'get-orders'
          ? 'included-backend'
          : 'excluded-backend';
        return { content: `<set-backend-service backend-id="${backend}" />` };
      });

      await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: {
          workspaces: ['team-a'],
          workspaceSubFilters: {
            'team-a': {
              apis: ['orders'],
              apiSubFilters: {
                orders: { operations: ['get-orders'] },
              },
              backends: [],
            },
          },
        },
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      const backendNames = client.putResource.mock.calls
        .filter((call) => call[1].type === ResourceType.Backend)
        .map((call) => call[1].nameParts[0]);
      expect(backendNames).toContain('included-backend');
      expect(backendNames).not.toContain('excluded-backend');
    });

    it('should report filtered targets in dry-run mode', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['keep'] },
        { type: ResourceType.NamedValue, nameParts: ['skip'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);

      await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        filter: { namedValues: ['keep'] },
        includeTransitive: false,
        dryRun: true,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(generateDryRunReport).toHaveBeenCalledWith(
        store,
        client,
        testContext,
        expect.objectContaining({ filter: { namedValues: ['keep'] } }),
        [{ type: ResourceType.NamedValue, nameParts: ['keep'] }],
        []
      );
    });

    it('should return exit code 1 when some fail', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        { type: ResourceType.NamedValue, nameParts: ['nv2'] },
      ];

      const client = createMockClient();
      client.putResource.mockImplementation(async (ctx, descriptor) => {
        if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'nv2') {
          throw new Error('PUT failed');
        }
      });
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(1);
      expect(result.totalErrors).toBe(1);
    });

    it('should return exit code 2 when all fail or fatal error', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
      ];

      const client = createMockClient();
      client.putResource.mockRejectedValue(new Error('Fatal error'));
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(2);
    });

    it('should use publishApi for Api type resources', async () => {
      const resources = [
        { type: ResourceType.Api, nameParts: ['my-api'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(publishApi).toHaveBeenCalled();
    });

    it('should publish regular APIs before MCP APIs in tier 2', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['src-rest-openapi'] },
        { type: ResourceType.Api, nameParts: ['src-mcp-from-api'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      store.readResource.mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) => {
        const name = descriptor.nameParts[descriptor.nameParts.length - 1] ?? '';
        if (name === 'src-mcp-from-api') {
          return { name, properties: { mcpTools: [{ operationId: '/apis/src-rest-openapi/operations/get' }] } };
        }
        return { name, properties: {} };
      });

      const apiCallOrder: string[] = [];
      vi.mocked(publishApi).mockImplementation(async (_client, _store, _context, descriptor) => {
        apiCallOrder.push(descriptor.nameParts[0] ?? '');
        return {
          descriptor,
          status: 'success',
          action: 'put',
        };
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(apiCallOrder).toEqual(['src-rest-openapi', 'src-mcp-from-api']);
    });

    it('should wait for APIs to finish publishing before publishing Products in tier 2', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Product, nameParts: ['petstore-product'] },
        { type: ResourceType.Api, nameParts: ['swagger-petstore'] },
      ];
      const client = createMockClient();
      const store = createMockStore(resources);
      let finishApi!: () => void;
      const apiFinished = new Promise<void>((resolve) => {
        finishApi = resolve;
      });

      vi.mocked(publishApi).mockImplementation(async (_client, _store, _context, descriptor) => {
        await apiFinished;
        return {
          descriptor,
          status: 'success',
          action: 'put',
        };
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const publishPromise = runPublish(client, store, config);
      await vi.waitFor(() => expect(publishApi).toHaveBeenCalledOnce());

      try {
        expect(publishProduct).not.toHaveBeenCalled();
      } finally {
        finishApi();
        await publishPromise;
      }

      expect(publishProduct).toHaveBeenCalledOnce();
    });

    it('should not publish revision APIs as standalone resources when root API is in the same batch', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['orders-api;rev=2'] },
        { type: ResourceType.Api, nameParts: ['orders-api'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const apiCallOrder: string[] = [];
      vi.mocked(publishApi).mockImplementation(async (_client, _store, _context, descriptor) => {
        apiCallOrder.push(descriptor.nameParts[0] ?? '');
        return {
          descriptor,
          status: 'success',
          action: 'put',
        };
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(apiCallOrder).toEqual(['orders-api']);
      expect(result.totalPuts).toBe(1);
    });

    it('should publish revision-only API descriptors via generic publisher path', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['orders-api;rev=2'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockResolvedValue({
        name: 'orders-api;rev=2',
        properties: {
          apiRevision: '2',
          path: 'orders',
          protocols: ['https'],
        },
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(publishApi).not.toHaveBeenCalled();
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        { type: ResourceType.Api, nameParts: ['orders-api;rev=2'] },
        expect.objectContaining({
          properties: expect.objectContaining({
            sourceApiId: expect.stringContaining('/apis/orders-api'),
          }),
        })
      );
      expect(result.totalPuts).toBe(1);
    });

    it('should call generateDryRunReport in dry-run mode', async () => {
      const resources = [
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: true,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(generateDryRunReport).toHaveBeenCalled();
      expect(result.dryRunReport).toBeDefined();
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should return a partial failure when a dry-run existence check fails', async () => {
      vi.mocked(generateDryRunReport).mockResolvedValueOnce({
        actions: [{
          operation: 'SKIP',
          type: ResourceType.Tag,
          name: 'tag1',
          descriptor: { type: ResourceType.Tag, nameParts: ['tag1'] },
          reason: 'existence check failed: network error',
          error: 'existence check failed: network error',
        }],
        summary: { creates: 0, patches: 0, deletes: 0, skips: 1 },
      });
      const client = createMockClient();
      const store = createMockStore([
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ]);

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        dryRun: true,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.exitCode).toBe(1);
      expect(result.totalErrors).toBe(1);
      expect(result.totalSkipped).toBe(1);
    });

    it('should abort the entire publish before any PUT when a redaction marker is found', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['nv-secret'] },
        { type: ResourceType.Api, nameParts: ['api1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir: string, descriptor: ResourceDescriptor) => {
          if (descriptor.type === ResourceType.NamedValue) {
            return { name: 'nv-secret', properties: { secret: true, value: '*** REDACTED ***' } };
          }
          return { name: descriptor.nameParts[0] ?? '', properties: {} };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(2);
      expect(result.totalErrors).toBe(1);
      expect(result.totalPuts).toBe(0);
      expect(client.putResource).not.toHaveBeenCalled();
      expect(publishApi).not.toHaveBeenCalled();
    });

    it('should fail dry-run when a redaction marker is found and not generate a report', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['nv-secret'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockResolvedValue({
        name: 'nv-secret',
        properties: { secret: true, value: '*** REDACTED ***' },
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: true,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(2);
      expect(result.totalErrors).toBe(1);
      expect(result.dryRunReport).toBeUndefined();
      expect(generateDryRunReport).not.toHaveBeenCalled();
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should use computeGitDiff when commitId is set (incremental mode)', async () => {
      const client = createMockClient();
      const store = createMockStore([]);

      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [
          { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        ],
        deletedDescriptors: [],
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        commitId: 'abc123',
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(computeGitDiff).toHaveBeenCalledWith('/source', 'abc123');
    });

    it('should delete descriptors removed in the commit when explicitly enabled', async () => {
      const client = createMockClient();
      const store = createMockStore([]);

      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [
          { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        ],
        deletedDescriptors: [
          { type: ResourceType.Tag, nameParts: ['old-tag'] },
        ],
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: true,
        commitId: 'abc123',
        overrides: {
          environment: { namePrefix: 'dev-' },
        },
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(client.deleteResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.Tag,
          nameParts: ['dev-old-tag'],
        })
      );
      expect(result.totalDeletes).toBe(1);
      expect(computeDeleteActions).not.toHaveBeenCalled();
    });

    it('should not delete commit-scoped descriptors without explicit opt-in', async () => {
      const client = createMockClient();
      const store = createMockStore([]);
      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [],
        deletedDescriptors: [
          { type: ResourceType.Tag, nameParts: ['old-tag'] },
        ],
      });

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        commitId: 'abc123',
        logLevel: LogLevel.INFO,
      });

      expect(client.deleteResource).not.toHaveBeenCalled();
      expect(result.totalDeletes).toBe(0);
    });

    it('should resolve opaque workspace association links before incremental deletion', async () => {
      const client = createMockClient();
      client.listResources = async function* () {
        yield {
          name: 'opaque-link',
          properties: {
            apiId: `${testContext.baseUrl}/workspaces/team/apis/orders`,
          },
        };
      };
      const store = createMockStore([]);
      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [],
        deletedDescriptors: [{
          type: ResourceType.ProductApi,
          nameParts: ['store', 'orders'],
          workspace: 'team',
        }],
      });

      await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: true,
        commitId: 'abc123',
        logLevel: LogLevel.INFO,
      });

      expect(client.deleteResource).toHaveBeenCalledWith(testContext, {
        type: ResourceType.ProductApi,
        nameParts: ['store', 'opaque-link'],
        workspace: 'team',
      });
    });

    it('should not run full unmatched deletion when an incremental commit has no deletions', async () => {
      const client = createMockClient();
      client.listResources = async function* () {
        yield await Promise.reject(new Error('Full unmatched discovery must not run'));
      };
      const store = createMockStore([]);
      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [],
        deletedDescriptors: [],
      });

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: true,
        commitId: 'abc123',
        logLevel: LogLevel.INFO,
      });

      expect(client.deleteResource).not.toHaveBeenCalled();
      expect(result.totalDeletes).toBe(0);
    });

    it('incremental mode: lists FULL artifact set for env-mapping validation and known-artifact sets', async () => {
      // Regression: prior to this fix, publish-service passed the changed
      // subset (from computeGitDiff) to both validateAndBuildEnvMapping and
      // buildKnownArtifactSets. That silently broke policy XML ref rewriting
      // for any NamedValue / PolicyFragment / Backend whose file did not
      // change in the current commit, and produced false stale-override
      // warnings on every unchanged override entry.
      const client = createMockClient();
      const fullArtifacts: ResourceDescriptor[] = [
        { type: ResourceType.NamedValue, nameParts: ['nv-unchanged'] },
        { type: ResourceType.NamedValue, nameParts: ['nv-changed'] },
        { type: ResourceType.Api, nameParts: ['api1'] },
      ];
      const store = createMockStore(fullArtifacts);

      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [
          { type: ResourceType.NamedValue, nameParts: ['nv-changed'] },
        ],
        deletedDescriptors: [],
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        commitId: 'abc123',
        logLevel: LogLevel.INFO,
        overrides: {
          environment: { namePrefix: 'dev-' },
        },
      };

      await runPublish(client, store, config);

      // In incremental mode, publish-service must call store.listResources to
      // build the full artifact set for env-mapping validation and policy-ref
      // rewriting — not just rely on the git-diff subset.
      expect(store.listResources).toHaveBeenCalledWith('/source');
      // envMapping must be populated on config after validation
      expect(config.envMapping).toBeDefined();
      // knownArtifactSets must contain the FULL set of named values, not just changed
      expect(config.knownArtifactSets?.namedValues.has('nv-unchanged')).toBe(true);
      expect(config.knownArtifactSets?.namedValues.has('nv-changed')).toBe(true);
    });

    it('should pass commit-scoped deleted descriptors to dry-run report', async () => {
      const client = createMockClient();
      const store = createMockStore([]);

      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [
          { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        ],
        deletedDescriptors: [
          { type: ResourceType.Tag, nameParts: ['old-tag'] },
        ],
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: true,
        deleteUnmatched: true,
        commitId: 'abc123',
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(generateDryRunReport).toHaveBeenCalledWith(
        store,
        client,
        testContext,
        config,
        [{ type: ResourceType.NamedValue, nameParts: ['nv1'] }],
        [{ type: ResourceType.Tag, nameParts: ['old-tag'] }]
      );
    });

    it('should call computeDeleteActions when deleteUnmatched is true', async () => {
      const resources = [
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      vi.mocked(computeDeleteActions).mockResolvedValue([
        { type: ResourceType.Backend, nameParts: ['dev-old-backend'] },
      ]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: true,
        overrides: {
          environment: { namePrefix: 'dev-' },
        },
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(computeDeleteActions).toHaveBeenCalled();
      expect(client.deleteResource).toHaveBeenCalledWith(testContext, {
        type: ResourceType.Backend,
        nameParts: ['dev-old-backend'],
      });
      expect(result.totalDeletes).toBe(1);
    });

    it('deletes a revisioned API via the base API only, not individual revisions', async () => {
      const resources = [
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      // computeDeleteActions returns both the base API and one of its revisions.
      vi.mocked(computeDeleteActions).mockResolvedValue([
        { type: ResourceType.Api, nameParts: ['orders-api'] },
        { type: ResourceType.Api, nameParts: ['orders-api;rev=2'] },
      ]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: true,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      // Base API delete (which uses deleteRevisions=true) is issued once.
      expect(client.deleteResource).toHaveBeenCalledWith(
        testContext,
        { type: ResourceType.Api, nameParts: ['orders-api'] }
      );
      // The individual revision delete is dropped to avoid the
      // "Cannot delete the current revision of an API" error.
      expect(client.deleteResource).not.toHaveBeenCalledWith(
        testContext,
        { type: ResourceType.Api, nameParts: ['orders-api;rev=2'] }
      );
      expect(result.totalDeletes).toBe(1);
    });

    it('should output per-resource status lines', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const resources = [
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('PUT'));

      stdoutSpy.mockRestore();
    });

    it('should handle resources in tier order', async () => {
      const resources = [
        { type: ResourceType.Backend, nameParts: ['backend1'] },
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.totalPuts).toBe(2);
      expect(client.putResource).toHaveBeenCalledTimes(2);
    });

    it('should not throw RangeError when ServicePolicy (nameParts=[]) is in the batch', async () => {
      // ServicePolicy is a tier-2 top-level singleton with no name segments (nameParts: []).
      // The isTopLevelSingleton() guard in executePuts must fire so that
      // getNamePart(d.nameParts, 0) is never called for this resource.
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.ServicePolicy, nameParts: [] },
        { type: ResourceType.Api, nameParts: ['my-api'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);
      // ServicePolicy is a policy type — its artifact is policy.xml, not JSON.
      // Mock readContent so the policy publish path reaches putResource.
      vi.mocked(store.readContent).mockImplementation(
        async (_sourceDir, descriptor, contentType) => {
          if (
            descriptor.type === ResourceType.ServicePolicy &&
            contentType === 'policy'
          ) {
            // Minimal valid APIM policy XML — content doesn't matter for this test,
            // only that readContent returns something so publishPolicy reaches putResource.
            return { content: '<policies><inbound/></policies>', format: 'xml' };
          }
          return undefined;
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await expect(runPublish(client, store, config)).resolves.not.toThrow();
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ServicePolicy }),
        expect.anything(),
      );
    });
  });

  describe('pre-flight validation', () => {
    it('should call validatePreFlight before publishing', async () => {
      const client = createMockClient();
      const store = createMockStore([{ type: ResourceType.Tag, nameParts: ['tag1'] }]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(client.validatePreFlight).toHaveBeenCalledWith(testContext);
    });

    it('should return validation failure exit code when resource group does not exist', async () => {
      const client = createMockClient();
      vi.mocked(client.validatePreFlight).mockRejectedValue(
        new Error("Resource group 'rg-1' not found in subscription 'sub-1'. Ensure the resource group exists before publishing.")
      );
      const store = createMockStore([]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(2);
      expect(result.totalErrors).toBe(1);
    });

    it('should return validation failure exit code when APIM service does not exist', async () => {
      const client = createMockClient();
      vi.mocked(client.validatePreFlight).mockRejectedValue(
        new Error("APIM service 'apim-1' not found in resource group 'rg-1'. Ensure the APIM instance exists before publishing.")
      );
      const store = createMockStore([]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(2);
      expect(result.totalErrors).toBe(1);
    });

    it('should not publish any resources when pre-flight fails', async () => {
      const client = createMockClient();
      vi.mocked(client.validatePreFlight).mockRejectedValue(
        new Error("Resource group 'rg-missing' not found.")
      );
      const store = createMockStore([{ type: ResourceType.Tag, nameParts: ['tag1'] }]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(client.putResource).not.toHaveBeenCalled();
    });
  });

  describe('named value ordering within tier 1', () => {
    it('should publish named values before loggers within tier 1', async () => {
      const publishOrder: string[] = [];

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Logger, nameParts: ['appinsights-logger'] },
        { type: ResourceType.NamedValue, nameParts: ['AppInsights-InstrumentationKey'] },
        { type: ResourceType.NamedValue, nameParts: ['Gemini-ApiKey'] },
        { type: ResourceType.Backend, nameParts: ['my-backend'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockImplementation(
        async (_ctx, descriptor) => {
          publishOrder.push(descriptor.nameParts[descriptor.nameParts.length - 1] ?? "");
        }
      );

      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => ({ name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: {} })
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      // Both named values must appear before the logger
      const nvIdx1 = publishOrder.indexOf('AppInsights-InstrumentationKey');
      const nvIdx2 = publishOrder.indexOf('Gemini-ApiKey');
      const loggerIdx = publishOrder.indexOf('appinsights-logger');
      const backendIdx = publishOrder.indexOf('my-backend');

      expect(nvIdx1).toBeGreaterThan(-1);
      expect(nvIdx2).toBeGreaterThan(-1);
      expect(loggerIdx).toBeGreaterThan(-1);
      expect(backendIdx).toBeGreaterThan(-1);

      expect(nvIdx1).toBeLessThan(loggerIdx);
      expect(nvIdx2).toBeLessThan(loggerIdx);
      expect(nvIdx1).toBeLessThan(backendIdx);
      expect(nvIdx2).toBeLessThan(backendIdx);
    });

    it('should publish named values before pool backends within tier 1', async () => {
      const publishOrder: string[] = [];

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Backend, nameParts: ['pool-b'] },
        { type: ResourceType.Backend, nameParts: ['regular-b'] },
        { type: ResourceType.NamedValue, nameParts: ['my-nv'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockImplementation(
        async (_ctx, descriptor) => {
          publishOrder.push(descriptor.nameParts[descriptor.nameParts.length - 1] ?? "");
        }
      );

      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => {
          if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'pool-b') {
            return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { type: 'Pool' } };
          }
          return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: {} };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      const nvIdx = publishOrder.indexOf('my-nv');
      const poolIdx = publishOrder.indexOf('pool-b');
      const regularIdx = publishOrder.indexOf('regular-b');

      expect(nvIdx).toBeLessThan(regularIdx);
      expect(nvIdx).toBeLessThan(poolIdx);
      // Pool backend still comes after regular backend
      expect(poolIdx).toBeGreaterThan(regularIdx);
    });
  });

  describe('pool backend ordering', () => {
    it('should publish regular backends before pool backends within tier 1', async () => {
      const publishOrder: string[] = [];

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Backend, nameParts: ['premium-pool'] },
        { type: ResourceType.Backend, nameParts: ['premium-service-1'] },
        { type: ResourceType.Backend, nameParts: ['premium-service-2'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockImplementation(
        async (_ctx, descriptor) => {
          publishOrder.push(descriptor.nameParts[descriptor.nameParts.length - 1] ?? "");
        }
      );

      const store = createMockStore(resources);
      // premium-pool is a pool backend; the other two are regular backends.
      // The pool service references (weight/priority) are included to reflect
      // real APIM artifacts; their non-ID values remain opaque during publish.
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => {
          if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'premium-pool') {
            return {
              name: descriptor.nameParts[descriptor.nameParts.length - 1] ?? "",
              properties: {
                type: 'Pool',
                pool: {
                  services: [
                    { id: '.../backends/premium-service-1', weight: 1, priority: 1 },
                    { id: '.../backends/premium-service-2', weight: 1, priority: 1 },
                  ],
                },
              },
            };
          }
          return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { url: 'https://example.com', protocol: 'http' } };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      // Pool backend must appear after both regular backends
      const poolIdx = publishOrder.indexOf('premium-pool');
      const svc1Idx = publishOrder.indexOf('premium-service-1');
      const svc2Idx = publishOrder.indexOf('premium-service-2');

      expect(poolIdx).toBeGreaterThan(-1);
      expect(svc1Idx).toBeGreaterThan(-1);
      expect(svc2Idx).toBeGreaterThan(-1);
      expect(poolIdx).toBeGreaterThan(svc1Idx);
      expect(poolIdx).toBeGreaterThan(svc2Idx);
    });

    it('should treat a Backend with no type property as a regular backend', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Backend, nameParts: ['plain-backend'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockResolvedValue({
        name: 'plain-backend',
        properties: { url: 'https://example.com', protocol: 'http' },
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.totalPuts).toBe(1);
      expect(client.putResource).toHaveBeenCalledTimes(1);
    });

    it('should detect pool backends case-insensitively', async () => {
      const publishOrder: string[] = [];

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Backend, nameParts: ['POOL-backend'] },
        { type: ResourceType.Backend, nameParts: ['member-backend'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockImplementation(
        async (_ctx, descriptor) => {
          publishOrder.push(descriptor.nameParts[descriptor.nameParts.length - 1] ?? "");
        }
      );

      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => {
          if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'POOL-backend') {
            return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { type: 'pool' } };
          }
          return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { url: 'https://example.com', protocol: 'http' } };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      const poolIdx = publishOrder.indexOf('POOL-backend');
      const memberIdx = publishOrder.indexOf('member-backend');

      expect(poolIdx).toBeGreaterThan(memberIdx);
    });

    it('should publish all tier 1 resources including pool backends', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        { type: ResourceType.Tag, nameParts: ['tag1'] },
        { type: ResourceType.Backend, nameParts: ['pool-b'] },
        { type: ResourceType.Backend, nameParts: ['regular-b'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => {
          if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'pool-b') {
            return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { type: 'Pool' } };
          }
          return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: {} };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      // All 4 resources should be published
      expect(result.totalPuts).toBe(4);
    });
  });

  describe('product publish routing', () => {
    it('uses publishProduct for Product type resources', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Product, nameParts: ['my-product'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      // publishProduct should be called with the right descriptor and config
      expect(publishProduct).toHaveBeenCalledOnce();
      expect(publishProduct).toHaveBeenCalledWith(
        client,
        store,
        testContext,
        { type: ResourceType.Product, nameParts: ['my-product'] },
        config,
      );

      // Product must NOT be published via a direct putResource call
      const productPutCalls = (client.putResource.mock.calls as unknown[][]).filter((c) => {
        const d = c[1] as ResourceDescriptor;
        return d?.type === ResourceType.Product;
      });
      expect(productPutCalls).toHaveLength(0);
    });

    it('counts concrete product association results returned by the live publisher', async () => {
      const product: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['my-product'],
      };
      vi.mocked(publishProduct).mockResolvedValueOnce({
        descriptor: product,
        status: 'success',
        action: 'put',
        relatedResults: [
          {
            descriptor: {
              type: ResourceType.ProductApi,
              nameParts: ['my-product', 'orders'],
            },
            status: 'success',
            action: 'put',
          },
          {
            descriptor: {
              type: ResourceType.ProductGroup,
              nameParts: ['my-product', 'developers'],
            },
            status: 'success',
            action: 'put',
          },
          {
            descriptor: {
              type: ResourceType.ProductTag,
              nameParts: ['my-product', 'production'],
            },
            status: 'skipped',
            action: 'noop',
          },
        ],
      });
      const client = createMockClient();
      const store = createMockStore([product]);

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(3);
      expect(result.totalSkipped).toBe(1);
      expect(result.actions.map((action) => action.descriptor.type)).toEqual([
        ResourceType.Product,
        ResourceType.ProductApi,
        ResourceType.ProductGroup,
        ResourceType.ProductTag,
      ]);
    });

    it('counts concrete API PATCH results separately from PUTs', async () => {
      const api: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders'],
      };
      const operation: ResourceDescriptor = {
        type: ResourceType.ApiOperation,
        nameParts: ['orders', 'get-orders'],
      };
      vi.mocked(publishApi).mockResolvedValueOnce({
        descriptor: api,
        status: 'success',
        action: 'put',
        relatedResults: [
          {
            descriptor: operation,
            status: 'success',
            action: 'patch',
          },
        ],
      });
      const client = createMockClient();
      const store = createMockStore([api]);

      const result = await runPublish(client, store, {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      });

      expect(result.totalPuts).toBe(1);
      expect(result.totalPatches).toBe(1);
      expect(result.actions).toMatchObject([
        { descriptor: api, action: 'put' },
        { descriptor: operation, action: 'patch' },
      ]);
    });

    it('skips ProductApi children when parent Product is in the batch', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Product, nameParts: ['my-product'] },
        // ProductApi child with same parent name — should be skipped by tier filtering
        { type: ResourceType.ProductApi, nameParts: ['my-product', 'petstore'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      // ProductApi should NOT receive a standalone putResource call
      // (publishProduct handles associations internally)
      const productApiCalls = (client.putResource.mock.calls as unknown[][]).filter((c) => {
        const d = c[1] as ResourceDescriptor;
        return d.type === ResourceType.ProductApi;
      });
      expect(productApiCalls).toHaveLength(0);
    });
  });

  describe('auto-generated named value with overrides', () => {
    it('should skip auto-generated named values when no override exists', async () => {
      const autoGenId = 'aabbccddeeff112233445566'; // 24-char hex = auto-generated

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.NamedValue, nameParts: [autoGenId] },
        { type: ResourceType.NamedValue, nameParts: ['regular-nv'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockResolvedValue(undefined);

      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => ({
          name: descriptor.nameParts[descriptor.nameParts.length - 1] ?? '',
          properties: {},
        })
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      // Only regular-nv should be published
      const putNames = (client.putResource.mock.calls as unknown[][]).map((c) => {
        const d = c[1] as ResourceDescriptor;
        return d.nameParts[d.nameParts.length - 1];
      });
      expect(putNames).toContain('regular-nv');
      expect(putNames).not.toContain(autoGenId);
    });

    it('should publish auto-generated named values when an override exists', async () => {
      const autoGenId = 'aabbccddeeff112233445566';

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.NamedValue, nameParts: [autoGenId] },
        { type: ResourceType.NamedValue, nameParts: ['regular-nv'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockResolvedValue(undefined);

      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => ({
          name: descriptor.nameParts[descriptor.nameParts.length - 1] ?? '',
          properties: {},
        })
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
        overrides: {
          namedValues: {
            [autoGenId]: {
              properties: {
                value: 'overridden-secret-value',
              },
            },
          },
        },
      };

      await runPublish(client, store, config);

      // Both named values should be published
      const putNames = (client.putResource.mock.calls as unknown[][]).map((c) => {
        const d = c[1] as ResourceDescriptor;
        return d.nameParts[d.nameParts.length - 1];
      });
      expect(putNames).toContain('regular-nv');
      expect(putNames).toContain(autoGenId);
    });
  });
});
