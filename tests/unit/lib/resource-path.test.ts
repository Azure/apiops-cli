import { describe, it, expect } from 'vitest';
import {
  formatTemplatePath,
  countTemplatePlaceholders,
  makeFullPath,
  makeRelativePath,
  parseTemplatePath,
  getNamePart,
  getNameFromNameParts,
  buildArtifactDirectory,
  buildArtifactFilePath,
  buildPolicyFilePath,
  buildSpecificationFilePath,
  buildAssociationFilePath,
  parseArtifactPath,
  parseArtifactChangePath,
  deriveListPaths,
  hasNestedParent,
  getPublishTier,
  isTopLevelSingleton,
} from '../../../src/lib/resource-path.js';
import { ResourceDescriptor } from '../../../src/models/types.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import * as path from 'node:path';

const baseDir = '/artifacts';

describe('buildArtifactDirectory', () => {
  it('should build directory for a top-level resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      nameParts: ['mySecret'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('namedValues', 'mySecret'));
  });

  it('should build directory for Api', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      nameParts: ['my-api'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api'));
  });

  it('should build directory for Product', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      nameParts: ['starter'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('products', 'starter'));
  });

  it('should add workspace prefix when workspace is set', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      nameParts: ['ws-api'],
      workspace: 'my-workspace',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('workspaces', 'my-workspace'));
    expect(dir).toContain(path.join('apis', 'ws-api'));
  });

  it('should build directory for ApiDiagnostic using nameParts[0]=apiName, nameParts[1]=diagName', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiDiagnostic,
      nameParts: ['my-api', 'applicationinsights'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'diagnostics', 'applicationinsights'));
  });

  it('should build directory for ApiTag using nameParts[0]=apiName, nameParts[1]=tagName', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiTag,
      nameParts: ['my-api', 'v1'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'tags', 'v1'));
  });

  it('should build directory for ApiDiagnostic with workspace prefix', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiDiagnostic,
      nameParts: ['my-api', 'applicationinsights'],
      workspace: 'ws1',
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('workspaces', 'ws1'));
    expect(dir).toContain(path.join('apis', 'my-api', 'diagnostics', 'applicationinsights'));
  });

  it('should handle ServicePolicy (empty artifact directory)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ServicePolicy,
      nameParts: [],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toBe(path.join(baseDir));
  });
});

describe('buildArtifactFilePath', () => {
  it('should return info file path for NamedValue', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.NamedValue,
      nameParts: ['mySecret'],
    };
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    expect(filePath).toBe(
      path.join(baseDir, 'namedValues', 'mySecret', 'namedValueInformation.json')
    );
  });

  it('should return info file path for Api', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      nameParts: ['my-api'],
    };
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    expect(filePath).toBe(
      path.join(baseDir, 'apis', 'my-api', 'apiInformation.json')
    );
  });

  it('should return undefined for types with no info file (ApiOperation)', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      nameParts: ['my-api', 'getUsers'],
    };
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    expect(filePath).toBeUndefined();
  });

  it('should return policy.xml path for ServicePolicy', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ServicePolicy,
      nameParts: [],
    };
    const filePath = buildArtifactFilePath(baseDir, descriptor);
    expect(filePath).toBe(path.join(baseDir, 'policy.xml'));
  });
});

