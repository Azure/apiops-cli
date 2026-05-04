/**
 * Unit tests for T030: Publish orchestration service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ResourceDescriptor, ApimServiceContext } from '../../../src/models/types.js';
import { PublishConfig } from '../../../src/models/config.js';
import { LogLevel } from '../../../src/lib/logger.js';

// Mock service dependencies
vi.mock('../../../src/services/git-diff-service.js');
vi.mock('../../../src/services/dry-run-reporter.js');
vi.mock('../../../src/services/delete-unmatched-service.js');
vi.mock('../../../src/services/api-publisher.js');
vi.mock('../../../src/services/product-publisher.js');

// Import the module under test and mocked modules
import { runPublish } from '../../../src/services/publish-service.js';
import { computeGitDiff } from '../../../src/services/git-diff-service.js';
import { generateDryRunReport } from '../../../src/services/dry-run-reporter.js';
import { computeDeleteActions } from '../../../src/services/delete-unmatched-service.js';
import { publishApi } from '../../../src/services/api-publisher.js';
import { publishProduct } from '../../../src/services/product-publisher.js';

function createMockClient() {
  return {
    listResources: async function* () {},
    getResource: vi.fn(),
    putResource: vi.fn().mockResolvedValue(undefined),
    deleteResource: vi.fn().mockResolvedValue(true),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn(),
    validatePreFlight: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockStore(resources: ResourceDescriptor[] = []) {
  return {
    writeResource: vi.fn(),
    writeContent: vi.fn(),
    writeAssociation: vi.fn(),
    readResource: vi.fn().mockImplementation(async (_sourceDir: string, descriptor: ResourceDescriptor) => {
      return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: {} };
    }),
    readContent: vi.fn().mockResolvedValue(undefined),
    readAssociation: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue(resources),
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

describe('publish-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(computeGitDiff).mockResolvedValue({
      changedDescriptors: [],
      deletedDescriptors: [],
    });
    
    vi.mocked(generateDryRunReport).mockResolvedValue({
      actions: [],
      summary: { creates: 0, deletes: 0, skips: 0 },
    });
    
    vi.mocked(computeDeleteActions).mockResolvedValue([]);
    
    vi.mocked(publishApi).mockResolvedValue({
      descriptor: { type: ResourceType.Api, nameParts: ['test-api'] },
      status: 'success',
      action: 'put',
    });

    vi.mocked(publishProduct).mockResolvedValue({
      descriptor: { type: ResourceType.Product, nameParts: ['test-product'] },
      status: 'success',
      action: 'put',
    });
  });

  describe('runPublish', () => {
    it('should call publishResource for each artifact in dependency order', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        { type: ResourceType.Api, nameParts: ['api1'] },
        { type: ResourceType.Backend, nameParts: ['backend1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.totalPuts).toBe(3);
      expect(result.exitCode).toBe(0);
    });

    it('should return exit code 0 when all succeed', async () => {
      const resources = [
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(0);
      expect(result.totalErrors).toBe(0);
    });

    it('should return exit code 1 when some fail', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        { type: ResourceType.NamedValue, nameParts: ['nv2'] },
      ];

      const client = createMockClient();
      client.putResource.mockImplementation(async (ctx, descriptor) => {
        if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'nv2') {
          throw new Error('PUT failed');
        }
      });
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(1);
      expect(result.totalErrors).toBe(1);
    });

    it('should return exit code 2 when all fail or fatal error', async () => {
      const resources = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
      ];

      const client = createMockClient();
      client.putResource.mockRejectedValue(new Error('Fatal error'));
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(2);
    });

    it('should use publishApi for Api type resources', async () => {
      const resources = [
        { type: ResourceType.Api, nameParts: ['my-api'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(publishApi).toHaveBeenCalled();
    });

    it('should call generateDryRunReport in dry-run mode', async () => {
      const resources = [
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: true,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(generateDryRunReport).toHaveBeenCalled();
      expect(result.dryRunReport).toBeDefined();
      expect(client.putResource).not.toHaveBeenCalled();
    });

    it('should use computeGitDiff when commitId is set (incremental mode)', async () => {
      const client = createMockClient();
      const store = createMockStore([]);

      vi.mocked(computeGitDiff).mockResolvedValue({
        changedDescriptors: [
          { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        ],
        deletedDescriptors: [],
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        commitId: 'abc123',
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(computeGitDiff).toHaveBeenCalledWith('/source', 'abc123');
    });

    it('should call computeDeleteActions when deleteUnmatched is true', async () => {
      const resources = [
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      vi.mocked(computeDeleteActions).mockResolvedValue([
        { type: ResourceType.Backend, nameParts: ['old-backend'] },
      ]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: true,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(computeDeleteActions).toHaveBeenCalled();
      expect(result.totalDeletes).toBe(1);
    });

    it('should output per-resource status lines', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const resources = [
        { type: ResourceType.Tag, nameParts: ['tag1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('PUT'));

      stdoutSpy.mockRestore();
    });

    it('should handle resources in tier order', async () => {
      const resources = [
        { type: ResourceType.Backend, nameParts: ['backend1'] },
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.totalPuts).toBe(2);
      expect(client.putResource).toHaveBeenCalledTimes(2);
    });
  });

  describe('pre-flight validation', () => {
    it('should call validatePreFlight before publishing', async () => {
      const client = createMockClient();
      const store = createMockStore([{ type: ResourceType.Tag, nameParts: ['tag1'] }]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(client.validatePreFlight).toHaveBeenCalledWith(testContext);
    });

    it('should return validation failure exit code when resource group does not exist', async () => {
      const client = createMockClient();
      vi.mocked(client.validatePreFlight).mockRejectedValue(
        new Error("Resource group 'rg-1' not found in subscription 'sub-1'. Ensure the resource group exists before publishing.")
      );
      const store = createMockStore([]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(2);
      expect(result.totalErrors).toBe(1);
    });

    it('should return validation failure exit code when APIM service does not exist', async () => {
      const client = createMockClient();
      vi.mocked(client.validatePreFlight).mockRejectedValue(
        new Error("APIM service 'apim-1' not found in resource group 'rg-1'. Ensure the APIM instance exists before publishing.")
      );
      const store = createMockStore([]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.exitCode).toBe(2);
      expect(result.totalErrors).toBe(1);
    });

    it('should not publish any resources when pre-flight fails', async () => {
      const client = createMockClient();
      vi.mocked(client.validatePreFlight).mockRejectedValue(
        new Error("Resource group 'rg-missing' not found.")
      );
      const store = createMockStore([{ type: ResourceType.Tag, nameParts: ['tag1'] }]);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      expect(client.putResource).not.toHaveBeenCalled();
    });
  });

  describe('named value ordering within tier 1', () => {
    it('should publish named values before loggers within tier 1', async () => {
      const publishOrder: string[] = [];

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Logger, nameParts: ['appinsights-logger'] },
        { type: ResourceType.NamedValue, nameParts: ['AppInsights-InstrumentationKey'] },
        { type: ResourceType.NamedValue, nameParts: ['Gemini-ApiKey'] },
        { type: ResourceType.Backend, nameParts: ['my-backend'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockImplementation(
        async (_ctx, descriptor) => {
          publishOrder.push(descriptor.nameParts[descriptor.nameParts.length - 1] ?? "");
        }
      );

      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => ({ name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: {} })
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      // Both named values must appear before the logger
      const nvIdx1 = publishOrder.indexOf('AppInsights-InstrumentationKey');
      const nvIdx2 = publishOrder.indexOf('Gemini-ApiKey');
      const loggerIdx = publishOrder.indexOf('appinsights-logger');
      const backendIdx = publishOrder.indexOf('my-backend');

      expect(nvIdx1).toBeGreaterThan(-1);
      expect(nvIdx2).toBeGreaterThan(-1);
      expect(loggerIdx).toBeGreaterThan(-1);
      expect(backendIdx).toBeGreaterThan(-1);

      expect(nvIdx1).toBeLessThan(loggerIdx);
      expect(nvIdx2).toBeLessThan(loggerIdx);
      expect(nvIdx1).toBeLessThan(backendIdx);
      expect(nvIdx2).toBeLessThan(backendIdx);
    });

    it('should publish named values before pool backends within tier 1', async () => {
      const publishOrder: string[] = [];

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Backend, nameParts: ['pool-b'] },
        { type: ResourceType.Backend, nameParts: ['regular-b'] },
        { type: ResourceType.NamedValue, nameParts: ['my-nv'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockImplementation(
        async (_ctx, descriptor) => {
          publishOrder.push(descriptor.nameParts[descriptor.nameParts.length - 1] ?? "");
        }
      );

      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => {
          if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'pool-b') {
            return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { type: 'Pool' } };
          }
          return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: {} };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      const nvIdx = publishOrder.indexOf('my-nv');
      const poolIdx = publishOrder.indexOf('pool-b');
      const regularIdx = publishOrder.indexOf('regular-b');

      expect(nvIdx).toBeLessThan(regularIdx);
      expect(nvIdx).toBeLessThan(poolIdx);
      // Pool backend still comes after regular backend
      expect(poolIdx).toBeGreaterThan(regularIdx);
    });
  });

  describe('pool backend ordering', () => {
    it('should publish regular backends before pool backends within tier 1', async () => {
      const publishOrder: string[] = [];

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Backend, nameParts: ['premium-pool'] },
        { type: ResourceType.Backend, nameParts: ['premium-service-1'] },
        { type: ResourceType.Backend, nameParts: ['premium-service-2'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockImplementation(
        async (_ctx, descriptor) => {
          publishOrder.push(descriptor.nameParts[descriptor.nameParts.length - 1] ?? "");
        }
      );

      const store = createMockStore(resources);
      // premium-pool is a pool backend; the other two are regular backends.
      // The pool service references (weight/priority) are included to reflect
      // real APIM artifacts; their values are passed through opaquely by the
      // resource publisher (FR-009) and are not inspected here.
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => {
          if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'premium-pool') {
            return {
              name: descriptor.nameParts[descriptor.nameParts.length - 1] ?? "",
              properties: {
                type: 'Pool',
                pool: {
                  services: [
                    { id: '.../backends/premium-service-1', weight: 1, priority: 1 },
                    { id: '.../backends/premium-service-2', weight: 1, priority: 1 },
                  ],
                },
              },
            };
          }
          return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { url: 'https://example.com', protocol: 'http' } };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      // Pool backend must appear after both regular backends
      const poolIdx = publishOrder.indexOf('premium-pool');
      const svc1Idx = publishOrder.indexOf('premium-service-1');
      const svc2Idx = publishOrder.indexOf('premium-service-2');

      expect(poolIdx).toBeGreaterThan(-1);
      expect(svc1Idx).toBeGreaterThan(-1);
      expect(svc2Idx).toBeGreaterThan(-1);
      expect(poolIdx).toBeGreaterThan(svc1Idx);
      expect(poolIdx).toBeGreaterThan(svc2Idx);
    });

    it('should treat a Backend with no type property as a regular backend', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Backend, nameParts: ['plain-backend'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockResolvedValue({
        name: 'plain-backend',
        properties: { url: 'https://example.com', protocol: 'http' },
      });

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      expect(result.totalPuts).toBe(1);
      expect(client.putResource).toHaveBeenCalledTimes(1);
    });

    it('should detect pool backends case-insensitively', async () => {
      const publishOrder: string[] = [];

      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Backend, nameParts: ['POOL-backend'] },
        { type: ResourceType.Backend, nameParts: ['member-backend'] },
      ];

      const client = createMockClient();
      vi.mocked(client.putResource).mockImplementation(
        async (_ctx, descriptor) => {
          publishOrder.push(descriptor.nameParts[descriptor.nameParts.length - 1] ?? "");
        }
      );

      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => {
          if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'POOL-backend') {
            return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { type: 'pool' } };
          }
          return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { url: 'https://example.com', protocol: 'http' } };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      const poolIdx = publishOrder.indexOf('POOL-backend');
      const memberIdx = publishOrder.indexOf('member-backend');

      expect(poolIdx).toBeGreaterThan(memberIdx);
    });

    it('should publish all tier 1 resources including pool backends', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.NamedValue, nameParts: ['nv1'] },
        { type: ResourceType.Tag, nameParts: ['tag1'] },
        { type: ResourceType.Backend, nameParts: ['pool-b'] },
        { type: ResourceType.Backend, nameParts: ['regular-b'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => {
          if ((descriptor.nameParts[descriptor.nameParts.length - 1] ?? '') === 'pool-b') {
            return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: { type: 'Pool' } };
          }
          return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: {} };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      const result = await runPublish(client, store, config);

      // All 4 resources should be published
      expect(result.totalPuts).toBe(4);
    });
  });

  describe('product publish routing', () => {
    it('uses publishProduct for Product type resources', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Product, nameParts: ['my-product'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      // publishProduct should be called with the right descriptor and config
      expect(publishProduct).toHaveBeenCalledOnce();
      expect(publishProduct).toHaveBeenCalledWith(
        client,
        store,
        testContext,
        { type: ResourceType.Product, nameParts: ['my-product'] },
        config,
      );

      // Product must NOT be published via a direct putResource call
      const productPutCalls = (client.putResource.mock.calls as unknown[][]).filter((c) => {
        const d = c[1] as ResourceDescriptor;
        return d?.type === ResourceType.Product;
      });
      expect(productPutCalls).toHaveLength(0);
    });

    it('skips ProductApi children when parent Product is in the batch', async () => {
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.Product, nameParts: ['my-product'] },
        // ProductApi child with same parent name — should be skipped by tier filtering
        { type: ResourceType.ProductApi, nameParts: ['my-product', 'petstore'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      await runPublish(client, store, config);

      // ProductApi should NOT receive a standalone putResource call
      // (publishProduct handles associations internally)
      const productApiCalls = (client.putResource.mock.calls as unknown[][]).filter((c) => {
        const d = c[1] as ResourceDescriptor;
        return d.type === ResourceType.ProductApi;
      });
      expect(productApiCalls).toHaveLength(0);
    });
  });

  describe('singleton resources with empty nameParts', () => {
    it('should handle ServicePolicy with empty nameParts without crashing', async () => {
      // ServicePolicy is a singleton with no placeholders, resulting in empty nameParts
      const resources: ResourceDescriptor[] = [
        { type: ResourceType.ServicePolicy, nameParts: [] },
        { type: ResourceType.Api, nameParts: ['my-api'] },
        { type: ResourceType.NamedValue, nameParts: ['my-nv'] },
      ];

      const client = createMockClient();
      const store = createMockStore(resources);
      
      // Mock readResource to handle empty nameParts for ServicePolicy
      vi.mocked(store.readResource).mockImplementation(
        async (_sourceDir, descriptor) => {
          if (descriptor.type === ResourceType.ServicePolicy) {
            return { properties: { format: 'xml', value: '<policies><inbound /></policies>' } };
          }
          return { name: (descriptor.nameParts[descriptor.nameParts.length - 1] ?? ""), properties: {} };
        }
      );

      const config: PublishConfig = {
        service: testContext,
        sourceDir: '/source',
        dryRun: false,
        deleteUnmatched: false,
        logLevel: LogLevel.INFO,
      };

      // This should NOT throw "RangeError: getNamePart: nameParts[0] is out of range"
      const result = await runPublish(client, store, config);

      expect(result.totalErrors).toBe(0);
      expect(result.exitCode).toBe(0);
      expect(result.totalPuts).toBe(3);
    });
  });
});
