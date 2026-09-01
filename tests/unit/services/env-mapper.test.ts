// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, it, expect } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import type { ResourceDescriptor } from '../../../src/models/types.js';
import type { OverrideConfig } from '../../../src/models/config.js';
import {
  DEFAULT_APPLIES_TO,
  NON_AFFIXABLE_TYPES,
  buildEnvMapping,
  buildEnvMappingFromOverrides,
  toDeployedName,
  toCanonicalName,
  isInEnvNamespace,
  mapDescriptor,
  type EnvironmentOverride,
  type EnvMapping,
} from '../../../src/services/env-mapper.js';

// Helper to build a simple prefix-only mapping
function prefixMapping(prefix: string, types?: ResourceType[]): EnvMapping {
  return buildEnvMapping({ namePrefix: prefix, appliesTo: types })!;
}

// Helper to build a suffix-only mapping
function suffixMapping(suffix: string): EnvMapping {
  return buildEnvMapping({ nameSuffix: suffix })!;
}

// Helper to build a prefix+suffix mapping
function bothMapping(prefix: string, suffix: string): EnvMapping {
  return buildEnvMapping({ namePrefix: prefix, nameSuffix: suffix })!;
}

describe('env-mapper', () => {
  // ─── DEFAULT_APPLIES_TO ──────────────────────────────────────────────────
  describe('DEFAULT_APPLIES_TO', () => {
    const expected = [
      ResourceType.Api,
      ResourceType.Product,
      ResourceType.NamedValue,
      ResourceType.Backend,
      ResourceType.Logger,
      ResourceType.PolicyFragment,
      ResourceType.VersionSet,
      ResourceType.Tag,
      ResourceType.Group,
      ResourceType.Subscription,
      ResourceType.Workspace,
    ];

    it('should contain exactly the 11 expected types', () => {
      expect(DEFAULT_APPLIES_TO.size).toBe(11);
      for (const t of expected) {
        expect(DEFAULT_APPLIES_TO.has(t)).toBe(true);
      }
    });

    it('should NOT include opt-in types (Gateway, Diagnostic, GlobalSchema, etc.)', () => {
      expect(DEFAULT_APPLIES_TO.has(ResourceType.Gateway)).toBe(false);
      expect(DEFAULT_APPLIES_TO.has(ResourceType.Diagnostic)).toBe(false);
      expect(DEFAULT_APPLIES_TO.has(ResourceType.GlobalSchema)).toBe(false);
      expect(DEFAULT_APPLIES_TO.has(ResourceType.PolicyRestriction)).toBe(false);
      expect(DEFAULT_APPLIES_TO.has(ResourceType.Documentation)).toBe(false);
    });
  });

  // ─── NON_AFFIXABLE_TYPES ─────────────────────────────────────────────────
  describe('NON_AFFIXABLE_TYPES', () => {
    it('should include singleton policies', () => {
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ServicePolicy)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ApiPolicy)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ProductPolicy)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ApiOperationPolicy)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.GraphQLResolverPolicy)).toBe(true);
    });

    it('should include wikis and McpServer', () => {
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ApiWiki)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ProductWiki)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.McpServer)).toBe(true);
    });

    it('should include association types', () => {
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ProductApi)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ProductGroup)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ProductTag)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.GatewayApi)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ApiTag)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ApiDiagnostic)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ApiOperation)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ApiSchema)).toBe(true);
      expect(NON_AFFIXABLE_TYPES.has(ResourceType.ApiRelease)).toBe(true);
    });
  });

  // ─── buildEnvMapping ─────────────────────────────────────────────────────
  describe('buildEnvMapping', () => {
    it('returns undefined for undefined input', () => {
      expect(buildEnvMapping(undefined)).toBeUndefined();
    });

    it('returns undefined for an empty block (no prefix, suffix, apiPathPrefix, or appliesTo)', () => {
      expect(buildEnvMapping({})).toBeUndefined();
    });

    it('returns undefined when prefix and suffix are whitespace-only and no other fields', () => {
      expect(buildEnvMapping({ namePrefix: '   ', nameSuffix: '  ' })).toBeUndefined();
    });

    it('returns a mapping for prefix only', () => {
      const m = buildEnvMapping({ namePrefix: 'dev-' });
      expect(m).toBeDefined();
      expect(m!.prefix).toBe('dev-');
      expect(m!.suffix).toBe('');
    });

    it('returns a mapping for suffix only', () => {
      const m = buildEnvMapping({ nameSuffix: '-dev' });
      expect(m).toBeDefined();
      expect(m!.prefix).toBe('');
      expect(m!.suffix).toBe('-dev');
    });

    it('returns a mapping for both prefix and suffix', () => {
      const m = buildEnvMapping({ namePrefix: 'dev-', nameSuffix: '-v2' });
      expect(m).toBeDefined();
      expect(m!.prefix).toBe('dev-');
      expect(m!.suffix).toBe('-v2');
    });

    it('returns a mapping for apiPathPrefix only (no name affix)', () => {
      const m = buildEnvMapping({ apiPathPrefix: '/dev' });
      expect(m).toBeDefined();
      expect(m!.apiPathPrefix).toBe('/dev');
      expect(m!.prefix).toBe('');
      expect(m!.suffix).toBe('');
    });

    it('trims whitespace from prefix and suffix', () => {
      const m = buildEnvMapping({ namePrefix: '  dev-  ', nameSuffix: '  -qa  ' });
      expect(m!.prefix).toBe('dev-');
      expect(m!.suffix).toBe('-qa');
    });

    it('uses DEFAULT_APPLIES_TO when appliesTo is omitted', () => {
      const m = buildEnvMapping({ namePrefix: 'dev-' });
      expect(m!.appliesTo).toBe(DEFAULT_APPLIES_TO);
    });

    it('uses explicit appliesTo when provided, overriding the default', () => {
      const m = buildEnvMapping({ namePrefix: 'dev-', appliesTo: [ResourceType.Api, ResourceType.Gateway] });
      expect(m!.appliesTo.has(ResourceType.Api)).toBe(true);
      expect(m!.appliesTo.has(ResourceType.Gateway)).toBe(true);
      expect(m!.appliesTo.has(ResourceType.Product)).toBe(false);
    });

    it('accepts an explicit empty appliesTo and still returns a mapping', () => {
      const m = buildEnvMapping({ namePrefix: 'dev-', appliesTo: [] });
      expect(m).toBeDefined();
      expect(m!.appliesTo.size).toBe(0);
    });

    it('does not include apiPathPrefix in the result when it is absent', () => {
      const m = buildEnvMapping({ namePrefix: 'dev-' });
      expect('apiPathPrefix' in m!).toBe(false);
    });

    it('includes apiPathPrefix in the result when set', () => {
      const m = buildEnvMapping({ namePrefix: 'dev-', apiPathPrefix: '/dev' });
      expect(m!.apiPathPrefix).toBe('/dev');
    });

    it('returns a mapping when only appliesTo is set (no prefix/suffix/apiPathPrefix)', () => {
      const m = buildEnvMapping({ appliesTo: [ResourceType.Api] });
      expect(m).toBeDefined();
      expect(m!.appliesTo.has(ResourceType.Api)).toBe(true);
    });
  });

  // ─── buildEnvMappingFromOverrides ────────────────────────────────────────
  describe('buildEnvMappingFromOverrides', () => {
    it('returns undefined for undefined overrides', () => {
      expect(buildEnvMappingFromOverrides(undefined)).toBeUndefined();
    });

    it('returns undefined when overrides has no environment field', () => {
      const overrides: OverrideConfig = {};
      expect(buildEnvMappingFromOverrides(overrides)).toBeUndefined();
    });

    it('delegates to buildEnvMapping when environment field is present', () => {
      type WithEnv = OverrideConfig & { environment?: EnvironmentOverride };
      const overrides: WithEnv = { environment: { namePrefix: 'dev-' } };
      const m = buildEnvMappingFromOverrides(overrides as OverrideConfig);
      expect(m).toBeDefined();
      expect(m!.prefix).toBe('dev-');
    });

    it('returns undefined when environment block is empty', () => {
      type WithEnv = OverrideConfig & { environment?: EnvironmentOverride };
      const overrides: WithEnv = { environment: {} };
      expect(buildEnvMappingFromOverrides(overrides as OverrideConfig)).toBeUndefined();
    });
  });

  // ─── toDeployedName / toCanonicalName round-trips ────────────────────────
  describe('toDeployedName / toCanonicalName round-trip', () => {
    const m = buildEnvMapping({ namePrefix: 'dev-', nameSuffix: '-qa' })!;

    const defaultTypes: ResourceType[] = [
      ResourceType.Api,
      ResourceType.Product,
      ResourceType.NamedValue,
      ResourceType.Backend,
      ResourceType.Logger,
      ResourceType.PolicyFragment,
      ResourceType.VersionSet,
      ResourceType.Tag,
      ResourceType.Group,
      ResourceType.Subscription,
      ResourceType.Workspace,
    ];

    it.each(defaultTypes)('round-trips for %s (prefix+suffix)', (type) => {
      const canonical = 'my-resource';
      const deployed = toDeployedName(canonical, type, m);
      expect(deployed).toBe('dev-my-resource-qa');
      const recovered = toCanonicalName(deployed, type, m);
      expect(recovered).toBe(canonical);
    });

    it('types outside default appliesTo are returned unchanged by toDeployedName', () => {
      expect(toDeployedName('my-gw', ResourceType.Gateway, m)).toBe('my-gw');
      expect(toDeployedName('my-diag', ResourceType.Diagnostic, m)).toBe('my-diag');
      expect(toDeployedName('my-schema', ResourceType.GlobalSchema, m)).toBe('my-schema');
    });

    it('types outside default appliesTo are returned unchanged by toCanonicalName', () => {
      expect(toCanonicalName('my-gw', ResourceType.Gateway, m)).toBe('my-gw');
      expect(toCanonicalName('dev-my-diag-qa', ResourceType.Diagnostic, m)).toBe('dev-my-diag-qa');
    });

    it('prefix-only: deployed = prefix + name', () => {
      const mp = prefixMapping('dev-');
      expect(toDeployedName('petstore', ResourceType.Api, mp)).toBe('dev-petstore');
      expect(toCanonicalName('dev-petstore', ResourceType.Api, mp)).toBe('petstore');
    });

    it('suffix-only: deployed = name + suffix', () => {
      const ms = suffixMapping('-dev');
      expect(toDeployedName('petstore', ResourceType.Api, ms)).toBe('petstore-dev');
      expect(toCanonicalName('petstore-dev', ResourceType.Api, ms)).toBe('petstore');
    });

    it('both prefix and suffix: deployed = prefix + name + suffix', () => {
      const mb = bothMapping('dev-', '-v2');
      expect(toDeployedName('petstore', ResourceType.Api, mb)).toBe('dev-petstore-v2');
      expect(toCanonicalName('dev-petstore-v2', ResourceType.Api, mb)).toBe('petstore');
    });

    it('toCanonicalName returns undefined when name does not match prefix', () => {
      const mp = prefixMapping('dev-');
      expect(toCanonicalName('prod-foo', ResourceType.Api, mp)).toBeUndefined();
    });

    it('toCanonicalName returns undefined when suffix does not match', () => {
      const ms = suffixMapping('-dev');
      expect(toCanonicalName('petstore-prod', ResourceType.Api, ms)).toBeUndefined();
    });

    it('toCanonicalName returns undefined when name is too short for prefix+suffix', () => {
      const mb = bothMapping('dev-', '-qa');
      expect(toCanonicalName('d', ResourceType.Api, mb)).toBeUndefined();
    });
  });

  // ─── isInEnvNamespace ────────────────────────────────────────────────────
  describe('isInEnvNamespace', () => {
    const m = prefixMapping('dev-');

    it('returns true when name starts with prefix', () => {
      expect(isInEnvNamespace('dev-foo', ResourceType.Api, m)).toBe(true);
    });

    it('returns false when name does not start with prefix', () => {
      expect(isInEnvNamespace('prod-foo', ResourceType.Api, m)).toBe(false);
      expect(isInEnvNamespace('foo', ResourceType.Api, m)).toBe(false);
    });

    it('returns true for type not in appliesTo (not scoped)', () => {
      expect(isInEnvNamespace('anything', ResourceType.Gateway, m)).toBe(true);
      expect(isInEnvNamespace('prod-foo', ResourceType.Diagnostic, m)).toBe(true);
    });

    it('handles suffix-only mapping', () => {
      const ms = suffixMapping('-dev');
      expect(isInEnvNamespace('foo-dev', ResourceType.Api, ms)).toBe(true);
      expect(isInEnvNamespace('foo-prod', ResourceType.Api, ms)).toBe(false);
    });

    it('handles both prefix and suffix', () => {
      const mb = bothMapping('dev-', '-v2');
      expect(isInEnvNamespace('dev-foo-v2', ResourceType.Api, mb)).toBe(true);
      expect(isInEnvNamespace('dev-foo', ResourceType.Api, mb)).toBe(false);
      expect(isInEnvNamespace('foo-v2', ResourceType.Api, mb)).toBe(false);
    });

    it('returns false when name length is less than prefix+suffix combined', () => {
      const mb = bothMapping('dev-', '-qa');
      expect(isInEnvNamespace('x', ResourceType.Api, mb)).toBe(false);
    });
  });

  // ─── mapDescriptor ───────────────────────────────────────────────────────
  describe('mapDescriptor', () => {
    const m = prefixMapping('dev-');

    it('affixes top-level type nameParts[0] when type ∈ appliesTo', () => {
      const d: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['petstore'] };
      expect(mapDescriptor(d, m)).toEqual({ type: ResourceType.Api, nameParts: ['dev-petstore'] });
    });

    it('leaves top-level type unchanged when type ∉ appliesTo', () => {
      const d: ResourceDescriptor = { type: ResourceType.Diagnostic, nameParts: ['applicationinsights'] };
      expect(mapDescriptor(d, m)).toEqual(d);
    });

    it('ApiOperation: only parent (Api) segment affixed, operation key unchanged', () => {
      const d: ResourceDescriptor = { type: ResourceType.ApiOperation, nameParts: ['petstore', 'get-pets'] };
      const result = mapDescriptor(d, m);
      expect(result).toEqual({ type: ResourceType.ApiOperation, nameParts: ['dev-petstore', 'get-pets'] });
    });

    it('ApiPolicy: parent Api name affixed (singleton child)', () => {
      const d: ResourceDescriptor = { type: ResourceType.ApiPolicy, nameParts: ['petstore'] };
      const result = mapDescriptor(d, m);
      expect(result).toEqual({ type: ResourceType.ApiPolicy, nameParts: ['dev-petstore'] });
    });

    it('ProductApi: both Product and Api segments affixed (both in default appliesTo)', () => {
      const d: ResourceDescriptor = { type: ResourceType.ProductApi, nameParts: ['starter', 'petstore'] };
      const result = mapDescriptor(d, m);
      expect(result).toEqual({ type: ResourceType.ProductApi, nameParts: ['dev-starter', 'dev-petstore'] });
    });

    it('ApiTag: both Api and Tag segments affixed (both in default appliesTo)', () => {
      const d: ResourceDescriptor = { type: ResourceType.ApiTag, nameParts: ['petstore', 'version-one'] };
      const result = mapDescriptor(d, m);
      expect(result).toEqual({ type: ResourceType.ApiTag, nameParts: ['dev-petstore', 'dev-version-one'] });
    });

    it('ProductGroup: Product affixed, Group affixed', () => {
      const d: ResourceDescriptor = { type: ResourceType.ProductGroup, nameParts: ['starter', 'devs'] };
      const result = mapDescriptor(d, m);
      expect(result).toEqual({ type: ResourceType.ProductGroup, nameParts: ['dev-starter', 'dev-devs'] });
    });

    it('GatewayApi: Gateway NOT in default appliesTo → segment 0 unchanged; Api → affixed', () => {
      const d: ResourceDescriptor = { type: ResourceType.GatewayApi, nameParts: ['my-gw', 'petstore'] };
      const result = mapDescriptor(d, m);
      expect(result).toEqual({ type: ResourceType.GatewayApi, nameParts: ['my-gw', 'dev-petstore'] });
    });

    it('ServicePolicy: no nameParts, returned unchanged', () => {
      const d: ResourceDescriptor = { type: ResourceType.ServicePolicy, nameParts: [] };
      expect(mapDescriptor(d, m)).toEqual(d);
    });

    it('ProductPolicy: Product segment affixed', () => {
      const d: ResourceDescriptor = { type: ResourceType.ProductPolicy, nameParts: ['starter'] };
      expect(mapDescriptor(d, m)).toEqual({ type: ResourceType.ProductPolicy, nameParts: ['dev-starter'] });
    });

    it('ApiOperationPolicy: Api segment affixed, operation key unchanged', () => {
      const d: ResourceDescriptor = { type: ResourceType.ApiOperationPolicy, nameParts: ['petstore', 'get-pets'] };
      const result = mapDescriptor(d, m);
      expect(result).toEqual({ type: ResourceType.ApiOperationPolicy, nameParts: ['dev-petstore', 'get-pets'] });
    });

    it('ApiSchema: Api segment affixed, schema key unchanged', () => {
      const d: ResourceDescriptor = { type: ResourceType.ApiSchema, nameParts: ['petstore', 'json'] };
      const result = mapDescriptor(d, m);
      expect(result).toEqual({ type: ResourceType.ApiSchema, nameParts: ['dev-petstore', 'json'] });
    });

    it('workspace-scoped descriptor: workspace field is preserved unchanged', () => {
      const d: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['petstore'],
        workspace: 'my-workspace',
      };
      const result = mapDescriptor(d, m);
      expect(result.workspace).toBe('my-workspace');
      expect(result.nameParts[0]).toBe('dev-petstore');
    });

    it('workspace-scoped ApiPolicy: parent Api affixed, workspace preserved', () => {
      const d: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['petstore'],
        workspace: 'my-workspace',
      };
      const result = mapDescriptor(d, m);
      expect(result).toEqual({ type: ResourceType.ApiPolicy, nameParts: ['dev-petstore'], workspace: 'my-workspace' });
    });

    it('explicit appliesTo with only Product: Api segments not affixed in ProductApi', () => {
      const mp = prefixMapping('dev-', [ResourceType.Product]);
      const d: ResourceDescriptor = { type: ResourceType.ProductApi, nameParts: ['starter', 'petstore'] };
      const result = mapDescriptor(d, mp);
      expect(result).toEqual({ type: ResourceType.ProductApi, nameParts: ['dev-starter', 'petstore'] });
    });

    it('mapDescriptor does not mutate the original descriptor', () => {
      const d: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['petstore'] };
      const original = { ...d, nameParts: [...d.nameParts] };
      mapDescriptor(d, m);
      expect(d).toEqual(original);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('empty string name round-trips correctly', () => {
      const m = prefixMapping('dev-');
      const deployed = toDeployedName('', ResourceType.Api, m);
      expect(deployed).toBe('dev-');
      const canonical = toCanonicalName('dev-', ResourceType.Api, m);
      expect(canonical).toBe('');
    });

    it('name that equals only the prefix is an empty canonical', () => {
      const m = prefixMapping('dev-');
      expect(toCanonicalName('dev-', ResourceType.Api, m)).toBe('');
    });

    it('name without the env prefix for a tracked type returns undefined from toCanonicalName', () => {
      const m = prefixMapping('dev-');
      expect(toCanonicalName('prod-foo', ResourceType.Api, m)).toBeUndefined();
    });

    it('suffix check: name with wrong suffix returns undefined', () => {
      const m = suffixMapping('-dev');
      expect(toCanonicalName('foo-prod', ResourceType.Api, m)).toBeUndefined();
    });

    it('prefix+suffix: name matching only prefix returns false from isInEnvNamespace', () => {
      const m = bothMapping('dev-', '-qa');
      expect(isInEnvNamespace('dev-foo', ResourceType.Api, m)).toBe(false);
    });

    it('apiPathPrefix-only mapping: names are returned unchanged', () => {
      const m = buildEnvMapping({ apiPathPrefix: '/dev' })!;
      expect(toDeployedName('petstore', ResourceType.Api, m)).toBe('petstore');
      expect(toCanonicalName('petstore', ResourceType.Api, m)).toBe('petstore');
      expect(isInEnvNamespace('petstore', ResourceType.Api, m)).toBe(true);
    });
  });
});