describe('buildPolicyFilePath', () => {
  it('should return policy.xml for API policy', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiPolicy,
      nameParts: ['my-api'],
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
      nameParts: ['my-api'],
    };
    const filePath = buildSpecificationFilePath(baseDir, descriptor, 'yaml');
    expect(filePath).toBe(
      path.join(baseDir, 'apis', 'my-api', 'specification.yaml')
    );
  });

  it('should build json specification path', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      nameParts: ['my-api'],
    };
    const filePath = buildSpecificationFilePath(baseDir, descriptor, 'json');
    expect(filePath).toBe(
      path.join(baseDir, 'apis', 'my-api', 'specification.json')
    );
  });

  it('should build graphql specification path', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      nameParts: ['graphql-api'],
    };
    const filePath = buildSpecificationFilePath(baseDir, descriptor, 'graphql');
    expect(filePath).toBe(
      path.join(baseDir, 'apis', 'graphql-api', 'specification.graphql')
    );
  });

  it('should throw for non-Api resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      nameParts: ['prod1'],
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
      nameParts: ['starter'],
    };
    const filePath = buildAssociationFilePath(baseDir, descriptor, 'apis');
    expect(filePath).toBe(
      path.join(baseDir, 'products', 'starter', 'apis.json')
    );
  });

  it('should build groups.json path for Product', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      nameParts: ['starter'],
    };
    const filePath = buildAssociationFilePath(baseDir, descriptor, 'groups');
    expect(filePath).toBe(
      path.join(baseDir, 'products', 'starter', 'groups.json')
    );
  });

  it('should build apis.json path for Gateway', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Gateway,
      nameParts: ['gw1'],
    };
    const filePath = buildAssociationFilePath(baseDir, descriptor, 'apis');
    expect(filePath).toBe(
      path.join(baseDir, 'gateways', 'gw1', 'apis.json')
    );
  });

  it("accepts 'tags' as associationType for a Product descriptor", () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Product,
      nameParts: ['starter'],
    };
    const filePath = buildAssociationFilePath(baseDir, descriptor, 'tags');
    expect(filePath).toBe(
      path.join(baseDir, 'products', 'starter', 'tags.json')
    );
  });

  it('should throw for non-Product/Gateway resource', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.Api,
      nameParts: ['api1'],
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
    expect(result!.nameParts[0]).toBe('mySecret');
  });

  it('should parse Api info file', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'apiInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.Api);
    expect(result!.nameParts[0]).toBe('my-api');
  });

  it('should parse Product info file', () => {
    const filePath = path.join(baseDir, 'products', 'starter', 'productInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.Product);
    expect(result!.nameParts[0]).toBe('starter');
  });

  it('should parse workspace-scoped resource', () => {
    const filePath = path.join(baseDir, 'workspaces', 'ws1', 'apis', 'ws-api', 'apiInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.workspace).toBe('ws1');
    expect(result!.nameParts[0]).toBe('ws-api');
  });

  it('should parse ApiDiagnostic info file (nameParts[0]=apiName, nameParts[1]=diagName)', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'diagnostics', 'applicationinsights', 'diagnosticInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.ApiDiagnostic);
    expect(result!.nameParts[0]).toBe('my-api');
    expect(result!.nameParts[1]).toBe('applicationinsights');
  });

  it('should parse ApiTag info file (nameParts[0]=apiName, nameParts[1]=tagName)', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'tags', 'v1', 'tagInformation.json');
    const result = parseArtifactPath(baseDir, filePath);
    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.ApiTag);
    expect(result!.nameParts[0]).toBe('my-api');
    expect(result!.nameParts[1]).toBe('v1');
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
    expect(result!.nameParts).toEqual([]);
  });
});

describe('parseArtifactChangePath', () => {
  it('should parse regular info files via parseArtifactPath fallback', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'apiInformation.json');
    const result = parseArtifactChangePath(baseDir, filePath);

    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.Api);
    expect(result!.nameParts).toEqual(['my-api']);
  });

  it('should parse API specification file to Api descriptor', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'specification.yaml');
    const result = parseArtifactChangePath(baseDir, filePath);

    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.Api);
    expect(result!.nameParts).toEqual(['my-api']);
    expect(result!.workspace).toBeUndefined();
  });

  it('should parse workspace-scoped API specification file', () => {
    const filePath = path.join(
      baseDir,
      'workspaces',
      'dev',
      'apis',
      'my-api',
      'specification.json'
    );
    const result = parseArtifactChangePath(baseDir, filePath);

    expect(result).toBeDefined();
    expect(result!.type).toBe(ResourceType.Api);
    expect(result!.nameParts).toEqual(['my-api']);
    expect(result!.workspace).toBe('dev');
  });

  it('should ignore unsupported specification extensions', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'specification.txt');
    const result = parseArtifactChangePath(baseDir, filePath);

    expect(result).toBeUndefined();
  });

  it('should return undefined for a path with no extension on the specification file', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'specification');
    const result = parseArtifactChangePath(baseDir, filePath);

    expect(result).toBeUndefined();
  });

  it('should return undefined for a deeply nested path that does not match any pattern', () => {
    const filePath = path.join(baseDir, 'apis', 'my-api', 'extra', 'specification.yaml');
    const result = parseArtifactChangePath(baseDir, filePath);

    expect(result).toBeUndefined();
  });
});

