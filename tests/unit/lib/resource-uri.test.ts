// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect } from 'vitest';
import { buildArmUri, parseArmUri, buildResourceLabel, getRelativeResourceId } from '../../../src/lib/resource-uri.js';
import { ApimServiceContext, ResourceDescriptor } from '../../../src/models/types.js';
import { ResourceType } from '../../../src/models/resource-types.js';

const context: ApimServiceContext = {
  subscriptionId: 'sub-123',
  resourceGroup: 'rg-test',
  serviceName: 'my-apim',
  apiVersion: '2024-05-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-123/resourceGroups/rg-test/providers/Microsoft.ApiManagement/service/my-apim',
};

describe('buildArmUri', () => {
  it('should build URI for a top-level resource (NamedValue)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      nameParts: ['mySecret'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toBe(
      `${context.baseUrl}/namedValues/mySecret?api-version=${context.apiVersion}`
    );
  });

  it('should build URI for Api resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      nameParts: ['my-api'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api');
    expect(uri).toContain('api-version=2024-05-01');
  });

  it('should build URI for Product resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      nameParts: ['starter'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/products/starter');
  });

  it('should build URI for child resource (ApiPolicy)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiPolicy,
      nameParts: ['my-api'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/policies/policy');
  });

  it('should build URI for ApiOperation', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      nameParts: ['my-api', 'getUsers'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/operations/getUsers');
  });

  it('should build URI for ApiOperationPolicy', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperationPolicy,
      nameParts: ['my-api', 'getUsers'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/operations/getUsers/policies/policy');
  });

  it('should build URI for ProductApi', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ProductApi,
      nameParts: ['starter', 'my-api'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/products/starter/apis/my-api');
  });

  it('should build URI for ApiTag', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiTag,
      nameParts: ['my-api', 'v1'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/tags/v1');
  });

  it('should build URI for ApiDiagnostic', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiDiagnostic,
      nameParts: ['my-api', 'applicationinsights'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/diagnostics/applicationinsights');
  });

  it('should URL-encode resource names', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      nameParts: ['my secret value'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/namedValues/my%20secret%20value');
  });

  it('should include workspace prefix if set', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      nameParts: ['ws-api'],
      workspace: 'my-workspace',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/workspaces/my-workspace/apis/ws-api');
  });

  it('should throw for unresolved placeholders (missing nameParts)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolver,
      nameParts: ['myApi'], // only 1 of 2 required name-parts
    };
    expect(() => buildArmUri(context, descriptor)).toThrow('Unresolved placeholder');
  });

  it('should build URI for GraphQLResolver with both name-parts', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolver,
      nameParts: ['my-api', 'myResolver'],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/resolvers/myResolver');
  });

  it('should build URI for ServicePolicy (singleton, no name-parts)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ServicePolicy,
      nameParts: [],
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/policies/policy');
  });
});

describe('parseArmUri', () => {
  it('should parse a top-level resource URI', () => {
    const uri = `${context.baseUrl}/namedValues/mySecret?api-version=2024-05-01`;
    const result = parseArmUri(uri, context);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.NamedValue);
    expect(result!.nameParts[0]).toBe('mySecret');
  });

  it('should return undefined for non-matching base URL', () => {
    const uri = 'https://other.azure.com/namedValues/mySecret';
    const result = parseArmUri(uri, context);
    expect(result).toBeUndefined();
  });

  it('should parse workspace-scoped resource URI', () => {
    const uri = `${context.baseUrl}/workspaces/ws1/apis/my-api?api-version=2024-05-01`;
    const result = parseArmUri(uri, context);
    expect(result).toBeDefined();
    expect(result!.workspace).toBe('ws1');
    expect(result!.nameParts[0]).toBe('my-api');
  });

  it('should parse URL-encoded resource names', () => {
    const uri = `${context.baseUrl}/namedValues/my%20secret?api-version=2024-05-01`;
    const result = parseArmUri(uri, context);
    expect(result).toBeDefined();
    expect(result!.nameParts[0]).toBe('my secret');
  });

  it('should strip query parameters before matching', () => {
    const uri = `${context.baseUrl}/tags/v1?api-version=2024-05-01&extra=true`;
    const result = parseArmUri(uri, context);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.Tag);
  });

  it('should return undefined for unrecognized paths', () => {
    const uri = `${context.baseUrl}/unknownResources/foo`;
    const result = parseArmUri(uri, context);
    expect(result).toBeUndefined();
  });
});

