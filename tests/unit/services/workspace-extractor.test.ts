// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Workspace-scoped extraction
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext } from '../../../src/models/types.js';
import { FilterConfig } from '../../../src/models/config.js';
import { extractWorkspaces } from '../../../src/services/workspace-extractor.js';
import { resolveWorkspaceFilter } from '../../../src/services/workspace-extractor.js';
import { logger } from '../../../src/lib/logger.js';

const testContext: ApimServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apim-1',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

function createMockClient() {
  return {
    listResources: async function* (_ctx: ApimServiceContext, _type: ResourceType): AsyncGenerator<Record<string, unknown>> {},
    getResource: vi.fn().mockResolvedValue(undefined),
    putResource: vi.fn(),
    patchResource: vi.fn(),
    deleteResource: vi.fn(),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn().mockResolvedValue(undefined),
    validatePreFlight: vi.fn().mockResolvedValue(undefined),
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

describe('workspace-extractor', () => {
  describe('extractWorkspaces', () => {
    it('should iterate only workspaceSupported types in enum order', async () => {
      const client = createMockClient();
      const seenTypes: ResourceType[] = [];
      // eslint-disable-next-line require-yield
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        seenTypes.push(type);
      };
      const store = createMockStore();
      const filter: FilterConfig = { workspaces: ['ws-1'] };

      await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      const expectedTypes = [
        ResourceType.NamedValue,
        ResourceType.Tag,
        ResourceType.VersionSet,
        ResourceType.Backend,
        ResourceType.Logger,
        ResourceType.Group,
        ResourceType.Diagnostic,
        ResourceType.PolicyFragment,
        ResourceType.Product,
        ResourceType.Api,
        ResourceType.Subscription,
        ResourceType.GlobalSchema,
      ];

      // Keep this test focused on the workspace extractor iteration contract.
      // Some type extractors may issue additional list calls (for example,
      // Logger extraction prefetches NamedValues for credential normalization).
      const firstSeenInOrder = seenTypes.filter((type, index) =>
        seenTypes.indexOf(type) === index
      );
      expect(firstSeenInOrder).toEqual(expectedTypes);

      // Ensure no unexpected resource types are listed for workspace extraction.
      expect(seenTypes.every((type) => expectedTypes.includes(type))).toBe(true);
    });

    it('should skip extraction when no workspace names in filter', async () => {
      const client = createMockClient();
      const store = createMockStore();

      const results = await extractWorkspaces(
        client, store, testContext, '/output'
      );

      expect(results).toHaveLength(0);
    });

    it('should skip extraction when workspace names array is empty', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const filter: FilterConfig = { workspaces: [] };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(0);
    });

    it('should extract resources from specified workspaces', async () => {
      const client = createMockClient();
      // Return resources when listing NamedValues in workspace context
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.NamedValue) {
          yield { name: 'ws-nv-1', properties: {} };
        }
      };
      const store = createMockStore();
      const filter: FilterConfig = { workspaces: ['ws-1'] };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.workspaceName).toBe('ws-1');
      expect(results[0]?.resourceCount).toBeGreaterThan(0);
    });

    it('should extract multiple workspaces', async () => {
      const client = createMockClient();
      client.listResources = async function* () {};
      const store = createMockStore();
      const filter: FilterConfig = { workspaces: ['ws-1', 'ws-2'] };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(2);
      expect(results[0]?.workspaceName).toBe('ws-1');
      expect(results[1]?.workspaceName).toBe('ws-2');
    });

    it('should handle workspace extraction errors', async () => {
      const client = createMockClient();
      // eslint-disable-next-line require-yield
      client.listResources = async function* () {
        throw new Error('Workspace not found');
      };
      const store = createMockStore();
      const filter: FilterConfig = { workspaces: ['bad-ws'] };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.errorCount).toBeGreaterThan(0);
    });

    it('should count a missing workspace container as an error', async () => {
      const client = createMockClient();
      const store = createMockStore();

      const results = await extractWorkspaces(
        client, store, testContext, '/output', { workspaces: ['ws-1'] }
      );

      expect(results[0]?.errorCount).toBe(1);
    });

    it('should count workspace API supplemental failures', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx, type) {
        if (type === ResourceType.Api) {
          yield { name: 'ws-api', properties: {} };
        }
      };
      client.getResource = vi.fn().mockImplementation(async (_ctx, descriptor) =>
        descriptor.type === ResourceType.Workspace ? { name: 'ws-1', properties: {} } : undefined
      );
      client.getApiSpecification = vi.fn().mockRejectedValue(new Error('spec export failed'));
      const store = createMockStore();

      const results = await extractWorkspaces(
        client, store, testContext, '/output', { workspaces: ['ws-1'] }
      );

      expect(results[0]?.errorCount).toBe(1);
    });

    it('should count workspace product supplemental failures', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx, type) {
        if (type === ResourceType.Product) {
          yield { name: 'ws-product', properties: {} };
        } else if (type === ResourceType.ProductApi || type === ResourceType.ProductGroup) {
          throw new Error(`${type} list failed`);
        }
      };
      client.getResource = vi.fn().mockImplementation(async (_ctx, descriptor) => {
        if (descriptor.type === ResourceType.Workspace) {
          return { name: 'ws-1', properties: {} };
        }
        if (descriptor.type === ResourceType.ProductWiki) {
          throw new Error('wiki failed');
        }
        return undefined;
      });
      const store = createMockStore();

      const results = await extractWorkspaces(
        client, store, testContext, '/output', { workspaces: ['ws-1'] }
      );

      expect(results[0]?.errorCount).toBe(3);
    });

    it('should count workspace tag-link failures', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx, type) {
        if (type === ResourceType.Tag) {
          yield { name: 'tag-1', properties: {} };
        } else if (type === ResourceType.Api) {
          yield { name: 'api-1', properties: {} };
        } else if (type === ResourceType.ApiTag) {
          throw new Error('apiLinks failed');
        }
      };
      client.getResource = vi.fn().mockImplementation(async (_ctx, descriptor) =>
        descriptor.type === ResourceType.Workspace ? { name: 'ws-1', properties: {} } : undefined
      );
      const store = createMockStore();

      const results = await extractWorkspaces(
        client, store, testContext, '/output', { workspaces: ['ws-1'] }
      );

      expect(results[0]?.errorCount).toBe(1);
    });

    it('should count workspace product tag-link failures', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx, type) {
        if (type === ResourceType.Tag) {
          yield { name: 'tag-1', properties: {} };
        } else if (type === ResourceType.Product) {
          yield { name: 'product-1', properties: {} };
        } else if (type === ResourceType.ProductTag) {
          throw new Error('productLinks failed');
        }
      };
      client.getResource = vi.fn().mockImplementation(async (_ctx, descriptor) =>
        descriptor.type === ResourceType.Workspace ? { name: 'ws-1', properties: {} } : undefined
      );
      const store = createMockStore();

      const results = await extractWorkspaces(
        client, store, testContext, '/output', { workspaces: ['ws-1'] }
      );

      expect(results[0]?.errorCount).toBe(1);
    });

    it('should extract API sub-resources within workspace', async () => {
      const client = createMockClient();
      // Return APIs when listing in workspace context
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.Api) {
          yield { name: 'ws-api-1', properties: {} };
        }
      };
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();
      const filter: FilterConfig = { workspaces: ['ws-1'] };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.resourceCount).toBeGreaterThan(0);
      expect(results[0]?.workspaceName).toBe('ws-1');
    });

    it('should extract product resources within workspace', async () => {
      const client = createMockClient();
      // Return products when listing in workspace context
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.Product) {
          yield { name: 'ws-product', properties: {} };
        }
      };
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();
      const filter: FilterConfig = { workspaces: ['ws-1'] };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.resourceCount).toBeGreaterThan(0);
    });

    it('should apply workspace sub-filter to limit extracted resources', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.NamedValue) {
          yield { name: 'ws-nv-1', properties: {} };
          yield { name: 'ws-nv-2', properties: {} };
        }
      };
      const store = createMockStore();
      const filter: FilterConfig = {
        workspaces: ['ws-1'],
        workspaceSubFilters: {
          'ws-1': {
            namedValues: ['ws-nv-1'],
          },
        },
      };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(1);
      // Only ws-nv-1 should be extracted, ws-nv-2 should be filtered out
      expect(results[0]?.resourceCount).toBe(1);
    });

    it('should extract everything when workspace has no sub-filter', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.NamedValue) {
          yield { name: 'ws-nv-1', properties: {} };
          yield { name: 'ws-nv-2', properties: {} };
        }
      };
      const store = createMockStore();
      const filter: FilterConfig = {
        workspaces: ['ws-1'],
        // No workspaceSubFilters — extract everything in the workspace
      };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(1);
      // Both named values should be extracted
      expect(results[0]?.resourceCount).toBe(2);
    });

    it('should support wildcard patterns in workspace names', async () => {
      const client = createMockClient();
      // Discovery returns three workspaces
      const originalListResources = client.listResources;
      let firstCall = true;
      client.listResources = async function* (ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.Workspace && firstCall) {
          firstCall = false;
          yield { name: 'team-a-workspace', properties: {} };
          yield { name: 'team-b-workspace', properties: {} };
          yield { name: 'other-workspace', properties: {} };
          return;
        }
        yield* originalListResources(ctx, type);
      };
      const store = createMockStore();
      const filter: FilterConfig = { workspaces: ['team-*'] };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      // Only team-a-workspace and team-b-workspace should match
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.workspaceName).sort()).toEqual([
        'team-a-workspace',
        'team-b-workspace',
      ]);
    });

    it('should apply workspace exclusions with shared filter semantics', async () => {
      const client = createMockClient();
      client.listResources = async function* (
        _ctx: ApimServiceContext,
        type: ResourceType
      ) {
        if (type === ResourceType.Workspace) {
          yield { name: 'team-a', properties: {} };
          yield { name: 'team-b', properties: {} };
        }
      };
      const store = createMockStore();

      const results = await extractWorkspaces(
        client,
        store,
        testContext,
        '/output',
        { workspaces: ['!team-b'] }
      );

      expect(results.map((result) => result.workspaceName)).toEqual(['team-a']);
    });

    it('should apply exclusions after wildcard workspace inclusions', async () => {
      const client = createMockClient();
      client.listResources = async function* (
        _ctx: ApimServiceContext,
        type: ResourceType
      ) {
        if (type === ResourceType.Workspace) {
          yield { name: 'team-a', properties: {} };
          yield { name: 'team-b', properties: {} };
          yield { name: 'shared', properties: {} };
        }
      };
      const store = createMockStore();

      const results = await extractWorkspaces(
        client,
        store,
        testContext,
        '/output',
        { workspaces: ['team-*', '!team-b'] }
      );

      expect(results.map((result) => result.workspaceName)).toEqual(['team-a']);
    });

    it('should apply sub-filter with wildcard workspace name patterns', async () => {
      const client = createMockClient();
      let firstCall = true;
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.Workspace && firstCall) {
          firstCall = false;
          yield { name: 'team-a', properties: {} };
          return;
        }
        if (type === ResourceType.NamedValue) {
          yield { name: 'nv-1', properties: {} };
          yield { name: 'nv-2', properties: {} };
        }
      };
      const store = createMockStore();
      const filter: FilterConfig = {
        workspaces: ['team-*'],
        workspaceSubFilters: {
          'team-a': {
            namedValues: ['nv-1'],
          },
        },
      };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.workspaceName).toBe('team-a');
      // Only nv-1 should be extracted due to sub-filter
      expect(results[0]?.resourceCount).toBe(1);
    });

    it('should extract workspace policy fragment dependencies transitively', async () => {
      const client = createMockClient();
      client.listResources = async function* (
        _ctx: ApimServiceContext,
        type: ResourceType
      ) {
        if (type === ResourceType.PolicyFragment) {
          yield {
            name: 'shared-fragment',
            properties: {
              value: '<set-header name="key"><value>{{workspace-secret}}</value></set-header>',
            },
          };
        }
        if (type === ResourceType.Backend) {
          yield {
            name: 'workspace-pool',
            properties: {
              type: 'Pool',
              pool: {
                services: [{
                  id: '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/backends/service-member',
                }],
              },
            },
          };
        }
      };
      client.getResource.mockImplementation(async (_ctx, descriptor) => {
        if (descriptor.type === ResourceType.Workspace) {
          return { name: 'team-a', properties: {} };
        }
        if (
          descriptor.type === ResourceType.NamedValue &&
          descriptor.nameParts[0] === 'workspace-secret'
        ) {
          return { name: 'workspace-secret', properties: { secret: true, value: 'secret' } };
        }
        if (
          descriptor.type === ResourceType.Backend &&
          descriptor.nameParts[0] === 'service-member'
        ) {
          return { name: 'service-member', properties: {} };
        }
        return undefined;
      });
      const store = createMockStore();
      const filter: FilterConfig = {
        workspaces: ['team-a'],
        workspaceSubFilters: {
          'team-a': {
            backends: ['workspace-pool'],
            namedValues: [],
            policyFragments: ['shared-fragment'],
          },
        },
      };

      const results = await extractWorkspaces(
        client,
        store,
        testContext,
        '/output',
        filter,
        true
      );

      expect(results[0]?.resourceCount).toBe(4);
      expect(client.getResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.Backend,
          nameParts: ['service-member'],
          workspace: undefined,
        })
      );
      expect(store.writeResource).toHaveBeenCalledWith(
        '/output',
        expect.objectContaining({
          type: ResourceType.NamedValue,
          nameParts: ['workspace-secret'],
          workspace: 'team-a',
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            value: '*** REDACTED ***',
          }),
        })
      );
    });
  });

  describe('workspace dependency coverage', () => {
    const SERVICE = '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a';
    const wsContext = { ...testContext, baseUrl: `${testContext.baseUrl}/workspaces/team-a` };

    /** A store that keeps association files in memory so they can be read back. */
    function createAssociationStore() {
      const store = createMockStore();
      const associations = new Map<string, unknown[]>();
      const key = (descriptor: { nameParts: string[]; workspace?: string }, type: string) =>
        `${descriptor.workspace ?? ''}/${descriptor.nameParts.join('/')}/${type}`;
      store.writeAssociation.mockImplementation(async (_dir, descriptor, type, entries) => {
        associations.set(key(descriptor, type), entries);
      });
      store.readAssociation.mockImplementation(async (_dir, descriptor, type) =>
        associations.get(key(descriptor, type)) ?? []
      );
      return store;
    }

    it("should pull in an API diagnostic's logger, tags linked through any workspace tag, and a product's groups and tags", async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType, parent?: { nameParts: string[] }) {
        if (type === ResourceType.Api) yield { name: 'orders', properties: {} };
        if (type === ResourceType.Product) yield { name: 'starter', properties: {} };
        if (type === ResourceType.Tag) {
          yield { name: 'public', properties: {} };
          yield { name: 'internal', properties: {} };
        }
        if (type === ResourceType.ApiDiagnostic) {
          yield { name: 'applicationinsights', properties: { loggerId: `${SERVICE}/workspaces/team-a/loggers/ws-logger` } };
        }
        if (type === ResourceType.ApiTag && parent?.nameParts[0] === 'public') {
          yield { name: 'link-1', properties: { apiId: `${SERVICE}/workspaces/team-a/apis/orders` } };
        }
        if (type === ResourceType.ProductTag && parent?.nameParts[0] === 'internal') {
          yield { name: 'link-2', properties: { productId: `${SERVICE}/workspaces/team-a/products/starter` } };
        }
        if (type === ResourceType.ProductGroup) {
          yield { name: 'link-3', properties: { groupId: `${SERVICE}/groups/support-team` } };
        }
      };
      client.getResource.mockImplementation(async (_ctx, descriptor) => {
        if (descriptor.type === ResourceType.Workspace) return { name: 'team-a', properties: {} };
        if ([ResourceType.Logger, ResourceType.Tag, ResourceType.Group].includes(descriptor.type)) {
          return { name: descriptor.nameParts[0], properties: {} };
        }
        return undefined;
      });
      const store = createAssociationStore();
      const filter: FilterConfig = {
        workspaces: ['team-a'],
        workspaceSubFilters: {
          'team-a': { apis: ['orders'], products: ['starter'], tags: [], loggers: [], groups: [] },
        },
      };

      await extractWorkspaces(client, store, testContext, '/output', filter, true);

      const fetched = client.getResource.mock.calls.map(([ctx, d]) =>
        `${d.type}:${d.workspace ?? 'service'}:${d.nameParts.join('/')}@${ctx.baseUrl === wsContext.baseUrl ? 'workspace' : 'service'}`
      );
      expect(fetched).toEqual(expect.arrayContaining([
        'Logger:team-a:ws-logger@workspace',
        'Tag:team-a:public@workspace',
        'Tag:team-a:internal@workspace',
        'Group:service:support-team@service',
      ]));
      expect(store.writeResource).toHaveBeenCalledWith(
        '/output',
        expect.objectContaining({ type: ResourceType.ApiTag, nameParts: ['orders', 'public'], workspace: 'team-a' }),
        expect.anything()
      );
    });

    it('should fall back to the extracted tags, and report an error, when listing the workspace tags fails', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const client = createMockClient();
      let tagListings = 0;
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.Api) yield { name: 'orders', properties: {} };
        if (type === ResourceType.Tag && ++tagListings > 1) throw new Error('HTTP 503');
      };
      client.getResource.mockResolvedValue({ name: 'team-a', properties: {} });
      const filter: FilterConfig = {
        workspaces: ['team-a'],
        workspaceSubFilters: { 'team-a': { apis: ['orders'], tags: [] } },
      };

      const results = await extractWorkspaces(client, createAssociationStore(), testContext, '/output', filter, true);

      expect(results).toHaveLength(1);
      expect(results[0].errorCount).toBe(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to list tags in workspace "team-a"'));
      warn.mockRestore();
    });

    it('should not pull in dependencies the workspace or top-level filter excludes by name', async () => {
      const client = createMockClient();
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType, parent?: { nameParts: string[] }) {
        if (type === ResourceType.Api) yield { name: 'orders', properties: {} };
        if (type === ResourceType.Product) yield { name: 'starter', properties: {} };
        if (type === ResourceType.Tag) {
          yield { name: 'public', properties: {} };
          yield { name: 'internal', properties: {} };
        }
        if (type === ResourceType.ApiTag && parent) {
          yield { name: `link-${parent.nameParts[0]}`, properties: { apiId: `${SERVICE}/workspaces/team-a/apis/orders` } };
        }
        if (type === ResourceType.ProductGroup) {
          yield { name: 'link-a', properties: { groupId: `${SERVICE}/groups/partners` } };
          yield { name: 'link-b', properties: { groupId: `${SERVICE}/groups/support-team` } };
          yield { name: 'link-c', properties: { groupId: `${SERVICE}/workspaces/team-a/groups/developers` } };
        }
      };
      client.getResource.mockImplementation(async (_ctx, descriptor) => {
        if (descriptor.type === ResourceType.Workspace) return { name: 'team-a', properties: {} };
        if ([ResourceType.Tag, ResourceType.Group].includes(descriptor.type)) {
          return { name: descriptor.nameParts[0], properties: {} };
        }
        return undefined;
      });
      const filter: FilterConfig = {
        groups: ['!partners', '*'],
        workspaces: ['team-a'],
        workspaceSubFilters: {
          'team-a': { apis: ['orders'], products: ['starter'], tags: ['!internal', 'none'], groups: [] },
        },
      };

      await extractWorkspaces(client, createAssociationStore(), testContext, '/output', filter, true);

      const fetched = client.getResource.mock.calls
        .map(([, d]) => `${d.type}:${d.workspace ?? 'service'}:${d.nameParts.join('/')}`)
        .filter((key) => key.startsWith('Tag') || key.startsWith('Group'));
      expect(fetched.sort()).toEqual([
        'Group:service:support-team',
        // A workspace group named like a built-in group is a custom group.
        'Group:team-a:developers',
        'Tag:team-a:public',
      ]);
    });

    /**
     * A client whose workspaces each have product 'starter' linked to service
     * group 'support-team'. APIM refuses that link for a custom group; it
     * stands in for any service-level dependency a workspace can have.
     */
    function createSharedGroupClient(workspaces: string[]) {
      const client = createMockClient();
      client.listResources = async function* (ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.Workspace) {
          for (const name of workspaces) yield { name, properties: {} };
        }
        if (type === ResourceType.Product && ctx.baseUrl.includes('/workspaces/')) yield { name: 'starter', properties: {} };
        if (type === ResourceType.ProductGroup) {
          yield { name: 'link-1', properties: { groupId: `${SERVICE}/groups/support-team` } };
        }
      };
      client.getResource.mockImplementation(async (_ctx, descriptor) =>
        ({ name: descriptor.nameParts[0], properties: {} })
      );
      return client;
    }

    const groupGets = (client: ReturnType<typeof createMockClient>) =>
      client.getResource.mock.calls.filter(([, d]) => d.type === ResourceType.Group).length;

    /** A filter extracting product 'starter' from each workspace through a sub-filter. */
    const starterFilter = (workspaces: string[]): FilterConfig => ({
      groups: [],
      workspaces,
      workspaceSubFilters: Object.fromEntries(workspaces.map((name) => [name, { products: ['starter'] }])),
    });

    it('should not resolve dependencies in a workspace extracted without a sub-filter', async () => {
      const client = createSharedGroupClient(['team-a']);
      const filter: FilterConfig = { groups: ['partners'], workspaces: ['team-a'] };

      await extractWorkspaces(client, createAssociationStore(), testContext, '/output', filter, true);

      expect(groupGets(client)).toBe(0);
    });

    it('should fetch a service-level dependency once across workspaces', async () => {
      const client = createSharedGroupClient(['team-a', 'team-b']);
      const filter = starterFilter(['team-a', 'team-b']);

      const store = createAssociationStore();

      await extractWorkspaces(client, store, testContext, '/output', filter, true);

      expect(groupGets(client)).toBe(1);
      expect(store.writeResource.mock.calls.filter(([, d]) => d.type === ResourceType.Group)).toHaveLength(1);
    });

    it('should not fetch a service-level dependency the service extraction already wrote', async () => {
      const client = createSharedGroupClient(['team-a']);
      const filter = starterFilter(['team-a']);

      await extractWorkspaces(
        client, createAssociationStore(), testContext, '/output', filter, true,
        [{ type: ResourceType.Group, nameParts: ['support-team'] }]
      );

      expect(groupGets(client)).toBe(0);
    });

    it('should try a missing service-level dependency once across workspaces', async () => {
      const client = createSharedGroupClient(['team-a', 'team-b']);
      client.getResource.mockImplementation(async (_ctx, descriptor) =>
        descriptor.type === ResourceType.Group ? undefined : { name: descriptor.nameParts[0], properties: {} }
      );
      const filter = starterFilter(['team-a', 'team-b']);

      const results = await extractWorkspaces(client, createAssociationStore(), testContext, '/output', filter, true);

      expect(groupGets(client)).toBe(1);
      expect(results.map((ws) => ws.errorCount)).toEqual([1, 0]);
    });

    it.each([
      ['the tags filter only excludes by name', { apis: ['orders'], tags: ['!internal'] }],
      ['no APIs or products were extracted', { apis: [], products: [], tags: [] }],
      ['the tags filter includes every tag', { apis: ['orders'], tags: ['*', '!internal'] }],
      ['the tags key is left out, so every tag is included', { apis: ['orders'] }],
    ])('should not list the workspace tags again when %s', async (_case, subFilter) => {
      const client = createMockClient();
      let tagListings = 0;
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.Api) yield { name: 'orders', properties: {} };
        if (type === ResourceType.Tag) {
          tagListings++;
          yield { name: 'public', properties: {} };
        }
      };
      client.getResource.mockResolvedValue({ name: 'team-a', properties: {} });
      const filter: FilterConfig = { workspaces: ['team-a'], workspaceSubFilters: { 'team-a': subFilter } };

      await extractWorkspaces(client, createAssociationStore(), testContext, '/output', filter, true);

      expect(tagListings).toBe(1);
    });

    it('should only use extracted tags for links without transitive resolution', async () => {
      const client = createMockClient();
      const listed: ResourceType[] = [];
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        listed.push(type);
        if (type === ResourceType.Api) yield { name: 'orders', properties: {} };
      };
      client.getResource.mockResolvedValue({ name: 'team-a', properties: {} });
      const filter: FilterConfig = {
        workspaces: ['team-a'],
        workspaceSubFilters: { 'team-a': { apis: ['orders'], tags: [] } },
      };

      await extractWorkspaces(client, createAssociationStore(), testContext, '/output', filter, false);

      expect(listed).not.toContain(ResourceType.ApiTag);
    });
  });

  describe('resolveWorkspaceFilter', () => {
    it('should apply a sub-filter keyed by a pattern to every workspace it matches', () => {
      const filter: FilterConfig = {
        workspaces: ['team-*'],
        workspaceSubFilters: {
          'team-*': { apis: ['orders'], namedValues: [] },
          'team-b': { apis: ['billing'] },
          '!team-c': { apis: [] },
        },
      };

      expect(resolveWorkspaceFilter('team-a', filter)).toEqual(
        expect.objectContaining({ apis: ['orders'], namedValues: [] })
      );
      // A sub-filter keyed by the workspace's name takes precedence over a pattern.
      expect(resolveWorkspaceFilter('TEAM-B', filter)).toEqual(expect.objectContaining({ apis: ['billing'] }));
      // Exclusion keys never apply.
      expect(resolveWorkspaceFilter('team-c', filter)).toEqual(expect.objectContaining({ apis: ['orders'] }));
      expect(resolveWorkspaceFilter('platform', filter)).toBeUndefined();
    });

    it('should return undefined when no filter provided', () => {
      expect(resolveWorkspaceFilter('ws-1')).toBeUndefined();
    });

    it('should return undefined when no workspaceSubFilters', () => {
      const filter: FilterConfig = { workspaces: ['ws-1'] };
      expect(resolveWorkspaceFilter('ws-1', filter)).toBeUndefined();
    });

    it('should return undefined when workspace not in sub-filters', () => {
      const filter: FilterConfig = {
        workspaces: ['ws-1'],
        workspaceSubFilters: {
          'ws-2': { apis: ['api-1'] },
        },
      };
      expect(resolveWorkspaceFilter('ws-1', filter)).toBeUndefined();
    });

    it('should resolve workspace sub-filter case-insensitively', () => {
      const filter: FilterConfig = {
        workspaces: ['WS-1'],
        workspaceSubFilters: {
          'ws-1': { apis: ['api-1'], backends: ['backend-1'] },
        },
      };
      const result = resolveWorkspaceFilter('WS-1', filter);
      expect(result).toBeDefined();
      expect(result!.apis).toEqual(['api-1']);
      expect(result!.backends).toEqual(['backend-1']);
    });

    it('should convert all workspace sub-filter fields to FilterConfig', () => {
      const filter: FilterConfig = {
        workspaceSubFilters: {
          'ws-1': {
            apis: ['api-1'],
            backends: ['be-1'],
            diagnostics: ['diag-1'],
            groups: ['group-1'],
            loggers: ['logger-1'],
            namedValues: ['nv-1'],
            policyFragments: ['pf-1'],
            products: ['prod-1'],
            subscriptions: ['sub-1'],
            tags: ['tag-1'],
            versionSets: ['vs-1'],
          },
        },
      };
      const result = resolveWorkspaceFilter('ws-1', filter);
      expect(result).toBeDefined();
      expect(result!.apis).toEqual(['api-1']);
      expect(result!.backends).toEqual(['be-1']);
      expect(result!.diagnostics).toEqual(['diag-1']);
      expect(result!.groups).toEqual(['group-1']);
      expect(result!.loggers).toEqual(['logger-1']);
      expect(result!.namedValues).toEqual(['nv-1']);
      expect(result!.policyFragments).toEqual(['pf-1']);
      expect(result!.products).toEqual(['prod-1']);
      expect(result!.subscriptions).toEqual(['sub-1']);
      expect(result!.tags).toEqual(['tag-1']);
      expect(result!.versionSets).toEqual(['vs-1']);
    });
  });
});
