// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Transitive dependency resolver
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { FilterConfig } from '../../../src/models/config.js';
import {
  createNamedValueReader,
  scanNamedValueTargets,
  scanLiquidNamedValueCandidates,
  scanPolicyReferences,
  scanApiVersionSetReference,
  resolveTransitiveDependencies,
  findTransitiveDependencies,
  findSubscriptionTargets,
  scanArtifactReferences,
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

    it.each([
      ['an attribute before backend-id', '<set-backend-service id="apim-generated-policy" backend-id="func-backend" />', ResourceType.Backend, 'func-backend'],
      ['single quotes', "<set-backend-service backend-id='quoted-backend' />", ResourceType.Backend, 'quoted-backend'],
      ['llm-content-safety', '<llm-content-safety backend-id="content-safety" shield-prompt="true" />', ResourceType.Backend, 'content-safety'],
      ['azure-openai-semantic-cache-lookup', '<azure-openai-semantic-cache-lookup score-threshold="0.8" embeddings-backend-id="embeddings" />', ResourceType.Backend, 'embeddings'],
      ['llm-semantic-cache-lookup', '<llm-semantic-cache-lookup embeddings-backend-id="llm-embeddings" />', ResourceType.Backend, 'llm-embeddings'],
      ['include-fragment with another attribute first', '<include-fragment id="x" fragment-id="frag-a" />', ResourceType.PolicyFragment, 'frag-a'],
    ])('should detect a reference written with %s', (_label, policy, type, name) => {
      expect(scanPolicyReferences(policy)).toContainEqual({ type, name });
    });

    it('should ignore references inside XML comments (#305)', () => {
      const refs = scanPolicyReferences(
        '<!-- <set-backend-service backend-id="old-backend" /> {{old-secret}} -->' +
        '<set-backend-service backend-id="live-backend" />'
      );

      expect(refs).toEqual([{ type: ResourceType.Backend, name: 'live-backend' }]);
    });
    it('should not let a stray "<!--" in a policy expression hide later references', () => {
      const refs = scanPolicyReferences(
        '<set-variable name="marker" value="@(&quot;<!--&quot;)" />' +
        '<set-backend-service backend-id="orders-backend" />'
      );

      expect(refs).toContainEqual({ type: ResourceType.Backend, name: 'orders-backend' });
    });
    it('should give the {{name}}s in Liquid bodies that a named value could have, for callers to check', () => {
      const policy = `<policies><inbound>
        <set-body template="liquid">nv=[{{demo-backend-id}}] dotted=[{{body.id}}] spaced=[{{ context.Request.Url }}] filtered=[{{x | upcase}}]</set-body>
        <!-- <set-body template="liquid">{{commented}}</set-body> -->
        <set-header name="h"><value>{{outside-liquid}}</value></set-header>
      </inbound></policies>`;

      expect(scanLiquidNamedValueCandidates(policy)).toEqual(['demo-backend-id', 'body.id']);
    });
    it('should ignore Liquid output in set-body templates but keep named values elsewhere (#276)', () => {
      const refs = scanPolicyReferences(`
        <set-header name="Auth"><value>{{real-value}}</value></set-header>
        <set-body template="liquid">{{context.Request.MatchedParameters["id"]}}</set-body>
        <set-body x="1" template='liquid'>{{body.envelope.body.fault.faultcode}}</set-body>
        <set-body template="liquid" />
        <set-body>{{after-liquid}}</set-body>
        <set-body template="none">{{not-liquid}}</set-body>`);

      expect(refs).toEqual([
        { type: ResourceType.NamedValue, name: 'real-value' },
        { type: ResourceType.NamedValue, name: 'after-liquid' },
        { type: ResourceType.NamedValue, name: 'not-liquid' },
      ]);
    });

    it('should not treat policy expressions or named value placeholders as resource names', () => {
      const refs = scanPolicyReferences(
        '<set-backend-service backend-id="@(context.Variables.GetValueOrDefault<string>("b"))" />' +
        '<set-backend-service backend-id="{{backend-name}}" />'
      );

      expect(refs).toEqual([{ type: ResourceType.NamedValue, name: 'backend-name' }]);
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

    it('should preserve malformed encoded names instead of throwing', () => {
      const apiJson = {
        properties: {
          apiVersionSetId: '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.ApiManagement/service/svc1/apiVersionSets/version%',
        },
      };

      expect(scanApiVersionSetReference(apiJson)).toEqual({
        type: ResourceType.VersionSet,
        name: 'version%',
      });
    });
  });

  describe('resolveTransitiveDependencies', () => {
    it('should expand filter with discovered dependencies', () => {
      const policies = new Map<string, string>();
      policies.set('service-policy', '<value>{{my-secret}}</value>');

      const apis = new Map<string, Record<string, unknown>>();

      const filter: FilterConfig = {
        apis: ['my-api'],
        namedValues: [], // Start with empty — should be expanded
      };

      const expanded = resolveTransitiveDependencies(policies, apis, filter);
      expect(expanded.namedValues).toContain('my-secret');
    });

    it('should not add to undefined filter fields (unfiltered types)', () => {
      const policies = new Map<string, string>();
      policies.set('policy', '<value>{{my-secret}}</value>');

      const apis = new Map<string, Record<string, unknown>>();

      // namedValues is undefined = all named values included
      const filter: FilterConfig = {
        apis: ['my-api'],
      };

      const expanded = resolveTransitiveDependencies(policies, apis, filter);
      // Should remain undefined (no need to add — all are already included)
      expect(expanded.namedValues).toBeUndefined();
    });

    it('should not duplicate existing entries', () => {
      const policies = new Map<string, string>();
      policies.set('policy', '<value>{{existing-secret}}</value>');

      const apis = new Map<string, Record<string, unknown>>();

      const filter: FilterConfig = {
        namedValues: ['existing-secret'],
      };

      const expanded = resolveTransitiveDependencies(policies, apis, filter);
      expect(expanded.namedValues).toEqual(['existing-secret']);
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

    it('should follow named values in logger and backend credentials', () => {
      const deps = findTransitiveDependencies(new Map(), new Map(), undefined, [
        {
          descriptor: { type: ResourceType.Logger, nameParts: ['app-insights'] },
          json: { properties: { loggerType: 'applicationInsights', credentials: { instrumentationKey: '{{Logger-Credentials--abc}}' } } },
        },
        {
          descriptor: { type: ResourceType.Backend, nameParts: ['orders'], workspace: 'team-a' },
          json: {
            properties: {
              url: 'https://orders.example.com',
              credentials: {
                header: { 'x-api-key': ['{{orders-key}}'] },
                query: { code: ['{{orders-code}}'] },
                authorization: { scheme: 'Bearer', parameter: '{{orders-token}}' },
              },
            },
          },
        },
      ]);

      expect(deps).toEqual([
        { type: ResourceType.NamedValue, nameParts: ['Logger-Credentials--abc'], workspace: undefined },
        { type: ResourceType.NamedValue, nameParts: ['orders-key'], workspace: 'team-a' },
        { type: ResourceType.NamedValue, nameParts: ['orders-code'], workspace: 'team-a' },
        { type: ResourceType.NamedValue, nameParts: ['orders-token'], workspace: 'team-a' },
      ]);
    });

    describe('policy attributes set to a named value (#331)', () => {
      const POLICY = '<set-backend-service backend-id="{{Backend_Id}}" />';
      const namedValue = (properties: Record<string, unknown>, name = 'backend-id', workspace?: string) => ({
        descriptor: { type: ResourceType.NamedValue, nameParts: [name], workspace },
        json: { properties },
      });

      it('should read each named value once, however many policies set attributes to it', async () => {
        const descriptor = { type: ResourceType.NamedValue, nameParts: ['backend-id'] };
        const readResource = vi.fn(async () => ({ properties: { value: 'function-backend' } }));
        const read = createNamedValueReader(async () => descriptor, readResource);

        const results = await Promise.all([read(descriptor), read(descriptor), read({ ...descriptor, nameParts: ['BACKEND-ID'] })]);

        expect(results.map((result) => result?.json)).toEqual(Array(3).fill({ properties: { value: 'function-backend' } }));
        expect(readResource).toHaveBeenCalledTimes(1);
      });

      it('should find attributes whose whole value is a named value reference', () => {
        expect(scanNamedValueTargets(
          '<set-backend-service backend-id=" {{ Backend_Id }} " />' +
          '<llm-content-safety backend-id="{{safety}}" />' +
          '<include-fragment fragment-id="{{fragment}}" />' +
          '<set-backend-service backend-id="prefix-{{suffix}}" />' +
          '<!-- <set-backend-service backend-id="{{commented}}" /> -->'
        )).toEqual([
          { type: ResourceType.Backend, namedValue: 'Backend_Id' },
          { type: ResourceType.Backend, namedValue: 'safety' },
        ]);
      });

      it("should follow the named value's value to the resource it names, matching the display name", () => {
        const deps = findTransitiveDependencies(new Map([['p', POLICY]]), new Map(), undefined, [
          namedValue({ displayName: 'backend_id', value: ' function-backend ' }),
        ]);

        expect(deps).toContainEqual({ type: ResourceType.Backend, nameParts: ['function-backend'], workspace: undefined });
      });

      it('should follow only the named value with that display name, not one with that resource name', () => {
        const byName = findTransitiveDependencies(new Map([['p', POLICY]]), new Map(), undefined, [
          namedValue({ displayName: 'Other', value: 'by-name' }, 'Backend_Id'),
        ]);
        const byDisplayName = findTransitiveDependencies(new Map([['p', POLICY]]), new Map(), undefined, [
          namedValue({ displayName: 'Other', value: 'by-name' }, 'Backend_Id'),
          namedValue({ displayName: 'Backend_Id', value: 'by-display-name' }, 'nv-1'),
        ]);

        expect(byName.filter((dep) => dep.type === ResourceType.Backend)).toEqual([]);
        expect(byDisplayName.filter((dep) => dep.type === ResourceType.Backend)).toEqual([
          { type: ResourceType.Backend, nameParts: ['by-display-name'], workspace: undefined },
        ]);
      });

      it.each([
        ['a secret', { displayName: 'Backend_Id', value: '***REDACTED***', secret: true }],
        ['a policy expression', { displayName: 'Backend_Id', value: '@(context.Variables["b"])' }],
        ['a nested reference', { displayName: 'Backend_Id', value: '{{other}}' }],
      ])('should not follow %s named value', (_kind, properties) => {
        const deps = findTransitiveDependencies(new Map([['p', POLICY]]), new Map(), undefined, [namedValue(properties)]);

        expect(deps.filter((dep) => dep.type === ResourceType.Backend)).toEqual([]);
      });

      it("should only match a named value in the policy's own scope", () => {
        const deps = findTransitiveDependencies(new Map([['p', POLICY]]), new Map(), 'team-a', [
          namedValue({ displayName: 'Backend_Id', value: 'service-backend' }),
          namedValue({ displayName: 'Backend_Id', value: 'ws-backend' }, 'backend-id', 'team-a'),
        ]);

        expect(deps.filter((dep) => dep.type === ResourceType.Backend)).toEqual([
          { type: ResourceType.Backend, nameParts: ['ws-backend'], workspace: 'team-a' },
        ]);
      });

      it('should follow one in a policy fragment', () => {
        const deps = findTransitiveDependencies(new Map(), new Map(), undefined, [
          { descriptor: { type: ResourceType.PolicyFragment, nameParts: ['route'] }, json: { properties: { value: POLICY } } },
          namedValue({ displayName: 'Backend_Id', value: 'function-backend' }),
        ]);

        expect(deps).toContainEqual({ type: ResourceType.Backend, nameParts: ['function-backend'], workspace: undefined });
      });

      it('should read the named value when scanning an artifact, given a reader', async () => {
        const store = {
          readResource: vi.fn(),
          readContent: vi.fn().mockResolvedValue({ content: POLICY, format: 'xml' }),
          readAssociation: vi.fn(),
        };
        const readNamedValue = vi.fn().mockResolvedValue(
          namedValue({ displayName: 'Backend_Id', value: 'ws-backend' }, 'backend-id', 'team-a')
        );
        const policy = { type: ResourceType.ApiPolicy, nameParts: ['orders'], workspace: 'team-a' };

        const withReader = await scanArtifactReferences(store, '/source', policy, readNamedValue);
        const withoutReader = await scanArtifactReferences(store, '/source', policy);

        expect(readNamedValue).toHaveBeenCalledWith({ type: ResourceType.NamedValue, nameParts: ['Backend_Id'], workspace: 'team-a' });
        expect(withReader).toEqual([
          { type: ResourceType.NamedValue, nameParts: ['Backend_Id'], workspace: 'team-a' },
          { type: ResourceType.Backend, nameParts: ['ws-backend'], workspace: 'team-a' },
        ]);
        expect(withoutReader).toEqual([{ type: ResourceType.NamedValue, nameParts: ['Backend_Id'], workspace: 'team-a' }]);
      });

      it('should follow the named value the reader resolves a reference to, though an override renamed it', async () => {
        const store = {
          readResource: vi.fn(),
          readContent: vi.fn().mockResolvedValue({ content: POLICY, format: 'xml' }),
          readAssociation: vi.fn(),
        };
        // The reader matched {{Backend_Id}}, the source display name, to a
        // named value an override renames to Prod_Backend_Id.
        const readNamedValue = vi.fn().mockResolvedValue(
          namedValue({ displayName: 'Prod_Backend_Id', value: 'prod-backend' }, 'backend-id', 'team-a')
        );
        const policy = { type: ResourceType.ApiPolicy, nameParts: ['orders'], workspace: 'team-a' };

        const references = await scanArtifactReferences(store, '/source', policy, readNamedValue);

        expect(references).toContainEqual({ type: ResourceType.Backend, nameParts: ['prod-backend'], workspace: 'team-a' });
      });
    });

    describe('scanArtifactReferences', () => {
      it('scans policy references without parsing policy XML as JSON', async () => {
        const store = {
          readResource: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
          readContent: vi.fn().mockResolvedValue({
            content: '<value>{{shared-secret}}</value>',
            format: 'xml',
          }),
          readAssociation: vi.fn(),
        };

        await expect(
          scanArtifactReferences(store, '/source', {
            type: ResourceType.ApiPolicy,
            nameParts: ['orders'],
            workspace: 'team-a',
          })
        ).resolves.toContainEqual({
          type: ResourceType.NamedValue,
          nameParts: ['shared-secret'],
          workspace: 'team-a',
        });
        expect(store.readResource).not.toHaveBeenCalled();
      });

      it('should scan backend pools without treating links as transitive dependencies', async () => {
        const store = {
          readResource: vi.fn()
            .mockResolvedValueOnce({
              properties: {
                type: 'Pool',
                pool: {
                  services: [{ id: '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/backends/backend-1' }],
                },
              },
            }),
          readContent: vi.fn().mockResolvedValue(undefined),
          readAssociation: vi.fn(),
        };

        const backendRefs = await scanArtifactReferences(
          store,
          '/source',
          { type: ResourceType.Backend, nameParts: ['pool'] }
        );
        expect(backendRefs).toContainEqual({
          type: ResourceType.Backend,
          nameParts: ['backend-1'],
          workspace: undefined,
        });

        await expect(scanArtifactReferences(
          store,
          '/source',
          { type: ResourceType.Subscription, nameParts: ['sub'] }
        )).resolves.toEqual([]);

        await expect(scanArtifactReferences(
          store,
          '/source',
          { type: ResourceType.Product, nameParts: ['starter'] }
        )).resolves.toEqual([]);
        expect(store.readAssociation).not.toHaveBeenCalled();
      });

      it('should identify subscription targets separately from transitive dependencies', () => {
        const targets = findSubscriptionTargets({
          properties: {
            scope: '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/apis/orders',
            apiId: '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/products/starter',
          },
        });

        expect(targets).toEqual([
          {
            type: ResourceType.Api,
            nameParts: ['orders'],
            workspace: undefined,
          },
          {
            type: ResourceType.Product,
            nameParts: ['starter'],
            workspace: undefined,
          },
        ]);
      });

      it('should preserve service scope for absolute subscription targets', () => {
        expect(findSubscriptionTargets({
          properties: {
            scope: '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/apis/shared-api',
          },
        }, 'team-a')).toContainEqual({
          type: ResourceType.Api,
          nameParts: ['shared-api'],
          workspace: undefined,
        });
      });

      it.each([
        ['/apis/orders', ResourceType.Api, 'orders'],
        ['/products/store', ResourceType.Product, 'store'],
      ])(
        'should inherit workspace scope for relative target %s',
        (scope, type, name) => {
          expect(findSubscriptionTargets({
            properties: { scope },
          }, 'team-a')).toContainEqual({
            type,
            nameParts: [name],
            workspace: 'team-a',
          });
        }
      );

      it('should use the workspace encoded in a full ARM target', () => {
        expect(findSubscriptionTargets({
          properties: {
            scope:
              '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/workspaces/Team%20A/apis/Orders%20API',
          },
        }, 'fallback')).toContainEqual({
          type: ResourceType.Api,
          nameParts: ['Orders API'],
          workspace: 'Team A',
        });
      });
    });
  });
});
