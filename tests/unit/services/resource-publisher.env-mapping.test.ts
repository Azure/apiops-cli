// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Integration tests for resource-publisher env-mapping behavior.
 * Verifies that EnvMapping is applied at every PUT boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishResource } from '../../../src/services/resource-publisher.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import type { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import type { PublishConfig, KnownArtifactSets } from '../../../src/models/config.js';
import type { EnvMapping } from '../../../src/services/env-mapper.js';
import { DEFAULT_APPLIES_TO } from '../../../src/services/env-mapper.js';
import { LogLevel } from '../../../src/lib/logger.js';

// Mock keyvault-checker
vi.mock('../../../src/services/keyvault-checker.js', () => ({
  checkKeyVaultSecretAccess: vi.fn().mockResolvedValue(undefined),
  KeyVaultAccessError: class KeyVaultAccessError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'KeyVaultAccessError';
    }
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockClient() {
  return {
    listResources: async function* () {},
    getResource: vi.fn(),
    putResource: vi.fn().mockResolvedValue(undefined),
    patchResource: vi.fn().mockResolvedValue(undefined),
    deleteResource: vi.fn(),
    listApiRevisions: async function* () {},
    getApiSpecification: vi.fn(),
    validatePreFlight: vi.fn().mockResolvedValue(undefined),
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
  baseUrl:
    'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

const baseConfig: PublishConfig = {
  service: testContext,
  sourceDir: '/source',
  dryRun: false,
  deleteUnmatched: false,
  logLevel: LogLevel.INFO,
};

const DEV_MAPPING: EnvMapping = {
  prefix: 'dev-',
  suffix: '',
  appliesTo: DEFAULT_APPLIES_TO,
};

const EMPTY_KNOWN: KnownArtifactSets = {
  namedValues: new Set(),
  fragments: new Set(),
  backends: new Set(),
};

function makeConfig(overrides?: Partial<PublishConfig>): PublishConfig {
  return { ...baseConfig, ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resource-publisher env-mapping', () => {
  let client: ReturnType<typeof createMockClient>;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    client = createMockClient();
    store = createMockStore();
  });

  describe('no envMapping — regression', () => {
    it('passes descriptor unchanged when no envMapping', async () => {
      store.readResource.mockResolvedValue({ name: 'petstore', properties: { displayName: 'Petstore' } });
      const descriptor: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['petstore'] };
      await publishResource(client, store, testContext, descriptor, makeConfig());
      const [, putDescriptor] = client.putResource.mock.calls[0] as [unknown, ResourceDescriptor, unknown];
      expect(putDescriptor.nameParts[0]).toBe('petstore');
    });
  });

  describe('Api PUT', () => {
    it('affixes descriptor name with prefix', async () => {
      store.readResource.mockResolvedValue({ name: 'petstore', properties: { displayName: 'Petstore', path: 'petstore' } });
      const descriptor: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['petstore'] };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, putDescriptor] = client.putResource.mock.calls[0] as [unknown, ResourceDescriptor, unknown];
      expect(putDescriptor.nameParts[0]).toBe('dev-petstore');
    });
  });

  describe('Api path prefix', () => {
    it('prepends apiPathPrefix to properties.path when no explicit path override', async () => {
      store.readResource.mockResolvedValue({ name: 'petstore', properties: { path: 'petstore', displayName: 'Petstore' } });
      const descriptor: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['petstore'] };
      const mappingWithPath: EnvMapping = { ...DEV_MAPPING, apiPathPrefix: 'dev/' };
      const config = makeConfig({ envMapping: mappingWithPath, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect((payload.properties as Record<string, unknown>).path).toBe('dev/petstore');
    });

    it('does NOT prepend apiPathPrefix when explicit path override is present', async () => {
      store.readResource.mockResolvedValue({ name: 'petstore', properties: { path: 'petstore', displayName: 'Petstore' } });
      const descriptor: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['petstore'] };
      const mappingWithPath: EnvMapping = { ...DEV_MAPPING, apiPathPrefix: 'dev/' };
      const config = makeConfig({
        envMapping: mappingWithPath,
        knownArtifactSets: EMPTY_KNOWN,
        overrides: { apis: { petstore: { properties: { path: 'my-explicit-path' } } } },
      });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      // Override sets path to 'my-explicit-path'; no prefix applied
      expect((payload.properties as Record<string, unknown>).path).toBe('my-explicit-path');
    });
  });

  describe('ApiOperation PUT', () => {
    it('affixes parent Api name but leaves operation key unchanged', async () => {
      store.readResource.mockResolvedValue({ name: 'get-pets', properties: { displayName: 'List Pets', method: 'GET', urlTemplate: '/pets', description: '' } });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiOperation,
        nameParts: ['petstore', 'get-pets'],
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, putDescriptor] = client.putResource.mock.calls[0] as [unknown, ResourceDescriptor, unknown];
      expect(putDescriptor.nameParts[0]).toBe('dev-petstore'); // parent affixed
      expect(putDescriptor.nameParts[1]).toBe('get-pets'); // operation key unchanged
    });
  });

  describe('ProductApi association', () => {
    it('affixes both product and api segments', async () => {
      store.readAssociation.mockResolvedValue([{ name: 'petstore' }]);
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ProductApi,
        nameParts: ['starter'],
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, putDescriptor] = client.putResource.mock.calls[0] as [unknown, ResourceDescriptor, unknown];
      expect(putDescriptor.nameParts[0]).toBe('dev-starter'); // product affixed
      expect(putDescriptor.nameParts[1]).toBe('dev-petstore'); // api affixed
    });
  });

  describe('Subscription scope', () => {
    it('affixes api name in /apis/<name> scope', async () => {
      const armPrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';
      store.readResource.mockResolvedValue({
        name: 'my-sub',
        properties: {
          scope: `${armPrefix}/apis/petstore-api`,
          displayName: 'My Sub',
        },
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Subscription,
        nameParts: ['my-sub'],
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect((payload.properties as Record<string, unknown>).scope).toBe('/apis/dev-petstore-api');
    });

    it('affixes product name in /products/<name> scope', async () => {
      const armPrefix =
        '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1';
      store.readResource.mockResolvedValue({
        name: 'my-sub',
        properties: {
          scope: `${armPrefix}/products/starter`,
          displayName: 'My Sub',
        },
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Subscription,
        nameParts: ['my-sub'],
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect((payload.properties as Record<string, unknown>).scope).toBe('/products/dev-starter');
    });
  });

  describe('ApiRelease apiId', () => {
    it('affixes api name in apiId, preserving ;rev=N suffix', async () => {
      const srcArmPrefix =
        '/subscriptions/src-sub/resourceGroups/src-rg/providers/Microsoft.ApiManagement/service/src-apim';
      store.readResource.mockResolvedValue({
        name: 'rel1',
        properties: {
          apiId: `${srcArmPrefix}/apis/petstore-api;rev=2`,
          notes: 'v2 release',
        },
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiRelease,
        nameParts: ['petstore-api', 'rel1'],
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      const apiId = (payload.properties as Record<string, unknown>).apiId as string;
      expect(apiId).toContain('/apis/dev-petstore-api;rev=2');
    });
  });

  describe('API revision sourceApiId', () => {
    it('affixes baseApiName in sourceApiId', async () => {
      store.readResource.mockResolvedValue({
        name: 'petstore;rev=2',
        properties: { displayName: 'Petstore', path: 'petstore', apiRevision: '2' },
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['petstore;rev=2'],
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      const sourceApiId = (payload.properties as Record<string, unknown>).sourceApiId as string;
      expect(sourceApiId).toContain('/apis/dev-petstore');
    });
  });

  describe('NamedValue displayName', () => {
    it('affixes displayName when no explicit override', async () => {
      store.readResource.mockResolvedValue({
        name: 'myNv',
        properties: { displayName: 'myNv', value: 'secret', secret: false },
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['myNv'],
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect((payload.properties as Record<string, unknown>).displayName).toBe('dev-myNv');
    });

    it('does NOT re-affix displayName when user override sets it explicitly', async () => {
      store.readResource.mockResolvedValue({
        name: 'myNv',
        properties: { displayName: 'myNv', value: 'secret', secret: false },
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['myNv'],
      };
      const config = makeConfig({
        envMapping: DEV_MAPPING,
        knownArtifactSets: EMPTY_KNOWN,
        overrides: {
          namedValues: { myNv: { properties: { displayName: 'explicit-display-name' } } },
        },
      });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      expect((payload.properties as Record<string, unknown>).displayName).toBe('explicit-display-name');
    });
  });

  describe('Logger credentials {{ref}} rewrite', () => {
    it('rewrites {{canonicalNvName}} to {{dev-canonicalNvName}} when envMapping applies', async () => {
      // Logger has {{myNv}} credential; NV artifact has displayName matching resource name
      store.readResource.mockImplementation(async (_dir: string, d: ResourceDescriptor) => {
        if (d.type === ResourceType.Logger) {
          return {
            name: 'my-logger',
            properties: {
              loggerType: 'applicationInsights',
              credentials: { instrumentationKey: '{{myNv}}' },
            },
          };
        }
        if (d.type === ResourceType.NamedValue && d.nameParts[0] === 'myNv') {
          return {
            name: 'myNv',
            properties: { displayName: 'myNv', value: 'secret', secret: false },
          };
        }
        return null;
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Logger,
        nameParts: ['my-logger'],
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      const creds = (payload.properties as Record<string, unknown>).credentials as Record<string, unknown>;
      expect(creds.instrumentationKey).toBe('{{dev-myNv}}');
    });
  });

  describe('Policy XML rewrite', () => {
    it('rewrites {{nvName}}, fragment-id, backend-id in policy content', async () => {
      const xml =
        '<policies><inbound>' +
        '{{myNv}}' +
        '<include-fragment fragment-id="myFrag" />' +
        '<set-backend-service backend-id="myBackend" />' +
        '</inbound></policies>';
      store.readContent.mockResolvedValue({ content: xml });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['petstore'],
      };
      const known: KnownArtifactSets = {
        namedValues: new Set(['myNv']),
        fragments: new Set(['myFrag']),
        backends: new Set(['myBackend']),
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: known });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      const value = (payload.properties as Record<string, unknown>).value as string;
      expect(value).toContain('{{dev-myNv}}');
      expect(value).toContain('fragment-id="dev-myFrag"');
      expect(value).toContain('backend-id="dev-myBackend"');
    });
  });

  describe('PolicyFragment content rewrite', () => {
    it('rewrites refs inside fragment value', async () => {
      store.readResource.mockResolvedValue({
        name: 'myFrag',
        properties: {
          value: '<fragment><set-backend-service backend-id="myBackend" /></fragment>',
          description: 'My fragment',
          format: 'rawxml',
        },
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.PolicyFragment,
        nameParts: ['myFrag'],
      };
      const known: KnownArtifactSets = {
        namedValues: new Set(),
        fragments: new Set(),
        backends: new Set(['myBackend']),
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: known });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      const value = (payload.properties as Record<string, unknown>).value as string;
      expect(value).toContain('backend-id="dev-myBackend"');
    });
  });

  describe('Type not in appliesTo', () => {
    it('passes Diagnostic descriptor unchanged when appliesTo is default (Diagnostic not included)', async () => {
      store.readResource.mockResolvedValue({
        name: 'applicationinsights',
        properties: { loggerId: '/loggers/my-logger' },
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Diagnostic,
        nameParts: ['applicationinsights'],
      };
      // DEFAULT_APPLIES_TO does not include Diagnostic
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, putDescriptor] = client.putResource.mock.calls[0] as [unknown, ResourceDescriptor, unknown];
      expect(putDescriptor.nameParts[0]).toBe('applicationinsights'); // unchanged
    });
  });

  describe('McpTool operationId', () => {
    it('affixes api name segment in operationId, leaves operation name unchanged', async () => {
      const srcArmPrefix =
        '/subscriptions/src-sub/resourceGroups/src-rg/providers/Microsoft.ApiManagement/service/src-apim';
      store.readResource.mockResolvedValue({
        name: 'mcp-api',
        properties: {
          displayName: 'MCP API',
          path: 'mcp',
          type: 'http',
          mcpTools: [
            {
              name: 'listPets',
              operationId: `${srcArmPrefix}/apis/petstore/operations/list-pets`,
            },
          ],
        },
      });
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['mcp-api'],
      };
      const config = makeConfig({ envMapping: DEV_MAPPING, knownArtifactSets: EMPTY_KNOWN });
      await publishResource(client, store, testContext, descriptor, config);
      const [, , payload] = client.putResource.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
      const tools = (payload.properties as Record<string, unknown>).mcpTools as Array<Record<string, unknown>>;
      const opId = tools[0].operationId as string;
      expect(opId).toContain('/apis/dev-petstore/');
      expect(opId).toContain('/operations/list-pets'); // operation unchanged
    });
  });
});
