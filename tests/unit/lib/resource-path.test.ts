import { describe, it, expect } from 'vitest';
import {
  buildArtifactDirectory,
  buildArtifactFilePath,
  buildPolicyFilePath,
  buildSpecificationFilePath,
  buildAssociationFilePath,
  parseArtifactPath,
} from '../../../src/lib/resource-path.js';
import { ResourceDescriptor } from '../../../src/models/types.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import * as path from 'node:path';

const baseDir = '/artifacts';

describe('buildArtifactDirectory', () => {
  it('should build directory for a top-level resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      name: 'mySecret',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    // Assert on the normalized resource path segments without relying on any trailing separator.
    expect(dir).toContain(path.join('namedValues', 'mySecret'));
  });

  it('should build directory for Api', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'my-api',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api'));
  });

  it('should build directory for Product', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      name: 'starter',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('products', 'starter'));
  });

  it('should add workspace prefix when workspace is set', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'ws-api',
      workspace: 'my-workspace',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('workspaces', 'my-workspace'));
    expect(dir).toContain(path.join('apis', 'ws-api'));
  });

  it('should build directory for ApiDiagnostic using parent as API name and name as diagnostic name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiDiagnostic,
      name: 'applicationinsights',
      parent: 'my-api',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'diagnostics', 'applicationinsights'));
    expect(dir).not.toContain('applicationinsights' + path.sep + 'apis'); // API name must not appear as subdirectory
  });

  it('should build directory for ApiTag using parent as API name and name as tag name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiTag,
      name: 'v1',
      parent: 'my-api',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'tags', 'v1'));
    expect(dir).not.toContain('v1' + path.sep + 'apis'); // Tag name must not appear as API folder name
  });

  it('should build directory for ApiDiagnostic with workspace prefix', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiDiagnostic,
      name: 'applicationinsights',
      parent: 'my-api',
      workspace: 'ws1',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('workspaces', 'ws1'));
    expect(dir).toContain(path.join('apis', 'my-api', 'diagnostics', 'applicationinsights'));
  });

  it('should handle ServicePolicy (empty artifact directory)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ServicePolicy,
      name: 'policy',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toBe(path.join(baseDir));
  });
});

describe('buildArtifactFilePath', () => {
  it('should return info file path for NamedValue', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      name: 'mySecret',
    };
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    expect(filePath).toBe(
      path.join(baseDir, 'namedValues', 'mySecret', 'namedValueInformation.json')
    );
  });

  it('should return info file path for Api', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'my-api',
    };
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    expect(filePath).toBe(
      path.join(baseDir, 'apis', 'my-api', 'apiInformation.json')
    );
  });

  it('should return undefined for types with no info file (ApiOperation)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      name: 'getUsers',
      parent: 'my-api',
    };
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    expect(filePath).toBeUndefined();
  });

  it('should return policy.xml path for ServicePolicy', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ServicePolicy,
      name: 'policy',
    };
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    expect(filePath).toBe(path.join(baseDir, 'policy.xml'));
  });
});

describe('buildPolicyFilePath', () => {
  it('should return policy.xml for API policy', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiPolicy,
      name: 'my-api',
    };
    const filePath = buildPolicyFilePath(baseDir, descriptor);
    expect(filePath).toContain('policy.xml');
    expect(filePath).toContain(path.join('apis', 'my-api'));
  });
});

describe('buildSpecificationFilePath', () => {
  it('should build yaml specification path', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'my-api',
    };
    const filePath = buildSpecificationFilePath(baseDir, descriptor, 'yaml');
    expect(filePath).toBe(
      path.join(baseDir, 'apis', 'my-api', 'specification.yaml')
    );
  });

  it('should build json specification path', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'my-api',
    };
    const filePath = buildSpecificationFilePath(baseDir, descriptor, 'json');
    expect(filePath).toBe(
      path.join(baseDir, 'apis', 'my-api', 'specification.json')
    );
  });

  it('should build graphql specification path', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'graphql-api',
    };
    const filePath = buildSpecificationFilePath(baseDir, descriptor, 'graphql');
    expect(filePath).toBe(
      path.join(baseDir, 'apis', 'graphql-api', 'specification.graphql')
    );
  });

  it('should throw for non-Api resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      name: 'prod1',
    };
    expect(() => buildSpecificationFilePath(baseDir, descriptor, 'yaml')).toThrow(
      'Specification path only valid for API resources'
    );
  });
});

describe('buildAssociationFilePath', () => {
  it('should build apis.json path for Product', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      name: 'starter',
    };
    const filePath = buildAssociationFilePath(baseDir, descriptor, 'apis');
    expect(filePath).toBe(
      path.join(baseDir, 'products', 'starter', 'apis.json')
    );
  });

  it('should build groups.json path for Product', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      name: 'starter',
    };
    const filePath = buildAssociationFilePath(baseDir, descriptor, 'groups');
    expect(filePath).toBe(
      path.join(baseDir, 'products', 'starter', 'groups.json')
    );
  });

  it('should build apis.json path for Gateway', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Gateway,
      name: 'gw1',
    };
    const filePath = buildAssociationFilePath(baseDir, descriptor, 'apis');
    expect(filePath).toBe(
      path.join(baseDir, 'gateways', 'gw1', 'apis.json')
    );
  });

  it('should throw for non-Product/Gateway resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      name: 'api1',
    };
    expect(() => buildAssociationFilePath(baseDir, descriptor, 'apis')).toThrow(
      'Association path only valid for Product/Gateway resources'
    );
  });
});

