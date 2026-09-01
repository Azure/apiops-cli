// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for delete-unmatched env-namespace scoping (T7)
 *
 * Verifies that computeDeleteActions correctly restricts deletions to the
 * current env's namespace when config.envMapping is present, and falls back to
 * the original behaviour when it is absent.
 */

import { describe, it, expect, vi } from 'vitest';
import { computeDeleteActions } from '../../../src/services/delete-unmatched-service.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import type { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import type { PublishConfig } from '../../../src/models/config.js';
import type { EnvMapping } from '../../../src/services/env-mapper.js';
import { LogLevel } from '../../../src/lib/logger.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function createMockClient(
  apimResources: Map<ResourceType, Record<string, unknown>[]> = new Map()
) {
  return {
    listResources: async function* (ctx: ApimServiceContext, type: ResourceType) {
      const resources = apimResources.get(type) ?? [];
      for (const resource of resources) {
        yield resource;
      }
    },
    getResource: vi.fn(),
    putResource: vi.fn(),
    deleteResource: vi.fn(),
    patchResource: vi.fn().mockResolvedValue(undefined),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn(),
    validatePreFlight: vi.fn().mockResolvedValue(undefined),
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
  serviceName: 'apim-shared',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-shared',
};

/** Config with NO envMapping — exercises original code path. */
const baseConfig: PublishConfig = {
  service: testContext,
  sourceDir: '/source',
  dryRun: false,
  deleteUnmatched: true,
  logLevel: LogLevel.INFO,
};

/** A mapping for the "dev" environment: prefix `dev-`, all default types. */
const devMapping: EnvMapping = {
  prefix: 'dev-',
  suffix: '',
  appliesTo: new Set([
    ResourceType.Api,
    ResourceType.Product,
    ResourceType.NamedValue,
    ResourceType.Backend,
    ResourceType.Logger,
    ResourceType.PolicyFragment,
    ResourceType.VersionSet,
    ResourceType.Tag,
    ResourceType.Group,
    ResourceType.Subscription,
    ResourceType.Workspace,
  ]),
};

function devConfig(overrides?: Partial<PublishConfig>): PublishConfig {
  return { ...baseConfig, envMapping: devMapping, ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('delete-unmatched env-namespace scoping', () => {
  describe('no envMapping → original behaviour (regression)', () => {
    it('deletes resources missing from local artifacts', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Api, [
          { name: 'foo', id: '/apis/foo' },
          { name: 'bar', id: '/apis/bar' },
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([
        { type: ResourceType.Api, nameParts: ['foo'] },
      ]);

      const result = await computeDeleteActions(client, store, testContext, baseConfig);

      const names = result.map((d) => d.nameParts[0]);
      expect(names).not.toContain('foo');
      expect(names).toContain('bar');
    });

    it('does not delete built-in groups', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Group, [
          { name: 'administrators' },
          { name: 'custom-group' },
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([]);

      const result = await computeDeleteActions(client, store, testContext, baseConfig);
      const names = result.map((d) => d.nameParts[0]);
      expect(names).not.toContain('administrators');
      expect(names).toContain('custom-group');
    });
  });

  describe('envMapping present — namespace scoping', () => {
    it('deletes dev-foo but skips prod-foo when local artifacts are empty', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Api, [
          { name: 'dev-foo' },
          { name: 'prod-foo' },
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([]); // no local APIs

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const apiNames = result.filter((d) => d.type === ResourceType.Api).map((d) => d.nameParts[0]);
      expect(apiNames).toContain('dev-foo');
      expect(apiNames).not.toContain('prod-foo');
    });

    it('does NOT delete dev-foo when canonical foo is in local artifacts', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Api, [{ name: 'dev-foo' }]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([
        { type: ResourceType.Api, nameParts: ['foo'] }, // canonical local artifact
      ]);

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const apiNames = result.filter((d) => d.type === ResourceType.Api).map((d) => d.nameParts[0]);
      expect(apiNames).not.toContain('dev-foo');
    });

    it('deletes dev-bar (in namespace, canonical bar absent) using deployed name', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Api, [
          { name: 'dev-foo' }, // canonical foo → in local → not deleted
          { name: 'dev-bar' }, // canonical bar → not in local → deleted
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([
        { type: ResourceType.Api, nameParts: ['foo'] },
      ]);

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const apiResults = result.filter((d) => d.type === ResourceType.Api);
      expect(apiResults).toHaveLength(1);
      // Delete descriptor must carry the deployed name so the APIM client deletes the right resource.
      expect(apiResults[0]?.nameParts[0]).toBe('dev-bar');
    });

    it('type not in appliesTo (Diagnostic) — treated as today (no namespace filter)', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Diagnostic, [
          { name: 'applicationinsights' }, // Diagnostic ∉ devMapping.appliesTo
          { name: 'azuremonitor' },
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([
        { type: ResourceType.Diagnostic, nameParts: ['applicationinsights'] },
      ]);

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const diagNames = result
        .filter((d) => d.type === ResourceType.Diagnostic)
        .map((d) => d.nameParts[0]);
      // applicationinsights is in local → NOT deleted; azuremonitor is absent → deleted
      expect(diagNames).not.toContain('applicationinsights');
      expect(diagNames).toContain('azuremonitor');
    });

    it('ProductApi: skips when canonical parent+child match local (canonical match)', async () => {
      // APIM lists product dev-starter with API dev-foo
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.ProductApi, [
          { nameParts: ['dev-starter', 'dev-foo'] },
        ]],
      ]);
      const client = createMockClient(apimResources);
      // Local artifacts store canonical names: starter + foo
      const store = createMockStore([
        { type: ResourceType.ProductApi, nameParts: ['starter', 'foo'] },
      ]);

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const productApiResults = result.filter((d) => d.type === ResourceType.ProductApi);
      expect(productApiResults).toHaveLength(0);
    });

    it('ProductApi: deletes deployed nameParts when child differs from local', async () => {
      // APIM: dev-starter/dev-baz; local only has starter/foo
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.ProductApi, [
          { nameParts: ['dev-starter', 'dev-baz'] },
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([
        { type: ResourceType.ProductApi, nameParts: ['starter', 'foo'] },
      ]);

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const productApiResults = result.filter((d) => d.type === ResourceType.ProductApi);
      expect(productApiResults).toHaveLength(1);
      // Deployed nameParts must be used so the right resource is deleted in APIM
      expect(productApiResults[0]?.nameParts).toEqual(['dev-starter', 'dev-baz']);
    });

    it('ProductApi: skips prod-starter/prod-baz (parent outside env namespace)', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.ProductApi, [
          { nameParts: ['prod-starter', 'prod-baz'] },
          { nameParts: ['dev-starter', 'dev-baz'] },
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([]); // no local artifacts → all in-namespace resources would be deleted

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const productApiResults = result.filter((d) => d.type === ResourceType.ProductApi);
      const parents = productApiResults.map((d) => d.nameParts[0]);
      expect(parents).not.toContain('prod-starter');
      expect(parents).toContain('dev-starter');
    });

    it('built-in group administrators never deleted even under env mapping', async () => {
      // administrators has no dev- prefix — it is either outside namespace (skipped)
      // or caught by the system-resource guard if Group ∉ appliesTo.
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Group, [
          { name: 'administrators' },
          { name: 'dev-custom-group' },
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([]); // no local groups

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const groupNames = result.filter((d) => d.type === ResourceType.Group).map((d) => d.nameParts[0]);
      expect(groupNames).not.toContain('administrators');
      expect(groupNames).toContain('dev-custom-group');
    });

    it('system API echo-api (prefixed as dev-echo-api) never deleted', async () => {
      // With env mapping: canonical of dev-echo-api is echo-api → system resource → skipped
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Api, [
          { name: 'dev-echo-api' },
          { name: 'dev-my-api' },
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([]); // no local APIs

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const apiNames = result.filter((d) => d.type === ResourceType.Api).map((d) => d.nameParts[0]);
      expect(apiNames).not.toContain('dev-echo-api');
      expect(apiNames).toContain('dev-my-api');
    });

    it('mixed env listing: multiple resource types scoped correctly', async () => {
      const apimResources = new Map<ResourceType, Record<string, unknown>[]>([
        [ResourceType.Api, [
          { name: 'dev-foo' },
          { name: 'prod-bar' },
        ]],
        [ResourceType.Tag, [
          { name: 'dev-tag1' },
          { name: 'qa-tag2' },
        ]],
      ]);
      const client = createMockClient(apimResources);
      const store = createMockStore([]);

      const result = await computeDeleteActions(client, store, testContext, devConfig());

      const names = result.map((d) => d.nameParts[0]);
      expect(names).toContain('dev-foo');
      expect(names).toContain('dev-tag1');
      expect(names).not.toContain('prod-bar');
      expect(names).not.toContain('qa-tag2');
    });
  });
});
