// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { IApimClient } from '../../../src/clients/iapim-client.js';
import type { CompareConfig } from '../../../src/models/config.js';
import type {
  ApimServiceContext,
  ResourceDescriptor,
} from '../../../src/models/types.js';
import { LogLevel, logger } from '../../../src/lib/logger.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { compareApimInstances } from '../../../src/services/compare-service.js';

function createResource(
  serviceName: string,
  resourcePath: string,
  properties: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/${serviceName}/${resourcePath}`,
    name: resourcePath.split('/').at(-1),
    properties,
  };
}

function createMockClient(
  resourcesByType: Partial<Record<ResourceType, Record<string, unknown>[]>> = {},
): IApimClient {
  return {
    listResources: async function* (
      _context: ApimServiceContext,
      type: ResourceType,
      _parent?: ResourceDescriptor,
    ): AsyncIterable<Record<string, unknown>> {
      for (const resource of resourcesByType[type] ?? []) {
        yield resource;
      }
    },
    getResource: vi.fn().mockResolvedValue(undefined),
    putResource: vi.fn().mockResolvedValue({}),
    deleteResource: vi.fn().mockResolvedValue(true),
    listApiRevisions: async function* (): AsyncIterable<Record<string, unknown>> {
      yield* [];
    },
    getApiSpecification: vi.fn().mockResolvedValue(undefined),
    validatePreFlight: vi.fn().mockResolvedValue(undefined),
  };
}

function createContext(serviceName: string): ApimServiceContext {
  return {
    subscriptionId: 'sub-1',
    resourceGroup: 'rg-1',
    serviceName,
    apiVersion: '2024-05-01',
    baseUrl: `https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/${serviceName}`,
  };
}

describe('compare-service', () => {
  it('includes built-in groups products and apis in compare results', async () => {
    const sourceClient = createMockClient({
      [ResourceType.Group]: [
        createResource('source-apim', 'groups/developers', {
          displayName: 'Developers',
          description: 'Built-in group',
        }),
      ],
      [ResourceType.Product]: [
        createResource('source-apim', 'products/starter', {
          displayName: 'Starter',
          approvalRequired: false,
        }),
      ],
      [ResourceType.Api]: [
        createResource('source-apim', 'apis/echo-api', {
          displayName: 'Echo API',
          path: 'echo',
        }),
      ],
    });
    const targetClient = createMockClient();

    const config: CompareConfig = {
      source: createContext('source-apim'),
      target: createContext('target-apim'),
      sourceClient,
      targetClient,
      format: 'json',
      logLevel: LogLevel.INFO,
    };

    const result = await compareApimInstances(config);

    expect(result).toMatchObject({
      sourceResourceId:
        'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/source-apim',
      targetResourceId:
        'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/target-apim',
    });

    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: 'groups',
          resourceName: 'developers',
          displayName: 'Developers',
          diffType: 'missing',
          relativeResourceId: 'groups/developers',
          instance: 'source',
        }),
        expect.objectContaining({
          resourceType: 'products',
          resourceName: 'starter',
          displayName: 'Starter',
          diffType: 'missing',
          relativeResourceId: 'products/starter',
          instance: 'source',
        }),
        expect.objectContaining({
          resourceType: 'apis',
          resourceName: 'echo-api',
          displayName: 'Echo API',
          diffType: 'missing',
          relativeResourceId: 'apis/echo-api',
          instance: 'source',
        }),
      ]),
    );
  });

  it('includes master subscriptions in compare results', async () => {
    const sourceClient = createMockClient({
      [ResourceType.Subscription]: [
        createResource('source-apim', 'subscriptions/master', {
          displayName: 'Master Subscription',
        }),
      ],
    });
    const targetClient = createMockClient();

    const config: CompareConfig = {
      source: createContext('source-apim'),
      target: createContext('target-apim'),
      sourceClient,
      targetClient,
      format: 'json',
      logLevel: LogLevel.INFO,
    };

    const result = await compareApimInstances(config);

    expect(result).toMatchObject({
      sourceResourceId:
        'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/source-apim',
      targetResourceId:
        'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/target-apim',
    });

    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: 'subscriptions',
          resourceName: 'master',
          displayName: 'Master Subscription',
          diffType: 'missing',
          relativeResourceId: 'subscriptions/master',
          instance: 'source',
        }),
      ]),
    );
  });

  it('adds instance metadata and optional display names without changing semantics when absent', async () => {
    const sourceClient = createMockClient({
      [ResourceType.Tag]: [createResource('source-apim', 'tags/source-only-tag')],
      [ResourceType.Backend]: [
        createResource('source-apim', 'backends/0123456789abcdef01234567', {
          displayName: 'Shared backend',
          url: 'https://source.example.com',
        }),
      ],
    });
    const targetClient = createMockClient({
      [ResourceType.NamedValue]: [
        createResource('target-apim', 'namedValues/target-only-nv', {
          displayName: 'target-only-nv',
          secret: false,
          value: 'present',
        }),
      ],
      [ResourceType.Backend]: [
        createResource('target-apim', 'backends/fedcba9876543210fedcba98', {
          displayName: 'Shared backend',
          url: 'https://target.example.com',
        }),
      ],
    });

    const config: CompareConfig = {
      source: createContext('source-apim'),
      target: createContext('target-apim'),
      sourceClient,
      targetClient,
      format: 'json',
      logLevel: LogLevel.INFO,
    };

    const result = await compareApimInstances(config);

    expect(result).not.toHaveProperty('totalTypes');
    expect(result).not.toHaveProperty('totalResources');

    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: 'tags',
          resourceName: 'source-only-tag',
          diffType: 'missing',
          instance: 'source',
        }),
        expect.objectContaining({
          resourceType: 'namedValues',
          resourceName: 'target-only-nv',
          diffType: 'extra',
          displayName: 'target-only-nv',
          instance: 'target',
        }),
      ]),
    );

    const missingDiff = result.differences.find(
      (difference) =>
        difference.resourceType === 'tags' &&
        difference.resourceName === 'source-only-tag',
    );

    expect(missingDiff).not.toHaveProperty('displayName');
    expect(missingDiff).toHaveProperty('relativeResourceId', 'tags/source-only-tag');

    const propertyDiff = result.differences.find(
      (difference) =>
        difference.resourceType === 'backends' &&
        difference.resourceName === '{{auto-id-0}}',
    );

    expect(propertyDiff).toMatchObject({
      diffType: 'property-diff',
      displayName: 'Shared backend',
      relativeResourceId: 'backends/0123456789abcdef01234567',
      diffs: expect.any(Array),
    });
    expect(propertyDiff).not.toHaveProperty('instance');
  });

  it('includes source and target resource ids in compare differences', async () => {
    const sourceClient = createMockClient({
      [ResourceType.Subscription]: [
        createResource('source-apim', 'subscriptions/master', {
          displayName: 'Master subscription',
        }),
      ],
    });
    const targetClient = createMockClient({
      [ResourceType.Subscription]: [
        createResource('target-apim', 'subscriptions/target-only', {
          displayName: 'Target subscription',
        }),
      ],
    });

    const config: CompareConfig = {
      source: createContext('source-apim'),
      target: createContext('target-apim'),
      sourceClient,
      targetClient,
      format: 'json',
      logLevel: LogLevel.INFO,
    };

    const result = await compareApimInstances(config);

    expect(result).toMatchObject({
      sourceResourceId:
        'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/source-apim',
      targetResourceId:
        'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/target-apim',
    });

    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: 'subscriptions',
          resourceName: 'master',
          diffType: 'missing',
          instance: 'source',
          relativeResourceId: 'subscriptions/master',
        }),
        expect.objectContaining({
          resourceType: 'subscriptions',
          resourceName: 'target-only',
          diffType: 'extra',
          instance: 'target',
          relativeResourceId: 'subscriptions/target-only',
        }),
      ]),
    );
  });

  it('does not emit info logs for json output', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    const sourceClient = createMockClient();
    const targetClient = createMockClient();

    const config: CompareConfig = {
      source: createContext('source-apim'),
      target: createContext('target-apim'),
      sourceClient,
      targetClient,
      format: 'json',
      logLevel: LogLevel.INFO,
    };

    await compareApimInstances(config);

    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });
});