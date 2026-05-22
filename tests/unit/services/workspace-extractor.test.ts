// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T027: Workspace-scoped extraction
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../../../src/models/resource-types.js';
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

describe('workspace type selection', () => {
  it('should derive workspace types from RESOURCE_TYPE_METADATA workspaceSupported flag', () => {
    const derivedTypes = Object.values(ResourceType).filter(
      (type) => RESOURCE_TYPE_METADATA[type].workspaceSupported === true
    );
    expect(derivedTypes).toContain(ResourceType.NamedValue);
    expect(derivedTypes).toContain(ResourceType.Tag);
    expect(derivedTypes).toContain(ResourceType.Backend);
    expect(derivedTypes).toContain(ResourceType.Logger);
    expect(derivedTypes).toContain(ResourceType.Group);
    expect(derivedTypes).toContain(ResourceType.Diagnostic);
    expect(derivedTypes).toContain(ResourceType.PolicyFragment);
    expect(derivedTypes).toContain(ResourceType.Product);
    expect(derivedTypes).toContain(ResourceType.Api);
    expect(derivedTypes).toContain(ResourceType.Subscription);
    expect(derivedTypes).toContain(ResourceType.GlobalSchema);
    expect(derivedTypes).toContain(ResourceType.Documentation);
    expect(derivedTypes).toHaveLength(12);
  });

  it('should not include non-workspace types', () => {
    const derivedTypes = Object.values(ResourceType).filter(
      (type) => RESOURCE_TYPE_METADATA[type].workspaceSupported === true
    );
    expect(derivedTypes).not.toContain(ResourceType.ServicePolicy);
    expect(derivedTypes).not.toContain(ResourceType.ProductApi);
    expect(derivedTypes).not.toContain(ResourceType.GatewayApi);
    expect(derivedTypes).not.toContain(ResourceType.ApiPolicy);
  });

  it('should return types in enum declaration order', () => {
    const derivedTypes = Object.values(ResourceType).filter(
      (type) => RESOURCE_TYPE_METADATA[type].workspaceSupported === true
    );
    // Enum order: NamedValue, Tag, ..., Backend, Logger, Group, Diagnostic, PolicyFragment, ..., Product, Api, ..., Subscription, GlobalSchema, ..., Documentation
    const namedValueIdx = derivedTypes.indexOf(ResourceType.NamedValue);
    const tagIdx = derivedTypes.indexOf(ResourceType.Tag);
    const apiIdx = derivedTypes.indexOf(ResourceType.Api);
    const subscriptionIdx = derivedTypes.indexOf(ResourceType.Subscription);
    expect(namedValueIdx).toBeLessThan(tagIdx);
    expect(tagIdx).toBeLessThan(apiIdx);
    expect(apiIdx).toBeLessThan(subscriptionIdx);
  });
});

describe('workspace-extractor', () => {
  describe('extractWorkspaces', () => {
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