describe('buildArtifactFilePath + parseArtifactPath roundtrip', () => {
  const topLevelTypes: { type: ResourceType; nameParts: string[] }[] = [
    { type: ResourceType.NamedValue, nameParts: ['nv1'] },
    { type: ResourceType.Tag, nameParts: ['tag1'] },
    { type: ResourceType.Backend, nameParts: ['be1'] },
    { type: ResourceType.Logger, nameParts: ['log1'] },
    { type: ResourceType.Product, nameParts: ['prod1'] },
    { type: ResourceType.Api, nameParts: ['api1'] },
    { type: ResourceType.Gateway, nameParts: ['gw1'] },
    { type: ResourceType.Subscription, nameParts: ['sub1'] },
    { type: ResourceType.GlobalSchema, nameParts: ['schema1'] },
  ];

  for (const { type, nameParts } of topLevelTypes) {
    it(`should roundtrip for ${type}`, () => {
      const descriptor: ResourceDescriptor = { type, nameParts };
      const filePath = buildArtifactFilePath(baseDir, descriptor);
      if (!filePath) return; // Skip types with no info file
      const parsed = parseArtifactPath(baseDir, filePath);
      expect(parsed).toBeDefined();
      expect(parsed!.type).toBe(type);
      expect(parsed!.nameParts).toEqual(nameParts);
    });
  }
});

describe('buildArtifactDirectory for API child resources', () => {
  it('should place ApiTagDescription under api/tagDescriptions/name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiTagDescription,
      nameParts: ['my-api', 'v1-tag-desc'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'tagDescriptions', 'v1-tag-desc'));
  });

  it('should place ApiSchema under api/schemas/name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiSchema,
      nameParts: ['my-api', 'my-schema'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'schemas', 'my-schema'));
  });

  it('should place ApiRelease under api/releases/name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiRelease,
      nameParts: ['my-api', 'my-release'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'releases', 'my-release'));
  });

  it('should place GraphQLResolver under api/resolvers/name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolver,
      nameParts: ['my-api', 'my-resolver'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'resolvers', 'my-resolver'));
  });

  it('should place ApiOperation under api/operations/name', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperation,
      nameParts: ['my-api', 'get-users'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'operations', 'get-users'));
  });

  it('should place ApiOperationPolicy under api/operations/op/', () => {
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperationPolicy,
      nameParts: ['my-api', 'get-users'],
    };
    const dir = buildArtifactDirectory(baseDir, descriptor);
    expect(dir).toContain(path.join('apis', 'my-api', 'operations', 'get-users'));
  });
});

describe('buildArtifactFilePath + parseArtifactPath roundtrip for API child resources', () => {
  const childTypes: { type: ResourceType; nameParts: string[] }[] = [
    { type: ResourceType.ApiTagDescription, nameParts: ['my-api', 'my-tag-desc'] },
    { type: ResourceType.ApiSchema, nameParts: ['my-api', 'my-schema'] },
    { type: ResourceType.ApiRelease, nameParts: ['my-api', 'my-release'] },
    { type: ResourceType.GraphQLResolver, nameParts: ['my-api', 'my-resolver'] },
    { type: ResourceType.ApiOperationPolicy, nameParts: ['my-api', 'my-op'] },
  ];

  for (const { type, nameParts } of childTypes) {
    it(`should roundtrip for ${type}`, () => {
      const descriptor: ResourceDescriptor = { type, nameParts };
      const filePath = buildArtifactFilePath(baseDir, descriptor);
      expect(filePath).toBeDefined();
      const parsed = parseArtifactPath(baseDir, filePath!);
      expect(parsed).toBeDefined();
      expect(parsed!.type).toBe(type);
      expect(parsed!.nameParts).toEqual(nameParts);
    });
  }
});

