// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T027: Workspace-scoped extraction
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext } from '../../../src/models/types.js';
import { FilterConfig } from '../../../src/models/config.js';
import { extractWorkspaces } from '../../../src/services/workspace-extractor.js';

const testContext: ApimServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apim-1',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

function createMockClient() {
  return {
    listResources: async function* () {},
    getResource: vi.fn().mockResolvedValue(undefined),
    putResource: vi.fn(),
    deleteResource: vi.fn(),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn().mockResolvedValue(undefined),
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
      const filter: FilterConfig = { workspaceNames: ['ws-1'] };

      await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      const expectedCallSequence = [
        ResourceType.NamedValue,
        ResourceType.Tag,
        ResourceType.Backend,
        // Logger extraction preloads NamedValue display names for placeholder normalization.
        ResourceType.NamedValue,
        ResourceType.Logger,
        ResourceType.Group,
        ResourceType.Diagnostic,
        ResourceType.PolicyFragment,
        ResourceType.Product,
        ResourceType.Api,
        ResourceType.Subscription,
        ResourceType.GlobalSchema,
        ResourceType.Documentation,
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
      const filter: FilterConfig = { workspaceNames: [] };

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
      const filter: FilterConfig = { workspaceNames: ['ws-1'] };

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
      const filter: FilterConfig = { workspaceNames: ['ws-1', 'ws-2'] };

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
      const filter: FilterConfig = { workspaceNames: ['bad-ws'] };

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
      const filter: FilterConfig = { workspaceNames: ['ws-1'] };

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
      const filter: FilterConfig = { workspaceNames: ['ws-1'] };

      const results = await extractWorkspaces(
        client, store, testContext, '/output', filter
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.resourceCount).toBeGreaterThan(0);
    });
  });
});
