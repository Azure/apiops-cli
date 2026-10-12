// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Transitive dependency resolver
 */

import { describe, it, expect, vi } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { FilterConfig } from '../../../src/models/config.js';
import {
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

    it('ignores Liquid output expressions while retaining real policy dependencies', () => {
      const policy = `
        <policies>
          <inbound>
            <set-header name="Auth"><value>{{my-secret}}</value></set-header>
            <set-body template="liquid">
              <request>{{context.Request.MatchedParameters["id"]}}</request>
            </set-body>
            <set-backend-service backend-id="soap-backend" />
          </inbound>
          <outbound>
            <set-body template="liquid">
              {"result": "{{body.envelope.body.Test_Result.test}}"}
            </set-body>
          </outbound>
          <on-error>
            <set-body template="liquid">
              {"code": "{{body.envelope.body.fault.faultcode}}",
               "message": "{{body.envelope.body.fault.faultstring}}"}
            </set-body>
            <include-fragment fragment-id="error-handler" />
          </on-error>
        </policies>
      `;

      expect(scanPolicyReferences(policy)).toEqual([
        { type: ResourceType.NamedValue, name: 'my-secret' },
        { type: ResourceType.Backend, name: 'soap-backend' },
        { type: ResourceType.PolicyFragment, name: 'error-handler' },
      ]);
    });

    it.each([
      'template="liquid"',
      "template='liquid'",
      'parse-date="false"\n template = "liquid" xsi-nil="blank"',
    ])('ignores Liquid variables and filters with attributes %s', (attributes) => {
      const policy = `<set-body ${attributes}><![CDATA[
        {% assign result = body.value %}{{result}} {{ body.value | Escape }}
      ]]></set-body><value>{{real-value}}</value>`;

      expect(scanPolicyReferences(policy)).toEqual([
        { type: ResourceType.NamedValue, name: 'real-value' },
      ]);
    });

    it('retains named values in non-Liquid bodies and Liquid opening attributes', () => {
      const policy = `<set-body>{{plain-value}}</set-body>
        <set-body template="liquid" parse-date="{{parse-date}}">{{body.value}}</set-body>
        <set-body>@{ return "{{expression-value}}"; }</set-body>`;

      expect(scanPolicyReferences(policy)).toEqual([
        { type: ResourceType.NamedValue, name: 'plain-value' },
        { type: ResourceType.NamedValue, name: 'parse-date' },
        { type: ResourceType.NamedValue, name: 'expression-value' },
      ]);
    });

    it.each([
      '<![CDATA[</set-body>{{body.value}}]]>',
      '<!-- </set-body> -->{{body.value}}',
      '<root><set-body>{{body.first}}</set-body><value>{{body.second}}</value></root>',
      '<set-body /><set-body template="liquid">{{body.first}}</set-body>{{body.second}}',
    ])('ignores the entire Liquid body despite embedded boundaries: %s', (body) => {
      const policy = `<value>{{before}}</value>
        <set-body template="liquid" parse-date="{{parse-date}}">${body}</set-body>
        <set-body>{{after}}</set-body>`;

      expect(scanPolicyReferences(policy)).toEqual([
        { type: ResourceType.NamedValue, name: 'before' },
        { type: ResourceType.NamedValue, name: 'parse-date' },
        { type: ResourceType.NamedValue, name: 'after' },
      ]);
    });

    it.each([
      '<!-- <set-body template="liquid">{{comment-value}}</set-body> -->',
      '<![CDATA[<set-body template="liquid">{{comment-value}}</set-body>]]>',
    ])('does not treat tag-like text as a Liquid element: %s', (body) => {
      const policy = `${body}<set-body>{{plain-value}}</set-body>
        <set-body template="liquid">{{body.value}}</set-body>`;

      expect(scanPolicyReferences(policy)).toEqual([
        { type: ResourceType.NamedValue, name: 'comment-value' },
        { type: ResourceType.NamedValue, name: 'plain-value' },
      ]);
    });

    it('tolerates raw C# expressions and empty Liquid elements without changing backend or fragment scanning', () => {
      const policy = `<set-body>@{ return 1 < 2 && true ? "{{expression-value}}" : ""; }</set-body>
        <set-body template="liquid" parse-date="{{parse-date}}" />
        <value>{{after-empty}}</value>
        <set-body template="liquid">
          <set-backend-service backend-id="body-backend" />
          <include-fragment fragment-id="body-fragment" />
          {{body.value}}
        </set-body>`;

      expect(scanPolicyReferences(policy)).toEqual([
        { type: ResourceType.NamedValue, name: 'expression-value' },
        { type: ResourceType.NamedValue, name: 'parse-date' },
        { type: ResourceType.NamedValue, name: 'after-empty' },
        { type: ResourceType.Backend, name: 'body-backend' },
        { type: ResourceType.PolicyFragment, name: 'body-fragment' },
      ]);
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
