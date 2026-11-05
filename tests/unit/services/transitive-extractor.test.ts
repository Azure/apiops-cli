// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for transitive dependency extraction
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { extractTransitiveDependencies } from '../../../src/services/transitive-extractor.js';
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

    it('should not follow a reference that is only a resource name, as APIM does not', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const client = createMockClient();
      client.listResources = namedValueList({ name: 'plain-ref', displayName: 'Plain_Ref' });
      client.getResource.mockResolvedValue({ name: 'plain-ref', properties: { displayName: 'Plain_Ref' } });

      const result = await extractTransitiveDependencies(
        client, createMockStore(), testContext, '/output', policiesWith('plain-ref'), new Map(), [], []
      );

      expect(result.errorCount).toBe(0);
      expect(result.extractedDescriptors).toEqual([]);
      expect(client.getResource).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('{{plain-ref}}'));
      warn.mockRestore();
    });

    it('should match a display name ignoring case', async () => {
      const client = createMockClient();
      client.listResources = namedValueList({ name: 'foo', displayName: 'Something' });
      client.getResource.mockResolvedValue({ properties: { value: 'x' } });

      await extractTransitiveDependencies(client, createMockStore(), testContext, '/out', policiesWith('SOMETHING'), new Map(), [], []);

      expect(client.getResource.mock.calls.map((call) => call[1].nameParts)).toEqual([['foo']]);
    });

    it("should extract a named value whose display name is an extracted named value's name", async () => {
      // `one` has the display name `two`, so {{two}} is `one`, not the
      // selected `two`.
      const client = createMockClient();
      client.listResources = namedValueList({ name: 'one', displayName: 'two' }, { name: 'two', displayName: 'three' });
      client.getResource.mockResolvedValue({ name: 'one', properties: { displayName: 'two' } });
      const two = { type: ResourceType.NamedValue, nameParts: ['two'] };

      const result = await extractTransitiveDependencies(
        client, createMockStore(), testContext, '/output', policiesWith('two'), new Map(), [], [two]
      );

      expect(result.extractedDescriptors).toEqual([
        expect.objectContaining({ type: ResourceType.NamedValue, nameParts: ['one'] }),
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
      client.listResources = namedValueList({ name: 'missing', displayName: 'missing' });
      const store = createMockStore();

      const result = await extractTransitiveDependencies(
        client, store, testContext, '/output', policiesWith('missing'), new Map(), [], []
      );

      expect(result.errorCount).toBe(1);
      expect(result.extractedDescriptors).toEqual([]);
    });
  });
});

describe('extractTransitiveDependencies with Liquid bodies', () => {
  it('should extract a named value a Liquid body references and skip Liquid output without an error', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const client = createMockClient();
    client.listResources = namedValueList({ name: 'backend-id', displayName: 'demo-backend-id' });
    client.getResource.mockImplementation(async (_ctx: ApimServiceContext, descriptor: ResourceDescriptor) =>
      descriptor.type === ResourceType.NamedValue && descriptor.nameParts[0] === 'backend-id'
        ? { name: 'backend-id', properties: { displayName: 'demo-backend-id', value: 'function-backend' } }
        : undefined
    );
    const store = createMockStore();
    const policies = new Map([[
      'api:liquid-test:policy:0',
      '<policies><inbound><return-response><set-body template="liquid">nv=[{{demo-backend-id}}] liquid=[{{body.id}}] spaced=[{{ context.Request.Url }}]</set-body></return-response></inbound></policies>',
    ]]);

    const result = await extractTransitiveDependencies(client, store, testContext, '/out', policies, new Map(), [], []);

    const fetched = client.getResource.mock.calls.map((call) => `${call[1].type}:${call[1].nameParts.join('/')}`);
    expect(fetched).toEqual(['NamedValue:backend-id']);
    expect(result.errorCount).toBe(0);
    expect(result.extractedDescriptors.map((d) => d.nameParts[0])).toEqual(['backend-id']);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('should report an error when the named values for a Liquid body cannot be listed', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const client = createMockClient();
    // eslint-disable-next-line require-yield
    client.listResources = async function* () {
      throw new Error('HTTP 503');
    };
    const policies = new Map([['api:orders:policy:0', '<set-body template="liquid">{{demo-backend-id}}</set-body>']]);

    try {
      const result = await extractTransitiveDependencies(client, createMockStore(), testContext, '/out', policies, new Map(), [], []);

      expect(result.errorCount).toBe(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unable to tell which {{...}} in Liquid bodies are named values'));
    } finally {
      warn.mockRestore();
    }
  });

  it("should follow a Liquid {{name}} in a fragment extracted in a later round", async () => {
    const client = createMockClient();
    client.listResources = namedValueList({ name: 'frag-nv', displayName: 'frag-nv' });
    client.getResource.mockImplementation(async (_ctx: ApimServiceContext, descriptor: ResourceDescriptor) =>
      descriptor.type === ResourceType.PolicyFragment
        ? { properties: { value: '<fragment><set-body template="liquid">{{frag-nv}} {{body.id}}</set-body></fragment>' } }
        : { properties: { value: 'x' } }
    );
    const policies = new Map([['api:orders:policy:0', '<policies><inbound><include-fragment fragment-id="route" /></inbound></policies>']]);

    const result = await extractTransitiveDependencies(client, createMockStore(), testContext, '/out', policies, new Map(), [], []);

    expect(client.getResource.mock.calls.map((call) => `${call[1].type}:${call[1].nameParts.join('/')}`)).toEqual([
      'PolicyFragment:route',
      'NamedValue:frag-nv',
    ]);
    expect(result.errorCount).toBe(0);
  });

  it('should look a Liquid {{name}} up in the workspace being extracted', async () => {
    const client = createMockClient();
    const workspaceContext = { ...testContext, baseUrl: `${testContext.baseUrl}/workspaces/team-a` };
    client.listResources = vi.fn(async function* (ctx: ApimServiceContext, type: ResourceType) {
      if (type === ResourceType.NamedValue && ctx.baseUrl === workspaceContext.baseUrl) {
        yield { name: 'ws-key', properties: { displayName: 'ws-key' } };
      }
    });
    client.getResource.mockResolvedValue({ properties: { value: 'x' } });
    const policies = new Map([['api:orders:policy:0', '<set-body template="liquid">{{ws-key}}</set-body>']]);

    await extractTransitiveDependencies(
      client, createMockStore(), workspaceContext, '/out', policies, new Map(), [], [], 'team-a', testContext
    );

    expect(client.getResource.mock.calls.map((call) => call[1])).toEqual([
      { type: ResourceType.NamedValue, nameParts: ['ws-key'], workspace: 'team-a' },
    ]);
  });
});