describe('formatTemplatePath', () => {
  it('fills a single placeholder', () => {
    expect(formatTemplatePath('namedValues/{0}', ['mySecret'])).toBe('namedValues/mySecret');
  });

  it('fills two placeholders in order', () => {
    expect(formatTemplatePath('apis/{0}/operations/{1}', ['petstore', 'get-user'])).toBe(
      'apis/petstore/operations/get-user'
    );
  });

  it('returns the template unchanged when there are no placeholders', () => {
    expect(formatTemplatePath('policies/policy', [])).toBe('policies/policy');
  });

  it('returns empty string for an empty template', () => {
    expect(formatTemplatePath('', [])).toBe('');
  });

  it('throws when a namePart is missing for a placeholder', () => {
    expect(() => formatTemplatePath('apis/{0}/operations/{1}', ['petstore'])).toThrow(
      'nameParts[1] is undefined for template "apis/{0}/operations/{1}"'
    );
  });
});

describe('countTemplatePlaceholders', () => {
  it('returns 0 for a literal-only template', () => {
    expect(countTemplatePlaceholders('policies/policy')).toBe(0);
  });

  it('returns 0 for an empty template', () => {
    expect(countTemplatePlaceholders('')).toBe(0);
  });

  it('returns 1 for a single-placeholder template', () => {
    expect(countTemplatePlaceholders('namedValues/{0}')).toBe(1);
  });

  it('returns 2 for a two-placeholder template', () => {
    expect(countTemplatePlaceholders('apis/{0}/operations/{1}')).toBe(2);
  });
});

describe('makeFullPath', () => {
  it('prepends a slash when one is missing', () => {
    expect(makeFullPath('namedValues/my-nv')).toBe('/namedValues/my-nv');
  });

  it('does not add a second slash when the path already starts with one', () => {
    expect(makeFullPath('/namedValues/my-nv')).toBe('/namedValues/my-nv');
  });

  it('prepends a slash to an empty string', () => {
    expect(makeFullPath('')).toBe('/');
  });
});

describe('makeRelativePath', () => {
  it('strips the leading slash from an absolute path', () => {
    expect(makeRelativePath('/namedValues/my-nv')).toBe('namedValues/my-nv');
  });

  it('returns the path unchanged when there is no leading slash', () => {
    expect(makeRelativePath('namedValues/my-nv')).toBe('namedValues/my-nv');
  });

  it('returns empty string when given only a slash', () => {
    expect(makeRelativePath('/')).toBe('');
  });
});

describe('parseTemplatePath', () => {
  it('captures a single name part from a matching path', () => {
    expect(parseTemplatePath('namedValues/{0}', 'namedValues/mySecret')).toEqual(['mySecret']);
  });

  it('captures two name parts from a two-placeholder template', () => {
    expect(
      parseTemplatePath('apis/{0}/operations/{1}', 'apis/petstore/operations/get-user')
    ).toEqual(['petstore', 'get-user']);
  });

  it('returns an empty array for a literal-only template that matches', () => {
    expect(parseTemplatePath('policies/policy', 'policies/policy')).toEqual([]);
  });

  it('returns undefined when the path does not match the template', () => {
    expect(parseTemplatePath('apis/{0}', 'backends/b1')).toBeUndefined();
  });

  it('returns undefined for an empty template matched against a non-empty path', () => {
    expect(parseTemplatePath('', 'policies/policy')).toBeUndefined();
  });

  it('returns an empty array for an empty template matched against an empty string', () => {
    expect(parseTemplatePath('', '')).toEqual([]);
  });
});

