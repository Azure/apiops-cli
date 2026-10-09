// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for transitive dependency extraction
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { extractTransitiveDependencies } from '../../../src/services/transitive-extractor.js';

const testContext: ApimServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apim-1',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

function createMockClient() {
  return {
    listResources: vi.fn(async function* (_ctx: ApimServiceContext, _type: ResourceType): AsyncGenerator<Record<string, unknown>> {}),
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

function policiesWith(...refs: string[]): Map<string, string> {
  const xml = refs.map((ref) => `<set-variable name="v" value="{{${ref}}}" />`).join('');
  return new Map([['api-1', `<policies><inbound>${xml}</inbound></policies>`]]);
}

function namedValueList(...entries: Array<{ name: string; displayName: string }>) {
  return vi.fn(async function* (_ctx: ApimServiceContext, type: ResourceType) {
    if (type === ResourceType.NamedValue) {
      for (const entry of entries) {
        yield { name: entry.name, properties: { displayName: entry.displayName } };
      }
    }
  });
}

describe('transitive-extractor', () => {
  describe('named value displayName resolution (#291)', () => {
    it('should resolve {{displayName}} to the resource name and extract under that name', async () => {
      const client = createMockClient();
      client.listResources = namedValueList({ name: 'nv-resource', displayName: 'nv_display' });
      client.getResource.mockImplementation(async (_ctx, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.NamedValue && descriptor.nameParts[0] === 'nv-resource') {
          return { name: 'nv-resource', properties: { displayName: 'nv_display', secret: false, value: 'x' } };
        }
        return undefined;
      });
      const store = createMockStore();

      const result = await extractTransitiveDependencies(
        client, store, testContext, '/output', policiesWith('nv_display'), new Map(), [], []
      );

      expect(result.errorCount).toBe(0);
      expect(result.extractedDescriptors).toEqual([
        expect.objectContaining({ type: ResourceType.NamedValue, nameParts: ['nv-resource'] }),
      ]);
      expect(client.getResource).not.toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ nameParts: ['nv_display'] })
      );
      expect(store.writeResource).toHaveBeenCalledWith(
        '/output',
        expect.objectContaining({ type: ResourceType.NamedValue, nameParts: ['nv-resource'] }),
        expect.objectContaining({ name: 'nv-resource' })
      );
    });

    it('should fall back to the reference as resource name when no displayName matches', async () => {
      const client = createMockClient();
      client.listResources = namedValueList({ name: 'other', displayName: 'other' });
      client.getResource.mockImplementation(async (_ctx, descriptor: ResourceDescriptor) => {
        if (descriptor.type === ResourceType.NamedValue && descriptor.nameParts[0] === 'plain-ref') {
          return { name: 'plain-ref', properties: { displayName: 'plain-ref' } };
        }
        return undefined;
      });
      const store = createMockStore();

      const result = await extractTransitiveDependencies(
        client, store, testContext, '/output', policiesWith('plain-ref'), new Map(), [], []
      );

      expect(result.errorCount).toBe(0);
      expect(result.extractedDescriptors).toEqual([
        expect.objectContaining({ type: ResourceType.NamedValue, nameParts: ['plain-ref'] }),
      ]);
    });

    it('should list named values once per context across multiple references', async () => {
      const client = createMockClient();
      client.listResources = namedValueList(
        { name: 'nv-a', displayName: 'A' },
        { name: 'nv-b', displayName: 'B' },
        { name: 'nv-c', displayName: 'C' },
      );
      client.getResource.mockImplementation(async (_ctx, descriptor: ResourceDescriptor) => ({
        name: descriptor.nameParts[0],
        properties: {},
      }));
      const store = createMockStore();

      const result = await extractTransitiveDependencies(
        client, store, testContext, '/output', policiesWith('A', 'B', 'C'), new Map(), [], []
      );

      expect(result.errorCount).toBe(0);
      expect(result.extractedDescriptors.map((d) => d.nameParts[0]).sort()).toEqual(['nv-a', 'nv-b', 'nv-c']);
      const namedValueLists = client.listResources.mock.calls.filter(
        ([, type]) => type === ResourceType.NamedValue
      );
      expect(namedValueLists).toHaveLength(1);
    });

    it('should extract each resolved resource when a resource name is also another display name', async () => {
      const client = createMockClient();
      client.listResources = namedValueList(
        { name: 'one', displayName: 'two' },
        { name: 'two', displayName: 'three' },
      );
      client.getResource.mockImplementation(async (_ctx, descriptor: ResourceDescriptor) => ({
        name: descriptor.nameParts[0],
        properties: {},
      }));
      const store = createMockStore();

      const result = await extractTransitiveDependencies(
        client, store, testContext, '/output', policiesWith('two', 'three'), new Map(), [], []
      );

      expect(result.errorCount).toBe(0);
      expect(result.extractedDescriptors.map((descriptor) => descriptor.nameParts[0]).sort()).toEqual([
        'one',
        'two',
      ]);
      expect(client.getResource).toHaveBeenCalledTimes(2);
    });

    it('should not re-extract or count an error when the resolved name was already extracted', async () => {
      const client = createMockClient();
      client.listResources = namedValueList({ name: 'nv-resource', displayName: 'nv_display' });
      const store = createMockStore();
      const alreadyExtracted: ResourceDescriptor[] = [
        { type: ResourceType.NamedValue, nameParts: ['nv-resource'] },
      ];

      const result = await extractTransitiveDependencies(
        client, store, testContext, '/output', policiesWith('nv_display'), new Map(), [], alreadyExtracted
      );

      expect(result.errorCount).toBe(0);
      expect(result.extractedDescriptors).toEqual([]);
      expect(client.getResource).not.toHaveBeenCalled();
      expect(store.writeResource).not.toHaveBeenCalled();
    });

    it('should fall back to the reference when listing named values fails', async () => {
      const client = createMockClient();
      // eslint-disable-next-line require-yield
      client.listResources = vi.fn(async function* (): AsyncGenerator<Record<string, unknown>> {
        throw new Error('403 Forbidden');
      });
      client.getResource.mockImplementation(async (_ctx, descriptor: ResourceDescriptor) => {
        if (descriptor.nameParts[0] === 'nv_display') {
          return { name: 'nv_display', properties: {} };
        }
        return undefined;
      });
      const store = createMockStore();

      const result = await extractTransitiveDependencies(
        client, store, testContext, '/output', policiesWith('nv_display'), new Map(), [], []
      );

      expect(result.errorCount).toBe(0);
      expect(result.extractedDescriptors).toEqual([
        expect.objectContaining({ type: ResourceType.NamedValue, nameParts: ['nv_display'] }),
      ]);
    });

    it('should resolve workspace-scoped references against the workspace context', async () => {
      const wsContext: ApimServiceContext = {
        ...testContext,
        baseUrl: `${testContext.baseUrl}/workspaces/team-a`,
      };
      const client = createMockClient();
      client.listResources = vi.fn(async function* (ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.NamedValue && ctx.baseUrl === wsContext.baseUrl) {
          yield { name: 'ws-nv', properties: { displayName: 'ws_display' } };
        }
      });
      client.getResource.mockImplementation(async (ctx: ApimServiceContext, descriptor: ResourceDescriptor) => {
        if (ctx.baseUrl === wsContext.baseUrl && descriptor.nameParts[0] === 'ws-nv') {
          return { name: 'ws-nv', properties: {} };
        }
        return undefined;
      });
      const store = createMockStore();

      const result = await extractTransitiveDependencies(
        client, store, wsContext, '/output', policiesWith('ws_display'), new Map(), [], [], 'team-a', testContext
      );

      expect(result.errorCount).toBe(0);
      expect(result.extractedDescriptors).toEqual([
        expect.objectContaining({ type: ResourceType.NamedValue, nameParts: ['ws-nv'], workspace: 'team-a' }),
      ]);
      expect(client.listResources).not.toHaveBeenCalledWith(testContext, ResourceType.NamedValue);
    });

    it('should count a missing dependency as an error', async () => {
      const client = createMockClient();
      const store = createMockStore();

      const result = await extractTransitiveDependencies(
        client, store, testContext, '/output', policiesWith('missing'), new Map(), [], []
      );

      expect(result.errorCount).toBe(1);
      expect(result.extractedDescriptors).toEqual([]);
    });
  });
});
