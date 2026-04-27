import { describe, it, expect } from 'vitest';
import { buildArmUri, parseArmUri, buildResourceLabel } from '../../../src/lib/resource-uri.js';
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
      name: 'mySecret',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toBe(
      `${context.baseUrl}/namedValues/mySecret?api-version=${context.apiVersion}`
    );
  });

  it('should build URI for Api resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'my-api',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api');
    expect(uri).toContain('api-version=2024-05-01');
  });

  it('should build URI for Product resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      name: 'starter',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/products/starter');
  });

  it('should build URI for child resource (ApiPolicy)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiPolicy,
      name: 'my-api',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/policies/policy');
  });

  it('should build URI for ApiOperation', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      name: 'getUsers',
      parent: 'my-api',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/operations/getUsers');
  });

  it('should build URI for ApiOperationPolicy', () => {
    // name = API name (replaces {name}), parent = operation name (replaces {opName}),
    // grandparent = API name (triggers special artifact directory handling for {opName})
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperationPolicy,
      name: 'my-api',
      parent: 'getUsers',
      grandparent: 'my-api',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/operations/getUsers/policies/policy');
  });

  it('should build URI for ProductApi', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ProductApi,
      name: 'starter',
      parent: 'my-api',
    };
    const uri = buildArmUri(context, descriptor);
    // {name} → starter, {apiName} → my-api (from parent)
    expect(uri).toContain('/products/starter/apis/my-api');
  });

  it('should build URI for ApiTag', () => {
    // Pattern: /apis/{apiName}/tags/{tagName}
    // {apiName} → descriptor.parent (API name), {tagName} → descriptor.name (tag name)
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiTag,
      name: 'v1',
      parent: 'my-api',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/tags/v1');
  });

  it('should build URI for ApiDiagnostic', () => {
    // Pattern: /apis/{apiName}/diagnostics/{diagName}
    // {apiName} → descriptor.parent (API name), {diagName} → descriptor.name (diagnostic name)
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiDiagnostic,
      name: 'applicationinsights',
      parent: 'my-api',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/diagnostics/applicationinsights');
  });

  it('should URL-encode resource names', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      name: 'my secret value',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/namedValues/my%20secret%20value');
  });

  it('should include workspace prefix if set', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'ws-api',
      workspace: 'my-workspace',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/workspaces/my-workspace/apis/ws-api');
  });

  it('should throw for unresolved placeholders', () => {
    // GraphQLResolver needs parent to resolve {apiName} in pattern
    const descriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolver,
      name: 'myResolver',
      parent: 'my-api',
    };
    const uri = buildArmUri(context, descriptor);
    expect(uri).toContain('/apis/my-api/resolvers/myResolver');
  });

  it('should build URI for ServicePolicy (singleton)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ServicePolicy,
      name: 'policy',
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
    expect(result!.name).toBe('mySecret');
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
    expect(result!.name).toBe('my-api');
  });

  it('should parse URL-encoded resource names', () => {
    const uri = `${context.baseUrl}/namedValues/my%20secret?api-version=2024-05-01`;
    const result = parseArmUri(uri, context);
    expect(result).toBeDefined();
    expect(result!.name).toBe('my secret');
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
  const simpleTypes: { type: ResourceType; name: string }[] = [
    { type: ResourceType.NamedValue, name: 'nv1' },
    { type: ResourceType.Tag, name: 'tag1' },
    { type: ResourceType.Gateway, name: 'gw1' },
    { type: ResourceType.Backend, name: 'be1' },
    { type: ResourceType.Logger, name: 'log1' },
    { type: ResourceType.Group, name: 'grp1' },
    { type: ResourceType.Product, name: 'prod1' },
    { type: ResourceType.Api, name: 'api1' },
    { type: ResourceType.Subscription, name: 'sub1' },
    { type: ResourceType.GlobalSchema, name: 'schema1' },
  ];

  for (const { type, name } of simpleTypes) {
    it(`should roundtrip for ${type}`, () => {
      const descriptor: ResourceDescriptor = { type, name };
      const uri = buildArmUri(context, descriptor);
      const parsed = parseArmUri(uri, context);
      expect(parsed).toBeDefined();
      expect(parsed!.type).toBe(type);
      expect(parsed!.name).toBe(name);
    });
  }
});

describe('buildResourceLabel', () => {
  it('should format top-level resource as ARM-path segment', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Backend,
      name: 'backend-name',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('backends/backend-name');
  });

  it('should format named value as ARM-path segment', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      name: 'my-secret',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('namedValues/my-secret');
  });

  it('should format API singleton policy using name as API name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiPolicy,
      name: 'petstore',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/petstore/policies/policy');
  });

  it('should format parent-child resource (ApiOperation)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      name: 'get-user',
      parent: 'petstore',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/petstore/operations/get-user');
  });

  it('should format grandchild policy resource (ApiOperationPolicy)', () => {
    // name = API name, parent = operation name (per buildDescriptor convention)
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperationPolicy,
      name: 'petstore',
      parent: 'get-user',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/petstore/operations/get-user/policies/policy');
  });

  it('should format product-child resource (ProductApi)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ProductApi,
      name: 'my-api',
      parent: 'starter',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('products/starter/apis/my-api');
  });

  it('should omit workspace from label', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'workspace-api',
      workspace: 'my-workspace',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/workspace-api');
  });

  it('should format ApiWiki singleton using name as API name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiWiki,
      name: 'my-api',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/my-api/wikis/default');
  });

  it('should format GraphQLResolver as ARM-path segment', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolver,
      name: 'my-resolver',
      parent: 'my-api',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/my-api/resolvers/my-resolver');
  });

  it('should format GraphQLResolverPolicy (name=API, parent=resolver)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolverPolicy,
      name: 'my-api',
      parent: 'my-resolver',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/my-api/resolvers/my-resolver/policies/policy');
  });

  it('should handle special characters in names', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      name: 'get-user_by-id',
      parent: 'pet-store_v2',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/pet-store_v2/operations/get-user_by-id');
  });

  it('should handle names with multiple hyphens and underscores', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Backend,
      name: 'backend-name-with-many-hyphens_and_underscores',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('backends/backend-name-with-many-hyphens_and_underscores');
  });

  it('should preserve case in names', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      name: 'MyOperation',
      parent: 'MyApi',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('apis/MyApi/operations/MyOperation');
  });

  it('should format ServicePolicy singleton (no name placeholder)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ServicePolicy,
      name: 'policy',
    };
    const label = buildResourceLabel(descriptor);
    expect(label).toBe('policies/policy');
  });
});