describe('getNamePart', () => {
  it('returns the element at the given index', () => {
    expect(getNamePart(['petstore', 'get-user'], 0)).toBe('petstore');
    expect(getNamePart(['petstore', 'get-user'], 1)).toBe('get-user');
  });

  it('returns a single-element array by index 0', () => {
    expect(getNamePart(['my-api'], 0)).toBe('my-api');
  });

  it('throws RangeError when index equals array length', () => {
    expect(() => getNamePart(['a', 'b'], 2)).toThrow(RangeError);
    expect(() => getNamePart(['a', 'b'], 2)).toThrow('nameParts[2]');
  });

  it('throws RangeError for empty array', () => {
    expect(() => getNamePart([], 0)).toThrow(RangeError);
    expect(() => getNamePart([], 0)).toThrow('nameParts[0]');
    expect(() => getNamePart([], 0)).toThrow('0 entries');
  });

  it('throws RangeError for negative index', () => {
    expect(() => getNamePart(['a'], -1)).toThrow(RangeError);
  });
});

describe('getNameFromNameParts', () => {
  it('returns the last element for a 1-part array', () => {
    expect(getNameFromNameParts(['petstore'])).toBe('petstore');
  });

  it('returns the last element for a 2-part array', () => {
    expect(getNameFromNameParts(['petstore', 'get-user'])).toBe('get-user');
  });

  it('returns the last element for a 3-part array', () => {
    expect(getNameFromNameParts(['a', 'b', 'c'])).toBe('c');
  });

  it('throws RangeError for an empty array', () => {
    expect(() => getNameFromNameParts([])).toThrow(RangeError);
    expect(() => getNameFromNameParts([])).toThrow('empty');
  });
});

describe('deriveListPaths', () => {
  it('returns listPath for a single-placeholder top-level template', () => {
    expect(deriveListPaths('namedValues/{0}')).toEqual({ listPath: '/namedValues' });
    expect(deriveListPaths('apis/{0}')).toEqual({ listPath: '/apis' });
    expect(deriveListPaths('tags/{0}')).toEqual({ listPath: '/tags' });
  });

  it('returns childListPath for a two-placeholder child template', () => {
    expect(deriveListPaths('apis/{0}/operations/{1}')).toEqual({ childListPath: '/operations' });
    expect(deriveListPaths('apis/{0}/tags/{1}')).toEqual({ childListPath: '/tags' });
    expect(deriveListPaths('products/{0}/apis/{1}')).toEqual({ childListPath: '/apis' });
    expect(deriveListPaths('gateways/{0}/apis/{1}')).toEqual({ childListPath: '/apis' });
    expect(deriveListPaths('apis/{0}/resolvers/{1}')).toEqual({ childListPath: '/resolvers' });
  });

  it('returns empty object for a singleton with no placeholders', () => {
    expect(deriveListPaths('policies/policy')).toEqual({});
  });

  it('returns empty object for a singleton where the last segment is a fixed word', () => {
    expect(deriveListPaths('products/{0}/policies/policy')).toEqual({});
    expect(deriveListPaths('apis/{0}/policies/policy')).toEqual({});
    expect(deriveListPaths('apis/{0}/operations/{1}/policies/policy')).toEqual({});
    expect(deriveListPaths('apis/{0}/wikis/default')).toEqual({});
    expect(deriveListPaths('products/{0}/wikis/default')).toEqual({});
    expect(deriveListPaths('apis/{0}/resolvers/{1}/policies/policy')).toEqual({});
  });
});

describe('hasNestedParent', () => {
  it('returns true for ApiOperationPolicy (has segments after last placeholder)', () => {
    expect(hasNestedParent(ResourceType.ApiOperationPolicy)).toBe(true);
  });

  it('returns true for GraphQLResolverPolicy (has segments after last placeholder)', () => {
    expect(hasNestedParent(ResourceType.GraphQLResolverPolicy)).toBe(true);
  });

  it('returns false for ApiOperation (ends at placeholder)', () => {
    expect(hasNestedParent(ResourceType.ApiOperation)).toBe(false);
  });

  it('returns false for GraphQLResolver (ends at placeholder)', () => {
    expect(hasNestedParent(ResourceType.GraphQLResolver)).toBe(false);
  });

  it('returns false for ApiPolicy (only one placeholder, fixed suffix)', () => {
    expect(hasNestedParent(ResourceType.ApiPolicy)).toBe(false);
  });

  it('returns false for ApiTag (ends at placeholder)', () => {
    expect(hasNestedParent(ResourceType.ApiTag)).toBe(false);
  });

  it('returns false for top-level types like NamedValue', () => {
    expect(hasNestedParent(ResourceType.NamedValue)).toBe(false);
  });

  it('returns false for ServicePolicy (no placeholders)', () => {
    expect(hasNestedParent(ResourceType.ServicePolicy)).toBe(false);
  });

  it('returns false for ProductPolicy (has suffix but only one placeholder)', () => {
    expect(hasNestedParent(ResourceType.ProductPolicy)).toBe(false);
  });
});

