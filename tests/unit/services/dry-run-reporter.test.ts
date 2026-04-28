/**
 * Unit tests for T034: Dry-run reporter service
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

    it('should report association endpoints as PUT (not SKIP) when getResource returns undefined due to 405', async () => {
      // APIM association endpoints (ProductGroup, ProductApi, GatewayApi) return
      // HTTP 405 on GET. ApimClient.getResource catches 405 and returns undefined,
      // so the dry-run reporter must treat them as "would be created" (PUT new),
      // not as errors (SKIP).
      const client = createMockClient();
      // Simulate getResource returning undefined (as ApimClient does for 405)
      client.getResource.mockResolvedValue(undefined);
      const store = createMockStore();

      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.ProductGroup, nameParts: ['my-product', 'my-group'] },
        { type: ResourceType.ProductApi, nameParts: ['my-product', 'my-api'] },
        { type: ResourceType.GatewayApi, nameParts: ['my-gateway', 'my-api'] },
      ];

      const report = await generateDryRunReport(store, client, testContext, testConfig, descriptors);

      // All three association resources should be reported as PUT (new), not SKIP
      expect(report.summary.skips).toBe(0);
      expect(report.actions).toHaveLength(3);
      for (const action of report.actions) {
        expect(action.operation).toBe('PUT');
      }
    });
  });
});
