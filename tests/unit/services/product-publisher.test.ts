// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for product-publisher service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  planProductAssociationPublications,
  publishProduct,
} from '../../../src/services/product-publisher.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { PublishConfig } from '../../../src/models/config.js';
import { LogLevel } from '../../../src/lib/logger.js';
import { DEFAULT_APPLIES_TO } from '../../../src/services/env-mapper.js';

// Mock resource-publisher so product-publisher tests don't run full resource-publisher logic
const mockPublishResource = vi.fn();
vi.mock('../../../src/services/resource-publisher.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/resource-publisher.js')>()),
  publishResource: (...args: unknown[]) => mockPublishResource(...args),
}));

function createMockClient() {
  return {
    listResources: async function* (): AsyncGenerator<Record<string, unknown>> {},
    getResource: vi.fn(),
    putResource: vi.fn().mockResolvedValue(undefined),
    deleteResource: vi.fn().mockResolvedValue(true),
    patchResource: vi.fn().mockResolvedValue(undefined),
    listApiRevisions: async function* (): AsyncGenerator<Record<string, unknown>> {},
    getApiSpecification: vi.fn(),
    validatePreFlight: vi.fn(),
  };
}

function createMockStore() {
  return {
    writeResource: vi.fn(),
    writeContent: vi.fn(),
    writeAssociation: vi.fn(),
    readResource: vi.fn().mockResolvedValue(null),
    readContent: vi.fn().mockResolvedValue(undefined),
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
  dryRun: false,
  deleteUnmatched: false,
  logLevel: LogLevel.INFO,
};

const productDescriptor: ResourceDescriptor = {
  type: ResourceType.Product,
  nameParts: ['my-product'],
};

function generatedSubscriptionId(fill: string): string {
  return fill.repeat(24);
}

describe('product-publisher', () => {
  describe('publishProduct', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Default: product publish succeeds
      mockPublishResource.mockResolvedValue({
        descriptor: productDescriptor,
        status: 'success',
        action: 'put',
      });
    });

    it('happy path: publishes product and associations, returns success', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation
        .mockResolvedValueOnce([{ name: 'petstore' }, { name: 'orders' }]) // apis
        .mockResolvedValueOnce([{ name: 'developers' }])                  // groups
        .mockResolvedValueOnce([{ name: 'production' }, { name: 'v1' }]);  // tags
      store.readContent.mockResolvedValue({ content: '<policies/>', format: 'xml' });

      const result = await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(result.action).toBe('put');
      // publishResource called for product itself + policy
      expect(mockPublishResource).toHaveBeenCalledTimes(2);
      // putResource called for each association
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductApi, nameParts: ['my-product', 'petstore'] }),
        {}
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductApi, nameParts: ['my-product', 'orders'] }),
        {}
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductGroup, nameParts: ['my-product', 'developers'] }),
        {}
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductTag, nameParts: ['my-product', 'production'] }),
        {}
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductTag, nameParts: ['my-product', 'v1'] }),
        {}
      );
    });

    it('returns early without publishing associations when product publish fails', async () => {
      const client = createMockClient();
      const store = createMockStore();
      mockPublishResource.mockResolvedValue({
        descriptor: productDescriptor,
        status: 'failed',
        action: 'noop',
        error: new Error('Product PUT failed'),
      });

      const result = await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(result.status).toBe('failed');
      expect(client.putResource).not.toHaveBeenCalled();
      // readAssociation should not be called since we returned early
      expect(store.readAssociation).not.toHaveBeenCalled();
    });

    it('reports a preliminary existence-check failure without a PUT action', async () => {
      const client = createMockClient();
      const store = createMockStore();
      client.getResource.mockRejectedValue(new Error('Lookup failed'));

      const result = await publishProduct(
        client,
        store,
        testContext,
        productDescriptor,
        testConfig
      );

      expect(result).toMatchObject({
        descriptor: productDescriptor,
        status: 'failed',
        action: 'noop',
        error: expect.objectContaining({ message: 'Lookup failed' }),
      });
      expect(mockPublishResource).not.toHaveBeenCalled();
    });

    it('no apis.json / groups.json / tags.json: no client.putResource calls for associations', async () => {
      const client = createMockClient();
      const store = createMockStore();
      // readAssociation returns [] for all association types
      store.readAssociation.mockResolvedValue([]);
      store.readContent.mockResolvedValue(undefined);

      const result = await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('apis association: calls putResource for each api with ProductApi descriptor', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation
        .mockResolvedValueOnce([{ name: 'petstore' }, { name: 'orders' }]) // apis
        .mockResolvedValueOnce([])                     // groups
        .mockResolvedValueOnce([]);                    // tags
      store.readContent.mockResolvedValue(undefined);

      await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(client.putResource).toHaveBeenCalledTimes(2);
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductApi, nameParts: ['my-product', 'petstore'] }),
        {}
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductApi, nameParts: ['my-product', 'orders'] }),
        {}
      );
    });

    it('publishes environment-mapped product associations to deployed descriptors', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation
        .mockResolvedValueOnce([{ name: 'petstore' }])
        .mockResolvedValueOnce([{ name: 'developers' }])
        .mockResolvedValueOnce([{ name: 'production' }]);
      const config: PublishConfig = {
        ...testConfig,
        envMapping: {
          prefix: 'dev-',
          suffix: '',
          appliesTo: DEFAULT_APPLIES_TO,
        },
      };

      await publishProduct(
        client,
        store,
        testContext,
        productDescriptor,
        config,
        [
          productDescriptor,
          { type: ResourceType.Api, nameParts: ['petstore'] },
          { type: ResourceType.Group, nameParts: ['developers'] },
          { type: ResourceType.Tag, nameParts: ['production'] },
        ]
      );

      expect(client.getResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.Product,
          nameParts: ['dev-my-product'],
        })
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.ProductApi,
          nameParts: ['dev-my-product', 'dev-petstore'],
        }),
        {}
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.ProductGroup,
          nameParts: ['dev-my-product', 'developers'],
        }),
        {}
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.ProductTag,
          nameParts: ['dev-my-product', 'dev-production'],
        }),
        {}
      );
    });

    it('does not let resolved targets override explicit API exclusions', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation
        .mockResolvedValueOnce([{ name: 'legacy-api' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const legacyApi: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['legacy-api'],
      };
      const config: PublishConfig = {
        ...testConfig,
        filter: {
          products: ['my-product'],
          apis: ['!legacy-api', '*'],
        },
      };

      await publishProduct(
        client,
        store,
        testContext,
        productDescriptor,
        config,
        [productDescriptor, legacyApi]
      );

      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('publishes links to unchanged targets allowed during incremental publish', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation
        .mockResolvedValueOnce([{ name: 'orders-api' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const config: PublishConfig = {
        ...testConfig,
        commitId: 'abc123',
        filter: {
          products: ['my-product'],
          apis: ['orders-api'],
        },
      };

      await publishProduct(
        client,
        store,
        testContext,
        productDescriptor,
        config,
        [productDescriptor]
      );

      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.ProductApi,
          nameParts: ['my-product', 'orders-api'],
        }),
        {}
      );
    });

    it('republishes an unchanged product policy when the product changes in incremental mode', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockResolvedValue([]);
      store.readContent.mockResolvedValue({ content: '<policies><inbound/></policies>', format: 'xml' });
      const config: PublishConfig = {
        ...testConfig,
        commitId: 'abc123',
        filter: { products: ['my-product'] },
      };

      // Only the product itself is in the incremental diff/expansion set —
      // policy.xml did not change in this commit.
      await publishProduct(client, store, testContext, productDescriptor, config, [productDescriptor]);

      expect(mockPublishResource).toHaveBeenCalledWith(
        client, store, testContext,
        expect.objectContaining({ type: ResourceType.ProductPolicy, nameParts: ['my-product'] }),
        config
      );
    });

    it('groups association: calls putResource with ProductGroup descriptor', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation
        .mockResolvedValueOnce([])            // apis
        .mockResolvedValueOnce([{ name: 'developers' }]) // groups
        .mockResolvedValueOnce([]);           // tags
      store.readContent.mockResolvedValue(undefined);

      await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(client.putResource).toHaveBeenCalledTimes(1);
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductGroup, nameParts: ['my-product', 'developers'] }),
        {}
      );
    });

    it('tags association: calls putResource with ProductTag descriptor', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation
        .mockResolvedValueOnce([])                   // apis
        .mockResolvedValueOnce([])                   // groups
        .mockResolvedValueOnce([{ name: 'production' }, { name: 'v1' }]); // tags
      store.readContent.mockResolvedValue(undefined);

      await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(client.putResource).toHaveBeenCalledTimes(2);
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductTag, nameParts: ['my-product', 'production'] }),
        {}
      );
      expect(client.putResource).toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({ type: ResourceType.ProductTag, nameParts: ['my-product', 'v1'] }),
        {}
      );
    });

    it('policy published when content exists: publishResource called for ProductPolicy', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockResolvedValue([]);
      store.readContent.mockResolvedValue({ content: '<policies><inbound/></policies>', format: 'xml' });

      await publishProduct(client, store, testContext, productDescriptor, testConfig);

      // First call is for Product itself, second for ProductPolicy
      expect(mockPublishResource).toHaveBeenCalledTimes(2);
      expect(mockPublishResource).toHaveBeenCalledWith(
        client, store, testContext,
        expect.objectContaining({ type: ResourceType.ProductPolicy, nameParts: ['my-product'] }),
        testConfig
      );
    });

    it('policy skipped when no content: no extra publishResource call for ProductPolicy', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation.mockResolvedValue([]);
      store.readContent.mockResolvedValue(undefined);

      await publishProduct(client, store, testContext, productDescriptor, testConfig);

      // Only called once — for the product itself, not for the policy
      expect(mockPublishResource).toHaveBeenCalledTimes(1);
      expect(mockPublishResource).not.toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(),
        expect.objectContaining({ type: ResourceType.ProductPolicy }),
        expect.anything()
      );
    });

    it('returns a concrete failed result when an association PUT fails', async () => {
      const client = createMockClient();
      const store = createMockStore();
      store.readAssociation
        .mockResolvedValueOnce([{ name: 'petstore' }]) // apis
        .mockResolvedValueOnce([])           // groups
        .mockResolvedValueOnce([]);          // tags
      store.readContent.mockResolvedValue(undefined);
      client.putResource.mockRejectedValue(new Error('Association PUT failed'));

      const result = await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(result.relatedResults).toEqual([
        expect.objectContaining({
          descriptor: expect.objectContaining({
            type: ResourceType.ProductApi,
            nameParts: ['my-product', 'petstore'],
          }),
          status: 'failed',
          action: 'put',
          error: expect.objectContaining({ message: 'Association PUT failed' }),
        }),
      ]);
    });

    it('preserves the successful Product PUT when post-PUT planning fails', async () => {
      const client = createMockClient();
      const store = createMockStore();
      // Force a top-level throw by making readAssociation throw unexpectedly
      store.readAssociation.mockRejectedValue(new Error('Unexpected store error'));

      const result = await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(result.action).toBe('put');
      expect(result.relatedResults).toEqual([
        expect.objectContaining({
          descriptor: productDescriptor,
          status: 'failed',
          action: 'noop',
          error: expect.objectContaining({ message: 'Unexpected store error' }),
        }),
      ]);
    });

    it('does not delete auto-generated product subscriptions after product publish', async () => {
      const client = createMockClient();
      const store = createMockStore();
      const autoGeneratedId = generatedSubscriptionId('c');
      client.getResource.mockResolvedValue(undefined);
      store.readAssociation.mockResolvedValue([]);
      store.readContent.mockResolvedValue(undefined);

      client.listResources = async function* () {
        yield {
          id: `${testContext.baseUrl}/subscriptions/${autoGeneratedId}`,
          name: autoGeneratedId,
          properties: {
            scope: `${testContext.baseUrl}/products/my-product`,
            displayName: null,
          },
        };
      };

      const result = await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(client.deleteResource).not.toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.Subscription,
          nameParts: [autoGeneratedId],
        })
      );
    });

    it('does not delete product-scoped subscriptions on first product creation', async () => {
      const client = createMockClient();
      const store = createMockStore();
      client.getResource.mockResolvedValue(undefined);
      store.readAssociation.mockResolvedValue([]);
      store.readContent.mockResolvedValue(undefined);

      client.listResources = async function* () {
        yield {
          id: `${testContext.baseUrl}/subscriptions/src-sub-product`,
          name: 'src-sub-product',
          properties: {
            scope: `${testContext.baseUrl}/products/my-product`,
            displayName: 'Kitchen Sink Product Subscription',
          },
        };
      };

      const result = await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(client.deleteResource).not.toHaveBeenCalledWith(
        testContext,
        expect.objectContaining({
          type: ResourceType.Subscription,
          nameParts: ['src-sub-product'],
        })
      );
    });

    it('does not run cleanup when product already exists', async () => {
      const client = createMockClient();
      const store = createMockStore();
      client.getResource.mockResolvedValue({ name: 'my-product' });
      store.readAssociation.mockResolvedValue([]);
      store.readContent.mockResolvedValue(undefined);

      client.listResources = async function* () {
        yield {
          id: `${testContext.baseUrl}/subscriptions/${generatedSubscriptionId('d')}`,
          name: generatedSubscriptionId('d'),
          properties: {
            scope: `${testContext.baseUrl}/products/my-product`,
            displayName: null,
          },
        };
      };

      const result = await publishProduct(client, store, testContext, productDescriptor, testConfig);

      expect(result.status).toBe('success');
      expect(client.deleteResource).not.toHaveBeenCalled();
    });

    it('uses the shared plan for workspace and service-scoped association links', async () => {
      const store = createMockStore();
      const workspaceProduct: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['store'],
        workspace: 'team',
      };
      store.readAssociation
        .mockResolvedValueOnce([{ name: 'orders', scope: 'workspace' }])
        .mockResolvedValueOnce([{ name: 'administrators', scope: 'service' }])
        .mockResolvedValueOnce([{ name: 'production', scope: 'workspace' }]);
      const config: PublishConfig = {
        ...testConfig,
        envMapping: {
          prefix: 'dev-',
          suffix: '',
          appliesTo: DEFAULT_APPLIES_TO,
        },
        filter: {
          workspaces: ['team'],
          workspaceSubFilters: {
            team: {
              products: ['store'],
              apis: ['orders'],
              tags: ['production'],
            },
          },
          groups: ['administrators'],
        },
      };
      const allowed: ResourceDescriptor[] = [
        workspaceProduct,
        { type: ResourceType.Api, nameParts: ['orders'], workspace: 'team' },
        { type: ResourceType.Group, nameParts: ['administrators'] },
        { type: ResourceType.Tag, nameParts: ['production'], workspace: 'team' },
      ];

      const plans = await planProductAssociationPublications(
        store,
        testContext,
        workspaceProduct,
        config,
        allowed
      );

      expect(plans).toMatchObject([
        {
          eligible: true,
          descriptor: { type: ResourceType.ProductApi, nameParts: ['store', 'orders'], workspace: 'team' },
          deployedDescriptor: {
            type: ResourceType.ProductApi,
            nameParts: ['dev-store', 'dev-orders'],
            workspace: 'dev-team',
          },
          payload: {
            properties: {
              apiId: expect.stringContaining('/workspaces/dev-team/apis/dev-orders'),
            },
          },
        },
        {
          eligible: true,
          descriptor: { type: ResourceType.ProductGroup, nameParts: ['store', 'administrators'], workspace: 'team' },
          deployedDescriptor: {
            type: ResourceType.ProductGroup,
            nameParts: ['dev-store', 'administrators'],
            workspace: 'dev-team',
          },
          payload: {
            properties: {
              groupId: expect.stringContaining('/groups/administrators'),
            },
          },
        },
        {
          eligible: true,
          descriptor: { type: ResourceType.ProductTag, nameParts: ['store', 'production'], workspace: 'team' },
          deployedDescriptor: {
            type: ResourceType.ProductTag,
            nameParts: ['dev-store', 'dev-production'],
            workspace: 'dev-team',
          },
          payload: {
            properties: {
              productId: expect.stringContaining('/workspaces/dev-team/products/dev-store'),
            },
          },
        },
      ]);
    });
  });
});
