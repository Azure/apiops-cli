/**
 * Unit tests for T025: Transitive dependency resolver
 */

import { describe, it, expect } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { FilterConfig } from '../../../src/models/config.js';
import {
  scanPolicyReferences,
  scanApiVersionSetReference,
  resolveTransitiveDependencies,
  findTransitiveDependencies,
} from '../../../src/services/transitive-resolver.js';

describe('transitive-resolver', () => {
  describe('scanPolicyReferences', () => {
    it('should detect named value references', () => {
      const policy = '<policies><inbound><set-header name="Auth" exists-action="override"><value>{{my-secret}}</value></set-header></inbound></policies>';
      const refs = scanPolicyReferences(policy);
      expect(refs).toContainEqual({
        type: ResourceType.NamedValue,
        name: 'my-secret',
      });
    });

    it('should detect multiple named value references', () => {
      const policy = '<value>{{secret-1}}</value><value>{{secret-2}}</value>';
      const refs = scanPolicyReferences(policy);
      const nvRefs = refs.filter((r) => r.type === ResourceType.NamedValue);
      expect(nvRefs).toHaveLength(2);
      expect(nvRefs[0]?.name).toBe('secret-1');
      expect(nvRefs[1]?.name).toBe('secret-2');
    });

    it('should detect backend references', () => {
      const policy = '<policies><inbound><set-backend-service backend-id="my-backend" /></inbound></policies>';
      const refs = scanPolicyReferences(policy);
      expect(refs).toContainEqual({
        type: ResourceType.Backend,
        name: 'my-backend',
      });
    });

    it('should detect policy fragment references', () => {
      const policy = '<policies><inbound><include-fragment fragment-id="my-fragment" /></inbound></policies>';
      const refs = scanPolicyReferences(policy);
      expect(refs).toContainEqual({
        type: ResourceType.PolicyFragment,
        name: 'my-fragment',
      });
    });

    it('should detect all reference types in a single policy', () => {
      const policy = `
        <policies>
          <inbound>
            <set-header><value>{{my-key}}</value></set-header>
            <set-backend-service backend-id="backend-1" />
            <include-fragment fragment-id="auth-fragment" />
          </inbound>
        </policies>
      `;
      const refs = scanPolicyReferences(policy);
      expect(refs).toHaveLength(3);
      expect(refs.some((r) => r.type === ResourceType.NamedValue && r.name === 'my-key')).toBe(true);
      expect(refs.some((r) => r.type === ResourceType.Backend && r.name === 'backend-1')).toBe(true);
      expect(refs.some((r) => r.type === ResourceType.PolicyFragment && r.name === 'auth-fragment')).toBe(true);
    });

    it('should return empty array for policy without references', () => {
      const policy = '<policies><inbound><base /></inbound></policies>';
      const refs = scanPolicyReferences(policy);
      expect(refs).toHaveLength(0);
    });

    it('should trim whitespace from names', () => {
      const policy = '<value>{{ my-secret }}</value>';
      const refs = scanPolicyReferences(policy);
      expect(refs[0]?.name).toBe('my-secret');
    });
  });

  describe('scanApiVersionSetReference', () => {
    it('should detect apiVersionSetId property', () => {
      const apiJson = {
        properties: {
          apiVersionSetId: '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.ApiManagement/service/svc1/apiVersionSets/my-version-set',
        },
      };
      const ref = scanApiVersionSetReference(apiJson);
      expect(ref).toEqual({
        type: ResourceType.VersionSet,
        name: 'my-version-set',
      });
    });

    it('should return undefined when no version set', () => {
      const apiJson = { properties: { displayName: 'My API' } };
      expect(scanApiVersionSetReference(apiJson)).toBeUndefined();
    });

    it('should return undefined when no properties', () => {
      const apiJson = { name: 'my-api' };
      expect(scanApiVersionSetReference(apiJson)).toBeUndefined();
    });
  });

  describe('resolveTransitiveDependencies', () => {
    it('should expand filter with discovered dependencies', () => {
      const policies = new Map<string, string>();
      policies.set('service-policy', '<value>{{my-secret}}</value>');

      const apis = new Map<string, Record<string, unknown>>();

      const filter: FilterConfig = {
        apiNames: ['my-api'],
        namedValueNames: [], // Start with empty — should be expanded
      };

      const expanded = resolveTransitiveDependencies(policies, apis, filter);
      expect(expanded.namedValueNames).toContain('my-secret');
    });

    it('should not add to undefined filter fields (unfiltered types)', () => {
      const policies = new Map<string, string>();
      policies.set('policy', '<value>{{my-secret}}</value>');

      const apis = new Map<string, Record<string, unknown>>();

      // namedValueNames is undefined = all named values included
      const filter: FilterConfig = {
        apiNames: ['my-api'],
      };

      const expanded = resolveTransitiveDependencies(policies, apis, filter);
      // Should remain undefined (no need to add — all are already included)
      expect(expanded.namedValueNames).toBeUndefined();
    });

    it('should not duplicate existing entries', () => {
      const policies = new Map<string, string>();
      policies.set('policy', '<value>{{existing-secret}}</value>');

      const apis = new Map<string, Record<string, unknown>>();

      const filter: FilterConfig = {
        namedValueNames: ['existing-secret'],
      };

      const expanded = resolveTransitiveDependencies(policies, apis, filter);
      expect(expanded.namedValueNames).toEqual(['existing-secret']);
    });
  });

  describe('findTransitiveDependencies', () => {
    it('should find dependencies from policies and APIs', () => {
      const policies = new Map<string, string>();
      policies.set('policy-1', '<value>{{secret-1}}</value>');
      policies.set('policy-2', '<set-backend-service backend-id="backend-1" />');

      const apis = new Map<string, Record<string, unknown>>();
      apis.set('my-api', {
        properties: {
          apiVersionSetId: '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/s/apiVersionSets/vs-1',
        },
      });

      const deps = findTransitiveDependencies(policies, apis);
      expect(deps).toHaveLength(3);
      expect(deps.some((d) => d.type === ResourceType.NamedValue && d.nameParts[0] === 'secret-1')).toBe(true);
      expect(deps.some((d) => d.type === ResourceType.Backend && d.nameParts[0] === 'backend-1')).toBe(true);
      expect(deps.some((d) => d.type === ResourceType.VersionSet && d.nameParts[0] === 'vs-1')).toBe(true);
    });

    it('should deduplicate dependencies', () => {
      const policies = new Map<string, string>();
      policies.set('policy-1', '<value>{{my-secret}}</value>');
      policies.set('policy-2', '<value>{{my-secret}}</value>');

      const apis = new Map<string, Record<string, unknown>>();

      const deps = findTransitiveDependencies(policies, apis);
      const nvDeps = deps.filter((d) => d.type === ResourceType.NamedValue);
      expect(nvDeps).toHaveLength(1);
    });

    it('should return empty array when no references', () => {
      const policies = new Map<string, string>();
      policies.set('policy', '<base />');
      const apis = new Map<string, Record<string, unknown>>();

      const deps = findTransitiveDependencies(policies, apis);
      expect(deps).toHaveLength(0);
    });
  });
});
