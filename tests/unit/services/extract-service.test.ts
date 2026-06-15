// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Extract service orchestrator
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { ExtractConfig, FilterConfig } from '../../../src/models/config.js';
import { runExtraction } from '../../../src/services/extract-service.js';
import { LogLevel } from '../../../src/lib/logger.js';

// Mock IApimClient that returns configurable resources per type
function createMockClient(resourcesByType: Partial<Record<ResourceType, Record<string, unknown>[]>> = {}) {
  return {
    listResources: async function* (_ctx: ApimServiceContext, type: ResourceType) {
      const resources = resourcesByType[type] ?? [];
      for (const r of resources) {
        yield r;
      }
    },
    getResource: vi.fn().mockResolvedValue(undefined),
    putResource: vi.fn(),
    deleteResource: vi.fn(),
    patchResource: vi.fn().mockResolvedValue(undefined),
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

const testContext: ApimServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apim-1',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

describe('extract-service', () => {
  describe('runExtraction', () => {
    it('should extract resources across tiers', async () => {
      const client = createMockClient({
        [ResourceType.NamedValue]: [
          { name: 'nv-1', properties: { value: 'val1' } },
        ],
        [ResourceType.Tag]: [
          { name: 'tag-1', properties: {} },
        ],
        [ResourceType.Backend]: [
          { name: 'backend-1', properties: {} },
        ],
      });
      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);

      expect(result.totalExtracted).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
      expect(store.writeResource).toHaveBeenCalled();
    });

    it('should return exit code 0 when no errors', async () => {
      const client = createMockClient({
        [ResourceType.Tag]: [{ name: 'tag-1', properties: {} }],
      });
      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);
      expect(result.exitCode).toBe(0);
    });

    it('should apply filter when provided', async () => {
      const client = createMockClient({
        [ResourceType.NamedValue]: [
          { name: 'nv-keep', properties: {} },
          { name: 'nv-skip', properties: {} },
        ],
      });
      const store = createMockStore();

      const filter: FilterConfig = { namedValues: ['nv-keep'] };
      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        filter,
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);

      // Only nv-keep should be extracted
      const nvResults = result.typeResults.find((r) => r.type === ResourceType.NamedValue);
      expect(nvResults?.extracted.filter((e) => e.status === 'success')).toHaveLength(1);
    });

    it('should extract service policy', async () => {
      const client = createMockClient({});
      client.getResource = vi.fn().mockImplementation(async (_ctx, descriptor) => {
        if (descriptor.type === ResourceType.ServicePolicy) {
          return {
            name: 'policy',
            properties: { value: '<policies><inbound><base /></inbound></policies>' },
          };
        }
        return undefined;
      });
      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);

      expect(store.writeContent).toHaveBeenCalled();
      expect(result.collectedPolicies.has('service-policy')).toBe(true);
    });

    it('should not crash during transitive dedupe when a singleton (ServicePolicy) is already extracted', async () => {
      // Regression: transitive resolution previously keyed the
      // already-extracted set on getNamePart(d.nameParts, 0), which threw
      // RangeError for singletons with empty nameParts (e.g. ServicePolicy).
      // The dedupe now uses buildResourceLabel which handles empty nameParts.
      const client = createMockClient({});
      client.getResource = vi.fn().mockImplementation(async (_ctx, descriptor) => {
        if (descriptor.type === ResourceType.ServicePolicy) {
          return {
            name: 'policy',
            properties: { value: '<policies><inbound><base /></inbound></policies>' },
          };
        }
        return undefined;
      });
      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: true,
        logLevel: LogLevel.INFO,
      };

      // Must not throw RangeError from transitive dedupe key construction.
      const result = await runExtraction(client, store, config);

      expect(result.exitCode).toBe(0);
      expect(result.collectedPolicies.has('service-policy')).toBe(true);
    });

    it('should propagate write errors from store.writeContent for service policy', async () => {
      const writeError = new Error('I/O error');
      const client = createMockClient({});
      client.getResource = vi.fn().mockImplementation(async (_ctx, descriptor) => {
        if (descriptor.type === ResourceType.ServicePolicy) {
          return {
            name: 'policy',
            properties: { value: '<policies><inbound><base /></inbound></policies>' },
          };
        }
        return undefined;
      });
      const store = createMockStore();
      store.writeContent = vi.fn().mockRejectedValue(writeError);

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);

      // Write failure should be surfaced as a fatal error, not silently ignored as "No policy"
      expect(result.exitCode).toBe(2);
      expect(result.totalErrors).toBeGreaterThan(0);
      expect(result.collectedPolicies.has('service-policy')).toBe(false);
    });

    it('should surface API policy write failures from parallel sub-resource extraction', async () => {
      const writeError = new Error('API policy I/O error');
      const client = createMockClient({
        [ResourceType.Api]: [{ name: 'echo-api', properties: {} }],
      });
      client.getResource = vi.fn().mockImplementation(async (_ctx, descriptor) => {
        if (descriptor.type === ResourceType.ApiPolicy) {
          return {
            name: 'policy',
            properties: { value: '<policies><inbound><base /></inbound></policies>' },
          };
        }
        return undefined;
      });
      const store = createMockStore();
      // Only reject writeContent (policy/spec writes); writeResource (JSON artifacts) still works
      store.writeContent = vi.fn().mockRejectedValue(writeError);

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);

      // Rejected API sub-resource task must increment totalErrors and affect exitCode
      expect(result.totalErrors).toBeGreaterThan(0);
      expect(result.exitCode).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty APIM instance', async () => {
      const client = createMockClient({});
      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);
      expect(result.exitCode).toBe(0);
      expect(result.totalExtracted).toBe(0);
    });

    it('should skip workspace extraction when no workspace names in filter', async () => {
      const client = createMockClient({});
      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);
      expect(result.workspaceResults).toHaveLength(0);
    });

    it('should count product sub-resources when products are extracted', async () => {
      const client = createMockClient({
        [ResourceType.Product]: [
          { name: 'starter', properties: {} },
        ],
      });
      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);

      // Product itself should be extracted, sub-resources depend on product-extractor
      expect(result.productResults).toBeDefined();
      expect(result.totalExtracted).toBeGreaterThan(0);
    });

    it('should extract gateway API associations', async () => {
      const client = createMockClient({
        [ResourceType.Gateway]: [
          { name: 'gw-1', properties: {} },
        ],
      });

      // Handle GatewayApi requests for the gateway
      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType, parent?: ResourceDescriptor) {
        if (type === ResourceType.Gateway) {
          yield { name: 'gw-1', properties: {} };
        }
        if (type === ResourceType.GatewayApi && parent?.nameParts[0] === 'gw-1') {
          yield { name: 'my-api' };
        }
      };

      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      await runExtraction(client, store, config);

      expect(store.writeAssociation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: ResourceType.Gateway }),
        'apis',
        expect.arrayContaining(['my-api'])
      );
    });

    it('should handle gateway association extraction error gracefully', async () => {
      const client = createMockClient({
        [ResourceType.Gateway]: [
          { name: 'gw-1', properties: {} },
        ],
      });

      client.listResources = async function* (_ctx: ApimServiceContext, type: ResourceType, _parent?: ResourceDescriptor) {
        if (type === ResourceType.Gateway) {
          yield { name: 'gw-1', properties: {} };
        }
        if (type === ResourceType.GatewayApi) {
          throw new Error('GatewayApi listing failed');
        }
      };

      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);

      // Should not have fatal error
      expect(result.exitCode).not.toBe(2);
    });

    it('should extract transitive dependencies when includeTransitive is true', async () => {
      const client = createMockClient({
        [ResourceType.Backend]: [
          { name: 'backend-1', properties: {} },
        ],
      });

      // Mock getResource for transitive backend
      client.getResource = vi.fn().mockImplementation(async (_ctx, descriptor) => {
        if (descriptor.type === ResourceType.Backend && descriptor.nameParts[0] === 'transitive-backend') {
          return { name: 'transitive-backend', properties: {} };
        }
        return undefined;
      });

      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: true,
        filter: { apis: [] }, // Trigger transitive resolution
        logLevel: LogLevel.INFO,
      };

      // Since transitive resolution depends on finding dependencies in policies,
      // and we don't have policies here, this tests the code path exists
      const result = await runExtraction(client, store, config);

      expect(result.exitCode).toBe(0);
    });

    it('should handle transitive dependency not found (getResource returns null)', async () => {
      const client = createMockClient({});

      // getResource returns undefined for transitive deps
      client.getResource = vi.fn().mockResolvedValue(undefined);

      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: true,
        filter: { apis: [] },
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);

      // Should complete without crashing
      expect(result.exitCode).toBe(0);
    });

    it('should return EXIT_FATAL when errors > 0 and extracted === 0', async () => {
      const client = createMockClient({});

      // eslint-disable-next-line require-yield
      client.listResources = async function* () {
        throw new Error('All resource types fail');
      };

      const store = createMockStore();

      const config: ExtractConfig = {
        service: testContext,
        outputDir: '/output',
        includeTransitive: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runExtraction(client, store, config);

      // When all fail and nothing extracted, should be EXIT_FATAL (2)
      expect(result.totalExtracted).toBe(0);
      expect(result.totalErrors).toBeGreaterThan(0);
      expect(result.exitCode).toBe(2);
    });
  });
});
