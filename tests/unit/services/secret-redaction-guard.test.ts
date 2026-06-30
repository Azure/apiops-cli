// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for the secret redaction pre-flight guard
 */

import { describe, it, expect, vi } from 'vitest';
import { scanForRedactionMarkers } from '../../../src/services/secret-redaction-guard.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { PublishConfig } from '../../../src/models/config.js';
import { LogLevel } from '../../../src/lib/logger.js';
import { REDACTION_MARKER } from '../../../src/services/secret-redactor.js';

function createMockStore() {
  return {
    writeResource: vi.fn(),
    writeContent: vi.fn(),
    writeAssociation: vi.fn(),
    readResource: vi.fn().mockResolvedValue(undefined),
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
  baseUrl:
    'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

const testConfig: PublishConfig = {
  service: testContext,
  sourceDir: '/source',
  dryRun: false,
  deleteUnmatched: false,
  logLevel: LogLevel.INFO,
};

const policyDescriptor: ResourceDescriptor = {
  type: ResourceType.ApiPolicy,
  nameParts: ['my-api'],
};

const namedValueDescriptor: ResourceDescriptor = {
  type: ResourceType.NamedValue,
  nameParts: ['my-secret'],
};

describe('secret-redaction-guard', () => {
  describe('scanForRedactionMarkers', () => {
    it('returns no findings when artifacts are clean', async () => {
      const store = createMockStore();
      store.readContent.mockResolvedValue({
        content: '<policies><inbound /></policies>',
      });
      store.readResource.mockResolvedValue({
        properties: { secret: true, value: 'real-secret' },
      });

      const findings = await scanForRedactionMarkers(store, testConfig, [
        policyDescriptor,
        namedValueDescriptor,
      ]);

      expect(findings).toEqual([]);
    });

    it('flags a policy that still contains the redaction marker', async () => {
      const store = createMockStore();
      store.readContent.mockResolvedValue({
        content: `<policies><inbound><set-header name="Authorization"><value>${REDACTION_MARKER}</value></set-header></inbound></policies>`,
      });

      const findings = await scanForRedactionMarkers(store, testConfig, [policyDescriptor]);

      expect(findings).toHaveLength(1);
      expect(findings[0].descriptor).toBe(policyDescriptor);
      expect(findings[0].location).toBe('policy.xml');
    });

    it('flags a secret named value that equals the redaction marker', async () => {
      const store = createMockStore();
      store.readResource.mockResolvedValue({
        properties: { secret: true, value: REDACTION_MARKER },
      });

      const findings = await scanForRedactionMarkers(store, testConfig, [namedValueDescriptor]);

      expect(findings).toHaveLength(1);
      expect(findings[0].descriptor).toBe(namedValueDescriptor);
      expect(findings[0].location).toBe('properties.value');
    });

    it('ignores a non-secret named value that equals the marker', async () => {
      const store = createMockStore();
      store.readResource.mockResolvedValue({
        properties: { secret: false, value: REDACTION_MARKER },
      });

      const findings = await scanForRedactionMarkers(store, testConfig, [namedValueDescriptor]);

      expect(findings).toEqual([]);
    });

    it('ignores a KeyVault-backed named value even if the marker is present', async () => {
      const store = createMockStore();
      store.readResource.mockResolvedValue({
        properties: {
          secret: true,
          value: REDACTION_MARKER,
          keyVault: { secretIdentifier: 'https://vault.vault.azure.net/secrets/x' },
        },
      });

      const findings = await scanForRedactionMarkers(store, testConfig, [namedValueDescriptor]);

      expect(findings).toEqual([]);
    });

    it('does not flag a marker that an override replaces with clean content', async () => {
      const store = createMockStore();
      store.readContent.mockResolvedValue({
        content: `<policies><inbound><value>${REDACTION_MARKER}</value></inbound></policies>`,
      });

      const configWithOverride: PublishConfig = {
        ...testConfig,
        overrides: {
          apis: {
            'my-api': {
              properties: {},
              children: {
                policies: {
                  policy: {
                    properties: { value: '<policies><inbound /></policies>' },
                  },
                },
              },
            },
          },
        },
      };

      const findings = await scanForRedactionMarkers(store, configWithOverride, [policyDescriptor]);

      expect(findings).toEqual([]);
    });

    it('collects findings across multiple offending artifacts', async () => {
      const store = createMockStore();
      store.readContent.mockResolvedValue({
        content: `<policies>${REDACTION_MARKER}</policies>`,
      });
      store.readResource.mockResolvedValue({
        properties: { secret: true, value: REDACTION_MARKER },
      });

      const findings = await scanForRedactionMarkers(store, testConfig, [
        policyDescriptor,
        namedValueDescriptor,
      ]);

      expect(findings).toHaveLength(2);
    });

    it('skips resource types that cannot carry secrets', async () => {
      const store = createMockStore();

      const findings = await scanForRedactionMarkers(store, testConfig, [
        { type: ResourceType.Api, nameParts: ['my-api'] },
      ]);

      expect(findings).toEqual([]);
      expect(store.readContent).not.toHaveBeenCalled();
      expect(store.readResource).not.toHaveBeenCalled();
    });
  });
});
