/**
 * Unit tests for T021: Resource type extractor
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { FilterConfig } from '../../../src/models/config.js';
import {
  extractResourceType,
  extractSingleResource,
  extractResourceName,
} from '../../../src/services/resource-extractor.js';
import {
  isSingletonType,
  isChildType,
} from '../../../src/lib/resource-path.js';

// Mock IApimClient
function createMockClient(resources: Record<string, unknown>[] = []) {
  return {
    listResources: async function* () {
      for (const r of resources) {
        yield r;
      }
    },
    getResource: vi.fn().mockResolvedValue(resources[0] ?? undefined),
    putResource: vi.fn(),
    deleteResource: vi.fn(),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock IArtifactStore
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

const testContext: ApimServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apim-1',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

describe('resource-extractor', () => {
  describe('extractResourceName', () => {
    it('should extract name from JSON', () => {
      expect(extractResourceName({ name: 'my-resource', id: '/path' })).toBe('my-resource');
    });

    it('should throw when name is missing', () => {
      expect(() => extractResourceName({ id: '/path' })).toThrow('missing required "name" field');
    });
  });

  describe('extractResourceType', () => {
    it('should extract all resources of a type', async () => {
      const client = createMockClient([
        { name: 'nv-1', properties: { value: 'v1' } },
        { name: 'nv-2', properties: { value: 'v2' } },
      ]);
      const store = createMockStore();

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.NamedValue, '/output'
      );

      expect(result.type).toBe(ResourceType.NamedValue);
      expect(result.totalCount).toBe(2);
      expect(result.extracted).toHaveLength(2);
      expect(result.errorCount).toBe(0);
      expect(store.writeResource).toHaveBeenCalledTimes(2);
    });

    it('should apply filter', async () => {
      const client = createMockClient([
        { name: 'nv-1', properties: {} },
        { name: 'nv-2', properties: {} },
      ]);
      const store = createMockStore();
      const filter: FilterConfig = { namedValueNames: ['nv-1'] };

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.NamedValue, '/output', filter
      );

      expect(result.totalCount).toBe(2);
      expect(result.extracted).toHaveLength(1);
      expect(result.extracted[0]?.descriptor.nameParts[0]).toBe('nv-1');
    });

    it('should redact secret named values', async () => {
      const client = createMockClient([
        { name: 'secret-nv', properties: { secret: true, value: 'hidden' } },
      ]);
      const store = createMockStore();

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.NamedValue, '/output'
      );

      expect(result.extracted).toHaveLength(1);
      const writtenJson = store.writeResource.mock.calls[0]?.[2] as Record<string, unknown>;
      const props = writtenJson?.properties as Record<string, unknown>;
      expect(props.value).toBe('*** REDACTED ***');
    });

    it('should handle errors gracefully', async () => {
      const client = {
        ...createMockClient(),
        // eslint-disable-next-line require-yield
        listResources: async function* () {
          throw new Error('Network error');
        },
      };
      const store = createMockStore();

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.Api, '/output'
      );

      expect(result.errorCount).toBeGreaterThan(0);
    });

    it('should set parent descriptor for child resources', async () => {
      const parentDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      const client = createMockClient([
        { name: 'op-1' },
      ]);
      const store = createMockStore();

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.ApiOperation, '/output', undefined, parentDescriptor
      );

      expect(result.extracted).toHaveLength(1);
      expect(result.extracted[0]?.descriptor.nameParts[0]).toBe('my-api');
      expect(result.extracted[0]?.descriptor.nameParts[1]).toBe('op-1');
    });

    it('should handle singleton child resources (ApiPolicy)', async () => {
      // ApiPolicy has armPathSuffix 'apis/{0}/policies/policy' with 1 placeholder.
      // When parent.nameParts.length (1) >= placeholderCount (1), it's a singleton:
      // nameParts should be same as parent (no own name added).
      const parentDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      const client = createMockClient([
        { name: 'policy' },
      ]);
      const store = createMockStore();

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.ApiPolicy, '/output', undefined, parentDescriptor
      );

      expect(result.extracted).toHaveLength(1);
      // Singleton: nameParts should equal parent's nameParts
      expect(result.extracted[0]?.descriptor.nameParts).toEqual(['my-api']);
    });

    it('should produce nameParts=[] for zero-placeholder top-level singletons (ServicePolicy)', async () => {
      // ServicePolicy has armPathSuffix 'policies/policy' with 0 placeholders and no parent.
      // The buildDescriptor path is: no parent + placeholderCount===0 → nameParts = []
      const client = createMockClient([
        { name: 'policy' },
      ]);
      const store = createMockStore();

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.ServicePolicy, '/output'
      );

      expect(result.extracted).toHaveLength(1);
      // Zero-placeholder top-level type: nameParts must be empty
      expect(result.extracted[0]?.descriptor.nameParts).toEqual([]);
      expect(result.extracted[0]?.descriptor.type).toBe(ResourceType.ServicePolicy);
    });

    it('should pass workspace parameter to descriptor', async () => {
      const client = createMockClient([
        { name: 'nv-1', properties: {} },
      ]);
      const store = createMockStore();

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.NamedValue, '/output', undefined, undefined, 'ws-dev'
      );

      expect(result.extracted).toHaveLength(1);
      expect(result.extracted[0]?.descriptor.workspace).toBe('ws-dev');
    });

    it('should continue extraction when writeResource fails for one item', async () => {
      const client = createMockClient([
        { name: 'nv-1', properties: {} },
        { name: 'nv-2', properties: {} },
        { name: 'nv-3', properties: {} },
      ]);
      const store = createMockStore();
      // Make writeResource fail for the second item
      store.writeResource.mockImplementation(async (_dir: string, descriptor: ResourceDescriptor) => {
        if (descriptor.nameParts[0] === 'nv-2') {
          throw new Error('Disk write error');
        }
      });

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.NamedValue, '/output'
      );

      expect(result.totalCount).toBe(3);
      expect(result.extracted).toHaveLength(3);
      expect(result.errorCount).toBe(1);
      // First and third should succeed
      expect(result.extracted[0]?.status).toBe('success');
      expect(result.extracted[1]?.status).toBe('error');
      expect(result.extracted[1]?.error).toContain('Disk write error');
      expect(result.extracted[2]?.status).toBe('success');
    });

    it('should issue an individual GET for ApiSchema to capture properties.document', async () => {
      // APIM's ApiSchema list response omits `properties.document` (the SDL /
      // XSD / JSON schema body). The per-resource GET returns the full
      // payload, which publish needs for round-trip.
      const parentDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['gql-api'],
      };
      const listItem = {
        name: 'graphql',
        properties: { contentType: 'application/vnd.ms-azure-apim.graphql.schema' },
      };
      const fullItem = {
        name: 'graphql',
        properties: {
          contentType: 'application/vnd.ms-azure-apim.graphql.schema',
          document: { value: 'type Query { hello: String }' },
        },
      };
      const client = createMockClient([listItem]);
      client.getResource = vi.fn().mockResolvedValue(fullItem);
      const store = createMockStore();

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.ApiSchema, '/output', undefined, parentDescriptor
      );

      expect(result.extracted).toHaveLength(1);
      expect(client.getResource).toHaveBeenCalledOnce();
      const writtenJson = store.writeResource.mock.calls[0]?.[2] as Record<string, unknown>;
      const props = writtenJson.properties as Record<string, unknown>;
      const document = props.document as Record<string, unknown>;
      expect(document.value).toBe('type Query { hello: String }');
    });

    it('should fall back to list payload for ApiSchema when GET returns undefined', async () => {
      const parentDescriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['gql-api'],
      };
      const listItem = { name: 'graphql', properties: { contentType: 'graphql' } };
      const client = createMockClient([listItem]);
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();

      const result = await extractResourceType(
        client, store, testContext,
        ResourceType.ApiSchema, '/output', undefined, parentDescriptor
      );

      expect(result.extracted).toHaveLength(1);
      expect(result.errorCount).toBe(0);
      const writtenJson = store.writeResource.mock.calls[0]?.[2] as Record<string, unknown>;
      expect((writtenJson.properties as Record<string, unknown>).contentType).toBe('graphql');
    });

    it('should NOT issue an extra GET for non-ApiSchema resource types', async () => {
      const client = createMockClient([
        { name: 'nv-1', properties: { value: 'v1' } },
      ]);
      const store = createMockStore();

      await extractResourceType(
        client, store, testContext,
        ResourceType.NamedValue, '/output'
      );

      expect(client.getResource).not.toHaveBeenCalled();
    });
  });

  describe('extractSingleResource', () => {
    it('should extract a single resource', async () => {
      const json = { name: 'my-api', properties: { displayName: 'My API' } };
      const client = createMockClient([json]);
      const store = createMockStore();
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };

      const result = await extractSingleResource(
        client, store, testContext, descriptor, '/output'
      );

      expect(result.status).toBe('success');
      expect(store.writeResource).toHaveBeenCalledOnce();
    });

    it('should handle not found', async () => {
      const client = createMockClient();
      client.getResource = vi.fn().mockResolvedValue(undefined);
      const store = createMockStore();
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['missing-api'],
      };

      const result = await extractSingleResource(
        client, store, testContext, descriptor, '/output'
      );

      expect(result.status).toBe('error');
      expect(result.error).toContain('not found');
    });
  });

  describe('isSingletonType', () => {
    it('should identify singleton types', () => {
      expect(isSingletonType(ResourceType.ServicePolicy)).toBe(true);
      expect(isSingletonType(ResourceType.ApiWiki)).toBe(true);
      expect(isSingletonType(ResourceType.ProductWiki)).toBe(true);
    });

    it('should return false for non-singleton types', () => {
      expect(isSingletonType(ResourceType.Api)).toBe(false);
      expect(isSingletonType(ResourceType.NamedValue)).toBe(false);
    });
  });

  describe('isChildType', () => {
    it('should identify child types', () => {
      expect(isChildType(ResourceType.ApiPolicy)).toBe(true);
      expect(isChildType(ResourceType.ApiOperation)).toBe(true);
      expect(isChildType(ResourceType.ProductApi)).toBe(true);
    });

    it('should return false for top-level types', () => {
      expect(isChildType(ResourceType.Api)).toBe(false);
      expect(isChildType(ResourceType.NamedValue)).toBe(false);
      expect(isChildType(ResourceType.ServicePolicy)).toBe(false);
    });
  });
});
