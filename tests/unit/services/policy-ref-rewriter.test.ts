// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, it, expect } from 'vitest';
import { rewritePolicyRefs } from '../../../src/services/policy-ref-rewriter.js';
import type { KnownArtifactSets } from '../../../src/services/policy-ref-rewriter.js';
import type { EnvMapping } from '../../../src/services/env-mapper.js';
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

const baseKnown: KnownArtifactSets = {
  namedValues: new Set(['myNv', 'apiUrl']),
  fragments: new Set(['myFrag', 'authFrag']),
  backends: new Set(['myBackend']),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rewritePolicyRefs', () => {
  it('returns xml unchanged when mapping is undefined', () => {
    const xml = '<policies><inbound>{{myNv}}</inbound></policies>';
    expect(rewritePolicyRefs(xml, undefined, baseKnown)).toBe(xml);
  });

  it('returns empty string unchanged', () => {
    expect(rewritePolicyRefs('', devPrefixMapping(ALL_TYPES), baseKnown)).toBe('');
  });

  it('rewrites known {{token}} to deployed name', () => {
    const xml = '<set-url>{{myNv}}</set-url>';
    const result = rewritePolicyRefs(xml, devPrefixMapping([ResourceType.NamedValue]), baseKnown);
    expect(result).toBe('<set-url>{{dev-myNv}}</set-url>');
  });

  it('leaves unknown runtime context token untouched', () => {
    const xml = '<check-header name="X-Token" values="{{context.request.headers.foo}}" />';
    // context.request.headers.foo is not in namedValues — passes through
    expect(rewritePolicyRefs(xml, devPrefixMapping(ALL_TYPES), baseKnown)).toBe(xml);
  });

  it('leaves known named value untouched when NamedValue is not in appliesTo', () => {
    const xml = '<set-url>{{myNv}}</set-url>';
    const mapping = devPrefixMapping([ResourceType.Backend]); // NamedValue excluded
    expect(rewritePolicyRefs(xml, mapping, baseKnown)).toBe(xml);
  });

  it('rewrites fragment-id with double quotes', () => {
    const xml = '<include-fragment fragment-id="myFrag" />';
    const result = rewritePolicyRefs(xml, devPrefixMapping([ResourceType.PolicyFragment]), baseKnown);
    expect(result).toBe('<include-fragment fragment-id="dev-myFrag" />');
  });

  it('rewrites fragment-id with single quotes', () => {
    const xml = "<include-fragment fragment-id='myFrag' />";
    const result = rewritePolicyRefs(xml, devPrefixMapping([ResourceType.PolicyFragment]), baseKnown);
    expect(result).toBe("<include-fragment fragment-id='dev-myFrag' />");
  });

  it('leaves fragment-id unchanged when name is not in known fragments', () => {
    const xml = '<include-fragment fragment-id="unknownFrag" />';
    const result = rewritePolicyRefs(xml, devPrefixMapping([ResourceType.PolicyFragment]), baseKnown);
    expect(result).toBe(xml);
  });

  it('rewrites backend-id with single quotes', () => {
    const xml = "<set-backend-service backend-id='myBackend' />";
    const result = rewritePolicyRefs(xml, devPrefixMapping([ResourceType.Backend]), baseKnown);
    expect(result).toBe("<set-backend-service backend-id='dev-myBackend' />");
  });

  it('rewrites multiple ref types independently in a single pass', () => {
    const xml =
      '<policies><inbound>' +
      '{{myNv}}' +
      '<include-fragment fragment-id="myFrag" />' +
      '<set-backend-service backend-id="myBackend" />' +
      '</inbound></policies>';
    const result = rewritePolicyRefs(xml, devPrefixMapping(ALL_TYPES), baseKnown);
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
    const result = rewritePolicyRefs(xml, suffixMapping, baseKnown);
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

    const result = rewritePolicyRefs(xml, devPrefixMapping(ALL_TYPES), baseKnown);

    expect(result).toContain('backend-id="dev-myBackend"');
    expect(result).toContain('{{dev-apiUrl}}');
    expect(result).toContain('fragment-id="dev-authFrag"');
    // Unrelated content is preserved
    expect(result).toContain('<base />');
    expect(result).toContain('<send-request>');
  });

  it('handles whitespace inside {{  token  }} braces', () => {
    const xml = '<set-url>{{  myNv  }}</set-url>';
    const result = rewritePolicyRefs(xml, devPrefixMapping([ResourceType.NamedValue]), baseKnown);
    expect(result).toBe('<set-url>{{dev-myNv}}</set-url>');
  });

  it('matches fragment-id regardless of preceding attribute ordering', () => {
    const xml = '<include-fragment scope="all" fragment-id="myFrag" />';
    const result = rewritePolicyRefs(xml, devPrefixMapping([ResourceType.PolicyFragment]), baseKnown);
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
    const first = rewritePolicyRefs(xml, mapping, baseKnown);
    const second = rewritePolicyRefs(first, mapping, baseKnown);
    expect(second).toBe(first);
  });
});
