// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect } from 'vitest';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../../../src/models/resource-types.js';

describe('ResourceType enum', () => {
  it('should have exactly 34 resource types', () => {
    const values = Object.values(ResourceType);
    expect(values).toHaveLength(34);
  });

  it('should have unique enum values', () => {
    const values = Object.values(ResourceType);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe('RESOURCE_TYPE_METADATA', () => {
  it('should have metadata for all 34 resource types', () => {
    const metadataKeys = Object.keys(RESOURCE_TYPE_METADATA);
    const enumValues = Object.values(ResourceType);
    expect(metadataKeys).toHaveLength(34);
    for (const val of enumValues) {
      expect(RESOURCE_TYPE_METADATA[val]).toBeDefined();
    }
  });

  it('each entry should have armPathSuffix, artifactDirectory, and infoFile properties', () => {
    for (const [type, meta] of Object.entries(RESOURCE_TYPE_METADATA)) {
      expect(meta.armPathSuffix, `${type} armPathSuffix`).toBeDefined();
      expect(typeof meta.armPathSuffix).toBe('string');
      expect(meta.artifactDirectory, `${type} artifactDirectory`).toBeDefined();
      expect(typeof meta.artifactDirectory).toBe('string');
      // infoFile can be null or string
      expect(
        meta.infoFile === null || typeof meta.infoFile === 'string',
        `${type} infoFile should be null or string`
      ).toBe(true);
    }
  });

  it('armPathSuffix should not start with /', () => {
    for (const [type, meta] of Object.entries(RESOURCE_TYPE_METADATA)) {
      expect(meta.armPathSuffix.startsWith('/'), `${type} armPathSuffix should not start with /`).toBe(false);
    }
  });

  it('should include key tier 1 resources', () => {
    const tier1 = [
      ResourceType.NamedValue, ResourceType.Tag, ResourceType.Gateway,
      ResourceType.VersionSet, ResourceType.Backend, ResourceType.Logger,
      ResourceType.Group, ResourceType.PolicyFragment,
    ];
    for (const t of tier1) {
      expect(RESOURCE_TYPE_METADATA[t]).toBeDefined();
    }
  });

  it('should include child resource types with positional placeholders', () => {
    expect(RESOURCE_TYPE_METADATA[ResourceType.ApiOperation].armPathSuffix).toContain('{0}');
    expect(RESOURCE_TYPE_METADATA[ResourceType.ApiOperation].armPathSuffix).toContain('{1}');
    expect(RESOURCE_TYPE_METADATA[ResourceType.ProductApi].armPathSuffix).toContain('{0}');
    expect(RESOURCE_TYPE_METADATA[ResourceType.ProductApi].armPathSuffix).toContain('{1}');
  });

  it('supportsGet is defined as a boolean for all resource types', () => {
    for (const [type, meta] of Object.entries(RESOURCE_TYPE_METADATA)) {
      expect(typeof meta.supportsGet, `${type} supportsGet should be boolean`).toBe('boolean');
    }
  });

  it('association resource types have supportsGet=false', () => {
    const associationTypes = [
      ResourceType.ProductApi,
      ResourceType.ProductGroup,
      ResourceType.ProductTag,
      ResourceType.GatewayApi,
    ];
    for (const type of associationTypes) {
      expect(RESOURCE_TYPE_METADATA[type].supportsGet, `${type} should have supportsGet=false`).toBe(false);
    }
  });

  it('non-association resource types have supportsGet=true', () => {
    const nonAssociationTypes = [
      ResourceType.Product,
      ResourceType.Api,
      ResourceType.Tag,
      ResourceType.ServicePolicy,
    ];
    for (const type of nonAssociationTypes) {
      expect(RESOURCE_TYPE_METADATA[type].supportsGet, `${type} should have supportsGet=true`).toBe(true);
    }
  });

  it('workspaceSupported is optional and boolean when present', () => {
    for (const [type, meta] of Object.entries(RESOURCE_TYPE_METADATA)) {
      if (meta.workspaceSupported !== undefined) {
        expect(typeof meta.workspaceSupported, `${type} workspaceSupported should be boolean`).toBe('boolean');
      }
    }
  });

  it('workspace-capable types have workspaceSupported=true', () => {
    const expectedWorkspaceTypes = [
      ResourceType.NamedValue,
      ResourceType.Tag,
      ResourceType.Backend,
      ResourceType.Logger,
      ResourceType.Group,
      ResourceType.Diagnostic,
      ResourceType.PolicyFragment,
      ResourceType.Product,
      ResourceType.Api,
      ResourceType.Subscription,
      ResourceType.GlobalSchema,
      ResourceType.Documentation,
    ];
    for (const type of expectedWorkspaceTypes) {
      expect(
        RESOURCE_TYPE_METADATA[type].workspaceSupported,
        `${type} should have workspaceSupported=true`
      ).toBe(true);
    }
  });

  it('non-workspace types do not have workspaceSupported=true', () => {
    const nonWorkspaceTypes = [
      ResourceType.ServicePolicy,
      ResourceType.ProductPolicy,
      ResourceType.ProductApi,
      ResourceType.GatewayApi,
      ResourceType.ApiPolicy,
      ResourceType.ApiOperation,
    ];
    for (const type of nonWorkspaceTypes) {
      expect(
        RESOURCE_TYPE_METADATA[type].workspaceSupported,
        `${type} should not have workspaceSupported=true`
      ).not.toBe(true);
    }
  });
});
