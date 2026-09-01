// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Dry-run reporter service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateDryRunReport } from '../../../src/services/dry-run-reporter.js';
import type { IApimClient } from '../../../src/clients/iapim-client.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { PublishConfig } from '../../../src/models/config.js';
import { LogLevel, logger } from '../../../src/lib/logger.js';

type MockApimClient = IApimClient & {
  getResource: ReturnType<typeof vi.fn>;
  putResource: ReturnType<typeof vi.fn>;
  deleteResource: ReturnType<typeof vi.fn>;
  getApiSpecification: ReturnType<typeof vi.fn>;
  validatePreFlight: ReturnType<typeof vi.fn>;
};

function createMockClient(
  existingResources: Map<string, boolean> = new Map()
): MockApimClient {
  return {
    listResources: async function* () {},
    getResource: vi.fn(
      async (_ctx: ApimServiceContext, descriptor: ResourceDescriptor) => {
        const key = `${descriptor.type}:${descriptor.nameParts[0] ?? ''}`;
        const exists = existingResources.get(key);
        return exists ? { name: descriptor.nameParts[0] ?? '' } : undefined;
      }
    ),
    putResource: vi.fn(async () => ({ name: 'mock' })),
    deleteResource: vi.fn(async () => true),
    patchResource: vi.fn(async () => ({})),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn(async () => undefined),
    validatePreFlight: vi.fn(async () => {}),
  };
}