describe('buildArmUri + parseArmUri roundtrip', () => {
  const simpleTypes: { type: ResourceType; nameParts: string[] }[] = [
    { type: ResourceType.NamedValue, nameParts: ['nv1'] },
    { type: ResourceType.Tag, nameParts: ['tag1'] },
    { type: ResourceType.Gateway, nameParts: ['gw1'] },
    { type: ResourceType.Backend, nameParts: ['be1'] },
    { type: ResourceType.Logger, nameParts: ['log1'] },
    { type: ResourceType.Group, nameParts: ['grp1'] },
    { type: ResourceType.Product, nameParts: ['prod1'] },
    { type: ResourceType.Api, nameParts: ['api1'] },
    { type: ResourceType.Subscription, nameParts: ['sub1'] },
    { type: ResourceType.GlobalSchema, nameParts: ['schema1'] },
  ];

  for (const { type, nameParts } of simpleTypes) {
    it(`should roundtrip for ${type}`, () => {
      const descriptor: ResourceDescriptor = { type, nameParts };
      const uri = buildArmUri(context, descriptor);
      const parsed = parseArmUri(uri, context);
      expect(parsed).toBeDefined();
      expect(parsed!.type).toBe(type);
      expect(parsed!.nameParts).toEqual(nameParts);
    });
  }
});

describe('buildResourceLabel', () => {
  it('should format top-level resource as ARM-path segment', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Backend,
      nameParts: ['backend-name'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('backends/backend-name');
  });

  it('should format named value as ARM-path segment', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      nameParts: ['my-secret'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('namedValues/my-secret');
  });

  it('should format API singleton policy', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiPolicy,
      nameParts: ['petstore'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/petstore/policies/policy');
  });

  it('should format parent-child resource (ApiOperation)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      nameParts: ['petstore', 'get-user'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/petstore/operations/get-user');
  });

  it('should format grandchild policy resource (ApiOperationPolicy)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperationPolicy,
      nameParts: ['petstore', 'get-user'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/petstore/operations/get-user/policies/policy');
  });


describe('getRelativeResourceId', () => {
  it('should strip the APIM service prefix from a named value resource id', () => {
    const resourceId =
      '/subscriptions/sub-123/resourceGroups/rg-test/providers/Microsoft.ApiManagement/service/my-apim/namedValues/mySecret';

    expect(getRelativeResourceId(resourceId, 'my-apim')).toBe(
      'namedValues/mySecret',
    );
  });

  it('should strip query parameters from the relative resource id', () => {
    const resourceId =
      '/subscriptions/sub-123/resourceGroups/rg-test/providers/Microsoft.ApiManagement/service/my-apim/apis/petstore?api-version=2024-05-01';

    expect(getRelativeResourceId(resourceId, 'my-apim')).toBe('apis/petstore');
  });

  it('should return undefined when the service name does not match', () => {
    const resourceId =
      '/subscriptions/sub-123/resourceGroups/rg-test/providers/Microsoft.ApiManagement/service/my-apim/apis/petstore';

    expect(getRelativeResourceId(resourceId, 'other-apim')).toBeUndefined();
  });
});
  it('should format product-child resource (ProductApi)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ProductApi,
      nameParts: ['starter', 'my-api'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('products/starter/apis/my-api');
  });

  it('should omit workspace from label', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      nameParts: ['workspace-api'],
      workspace: 'my-workspace',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/workspace-api');
  });

  it('should format ApiWiki singleton', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiWiki,
      nameParts: ['my-api'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/my-api/wikis/default');
  });

  it('should format GraphQLResolver as ARM-path segment', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolver,
      nameParts: ['my-api', 'my-resolver'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/my-api/resolvers/my-resolver');
  });

  it('should format GraphQLResolverPolicy', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolverPolicy,
      nameParts: ['my-api', 'my-resolver'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/my-api/resolvers/my-resolver/policies/policy');
  });

  it('should handle special characters in names', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      nameParts: ['pet-store_v2', 'get-user_by-id'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/pet-store_v2/operations/get-user_by-id');
  });

  it('should handle names with multiple hyphens and underscores', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Backend,
      nameParts: ['backend-name-with-many-hyphens_and_underscores'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('backends/backend-name-with-many-hyphens_and_underscores');
  });

  it('should preserve case in names', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      nameParts: ['MyApi', 'MyOperation'],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/MyApi/operations/MyOperation');
  });

  it('should format ServicePolicy singleton (no name-parts)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ServicePolicy,
      nameParts: [],
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('policies/policy');
  });
});