describe('parseArtifactPath', () => {
  it('should parse a top-level resource info file', () => {
    const filePath = path.join(baseDir, 'namedValues', 'mySecret', 'namedValueInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.NamedValue);
    expect(result!.name).toBe('mySecret');
  });

  it('should parse Api info file', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'apiInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.Api);
    expect(result!.name).toBe('my-api');
  });

  it('should parse Product info file', () => {
    const filePath = path.join(baseDir, 'products', 'starter', 'productInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.Product);
    expect(result!.name).toBe('starter');
  });

  it('should parse workspace-scoped resource', () => {
    const filePath = path.join(baseDir, 'workspaces', 'ws1', 'apis', 'ws-api', 'apiInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.workspace).toBe('ws1');
    expect(result!.name).toBe('ws-api');
  });

  it('should parse ApiDiagnostic info file with parent as API name', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'diagnostics', 'applicationinsights', 'diagnosticInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.ApiDiagnostic);
    expect(result!.name).toBe('applicationinsights');
    expect(result!.parent).toBe('my-api');
  });

  it('should parse ApiTag info file with parent as API name', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'tags', 'v1', 'tagInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.ApiTag);
    expect(result!.name).toBe('v1');
    expect(result!.parent).toBe('my-api');
  });

  it('should return undefined for unrecognized paths', () => {
    const filePath = path.join(baseDir, 'unknown', 'foo', 'bar.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeUndefined();
  });

  it('should parse ServicePolicy (policy.xml at root)', () => {
    const filePath = path.join(baseDir, 'policy.xml');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.ServicePolicy);
  });
});

describe('buildArtifactFilePath + parseArtifactPath roundtrip', () => {
  const topLevelTypes: { type: ResourceType; name: string }[] = [
    { type: ResourceType.NamedValue, name: 'nv1' },
    { type: ResourceType.Tag, name: 'tag1' },
    { type: ResourceType.Backend, name: 'be1' },
    { type: ResourceType.Logger, name: 'log1' },
    { type: ResourceType.Product, name: 'prod1' },
    { type: ResourceType.Api, name: 'api1' },
    { type: ResourceType.Gateway, name: 'gw1' },
    { type: ResourceType.Subscription, name: 'sub1' },
    { type: ResourceType.GlobalSchema, name: 'schema1' },
  ];

  for (const { type, name } of topLevelTypes) {
    it(`should roundtrip for ${type}`, () => {
      const descriptor: ResourceDescriptor = { type, name };
      const filePath = buildArtifactFilePath(baseDir, descriptor);
      if (!filePath) return; // Skip types with no info file
      const parsed = parseArtifactPath(baseDir, filePath);
      expect(parsed).toBeDefined();
      expect(parsed!.type).toBe(type);
      expect(parsed!.name).toBe(name);
    });
  }
});

describe('buildArtifactDirectory for API child resources', () => {
  it('should place ApiTagDescription under api name, not tagDesc name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiTagDescription,
      name: 'v1-tag-desc',
      parent: 'my-api',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'tagDescriptions', 'v1-tag-desc'));
    expect(dir).not.toContain(path.join('apis', 'v1-tag-desc'));
  });

  it('should place ApiSchema under api name, not schema name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiSchema,
      name: 'my-schema',
      parent: 'my-api',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'schemas', 'my-schema'));
    expect(dir).not.toContain(path.join('apis', 'my-schema'));
  });

  it('should place ApiRelease under api name, not release name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiRelease,
      name: 'my-release',
      parent: 'my-api',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'releases', 'my-release'));
    expect(dir).not.toContain(path.join('apis', 'my-release'));
  });

  it('should place GraphQLResolver under api name, not resolver name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolver,
      name: 'my-resolver',
      parent: 'my-api',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'resolvers', 'my-resolver'));
    expect(dir).not.toContain(path.join('apis', 'my-resolver'));
  });

  it('should place ApiOperation under api name, not operation name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      name: 'get-users',
      parent: 'my-api',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'operations', 'get-users'));
    expect(dir).not.toContain(path.join('apis', 'get-users'));
  });
});

describe('buildArtifactFilePath + parseArtifactPath roundtrip for API child resources', () => {
  const childTypes: { type: ResourceType; name: string; parent: string }[] = [
    { type: ResourceType.ApiTagDescription, name: 'my-tag-desc', parent: 'my-api' },
    { type: ResourceType.ApiSchema, name: 'my-schema', parent: 'my-api' },
    { type: ResourceType.ApiRelease, name: 'my-release', parent: 'my-api' },
    { type: ResourceType.GraphQLResolver, name: 'my-resolver', parent: 'my-api' },
  ];

  for (const { type, name, parent } of childTypes) {
    it(`should roundtrip for ${type}`, () => {
      const descriptor: ResourceDescriptor = { type, name, parent };
      const filePath = buildArtifactFilePath(baseDir, descriptor);
      expect(filePath).toBeDefined();
      const parsed = parseArtifactPath(baseDir, filePath!);
      expect(parsed).toBeDefined();
      expect(parsed!.type).toBe(type);
      expect(parsed!.name).toBe(name);
      expect(parsed!.parent).toBe(parent);
    });
  }
});
