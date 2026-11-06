// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, it, expect } from 'vitest';
import { rewritePolicyRefs } from '../../../src/services/policy-ref-rewriter.js';
import type { KnownArtifactSets } from '../../../src/services/policy-ref-rewriter.js';
import type { EnvMapping } from '../../../src/services/env-mapper.js';
import { toDeployedName } from '../../../src/services/env-mapper.js';
import { ResourceType } from '../../../src/models/resource-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function devPrefixMapping(types: ResourceType[]): EnvMapping {
  return {
    prefix: 'dev-',
    suffix: '',
    appliesTo: new Set(types),
  };
}

const ALL_TYPES = [ResourceType.NamedValue, ResourceType.PolicyFragment, ResourceType.Backend];

// Each named value's display name is its name here.
const BASE: Names = {
  namedValues: ['myNv', 'apiUrl'],
  fragments: ['myFrag', 'authFrag'],
  backends: ['myBackend'],
  loggers: ['myLogger'],
  schemas: ['mySchema'],
};

interface Names {
  namedValues: string[];
  fragments: string[];
  backends: string[];
  loggers?: string[];
  schemas?: string[];
}

/** KnownArtifactSets for `names`, with named values deployed as `mapping` affixes them. */
function knownSets(mapping: EnvMapping | undefined, names = BASE): KnownArtifactSets {
  const find = (candidates: string[], name: string) =>
    candidates.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const byType: Partial<Record<ResourceType, string[] | undefined>> = {
    [ResourceType.NamedValue]: names.namedValues,
    [ResourceType.PolicyFragment]: names.fragments,
    [ResourceType.Backend]: names.backends,
    [ResourceType.Logger]: names.loggers,
    [ResourceType.GlobalSchema]: names.schemas,
  };
  return {
    has: (type, name, workspace) => !workspace && find(byType[type] ?? [], name) !== undefined,
    namedValueTargetTypes: () => new Set(),
    deployedNamedValueReference: (reference) => {
      const name = find(names.namedValues, reference);
      return name === undefined || !mapping ? name : toDeployedName(name, ResourceType.NamedValue, mapping);
    },
  };
}

