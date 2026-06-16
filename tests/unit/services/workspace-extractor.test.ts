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
      const listedTypes: ResourceType[] = [];
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType) {
        listedTypes.push(type);
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
  });

  describe('resolveWorkspaceFilter', () => {
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
