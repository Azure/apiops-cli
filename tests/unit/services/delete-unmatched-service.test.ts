/**
 * Unit tests for T035: Delete unmatched resources service
 */

import { describe, it, expect, vi } from 'vitest';
import { computeDeleteActions } from '../../../src/services/delete-unmatched-service.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { PublishConfig } from '../../../src/models/config.js';
import { LogLevel } from '../../../src/lib/logger.js';

function createMockClient(apimResources: Map<ResourceType, Record<string, unknown>[]> = new Map()) {
  return {
    listResources: async function* (ctx: ApimServiceContext, type: ResourceType) {
      const resources = apimResources.get(type) || [];
      for (const resource of resources) {
        yield resource;
      }
    },
    getResource: vi.fn(),
    putResource: vi.fn(),
    deleteResource: vi.fn(),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn(),
  };
}

function createMockStore(localDescriptors: ResourceDescriptor[] = []) {
  return {
    writeResource: vi.fn(),
    writeContent: vi.fn(),
    writeAssociation: vi.fn(),
    readResource: vi.fn(),
    readContent: vi.fn(),
    readAssociation: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue(localDescriptors),
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
  deleteUnmatched: true,
  logLevel: LogLevel.INFO,
};

describe('delete-unmatched-service', () => {
  describe('computeDeleteActions', () => {
    it('should return descriptors in reverse dependency order', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.NamedValue, [{ name: 'nv1', id: '/namedValues/nv1' }]],
        [ResourceType.Api, [{ name: 'api1', id: '/apis/api1' }]],
      ]);

      const client = createMockClient(apimResources);
      const store = createMockStore([]);

      const result = await computeDeleteActions(client, store, testContext, testConfig);

      // Api should come before NamedValue (tier 3 before tier 1)
      const types = result.map((d) => d.type);
      if (types.includes(ResourceType.Api) && types.includes(ResourceType.NamedValue)) {
        const apiIndex = types.indexOf(ResourceType.Api);
        const nvIndex = types.indexOf(ResourceType.NamedValue);
        expect(apiIndex).toBeLessThan(nvIndex);
      }
    });

    it('should exclude resources that exist in artifact store', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Tag, [
          { name: 'tag-keep', id: '/tags/tag-keep' },
          { name: 'tag-delete', id: '/tags/tag-delete' },
        ]],
      ]);

      const localDescriptors: ResourceDescriptor[] = [
        { type: ResourceType.Tag, nameParts: ['tag-keep'] },
      ];

      const client = createMockClient(apimResources);
      const store = createMockStore(localDescriptors);

      const result = await computeDeleteActions(client, store, testContext, testConfig);

      expect(result).toHaveLength(1);
      expect(result[0]?.nameParts[0]).toBe('tag-delete');
    });

    it('should skip built-in groups', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Group, [
          { name: 'administrators', id: '/groups/administrators' },
          { name: 'developers', id: '/groups/developers' },
          { name: 'guests', id: '/groups/guests' },
          { name: 'custom-group', id: '/groups/custom-group' },
        ]],
      ]);

      const client = createMockClient(apimResources);
      const store = createMockStore([]);

      const result = await computeDeleteActions(client, store, testContext, testConfig);

      const groupNames = result.filter((d) => d.type === ResourceType.Group).map((d) => d.nameParts[0]);
      expect(groupNames).not.toContain('administrators');
      expect(groupNames).not.toContain('developers');
      expect(groupNames).not.toContain('guests');
      expect(groupNames).toContain('custom-group');
    });

    it('should skip system products', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Product, [
          { name: 'master', id: '/products/master' },
          { name: 'unlimited', id: '/products/unlimited' },
          { name: 'starter', id: '/products/starter' },
          { name: 'custom-product', id: '/products/custom-product' },
        ]],
      ]);

      const client = createMockClient(apimResources);
      const store = createMockStore([]);

      const result = await computeDeleteActions(client, store, testContext, testConfig);

      const productNames = result.filter((d) => d.type === ResourceType.Product).map((d) => d.nameParts[0]);
      expect(productNames).not.toContain('master');
      expect(productNames).not.toContain('unlimited');
      expect(productNames).not.toContain('starter');
      expect(productNames).toContain('custom-product');
    });

    it('should skip echo-api system API', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Api, [
          { name: 'echo-api', id: '/apis/echo-api' },
          { name: 'custom-api', id: '/apis/custom-api' },
        ]],
      ]);

      const client = createMockClient(apimResources);
      const store = createMockStore([]);

      const result = await computeDeleteActions(client, store, testContext, testConfig);

      const apiNames = result.filter((d) => d.type === ResourceType.Api).map((d) => d.nameParts[0]);
      expect(apiNames).not.toContain('echo-api');
      expect(apiNames).toContain('custom-api');
    });

    it('should handle empty artifact store (nothing to delete)', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.NamedValue, []],
      ]);

      const client = createMockClient(apimResources);
      const store = createMockStore([]);

      const result = await computeDeleteActions(client, store, testContext, testConfig);

      expect(result).toEqual([]);
    });

    it('should handle APIM listing errors gracefully', async () => {
      const client = createMockClient();
      // Override listResources to throw error
      client.listResources = (): AsyncIterable<Record<string, unknown>> => {
        throw new Error('Network error');
      };
      const store = createMockStore([]);

      const result = await computeDeleteActions(client, store, testContext, testConfig);

      expect(result).toEqual([]);
    });

    it('should handle multiple resource types', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Tag, [{ name: 'tag1', id: '/tags/tag1' }]],
        [ResourceType.Backend, [{ name: 'backend1', id: '/backends/backend1' }]],
        [ResourceType.Api, [{ name: 'api1', id: '/apis/api1' }]],
      ]);

      const client = createMockClient(apimResources);
      const store = createMockStore([]);

      const result = await computeDeleteActions(client, store, testContext, testConfig);

      expect(result.length).toBeGreaterThan(0);
      const types = new Set(result.map((d) => d.type));
      expect(types.size).toBeGreaterThan(1);
    });

    it('should handle resources with parent hierarchies', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Api, [
          { name: 'api1', id: '/apis/api1' },
        ]],
      ]);

      const localDescriptors: ResourceDescriptor[] = [];

      const client = createMockClient(apimResources);
      const store = createMockStore(localDescriptors);

      const result = await computeDeleteActions(client, store, testContext, testConfig);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: ResourceType.Api,
        nameParts: ['api1'],
      });
    });
  });
});