const rewrite = (xml: string, mapping: EnvMapping | undefined) => rewritePolicyRefs(xml, mapping, knownSets(mapping));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rewritePolicyRefs', () => {
  it('returns xml unchanged when mapping is undefined', () => {
    const xml = '<policies><inbound>{{myNv}}</inbound></policies>';
    expect(rewrite(xml, undefined)).toBe(xml);
  });

  it('returns empty string unchanged', () => {
    expect(rewrite('', devPrefixMapping(ALL_TYPES))).toBe('');
  });

  it('rewrites known {{token}} to deployed name', () => {
    const xml = '<set-url>{{myNv}}</set-url>';
    const result = rewrite(xml, devPrefixMapping([ResourceType.NamedValue]));
    expect(result).toBe('<set-url>{{dev-myNv}}</set-url>');
  });

  it('leaves unknown runtime context token untouched', () => {
    const xml = '<check-header name="X-Token" values="{{context.request.headers.foo}}" />';
    // context.request.headers.foo is not in namedValues — passes through
    expect(rewrite(xml, devPrefixMapping(ALL_TYPES))).toBe(xml);
  });

  it('leaves known named value untouched when NamedValue is not in appliesTo', () => {
    const xml = '<set-url>{{myNv}}</set-url>';
    const mapping = devPrefixMapping([ResourceType.Backend]); // NamedValue excluded
    expect(rewrite(xml, mapping)).toBe(xml);
  });

  it('rewrites fragment-id with double quotes', () => {
    const xml = '<include-fragment fragment-id="myFrag" />';
    const result = rewrite(xml, devPrefixMapping([ResourceType.PolicyFragment]));
    expect(result).toBe('<include-fragment fragment-id="dev-myFrag" />');
  });

  it('rewrites fragment-id with single quotes', () => {
    const xml = "<include-fragment fragment-id='myFrag' />";
    const result = rewrite(xml, devPrefixMapping([ResourceType.PolicyFragment]));
    expect(result).toBe("<include-fragment fragment-id='dev-myFrag' />");
  });

  it('leaves fragment-id unchanged when name is not in known fragments', () => {
    const xml = '<include-fragment fragment-id="unknownFrag" />';
    const result = rewrite(xml, devPrefixMapping([ResourceType.PolicyFragment]));
    expect(result).toBe(xml);
  });

  it('rewrites backend-id with single quotes', () => {
    const xml = "<set-backend-service backend-id='myBackend' />";
    const result = rewrite(xml, devPrefixMapping([ResourceType.Backend]));
    expect(result).toBe("<set-backend-service backend-id='dev-myBackend' />");
  });

  it('rewrites multiple ref types independently in a single pass', () => {
    const xml =
      '<policies><inbound>' +
      '{{myNv}}' +
      '<include-fragment fragment-id="myFrag" />' +
      '<set-backend-service backend-id="myBackend" />' +
      '</inbound></policies>';
    const result = rewrite(xml, devPrefixMapping(ALL_TYPES));
    expect(result).toBe(
      '<policies><inbound>' +
      '{{dev-myNv}}' +
      '<include-fragment fragment-id="dev-myFrag" />' +
      '<set-backend-service backend-id="dev-myBackend" />' +
      '</inbound></policies>',
    );
  });

  it('applies a suffix-only mapping', () => {
    const suffixMapping: EnvMapping = {
      prefix: '',
      suffix: '-dev',
      appliesTo: new Set(ALL_TYPES),
    };
    const xml = '{{myNv}}<include-fragment fragment-id="myFrag" />';
    const result = rewrite(xml, suffixMapping);
    expect(result).toBe('{{myNv-dev}}<include-fragment fragment-id="myFrag-dev" />');
  });

  it('rewrites all three ref types in a realistic APIM policy fixture', () => {
    const xml = [
      '<policies>',
      '  <inbound>',
      '    <base />',
      '    <set-backend-service backend-id="myBackend" />',
      '    <send-request>',
      '      <set-url>{{apiUrl}}</set-url>',
      '    </send-request>',
      '    <include-fragment fragment-id="authFrag" />',
      '  </inbound>',
      '  <backend><base /></backend>',
      '  <outbound><base /></outbound>',
      '</policies>',
    ].join('\n');

    const result = rewrite(xml, devPrefixMapping(ALL_TYPES));

    expect(result).toContain('backend-id="dev-myBackend"');
    expect(result).toContain('{{dev-apiUrl}}');
    expect(result).toContain('fragment-id="dev-authFrag"');
    // Unrelated content is preserved
    expect(result).toContain('<base />');
    expect(result).toContain('<send-request>');
  });

  it('handles whitespace inside {{  token  }} braces', () => {
    const xml = '<set-url>{{  myNv  }}</set-url>';
    const result = rewrite(xml, devPrefixMapping([ResourceType.NamedValue]));
    expect(result).toBe('<set-url>{{dev-myNv}}</set-url>');
  });

  it('matches fragment-id regardless of preceding attribute ordering', () => {
    const xml = '<include-fragment scope="all" fragment-id="myFrag" />';
    const result = rewrite(xml, devPrefixMapping([ResourceType.PolicyFragment]));
    expect(result).toBe('<include-fragment scope="all" fragment-id="dev-myFrag" />');
  });

  it('is idempotent — rewriting twice equals rewriting once', () => {
    const xml =
      '<set-url>{{myNv}}</set-url>' +
      '<include-fragment fragment-id="myFrag" />' +
      "<set-backend-service backend-id='myBackend' />";
    const mapping = devPrefixMapping(ALL_TYPES);
    // After first pass: deployed names like dev-myNv are not in known sets,
    // so the second pass finds nothing to rewrite.
    const first = rewrite(xml, mapping);
    const second = rewrite(first, mapping);
    expect(second).toBe(first);
  });

  it("only rewrites names of resources in the policy's own scope", () => {
    const xml = '<set-backend-service backend-id="myBackend" />';
    const mapping = devPrefixMapping([ResourceType.Backend]);
    expect(rewritePolicyRefs(xml, mapping, knownSets(mapping), 'team-a')).toBe(xml);
  });

  it.each([
    ['llm-content-safety backend-id', '<llm-content-safety backend-id="myBackend" />', '<llm-content-safety backend-id="dev-myBackend" />'],
    [
      'semantic cache embeddings-backend-id',
      '<llm-semantic-cache-lookup score-threshold="0.8" embeddings-backend-id=\'myBackend\' />',
      '<llm-semantic-cache-lookup score-threshold="0.8" embeddings-backend-id=\'dev-myBackend\' />',
    ],
    ['an attribute before backend-id', '<set-backend-service id="apim-generated-policy" backend-id="myBackend" />', '<set-backend-service id="apim-generated-policy" backend-id="dev-myBackend" />'],
    ['log-to-eventhub logger-id', '<log-to-eventhub logger-id="myLogger">x</log-to-eventhub>', '<log-to-eventhub logger-id="dev-myLogger">x</log-to-eventhub>'],
    ['content schema-id', '<content type="application/json" schema-id="mySchema" />', '<content type="application/json" schema-id="dev-mySchema" />'],
  ])('rewrites %s', (_kind, xml, expected) => {
    const mapping = devPrefixMapping([ResourceType.Backend, ResourceType.Logger, ResourceType.GlobalSchema]);
    expect(rewrite(xml, mapping)).toBe(expected);
  });

  it('leaves a logger-id unchanged when Logger is not in appliesTo', () => {
    const xml = '<log-to-eventhub logger-id="myLogger">x</log-to-eventhub>';
    expect(rewrite(xml, devPrefixMapping([ResourceType.Backend]))).toBe(xml);
  });

  it('leaves an attribute set to a policy expression or a named value', () => {
    const xml = '<set-backend-service backend-id="@(context.Variables[&quot;b&quot;])" /><set-backend-service backend-id="{{unknown}}" />';
    expect(rewrite(xml, devPrefixMapping(ALL_TYPES))).toBe(xml);
  });

  it.each([
    [
      'a commented-out Liquid open tag',
      '<!-- <set-body template="liquid"> old --><value>{{ myNv }}</value><set-body template="liquid">{{ myNv }}</set-body>',
      '<!-- <set-body template="liquid"> old --><value>{{dev-myNv}}</value><set-body template="liquid">{{ myNv }}</set-body>',
    ],
    [
      'a commented-out close tag inside a Liquid body',
      '<set-body template="liquid"><!-- </set-body> -->{{ myNv }}</set-body><value>{{ myNv }}</value>',
      '<set-body template="liquid"><!-- </set-body> -->{{ myNv }}</set-body><value>{{dev-myNv}}</value>',
    ],
  ])('finds Liquid bodies as the scanner does, ignoring %s', (_kind, xml, expected) => {
    expect(rewrite(xml, devPrefixMapping([ResourceType.NamedValue]))).toBe(expected);
  });

  it('rewrites only a bare {{name}} inside a Liquid body, leaving Liquid output', () => {
    const xml = '<set-body template="liquid">{{myNv}} {{ myNv }} {{myNv | upcase}} {{body.id}}</set-body><value>{{ myNv }}</value>';
    expect(rewrite(xml, devPrefixMapping([ResourceType.NamedValue]))).toBe(
      '<set-body template="liquid">{{dev-myNv}} {{ myNv }} {{myNv | upcase}} {{body.id}}</set-body><value>{{dev-myNv}}</value>'
    );
  });
});
