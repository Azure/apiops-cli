/**
 * Unit tests for T-CMP-10: compare-service.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { runCompare, CompareResult } from '../../../src/services/compare-service.js';
import { IApimClient } from '../../../src/clients/iapim-client.js';
import { CompareConfig } from '../../../src/models/config.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext } from '../../../src/models/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const srcCtx: ApimServiceContext = {
  subscriptionId: 'src-sub',
  resourceGroup: 'src-rg',
  serviceName: 'src-apim',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/src-sub/resourceGroups/src-rg/providers/Microsoft.ApiManagement/service/src-apim',
};

const tgtCtx: ApimServiceContext = {
  subscriptionId: 'tgt-sub',
  resourceGroup: 'tgt-rg',
  serviceName: 'tgt-apim',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/tgt-sub/resourceGroups/tgt-rg/providers/Microsoft.ApiManagement/service/tgt-apim',
};

const config: CompareConfig = {
  source: srcCtx,
  target: tgtCtx,
  logLevel: 'warn',
};

/**
 * Build a minimal IApimClient mock where listResources returns empty iterables
 * for all resource types (except those overridden in `overrides`).
 */
function makeClient(
  overrides: Partial<Record<ResourceType, Record<string, unknown>[]>> = {},
): IApimClient {
  async function* empty(): AsyncIterable<Record<string, unknown>> {}

  async function* items(arr: Record<string, unknown>[]): AsyncIterable<Record<string, unknown>> {
    for (const item of arr) yield item;
  }

  return {
    listResources: vi.fn(
      (_ctx: ApimServiceContext, type: ResourceType, _parent?: unknown) => {
        const override = overrides[type];
        if (override) return items(override);
        return empty();
      },
    ),
    getResource: vi.fn().mockResolvedValue(undefined),
    putResource: vi.fn().mockResolvedValue({}),
    deleteResource: vi.fn().mockResolvedValue(true),
    listApiRevisions: vi.fn(async function* () {}),
    getApiSpecification: vi.fn().mockResolvedValue(undefined),
  } as unknown as IApimClient;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runCompare', () => {
  it('returns exitCode=0 when both instances are empty', async () => {
    const client = makeClient();
    const result = await runCompare(client, config);
    expect(result.exitCode).toBe(0);
    expect(result.totalDiffs).toBe(0);
  });

  it('returns exitCode=1 when resource is missing in target', async () => {
    const nv = {
      id: '/namedValues/my-nv',
      properties: { displayName: 'My NV', secret: false },
    };
    const client = makeClient();

    // Override: source returns NV, target returns empty for all types
    const mockListResources = vi.fn(
      async function* (ctx: ApimServiceContext, type: ResourceType) {
        if (type === ResourceType.NamedValue && ctx.serviceName === 'src-apim') {
          yield nv;
        }
        // Target returns nothing for NamedValue (and empty for all other types)
      },
    );
    (client as unknown as { listResources: typeof mockListResources }).listResources = mockListResources;

    const result = await runCompare(client, config);
    expect(result.exitCode).toBe(1);
    expect(result.totalDiffs).toBeGreaterThan(0);
  });

  it('returns exitCode=0 when same resource exists in both instances', async () => {
    const nv = {
      id: '/subs/src-sub/rg/src-rg/providers/Microsoft.ApiManagement/service/src-apim/namedValues/my-nv',
      properties: { displayName: 'My NV', secret: false },
    };
    const tgtNv = {
      id: '/subs/tgt-sub/rg/tgt-rg/providers/Microsoft.ApiManagement/service/tgt-apim/namedValues/my-nv',
      properties: { displayName: 'My NV', secret: false },
    };
    const client = makeClient({
      [ResourceType.NamedValue]: [nv],
    });

    // Override listResources to return source items for source context and target items for target context
    const mockListResources = vi.fn(
      async function* (ctx: ApimServiceContext, _type: ResourceType) {
        if (ctx.serviceName === 'src-apim') yield nv;
        else yield tgtNv;
      },
    );
    (client as unknown as { listResources: typeof mockListResources }).listResources = mockListResources;

    const result = await runCompare(client, config);
    expect(result.exitCode).toBe(0);
    expect(result.totalDiffs).toBe(0);
  });

  it('skips built-in excluded resources (echo-api, administrators, starter, master)', async () => {
    const client = makeClient({
      [ResourceType.Group]: [
        { id: '/groups/administrators', properties: {} },
        { id: '/groups/developers', properties: {} },
        { id: '/groups/guests', properties: {} },
      ],
      [ResourceType.Product]: [
        { id: '/products/starter', properties: {} },
        { id: '/products/unlimited', properties: {} },
      ],
      [ResourceType.Subscription]: [
        { id: '/subscriptions/master', properties: {} },
      ],
      [ResourceType.Api]: [
        { id: '/apis/echo-api', properties: {} },
      ],
    });

    // All excluded resources → no diffs expected
    const result = await runCompare(client, config);
    expect(result.exitCode).toBe(0);
  });

  it('includes skippedTypes count when a resource type fetch fails', async () => {
    const client = makeClient();
    const originalListResources = client.listResources as ReturnType<typeof vi.fn>;

    // Make Named Values fail on source
    originalListResources.mockImplementation(
      (ctx: ApimServiceContext, type: ResourceType) => {
        if (type === ResourceType.NamedValue && ctx.serviceName === 'src-apim') {
          return Promise.reject(new Error('HTTP 403 Forbidden'));
        }
        return (async function* () {})();
      },
    );

    const result = await runCompare(client, config);
    expect(result.skippedTypes).toBeGreaterThan(0);
    const namedValueResult = result.typeResults.find((r) => r.label === 'Named Values');
    expect(namedValueResult?.skipped).toBe(true);
  });

  it('returns a typeResult entry for each expected top-level resource type', async () => {
    const client = makeClient();
    const result = await runCompare(client, config);
    const labels = result.typeResults.map((r) => r.label);
    expect(labels).toContain('Named Values');
    expect(labels).toContain('APIs');
    expect(labels).toContain('Products');
    expect(labels).toContain('Loggers');
    expect(labels).toContain('Gateways');
  });

  it('result structure has all expected fields', async () => {
    const client = makeClient();
    const result: CompareResult = await runCompare(client, config);
    expect(result).toHaveProperty('typeResults');
    expect(result).toHaveProperty('totalCompared');
    expect(result).toHaveProperty('totalDiffs');
    expect(result).toHaveProperty('skippedTypes');
    expect(result).toHaveProperty('exitCode');
    expect(Array.isArray(result.typeResults)).toBe(true);
  });
});