function createMockStore() {
  return {
    writeResource: vi.fn(),
    writeContent: vi.fn(),
    writeAssociation: vi.fn(),
    readResource: vi.fn(),
    readContent: vi.fn(),
    readAssociation: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
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
  dryRun: true,
  deleteUnmatched: false,
  logLevel: LogLevel.INFO,
};

describe('dry-run-reporter', () => {
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerInfoSpy.mockRestore();
  });

  describe('generateDryRunReport', () => {
    it('should emit [DRY RUN] lines as info logs', async () => {
      const client = createMockClient(new Map([
        ['NamedValue:my-nv', false],
      ]));
      const store = createMockStore();

      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.NamedValue, nameParts: ['my-nv'] },
      ];

      await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN] PUT')
      );
    });

    it('should return report with correct action counts', async () => {
      const client = createMockClient(new Map([
        ['NamedValue:nv1', false],
        ['Backend:backend1', true],
      ]));
      const store = createMockStore();

      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        { type: ResourceType.Backend, nameParts: ['backend1'] },
      ];

      const report = await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      expect(report.actions).toHaveLength(2);
      expect(report.summary.creates).toBeGreaterThan(0);
    });

    it('should mark as PUT when resource does not exist (create)', async () => {
      const client = createMockClient(new Map([
        ['Tag:new-tag', false],
      ]));
      const store = createMockStore();

      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.Tag, nameParts: ['new-tag'] },
      ];

      const report = await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      expect(report.actions).toHaveLength(1);
      expect(report.actions[0].operation).toBe('PUT');
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('(new)')
      );
    });

    it('checks the deployed descriptor when environment mapping is active', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['shared-key'],
      };
      const config: PublishConfig = {
        ...testConfig,
        envMapping: {
          prefix: 'dev-',
          suffix: '',
          appliesTo: new Set([ResourceType.NamedValue]),
        },
      };

      await generateDryRunReport(store, client, testContext, config, [descriptor]);

      expect(client.getResource).toHaveBeenCalledWith(testContext, {
        type: ResourceType.NamedValue,
        nameParts: ['dev-shared-key'],
      });
    });

    it('should expand aggregate GatewayApi descriptors into per-API actions', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockResolvedValue([
        { name: 'api-one' },
        { name: 'api-two' },
      ]);

      // Discovery produces GatewayApi with only the gateway name (from apis.json)
      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.GatewayApi, nameParts: ['my-gateway'] },
      ];

      const report = await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      expect(store.readAssociation).toHaveBeenCalledWith(
        '/source',
        expect.objectContaining({ type: ResourceType.Gateway, nameParts: ['my-gateway'] }),
        'apis'
      );
      expect(report.actions).toHaveLength(2);
      expect(report.actions.map(a => a.name)).toEqual([
        'my-gateway/api-one',
        'my-gateway/api-two',
      ]);
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('gateways/my-gateway/apis/api-one')
      );
    });

    it('should mark as PUT when resource exists (update)', async () => {
      const client = createMockClient(new Map([
        ['Tag:existing-tag', true],
      ]));
      const store = createMockStore();

      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.Tag, nameParts: ['existing-tag'] },
      ];

      const report = await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      expect(report.actions).toHaveLength(1);
      expect(report.actions[0].operation).toBe('PUT');
    });

    it('should include summary with correct counts', async () => {
      const client = createMockClient(new Map([
        ['NamedValue:nv1', false],
        ['Backend:backend1', false],
        ['Tag:tag1', true],
      ]));
      const store = createMockStore();

      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        { type: ResourceType.Backend, nameParts: ['backend1'] },
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const report = await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      expect(report.summary.creates).toBe(3);
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Summary')
      );
    });

    it('should handle errors and mark as SKIP', async () => {
      const client = createMockClient();
      client.getResource.mockRejectedValue(new Error('Network error'));
      const store = createMockStore();

      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['my-api'] },
      ];

      const report = await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      expect(report.actions).toHaveLength(1);
      expect(report.actions[0].operation).toBe('SKIP');
      expect(report.actions[0].error).toContain('Network error');
      expect(report.summary.skips).toBe(1);
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('SKIP')
      );
    });

    it('should process resources in topological order', async () => {
      const client = createMockClient(new Map([
        ['NamedValue:nv1', false],
        ['Api:api1', false],
      ]));
      const store = createMockStore();

      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['api1'] },
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
      ];

      const report = await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      expect(report.actions).toHaveLength(2);
      // NamedValue should be processed before Api (tier 1 before tier 3)
      const actionTypes = report.actions.map((a) => a.type);
      const nvIndex = actionTypes.indexOf(ResourceType.NamedValue);
      const apiIndex = actionTypes.indexOf(ResourceType.Api);
      expect(nvIndex).toBeLessThan(apiIndex);
    });

    it('should handle empty descriptor list', async () => {
      const client = createMockClient();
      const store = createMockStore();

      const report = await generateDryRunReport(store, client, testContext, testConfig, []);

      expect(report.actions).toHaveLength(0);
      expect(report.summary.creates).toBe(0);
      expect(report.summary.deletes).toBe(0);
      expect(report.summary.skips).toBe(0);
    });

    it('should report commit-scoped deletes supplied after deletion opt-in', async () => {
      const client = createMockClient(new Map([
        ['Tag:old-tag', true],
      ]));
      const store = createMockStore();

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        testConfig,
        [],
        [{ type: ResourceType.Tag, nameParts: ['old-tag'] }]
      );

      expect(report.actions).toHaveLength(1);
      expect(report.actions[0].operation).toBe('DELETE');
      expect(report.summary.deletes).toBe(1);
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN] DELETE')
      );
    });

    it('should report a workspace association DELETE after resolving its opaque link', async () => {
      const client = createMockClient();
      client.listResources = async function* () {
        yield {
          name: 'opaque-link',
          properties: {
            apiId: `${testContext.baseUrl}/workspaces/team/apis/orders`,
          },
        };
      };
      const store = createMockStore();

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        testConfig,
        [],
        [{
          type: ResourceType.ProductApi,
          nameParts: ['store', 'orders'],
          workspace: 'team',
        }]
      );

      expect(report.actions).toMatchObject([{
        operation: 'DELETE',
        type: ResourceType.ProductApi,
        name: 'store/orders',
      }]);
      expect(report.summary.deletes).toBe(1);
    });

    it('should not report a PUT when a Product is also deleted incrementally', async () => {
      const product: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['retired'],
      };
      const client = createMockClient(new Map([['Product:retired', true]]));
      const store = createMockStore();

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        testConfig,
        [product],
        [product]
      );

      expect(report.actions.map((action) => action.operation)).toEqual([
        'SKIP',
        'DELETE',
      ]);
      expect(report.summary).toEqual({
        creates: 0,
        patches: 0,
        deletes: 1,
        skips: 1,
      });
    });

    it('should format hierarchical resource names correctly', async () => {
      const client = createMockClient(new Map([
        ['ApiOperation:get-user', false],
      ]));
      const store = createMockStore();

      const descriptors: ResourceDescriptor[] = [
        {
          type: ResourceType.ApiOperation,
          nameParts: ['my-api', 'get-user'],
        },
      ];

      await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('apis/my-api/operations/get-user')
      );
    });

    it('should report expanded association endpoints as PUT without issuing unsupported GETs', async () => {
      // APIM association endpoints (ProductGroup, ProductApi, GatewayApi) return
      // HTTP 405 on GET. ApimClient.getResource catches 405 and returns undefined,
      // so the dry-run reporter must treat them as "would be created" (PUT new),
      // not as errors (SKIP).
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor, type: string) => {
          if (descriptor.type === ResourceType.Product && type === 'apis') {
            return [{ name: 'my-api' }];
          }
          if (descriptor.type === ResourceType.Product && type === 'groups') {
            return [{ name: 'my-group' }];
          }
          if (descriptor.type === ResourceType.Gateway && type === 'apis') {
            return [{ name: 'my-api' }];
          }
          return [];
        }
      );

      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.Product, nameParts: ['my-product'] },
        { type: ResourceType.GatewayApi, nameParts: ['my-gateway'] },
      ];

      const report = await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      const associationActions = report.actions.filter((action) =>
        [
          ResourceType.ProductGroup,
          ResourceType.ProductApi,
          ResourceType.GatewayApi,
        ].includes(action.descriptor.type)
      );
      expect(report.summary.skips).toBe(0);
      expect(associationActions).toHaveLength(3);
      for (const action of associationActions) {
        expect(action.operation).toBe('PUT');
      }
      expect(client.getResource).toHaveBeenCalledTimes(1);
    });

    it('expands filtered product associations into concrete PUT and SKIP actions without duplicates', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockImplementation(
        async (_dir: string, _descriptor: ResourceDescriptor, type: string) => {
          if (type === 'apis') {
            return [{ name: 'orders' }, { name: 'legacy' }, { name: 'missing-api' }];
          }
          if (type === 'groups') {
            return [{ name: 'developers' }, { name: 'guests' }];
          }
          return [{ name: 'production' }, { name: 'missing-tag' }];
        }
      );

      const product: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['store'],
      };
      const descriptors: ResourceDescriptor[] = [
        product,
        { type: ResourceType.Api, nameParts: ['orders'] },
        { type: ResourceType.Group, nameParts: ['developers'] },
        { type: ResourceType.Tag, nameParts: ['production'] },
        // Parent-managed descriptors can also be present in caller-provided sets.
        { type: ResourceType.ProductApi, nameParts: ['store', 'orders'] },
      ];
      const config: PublishConfig = {
        ...testConfig,
        filter: {
          products: ['store'],
          apis: ['orders', 'missing-api', '!legacy'],
          groups: ['developers', '!guests'],
          tags: ['production', 'missing-tag'],
        },
      };

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        config,
        descriptors
      );

      const associations = report.actions.filter((action) =>
        [
          ResourceType.ProductApi,
          ResourceType.ProductGroup,
          ResourceType.ProductTag,
        ].includes(action.descriptor.type)
      );
      expect(associations.map((action) => [
        action.operation,
        action.type,
        action.name,
      ])).toEqual([
        ['PUT', ResourceType.ProductGroup, 'store/developers'],
        ['SKIP', ResourceType.ProductGroup, 'store/guests'],
        ['PUT', ResourceType.ProductTag, 'store/production'],
        ['SKIP', ResourceType.ProductTag, 'store/missing-tag'],
        ['PUT', ResourceType.ProductApi, 'store/orders'],
        ['SKIP', ResourceType.ProductApi, 'store/legacy'],
        ['SKIP', ResourceType.ProductApi, 'store/missing-api'],
      ]);
      expect(
        associations.filter((action) => action.name === 'store/orders')
      ).toHaveLength(1);
      expect(report.summary).toEqual({ creates: 7, patches: 0, deletes: 0, skips: 4 });
      expect(client.putResource).not.toHaveBeenCalled();
      expect(client.patchResource).not.toHaveBeenCalled();
      expect(client.deleteResource).not.toHaveBeenCalled();
    });

    it('includes an unchanged product policy when an incremental publish selects its product', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readContent.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor) =>
          descriptor.type === ResourceType.ProductPolicy
            ? { content: '<policies><inbound/></policies>', format: 'xml' }
            : undefined
      );
      const product: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['store'],
      };
      const config: PublishConfig = {
        ...testConfig,
        commitId: 'abc123',
        filter: { products: ['store'] },
      };

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        config,
        [product]
      );

      expect(report.actions).toMatchObject([
        { operation: 'PUT', type: ResourceType.Product, name: 'store' },
        { operation: 'PUT', type: ResourceType.ProductPolicy, name: 'store' },
      ]);
      expect(report.summary).toEqual({ creates: 2, patches: 0, deletes: 0, skips: 0 });
    });

    it('expands GatewayApi artifacts and reports excluded and unavailable API targets', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockResolvedValue([
        { name: 'orders' },
        { name: 'legacy' },
        { name: 'missing-api' },
      ]);
      const config: PublishConfig = {
        ...testConfig,
        filter: {
          gateways: ['edge'],
          apis: ['orders', 'missing-api', '!legacy'],
        },
      };

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        config,
        [
          { type: ResourceType.Api, nameParts: ['orders'] },
          { type: ResourceType.GatewayApi, nameParts: ['edge'] },
        ]
      );

      expect(report.actions.filter((action) => action.type === ResourceType.GatewayApi))
        .toMatchObject([
          { operation: 'PUT', name: 'edge/orders' },
          { operation: 'SKIP', name: 'edge/legacy', reason: 'target is excluded by the filter' },
          { operation: 'SKIP', name: 'edge/missing-api', reason: 'target is unavailable in the publish set' },
        ]);
      expect(report.summary).toEqual({ creates: 2, patches: 0, deletes: 0, skips: 2 });
      expect(client.putResource).not.toHaveBeenCalled();
      expect(client.patchResource).not.toHaveBeenCalled();
      expect(client.deleteResource).not.toHaveBeenCalled();
    });

    it('skips a missing incremental association target even when the association changed', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockResolvedValue([{ name: 'missing-api' }]);
      store.readResource.mockResolvedValue(undefined);
      const config: PublishConfig = {
        ...testConfig,
        commitId: 'base',
        filter: {
          gateways: ['edge'],
          apis: ['missing-api'],
        },
      };

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        config,
        [{ type: ResourceType.GatewayApi, nameParts: ['edge'] }]
      );

      expect(report.actions).toMatchObject([
        {
          operation: 'SKIP',
          type: ResourceType.GatewayApi,
          name: 'edge/missing-api',
          reason: 'target was never extracted',
        },
      ]);
    });

    it('uses shared ApiTag eligibility for allowed, excluded, and missing tags', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readResource.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor) => {
          if (
            descriptor.type === ResourceType.Tag &&
            descriptor.nameParts[0] === 'production'
          ) {
            return { name: 'production', properties: {} };
          }
          if (
            descriptor.type === ResourceType.ApiTag &&
            descriptor.nameParts[1] === 'production'
          ) {
            return { name: 'production', properties: {} };
          }
          return undefined;
        }
      );
      const config: PublishConfig = {
        ...testConfig,
        filter: {
          apis: ['orders'],
          tags: ['production', 'missing', '!internal'],
        },
      };

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        config,
        [
          { type: ResourceType.ApiTag, nameParts: ['orders', 'production'] },
          { type: ResourceType.ApiTag, nameParts: ['orders', 'internal'] },
          { type: ResourceType.ApiTag, nameParts: ['orders', 'missing'] },
        ]
      );

      expect(report.actions).toMatchObject([
        { operation: 'PUT', name: 'orders/production' },
        { operation: 'SKIP', name: 'orders/internal', reason: 'target is excluded by the filter' },
        { operation: 'SKIP', name: 'orders/missing', reason: 'target was never extracted' },
      ]);
      expect(report.summary).toEqual({ creates: 1, patches: 0, deletes: 0, skips: 2 });
      expect(client.putResource).not.toHaveBeenCalled();
      expect(client.patchResource).not.toHaveBeenCalled();
      expect(client.deleteResource).not.toHaveBeenCalled();
    });

    it('plans workspace ApiTag links without requiring a link artifact', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readResource.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor) =>
          descriptor.type === ResourceType.Tag &&
          descriptor.workspace === 'team' &&
          descriptor.nameParts[0] === 'production'
            ? { properties: {} }
            : undefined
      );
      const config: PublishConfig = {
        ...testConfig,
        filter: {
          workspaces: ['team'],
          workspaceSubFilters: {
            team: {
              apis: ['orders'],
              tags: ['production'],
            },
          },
        },
      };

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        config,
        [{
          type: ResourceType.ApiTag,
          nameParts: ['orders', 'production'],
          workspace: 'team',
        }]
      );

      expect(report.actions).toMatchObject([
        { operation: 'PUT', type: ResourceType.ApiTag, name: 'orders/production' },
      ]);
      expect(store.readResource).toHaveBeenCalledTimes(1);
      expect(client.putResource).not.toHaveBeenCalled();
      expect(client.patchResource).not.toHaveBeenCalled();
      expect(client.deleteResource).not.toHaveBeenCalled();
    });

    it('plans API and Product subscription eligibility across service and workspace scopes', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const armPrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';
      const resources = new Map<string, Record<string, unknown>>([
        ['Subscription::product-sub', {
          properties: { scope: `${armPrefix}/products/store` },
        }],
        ['Subscription::excluded-api-sub', {
          properties: { scope: `${armPrefix}/apis/legacy` },
        }],
        ['Subscription::missing-product-sub', {
          properties: { scope: `${armPrefix}/products/missing` },
        }],
        ['Subscription:team:workspace-api-sub', {
          properties: { scope: '/apis/orders' },
        }],
        ['Subscription:team:workspace-product-sub', {
          properties: { scope: '/products/team-store' },
        }],
        ['Subscription::root-sub', {
          properties: { scope: armPrefix },
        }],
        ['Product::store', { properties: {} }],
        ['Api:team:orders', { properties: {} }],
        ['Product:team:team-store', { properties: {} }],
      ]);
      store.readResource.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor) =>
          resources.get(
            `${descriptor.type}:${descriptor.workspace ?? ''}:${descriptor.nameParts.join('/')}`
          )
      );
      const config: PublishConfig = {
        ...testConfig,
        filter: {
          subscriptions: ['product-sub', 'excluded-api-sub', 'missing-product-sub', 'root-sub'],
          products: ['store', 'missing'],
          apis: ['!legacy', '*'],
          workspaces: ['team'],
          workspaceSubFilters: {
            team: {
              subscriptions: ['workspace-api-sub', 'workspace-product-sub'],
              apis: ['orders'],
              products: ['team-store'],
            },
          },
        },
      };

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        config,
        [
          { type: ResourceType.Subscription, nameParts: ['product-sub'] },
          { type: ResourceType.Subscription, nameParts: ['excluded-api-sub'] },
          { type: ResourceType.Subscription, nameParts: ['missing-product-sub'] },
          {
            type: ResourceType.Subscription,
            nameParts: ['workspace-api-sub'],
            workspace: 'team',
          },
          {
            type: ResourceType.Subscription,
            nameParts: ['workspace-product-sub'],
            workspace: 'team',
          },
          { type: ResourceType.Subscription, nameParts: ['root-sub'] },
        ]
      );

      expect(report.actions).toMatchObject([
        { operation: 'PUT', name: 'product-sub' },
        { operation: 'SKIP', name: 'excluded-api-sub' },
        { operation: 'SKIP', name: 'missing-product-sub' },
        { operation: 'PUT', name: 'workspace-api-sub' },
        { operation: 'PUT', name: 'workspace-product-sub' },
        {
          operation: 'SKIP',
          name: 'root-sub',
          reason: 'root-scoped subscriptions are managed by APIM',
        },
      ]);
      expect(report.summary).toEqual({ creates: 3, patches: 0, deletes: 0, skips: 3 });
      expect(client.putResource).not.toHaveBeenCalled();
      expect(client.patchResource).not.toHaveBeenCalled();
      expect(client.deleteResource).not.toHaveBeenCalled();
    });

    it('plans the concrete API requests used by full specification import', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const api: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders'],
      };
      const policy: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['orders', 'policy'],
      };
      const tag: ResourceDescriptor = {
        type: ResourceType.ApiTag,
        nameParts: ['orders', 'production'],
      };
      const operation: ResourceDescriptor = {
        type: ResourceType.ApiOperation,
        nameParts: ['orders', 'get-orders'],
      };
      const explicitSchema: ResourceDescriptor = {
        type: ResourceType.ApiSchema,
        nameParts: ['orders', 'order-schema'],
      };
      const generatedSchema: ResourceDescriptor = {
        type: ResourceType.ApiSchema,
        nameParts: ['orders', '69f15c3c10a45d29d855583a'],
      };
      const descriptors = [api, policy, tag, operation, explicitSchema, generatedSchema];
      store.listResources.mockResolvedValue(descriptors);
      store.readResource.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor) => {
          if (descriptor.type === ResourceType.Api) {
            return { name: 'orders', properties: { path: 'orders' } };
          }
          if (descriptor.type === ResourceType.ApiOperation) {
            return {
              name: 'get-orders',
              properties: { displayName: 'Get orders' },
            };
          }
          return { properties: {} };
        }
      );
      store.readContent.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor, kind: string) =>
          descriptor.type === ResourceType.Api && kind === 'specification'
            ? {
                content:
                  'openapi: "3.0.0"\npaths:\n  /orders:\n    get:\n      operationId: get-orders\n',
                format: 'yaml',
              }
            : undefined
      );
      const config: PublishConfig = {
        ...testConfig,
        filter: {
          apis: ['orders'],
          tags: ['production'],
        },
      };

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        config,
        descriptors
      );

      expect(report.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: 'PUT', type: ResourceType.Api, name: 'orders' }),
        expect.objectContaining({ operation: 'PUT', type: ResourceType.ApiPolicy, name: 'orders/policy' }),
        expect.objectContaining({ operation: 'PUT', type: ResourceType.ApiTag, name: 'orders/production' }),
        expect.objectContaining({ operation: 'PUT', type: ResourceType.ApiSchema, name: 'orders/order-schema' }),
        expect.objectContaining({ operation: 'PUT', type: ResourceType.ApiOperation, name: 'orders/get-orders' }),
        expect.objectContaining({ operation: 'PATCH', type: ResourceType.ApiOperation, name: 'orders/get-orders' }),
      ]));
      expect(report.actions).not.toContainEqual(
        expect.objectContaining({ descriptor: generatedSchema })
      );
      expect(report.summary).toEqual({ creates: 5, patches: 1, deletes: 0, skips: 0 });
      expect(client.putResource).not.toHaveBeenCalled();
      expect(client.patchResource).not.toHaveBeenCalled();
    });

    it('plans revision and active-revision alignment PUTs exactly once', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const api: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders'],
      };
      const revision: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['orders;rev=2'],
      };
      store.listResources.mockResolvedValue([api, revision]);
      store.readResource.mockImplementation(
        async (_dir: string, descriptor: ResourceDescriptor) =>
          descriptor.type === ResourceType.Api &&
          descriptor.nameParts[0] === 'orders'
            ? { properties: { isCurrent: true } }
            : { properties: {} }
      );
      store.readContent.mockResolvedValue(undefined);

      const report = await generateDryRunReport(
        store,
        client,
        testContext,
        testConfig,
        [api, revision]
      );

      expect(report.actions).toMatchObject([
        { operation: 'PUT', type: ResourceType.Api, name: 'orders' },
        { operation: 'PUT', type: ResourceType.Api, name: 'orders;rev=2' },
        { operation: 'PUT', type: ResourceType.Api, name: 'orders' },
      ]);
      expect(report.summary).toEqual({ creates: 3, patches: 0, deletes: 0, skips: 0 });
    });
  });
});