describe('isTopLevelSingleton', () => {
  it('returns true for ServicePolicy', () => {
    expect(isTopLevelSingleton(ResourceType.ServicePolicy)).toBe(true);
  });

  it('returns false for ApiWiki (child singleton)', () => {
    expect(isTopLevelSingleton(ResourceType.ApiWiki)).toBe(false);
  });

  it('returns false for Api (not a singleton)', () => {
    expect(isTopLevelSingleton(ResourceType.Api)).toBe(false);
  });
});

describe('getPublishTier', () => {
  it('returns tier 0 for ServicePolicy (no placeholders)', () => {
    // policies/policy → 0 placeholders → 0*2 + 0 = 0
    expect(getPublishTier(ResourceType.ServicePolicy)).toBe(0);
  });

  it('returns tier 2 for top-level types like NamedValue (1 placeholder, ends at placeholder)', () => {
    // namedValues/{0} → 1*2 + 0 = 2
    expect(getPublishTier(ResourceType.NamedValue)).toBe(2);
  });

  it('returns tier 2 for Api (1 placeholder, ends at placeholder)', () => {
    // apis/{0} → 1*2 + 0 = 2
    expect(getPublishTier(ResourceType.Api)).toBe(2);
  });

  it('returns tier 3 for ApiPolicy (1 placeholder, has suffix)', () => {
    // apis/{0}/policies/policy → 1*2 + 1 = 3
    expect(getPublishTier(ResourceType.ApiPolicy)).toBe(3);
  });

  it('returns tier 3 for ApiWiki (1 placeholder, has suffix)', () => {
    // apis/{0}/wikis/default → 1*2 + 1 = 3
    expect(getPublishTier(ResourceType.ApiWiki)).toBe(3);
  });

  it('returns tier 4 for ApiOperation (2 placeholders, ends at placeholder)', () => {
    // apis/{0}/operations/{1} → 2*2 + 0 = 4
    expect(getPublishTier(ResourceType.ApiOperation)).toBe(4);
  });

  it('returns tier 4 for GraphQLResolver (2 placeholders, ends at placeholder)', () => {
    // apis/{0}/resolvers/{1} → 2*2 + 0 = 4
    expect(getPublishTier(ResourceType.GraphQLResolver)).toBe(4);
  });

  it('returns tier 4 for ApiTag (2 placeholders, ends at placeholder)', () => {
    // apis/{0}/tags/{1} → 2*2 + 0 = 4
    expect(getPublishTier(ResourceType.ApiTag)).toBe(4);
  });

  it('returns tier 5 for ApiOperationPolicy (2 placeholders, has suffix)', () => {
    // apis/{0}/operations/{1}/policies/policy → 2*2 + 1 = 5
    expect(getPublishTier(ResourceType.ApiOperationPolicy)).toBe(5);
  });

  it('returns tier 5 for GraphQLResolverPolicy (2 placeholders, has suffix)', () => {
    // apis/{0}/resolvers/{1}/policies/policy → 2*2 + 1 = 5
    expect(getPublishTier(ResourceType.GraphQLResolverPolicy)).toBe(5);
  });

  it('ensures operations are published before their policies (tier 4 < tier 5)', () => {
    expect(getPublishTier(ResourceType.ApiOperation)).toBeLessThan(
      getPublishTier(ResourceType.ApiOperationPolicy)
    );
  });

  it('ensures resolvers are published before their policies (tier 4 < tier 5)', () => {
    expect(getPublishTier(ResourceType.GraphQLResolver)).toBeLessThan(
      getPublishTier(ResourceType.GraphQLResolverPolicy)
    );
  });
});
