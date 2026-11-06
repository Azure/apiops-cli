// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Transitive dependency resolver
 * Scan policies for named value refs, backend refs, policy fragment refs.
 * Scan apiInformation.json for apiVersionSetId.
 * Fixed-point expansion; --no-transitive bypass.
 */

import { FilterConfig } from '../models/config.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { ResourceDescriptor } from '../models/types.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import { logger } from '../lib/logger.js';
import { getResourceDescriptorKey } from '../lib/resource-path.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import {
  type NamedValueEntry,
  NamedValueNames,
  namedValueNamesByScope,
  namedValueTargetName,
} from './named-value-names.js';
import { runParallel } from '../lib/parallel-runner.js';

/**
 * Reference detection patterns for policy XML content.
 */
const NAMED_VALUE_PATTERN = /\{\{([^}]+)\}\}/g;
/** The resource types followed when a policy attribute names one by its name. */
const FOLLOWED_ATTRIBUTE_TYPES: ReadonlySet<ResourceType> = new Set([ResourceType.Backend, ResourceType.PolicyFragment]);

/**
 * One XML attribute (`name="value"` or `name='value'`) with its leading
 * whitespace. Matching whole attributes, rather than any character up to `>`,
 * lets a value contain `>` (as policy expressions can).
 */
const XML_ATTRIBUTE = String.raw`\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*')`;

/**
 * Build a pattern matching `attribute="value"` (either quote) anywhere on an
 * `element` start tag; the value is capture group 2.
 */
function attributePattern(element: string, attribute: string): RegExp {
  return new RegExp(`<${element}(?:${XML_ATTRIBUTE})*?\\s+${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'g');
}

/**
 * Policy attributes that name another resource, by the type they name: what
 * publish rewrites to deployed names. Each pattern's capture group 2 is the
 * attribute's value.
 */
export const POLICY_REFERENCE_PATTERNS: ReadonlyArray<{ type: ResourceType; pattern: RegExp }> = [
  { type: ResourceType.Backend, pattern: attributePattern('set-backend-service', 'backend-id') },
  { type: ResourceType.Backend, pattern: attributePattern('llm-content-safety', 'backend-id') },
  {
    type: ResourceType.Backend,
    pattern: attributePattern('(?:azure-openai|llm)-semantic-cache-lookup', 'embeddings-backend-id'),
  },
  { type: ResourceType.PolicyFragment, pattern: attributePattern('include-fragment', 'fragment-id') },
  { type: ResourceType.Logger, pattern: attributePattern('log-to-eventhub', 'logger-id') },
  // validate-content's <content schema-id="..."> names a schema added to the service.
  { type: ResourceType.GlobalSchema, pattern: attributePattern('content', 'schema-id') },
];

/**
 * The body of a `<set-body template="liquid">` element (capture group 3): its
 * `{{ ... }}` are mostly Liquid output expressions, not named value
 * references; see scanLiquidNamedValueCandidates. A self-closing set-body has
 * no body and is not matched.
 */
const LIQUID_BODY_PATTERN = new RegExp(
  `(<set-body(?:${XML_ATTRIBUTE})*?\\s+template\\s*=\\s*(["'])liquid\\2(?:${XML_ATTRIBUTE})*\\s*>)` +
    `([\\s\\S]*?)(<\\/set-body\\s*>)`,
  'gi'
);

/**
 * A `{{name}}` whose name has only the characters a named value's name can:
 * letters, digits, '.', '-' and '_'. Spaces or a filter (`|`) make it Liquid.
 */
const LIQUID_NAMED_VALUE_PATTERN = /\{\{([A-Za-z0-9._-]+)\}\}/g;

/**
 * The XML comments and policy expressions (`@(...)`, `@{...}`) in policy XML,
 * in order, found in one pass: a `<!--` inside an expression (in a string,
 * say) starts no comment, and an `@(` inside a comment starts no expression.
 * `end` is the index after the span. A comment or expression that doesn't
 * close is no span, so it can't hide the rest of the policy.
 */
function policySpans(xml: string): Array<{ kind: 'comment' | 'expression'; start: number; end: number }> {
  const spans: Array<{ kind: 'comment' | 'expression'; start: number; end: number }> = [];
  for (let i = 0; i < xml.length; i++) {
    const close = xml.startsWith('<!--', i)
      ? xml.indexOf('-->', i + 4)
      : xml[i] === '@' && (xml[i + 1] === '(' || xml[i + 1] === '{')
        ? policyExpressionEnd(xml, i + 1)
        : -1;
    if (close !== -1) {
      const comment = xml[i] === '<';
      const end = comment ? close + 3 : close + 1;
      spans.push({ kind: comment ? 'comment' : 'expression', start: i, end });
      i = end - 1;
    }
  }
  return spans;
}

/**
 * `xml` with each span of `kind` replaced by spaces, the same length, except
 * `keep` characters at its start and end.
 */
function blankSpans(xml: string, kind: 'comment' | 'expression', keep: { start: number; end: number }): string {
  let result = '';
  let last = 0;
  for (const span of policySpans(xml)) {
    if (span.kind === kind) {
      const from = span.start + keep.start;
      const to = span.end - keep.end;
      result += xml.slice(last, from) + ' '.repeat(to - from);
      last = to;
    }
  }
  return result + xml.slice(last);
}

/**
 * Policy XML with the inside of each policy expression (`@(...)`, `@{...}`)
 * replaced by spaces, the same length. APIM's raw XML keeps an expression's
 * string literals as written, so an attribute value can hold double quotes
 * (`sf-service-instance-name="@("fabric:/app")"`), which would end an
 * attribute pattern's value early and hide the attributes after it. The `@`
 * and the outer brackets are kept, so a value that is an expression still
 * starts with `@`; offsets are unchanged, so matches found in the result
 * apply to the original. An expression whose end can't be found, or that is
 * inside an XML comment, is left as it is.
 */
export function blankPolicyExpressions(xml: string): string {
  return blankSpans(xml, 'expression', { start: 2, end: 1 });
}

/**
 * Policy XML with each XML comment replaced by spaces, the same length:
 * references inside comments are not in effect. Comments are found the way
 * policySpans finds them, so a `<!--` in a policy expression string hides
 * nothing.
 */
function blankXmlComments(xml: string): string {
  return blankSpans(xml, 'comment', { start: 0, end: 0 });
}

/**
 * The index of the bracket closing the one at `start` (`(` or `{`), skipping
 * C# comments and string and character literals, or -1 when the expression
 * doesn't close.
 */
function policyExpressionEnd(xml: string, start: number): number {
  const opening = xml[start];
  const closing = opening === '(' ? ')' : '}';
  let depth = 0;
  for (let i = start; i < xml.length; i++) {
    const char = xml[i];
    if (char === '/' && (xml[i + 1] === '/' || xml[i + 1] === '*')) {
      // A comment can hold quotes and brackets (`/* don't */`).
      const commentEnd = xml[i + 1] === '/' ? xml.indexOf('\n', i) : xml.indexOf('*/', i + 2) + 1;
      if (commentEnd <= 0) {
        return -1;
      }
      i = commentEnd;
    } else if (char === '"' || char === "'") {
      // A verbatim string (@"...") doubles its quotes; others escape with '\'.
      const verbatim = char === '"' && xml[i - 1] === '@';
      for (i++; i < xml.length; i++) {
        if (verbatim ? xml[i] === '"' && xml[i + 1] === '"' : xml[i] === '\\') {
          i++;
        } else if (xml[i] === char) {
          break;
        }
      }
    } else if (char === opening) {
      depth++;
    } else if (char === closing && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Policy XML with the parts that cannot reference other resources removed:
 * XML comments (blanked), and the bodies of Liquid templates.
 */
function stripNonReferenceContent(policyXml: string): string {
  return blankXmlComments(policyXml)
    .replace(LIQUID_BODY_PATTERN, (_match, open: string, _quote: string, _body: string, close: string) => `${open}${close}`);
}

/**
 * Replace each `{{reference}}` in policy XML the way APIM substitutes named
 * values: any `{{ name }}` outside Liquid bodies, and inside a
 * `<set-body template="liquid">` body only a bare `{{name}}`
 * (scanLiquidNamedValueCandidates); the rest there is Liquid output. `replace`
 * gets the trimmed name and the whole match, and returns the text to put in
 * its place.
 */
export function replaceNamedValueReferences(policyXml: string, replace: (name: string, match: string) => string): string {
  const replaceIn = (text: string, pattern: RegExp) =>
    text.replace(pattern, (match: string, name: string) => replace(name.trim(), match));
  // Liquid bodies are found as the scanner finds them, ignoring XML comments:
  // on a copy with each comment blanked out, so offsets still match.
  const uncommented = blankXmlComments(policyXml);
  let result = '';
  let last = 0;
  for (const body of uncommented.matchAll(LIQUID_BODY_PATTERN)) {
    const start = body.index ?? 0;
    const [, open = '', , content = ''] = body;
    const contentStart = start + open.length;
    const end = start + body[0].length;
    result += replaceIn(policyXml.slice(last, contentStart), NAMED_VALUE_PATTERN);
    result += replaceIn(policyXml.slice(contentStart, contentStart + content.length), LIQUID_NAMED_VALUE_PATTERN);
    result += policyXml.slice(contentStart + content.length, end);
    last = end;
  }
  return result + replaceIn(policyXml.slice(last), NAMED_VALUE_PATTERN);
}

/**
 * The names a `<set-body template="liquid">` body may reference named values
 * by: each `{{name}}` there whose name a named value could have. APIM
 * substitutes a named value inside a Liquid body when one has that display
 * name, and leaves every other `{{ ... }}` (with spaces, a filter, or no such
 * named value, like `{{body.id}}`) to Liquid. So each is a reference only when
 * a named value with that display name exists; callers check before following
 * one, and skip the rest without an error. XML comments are ignored.
 */
export function scanLiquidNamedValueCandidates(policyXml: string): string[] {
  const names = new Set<string>();
  for (const body of blankXmlComments(policyXml).matchAll(LIQUID_BODY_PATTERN)) {
    for (const match of (body[3] ?? '').matchAll(LIQUID_NAMED_VALUE_PATTERN)) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  }
  return [...names];
}

/**
 * Represents a discovered transitive dependency.
 */
export interface TransitiveDependency {
  type: ResourceType;
  name: string;
}

/**
 * A whole named value reference as the value of a policy attribute that names
 * a resource, such as backend-id="{{backend-name}}": the attribute names the
 * resource of `type` the named value's value names.
 */
export interface NamedValueTarget {
  type: ResourceType;
  /** The named value as the policy references it (normally its display name). */
  namedValue: string;
}

/** An attribute value that is one named value reference and nothing else. */
const WHOLE_NAMED_VALUE_PATTERN = /^\{\{([^{}]+)\}\}$/;

const POLICY_RESOURCE_TYPES = new Set<ResourceType>([
  ResourceType.ServicePolicy,
  ResourceType.ApiPolicy,
  ResourceType.ApiOperationPolicy,
  ResourceType.ProductPolicy,
  ResourceType.GraphQLResolverPolicy,
]);

/** The artifact types scanArtifactReferences finds references in; the rest hold none. */
const REFERENCING_TYPES = new Set<ResourceType>([
  ...POLICY_RESOURCE_TYPES,
  ResourceType.Api,
  ResourceType.Logger,
  ResourceType.Backend,
  ResourceType.PolicyFragment,
]);

/**
 * Scan policy XML content for references to other resources.
 *
 * Detects, with the attribute anywhere on the element and in either quote:
 * - Named values: {{namedValueName}} syntax
 * - Backends: <set-backend-service backend-id>, <llm-content-safety backend-id>,
 *   and embeddings-backend-id on the semantic cache lookup policies
 * - Policy fragments: <include-fragment fragment-id>
 *
 * References inside XML comments, and `{{ ... }}` inside a
 * `<set-body template="liquid">` body, are ignored: most of those are Liquid
 * output. The bare `{{name}}`s there that APIM substitutes when a named value
 * has that display name are found by scanLiquidNamedValueCandidates, for
 * callers to check.
 */
export function scanPolicyReferences(policyXml: string): TransitiveDependency[] {
  const dependencies: TransitiveDependency[] = [];
  const scannable = stripNonReferenceContent(policyXml);

  // Named value references
  for (const match of scannable.matchAll(NAMED_VALUE_PATTERN)) {
    if (match[1]) {
      dependencies.push({
        type: ResourceType.NamedValue,
        name: match[1].trim(),
      });
    }
  }

  // Backends and fragments named by an attribute (POLICY_REFERENCE_PATTERNS).
  // A value that is a policy expression or a named value reference names no
  // resource here (see scanNamedValueTargets).
  for (const { type, value } of scanReferenceAttributes(scannable)) {
    if (FOLLOWED_ATTRIBUTE_TYPES.has(type) && !value.startsWith('@') && !value.includes('{{')) {
      dependencies.push({ type, name: value });
    }
  }

  return dependencies;
}

/**
 * Scan policy XML for attributes that name a resource through a named value,
 * such as backend-id="{{backend-name}}". The named value itself is found by
 * scanPolicyReferences; the resource its value names is found once the named
 * value's value is known.
 */
export function scanNamedValueTargets(policyXml: string): NamedValueTarget[] {
  const targets: NamedValueTarget[] = [];
  for (const { type, value } of scanReferenceAttributes(stripNonReferenceContent(policyXml))) {
    // APIM doesn't substitute a named value in include-fragment's fragment-id:
    // it looks for a fragment with that literal ID and rejects the policy.
    if (type === ResourceType.PolicyFragment) {
      continue;
    }
    const namedValue = WHOLE_NAMED_VALUE_PATTERN.exec(value)?.[1]?.trim();
    if (namedValue) {
      targets.push({ type, namedValue });
    }
  }
  return targets;
}

/**
 * The non-empty values of the policy attributes that name a resource, trimmed.
 * Policy expressions are blanked first (blankPolicyExpressions), so a quote
 * inside one doesn't end the attribute early; a value that is an expression
 * keeps its leading `@`.
 */
function scanReferenceAttributes(scannable: string): Array<{ type: ResourceType; value: string }> {
  const attributes: Array<{ type: ResourceType; value: string }> = [];
  const blanked = blankPolicyExpressions(scannable);
  for (const { type, pattern } of POLICY_REFERENCE_PATTERNS) {
    for (const match of blanked.matchAll(pattern)) {
      const value = match[2]?.trim();
      if (value) {
        attributes.push({ type, value });
      }
    }
  }
  return attributes;
}

/**
 * Scan API information JSON for version set reference.
 */
export function scanApiVersionSetReference(
  apiJson: Record<string, unknown>
): TransitiveDependency | undefined {
  const properties = apiJson.properties as Record<string, unknown> | undefined;
  if (!properties) {
    return undefined;
  }

  const versionSetId = properties.apiVersionSetId as string | undefined;
  if (!versionSetId) {
    return undefined;
  }

  const name = extractResourceNameFromId(versionSetId, 'apiVersionSets');
  if (!name) {
    return undefined;
  }

  return {
    type: ResourceType.VersionSet,
    name,
  };
}

/**
 * Resolve transitive dependencies by expanding the extraction set
 * until no new dependencies are found (fixed-point).
 *
 * @param extractedPolicies - Map of descriptor key to policy XML content
 * @param extractedApis - Map of API name to API JSON (for version set refs)
 * @param currentFilter - Current filter config to expand
 * @returns Updated filter config with transitive dependencies included
 */
export function resolveTransitiveDependencies(
  extractedPolicies: Map<string, string>,
  extractedApis: Map<string, Record<string, unknown>>,
  currentFilter: FilterConfig
): FilterConfig {
  const expanded = { ...currentFilter };
  let changed = true;
  let iterations = 0;
  const maxIterations = 10; // Safety limit

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Scan all extracted policies for references
    for (const [, policyXml] of extractedPolicies) {
      const refs = scanPolicyReferences(policyXml);

      for (const ref of refs) {
        if (addToFilter(expanded, ref)) {
          changed = true;
        }
      }
    }

    // Scan API information for version set references
    for (const [, apiJson] of extractedApis) {
      const versionSetRef = scanApiVersionSetReference(apiJson);
      if (versionSetRef && addToFilter(expanded, versionSetRef)) {
        changed = true;
      }
    }
  }

  if (iterations > 1) {
    logger.debug(`Transitive resolution completed in ${iterations} iterations`);
  }

  return expanded;
}

/**
 * Add a transitive dependency to the filter config.
 * Returns true if the filter was actually modified (new entry added).
 */
function addToFilter(
  filter: FilterConfig,
  dep: TransitiveDependency
): boolean {
  type StringArrayField = 'namedValues' | 'backends' | 'policyFragments' | 'versionSets';
  const fieldMap: Partial<Record<ResourceType, StringArrayField>> = {
    [ResourceType.NamedValue]: 'namedValues',
    [ResourceType.Backend]: 'backends',
    [ResourceType.PolicyFragment]: 'policyFragments',
    [ResourceType.VersionSet]: 'versionSets',
  };

  const field = fieldMap[dep.type];
  if (!field) {
    return false;
  }

  // Get current array; if undefined, the type is not filtered so no need to add
  const current = filter[field];
  if (current === undefined) {
    return false;
  }

  // Check if already included (case-insensitive)
  const lowerName = dep.name.toLowerCase();
  if (current.some((n: string) => n.toLowerCase() === lowerName)) {
    return false;
  }

  // Add to filter
  (filter[field] as string[]) = [...current, dep.name];
  logger.debug(`Transitive: added ${dep.type} "${dep.name}" to filter`);
  return true;
}

/**
 * The resource name of the named value a `{{reference}}` in `workspace`
 * resolves to, from a complete list of the named values there, or undefined
 * when that isn't known.
 */
export type NamedValueNameResolver = (reference: string, workspace: string | undefined) => string | undefined;

/**
 * Build a set of descriptors from transitive dependency scanning.
 * Returns additional descriptors that should be extracted.
 *
 * @param resolveNamedValueName - Where given, a policy attribute set to a
 *   named value is followed only through the named value the reference
 *   resolves to, once it is among `resources`, rather than through another
 *   one there that happens to have the reference as its name
 */
export function findTransitiveDependencies(
  policies: Map<string, string>,
  apis: Map<string, Record<string, unknown>>,
  workspace?: string,
  resources: ReadonlyArray<{
    descriptor: ResourceDescriptor;
    json: Record<string, unknown>;
  }> = [],
  resolveNamedValueName?: NamedValueNameResolver
): ResourceDescriptor[] {
  const dependencies: ResourceDescriptor[] = [];
  const namedValueTargets: Array<NamedValueTarget & { workspace?: string }> = [];

  for (const [, policyXml] of policies) {
    for (const dep of scanPolicyReferences(policyXml)) {
      dependencies.push({ type: dep.type, nameParts: [dep.name], workspace });
    }
    namedValueTargets.push(...scanNamedValueTargets(policyXml).map((target) => ({ ...target, workspace })));
  }

  for (const [, apiJson] of apis) {
    const dep = scanApiVersionSetReference(apiJson);
    if (dep) {
      dependencies.push({ type: dep.type, nameParts: [dep.name], workspace });
    }
  }

  for (const { descriptor, json } of resources) {
    const properties = json.properties as Record<string, unknown> | undefined;

    // Logger and backend credentials can hold named value references (for
    // example the Application Insights key APIM stores as a named value).
    if (
      (descriptor.type === ResourceType.Logger || descriptor.type === ResourceType.Backend) &&
      properties?.credentials !== undefined
    ) {
      for (const match of JSON.stringify(properties.credentials).matchAll(NAMED_VALUE_PATTERN)) {
        if (match[1]) {
          dependencies.push({ type: ResourceType.NamedValue, nameParts: [match[1].trim()], workspace: descriptor.workspace });
        }
      }
    }

    if (descriptor.type === ResourceType.Backend) {
      const pool = isRecord(properties?.pool) ? properties.pool : undefined;
      const services = pool?.services;
      if (Array.isArray(services)) {
        for (const service of services) {
          if (isRecord(service) && typeof service.id === 'string') {
            const name = extractResourceNameFromId(service.id, 'backends');
            if (name) {
              dependencies.push({
                type: ResourceType.Backend,
                nameParts: [name],
                workspace: workspaceFromReference(service.id, descriptor.workspace),
              });
            }
          }
        }
      }
    }

    if (descriptor.type === ResourceType.PolicyFragment) {
      for (const value of [properties?.value, properties?.policyContent]) {
        if (typeof value !== 'string') {
          continue;
        }
        for (const dep of scanPolicyReferences(value)) {
          dependencies.push({
            type: dep.type,
            nameParts: [dep.name],
            workspace: descriptor.workspace,
          });
        }
        namedValueTargets.push(
          ...scanNamedValueTargets(value).map((target) => ({ ...target, workspace: descriptor.workspace }))
        );
      }
    }
  }

  dependencies.push(...findNamedValueTargetDependencies(namedValueTargets, resources, resolveNamedValueName));

  return deduplicateDescriptors(dependencies);
}

/**
 * The resources that policy attributes name through a named value
 * (backend-id="{{backend-name}}"), for the named values among `resources`
 * (NamedValueNames, namedValueTargetName).
 */
function findNamedValueTargetDependencies(
  targets: ReadonlyArray<NamedValueTarget & { workspace?: string }>,
  resources: ReadonlyArray<{ descriptor: ResourceDescriptor; json: Record<string, unknown> }>,
  resolveNamedValueName?: NamedValueNameResolver
): ResourceDescriptor[] {
  if (targets.length === 0) {
    return [];
  }
  const namedValueKey = (name: string, workspace: string | undefined): string =>
    getResourceDescriptorKey({ type: ResourceType.NamedValue, nameParts: [name], workspace });
  const namedValues = resources.filter(({ descriptor }) => descriptor.type === ResourceType.NamedValue);
  // The name each named value's value gives, or undefined when it gives none.
  const byName = new Map(
    namedValues.map(({ descriptor, json }) => [
      namedValueKey(descriptor.nameParts[0] ?? '', descriptor.workspace),
      namedValueTargetName(json),
    ])
  );
  const localNames = namedValueNamesByScope(
    namedValues.map(({ descriptor, json }) => ({
      name: descriptor.nameParts[0] ?? '',
      displayName: (json.properties as Record<string, unknown> | undefined)?.displayName,
      workspace: descriptor.workspace,
    }))
  );

  const dependencies: ResourceDescriptor[] = [];
  for (const { type, namedValue, workspace } of targets) {
    // Known from the full list: the named value it resolves to, which may not
    // be among `resources` yet. Otherwise only the ones here can tell.
    const resolved = resolveNamedValueName?.(namedValue, workspace) ?? localNames(workspace).resolve(namedValue);
    const name = resolved === undefined ? undefined : byName.get(namedValueKey(resolved, workspace));
    if (name) {
      dependencies.push({ type, nameParts: [name], workspace });
    }
  }
  return dependencies;
}


/**
 * Read intrinsic dependencies from one on-disk artifact.
 *
 * Association and subscription targets are links to independently selected
 * composite resources, not transitive dependencies.
 *
 * @param readNamedValue - Reads the named value a `{{reference}}` resolves to,
 *   so a policy attribute set to one (backend-id="{{backend-name}}") also
 *   gives the resource its value names. Without it, only the named value is.
 * @param prepareJson - Turns the artifact's JSON into what is scanned, such
 *   as the payload publish sends with overrides applied
 */
export async function scanArtifactReferences(
  store: IArtifactStore,
  sourceDir: string,
  descriptor: ResourceDescriptor,
  readNamedValue?: NamedValueReader,
  prepareJson?: PrepareJson
): Promise<ResourceDescriptor[]> {
  if (!REFERENCING_TYPES.has(descriptor.type)) {
    return [];
  }
  const references: ResourceDescriptor[] = [];
  const policies = new Map<string, string>();
  const apis = new Map<string, Record<string, unknown>>();

  if (POLICY_RESOURCE_TYPES.has(descriptor.type)) {
    const content = await store.readContent(sourceDir, descriptor, 'policy');
    const text = content ? preparePolicyContent(descriptor, content.content, prepareJson) : undefined;
    if (typeof text === 'string') {
      policies.set(descriptor.nameParts.join('/'), text);
    }
  }

  const infoFile = RESOURCE_TYPE_METADATA[descriptor.type]?.infoFile;
  const stored = POLICY_RESOURCE_TYPES.has(descriptor.type) || !infoFile?.endsWith('.json')
    ? undefined
    : await store.readResource(sourceDir, descriptor);
  const json = stored && prepareJson ? prepareJson(descriptor, stored) : stored;
  if (json && descriptor.type === ResourceType.Api) {
    apis.set(descriptor.nameParts.join('/'), json);
  }

  const resources = json ? [{ descriptor, json }] : [];
  const resolvedNames = new Map<string, string>();
  if (readNamedValue) {
    const fragment = descriptor.type === ResourceType.PolicyFragment
      ? (json?.properties as Record<string, unknown> | undefined)
      : undefined;
    const policyTexts = [...policies.values(), fragment?.value, fragment?.policyContent]
      .filter((text): text is string => typeof text === 'string');
    const namedValues = new Set(policyTexts.flatMap(scanNamedValueTargets).map((target) => target.namedValue));
    for (const namedValue of namedValues) {
      const resolved = await readNamedValue({
        type: ResourceType.NamedValue,
        nameParts: [namedValue],
        workspace: descriptor.workspace,
      });
      if (resolved) {
        resources.push(resolved);
        resolvedNames.set(namedValue.toLowerCase(), resolved.descriptor.nameParts[0] ?? '');
      }
    }
  }

  // An attribute follows the named value its reference resolved to above,
  // matched as the reader matches it (a source display name an override
  // changes included).
  references.push(
    ...findTransitiveDependencies(policies, apis, descriptor.workspace, resources, (reference, workspace) =>
      workspace?.toLowerCase() === descriptor.workspace?.toLowerCase() ? resolvedNames.get(reference.toLowerCase()) : undefined
    )
  );

  // A {{name}} in a Liquid body is a reference only when a named value has
  // that display name; one that resolves to no artifact is simply not followed.
  const fragment = descriptor.type === ResourceType.PolicyFragment
    ? (json?.properties as Record<string, unknown> | undefined)
    : undefined;
  for (const text of [...policies.values(), fragment?.value, fragment?.policyContent]) {
    if (typeof text === 'string') {
      references.push(
        ...scanLiquidNamedValueCandidates(text).map((name) => ({
          type: ResourceType.NamedValue,
          nameParts: [name],
          workspace: descriptor.workspace,
        }))
      );
    }
  }

  return deduplicateDescriptors(references);
}

/**
 * Turns an artifact's JSON into the payload that is published, such as with
 * overrides applied.
 */
export type PrepareJson = (descriptor: ResourceDescriptor, json: Record<string, unknown>) => Record<string, unknown>;

/** Artifact files read at once while scanning references. */
export const REFERENCE_SCAN_CONCURRENCY = 5;

/**
 * A policy's XML as `prepareJson` leaves it: the payload publish sends is
 * `{ properties: { value, format: 'rawxml' } }`, which overrides can change.
 */
function preparePolicyContent(descriptor: ResourceDescriptor, content: string, prepareJson?: PrepareJson): unknown {
  if (!prepareJson) {
    return content;
  }
  const payload = prepareJson(descriptor, { properties: { value: content, format: 'rawxml' } });
  return (payload.properties as Record<string, unknown> | undefined)?.value;
}

/**
 * The `{{references}}` to named values that APIM checks when an artifact is
 * saved: in a policy's or policy fragment's XML (outside Liquid bodies and XML
 * comments), and in a logger's or backend's credentials, as prepareJson leaves
 * them. Other artifacts hold none.
 */
export async function scanArtifactNamedValueReferences(
  store: Pick<IArtifactStore, 'readContent' | 'readResource'>,
  sourceDir: string,
  descriptor: ResourceDescriptor,
  prepareJson?: PrepareJson
): Promise<ResourceDescriptor[]> {
  const names: string[] = [];
  const policyNames = (text: unknown) =>
    typeof text === 'string'
      ? scanPolicyReferences(text).filter((dep) => dep.type === ResourceType.NamedValue).map((dep) => dep.name)
      : [];
  if (POLICY_RESOURCE_TYPES.has(descriptor.type)) {
    const content = await store.readContent(sourceDir, descriptor, 'policy');
    names.push(...policyNames(content ? preparePolicyContent(descriptor, content.content, prepareJson) : undefined));
  } else if (
    descriptor.type === ResourceType.PolicyFragment ||
    descriptor.type === ResourceType.Logger ||
    descriptor.type === ResourceType.Backend
  ) {
    const stored = await store.readResource(sourceDir, descriptor);
    const json = stored && prepareJson ? prepareJson(descriptor, stored) : stored;
    const properties = json?.properties as Record<string, unknown> | undefined;
    if (descriptor.type === ResourceType.PolicyFragment) {
      names.push(...policyNames(properties?.value), ...policyNames(properties?.policyContent));
    } else if (json) {
      // The credentials' named values, as dependencies find them.
      names.push(
        ...findTransitiveDependencies(new Map(), new Map(), descriptor.workspace, [{ descriptor, json }])
          .filter((dependency) => dependency.type === ResourceType.NamedValue)
          .map((dependency) => dependency.nameParts[0] ?? '')
      );
    }
  }
  return deduplicateDescriptors(
    names.map((name) => ({ type: ResourceType.NamedValue, nameParts: [name], workspace: descriptor.workspace }))
  );
}

/**
 * Resolve the references scanArtifactReferences returns to the artifacts
 * they name. Policies reference named values as {{displayName}}, which can
 * differ from the resource name the artifact is stored under; as in APIM, a
 * reference matches display names only (NamedValueNames). Named value
 * artifacts are read once, on the first named value reference.
 *
 * @param available - The artifacts references can resolve to
 * @param readResource - Reads an artifact's JSON
 * @param onUnreadable - Called for a named value artifact that can't be read,
 *   so a {{reference}} to its display name may resolve to nothing
 * @param prepareJson - Turns a named value's JSON into what is published,
 *   such as with overrides applied; a reference then matches the display name
 *   it is published with, or the one in the source (NamedValueEntry)
 */
export function createArtifactReferenceResolver(
  available: ReadonlyArray<ResourceDescriptor>,
  readResource: (descriptor: ResourceDescriptor) => Promise<Record<string, unknown> | undefined>,
  onUnreadable?: (descriptor: ResourceDescriptor) => void,
  prepareJson?: PrepareJson
): (reference: ResourceDescriptor) => Promise<ResourceDescriptor | undefined> {
  const byKey = new Map(available.map((descriptor) => [getResourceDescriptorKey(descriptor), descriptor]));
  let names: Promise<(workspace: string | undefined) => NamedValueNames> | undefined;
  return async (reference) => {
    if (reference.type !== ResourceType.NamedValue) {
      return byKey.get(getResourceDescriptorKey(reference));
    }
    names ??= readNamedValueNames(available, readResource, onUnreadable, prepareJson);
    const name = (await names)(reference.workspace).resolve(reference.nameParts[0] ?? '');
    return name === undefined ? undefined : byKey.get(getResourceDescriptorKey({ ...reference, nameParts: [name] }));
  };
}

/**
 * The NamedValueNames of the named value artifacts among `available`. One that
 * can't be read can't be matched.
 */
async function readNamedValueNames(
  available: ReadonlyArray<ResourceDescriptor>,
  readResource: (descriptor: ResourceDescriptor) => Promise<Record<string, unknown> | undefined>,
  onUnreadable?: (descriptor: ResourceDescriptor) => void,
  prepareJson?: PrepareJson
): Promise<(workspace: string | undefined) => NamedValueNames> {
  const displayNameOf = (json: Record<string, unknown> | undefined) =>
    (json?.properties as Record<string, unknown> | undefined)?.displayName;
  const entries: Array<NamedValueEntry & { workspace?: string }> = [];
  for (const descriptor of available.filter((d) => d.type === ResourceType.NamedValue)) {
    let json: Record<string, unknown> | undefined;
    try {
      json = await readResource(descriptor);
    } catch (error) {
      logger.warn(`Unable to read ${buildResourceLabel(descriptor)} to match {{references}} by display name: ${String(error)}`);
      onUnreadable?.(descriptor);
    }
    entries.push({
      name: descriptor.nameParts[0] ?? '',
      displayName: displayNameOf(json && prepareJson ? prepareJson(descriptor, json) : json),
      sourceDisplayName: prepareJson ? displayNameOf(json) : undefined,
      workspace: descriptor.workspace,
    });
  }
  return namedValueNamesByScope(entries);
}

/** A named value artifact, read to learn what a policy attribute set to it names. */
export type NamedValueReader = (
  reference: ResourceDescriptor
) => Promise<{ descriptor: ResourceDescriptor; json: Record<string, unknown> } | undefined>;

/**
 * A NamedValueReader that resolves a `{{reference}}` with `resolve` (from
 * createArtifactReferenceResolver) and reads the artifact it resolves to.
 */
export function createNamedValueReader(
  resolve: (reference: ResourceDescriptor) => Promise<ResourceDescriptor | undefined>,
  readResource: (descriptor: ResourceDescriptor) => Promise<Record<string, unknown> | undefined>
): NamedValueReader {
  // Many policies can set attributes to the same named value; read it once.
  const read = new Map<string, ReturnType<NamedValueReader>>();
  return (reference) => {
    const key = getResourceDescriptorKey(reference);
    let result = read.get(key);
    if (!result) {
      result = (async () => {
        const descriptor = await resolve(reference);
        const json = descriptor ? await readResource(descriptor) : undefined;
        return descriptor && json ? { descriptor, json } : undefined;
      })();
      read.set(key, result);
    }
    return result;
  };
}

/**
 * The resource types each named value is the whole value of a reference
 * attribute for (backend-id="{{name}}"), keyed by the named value's
 * descriptor key. It reads the policies and policy fragments among
 * `selected`, and the fragments among `available` that they include
 * (<include-fragment>), directly or through another fragment. A named value
 * published without the policies that use it (only its value changed, say)
 * needs the resource its value now names.
 *
 * @param resolve - Resolves a `{{reference}}` to the named value artifact
 * @param prepareJson - Turns each policy and fragment into what is scanned,
 *   such as the payload publish sends with overrides applied
 */
export async function indexNamedValueTargetTypes(
  store: Pick<IArtifactStore, 'readContent' | 'readResource'>,
  sourceDir: string,
  selected: ReadonlyArray<ResourceDescriptor>,
  available: ReadonlyArray<ResourceDescriptor>,
  resolve: (reference: ResourceDescriptor) => Promise<ResourceDescriptor | undefined>,
  prepareJson?: PrepareJson
): Promise<Map<string, Set<ResourceType>>> {
  const isPolicy = (descriptor: ResourceDescriptor) =>
    POLICY_RESOURCE_TYPES.has(descriptor.type) || descriptor.type === ResourceType.PolicyFragment;
  const fragments = new Map(
    available
      .filter((descriptor) => descriptor.type === ResourceType.PolicyFragment)
      .map((descriptor) => [getResourceDescriptorKey(descriptor), descriptor])
  );
  const index = new Map<string, Set<ResourceType>>();
  const read = new Set<string>();
  let wave = selected.filter(isPolicy);
  while (wave.length > 0) {
    wave.forEach((descriptor) => read.add(getResourceDescriptorKey(descriptor)));
    const policies = wave;
    const results = await runParallel(
      policies.map((descriptor) => async (): Promise<unknown[]> => {
        if (POLICY_RESOURCE_TYPES.has(descriptor.type)) {
          const content = (await store.readContent(sourceDir, descriptor, 'policy'))?.content;
          return [content === undefined ? undefined : preparePolicyContent(descriptor, content, prepareJson)];
        }
        const json = await store.readResource(sourceDir, descriptor);
        const properties = (json && prepareJson ? prepareJson(descriptor, json) : json)?.properties as
          Record<string, unknown> | undefined;
        return [properties?.value, properties?.policyContent];
      }),
      REFERENCE_SCAN_CONCURRENCY
    );
    wave = [];
    for (const [position, result] of results.entries()) {
      const descriptor = policies[position];
      if (result.status !== 'fulfilled') {
        logger.warn(
          `Unable to read ${buildResourceLabel(descriptor)} to find the named values its policy attributes are set to: ` +
          String(result.reason)
        );
        continue;
      }
      for (const text of result.value ?? []) {
        if (typeof text !== 'string') {
          continue;
        }
        for (const { type, namedValue } of scanNamedValueTargets(text)) {
          const target = await resolve({ type: ResourceType.NamedValue, nameParts: [namedValue], workspace: descriptor.workspace });
          if (target) {
            const key = getResourceDescriptorKey(target);
            index.set(key, (index.get(key) ?? new Set<ResourceType>()).add(type));
          }
        }
        for (const reference of scanPolicyReferences(text)) {
          if (reference.type !== ResourceType.PolicyFragment) {
            continue;
          }
          const key = getResourceDescriptorKey({ type: reference.type, nameParts: [reference.name], workspace: descriptor.workspace });
          const fragment = fragments.get(key);
          if (fragment && !read.has(key)) {
            read.add(key);
            wave.push(fragment);
          }
        }
      }
    }
  }
  return index;
}

/**
 * Find API or Product targets referenced by a subscription payload.
 *
 * These targets are used to gate link publication; they must not be fed into
 * transitive expansion because APIs and Products are composite resources.
 */
export function findSubscriptionTargets(
  json: Record<string, unknown>,
  workspace?: string
): ResourceDescriptor[] {
  const references: ResourceDescriptor[] = [];
  const properties = json.properties as Record<string, unknown> | undefined;
  for (const value of [properties?.scope, properties?.apiId]) {
    if (typeof value !== 'string') {
      continue;
    }
    for (const [segment, type] of [
      ['apis', ResourceType.Api],
      ['products', ResourceType.Product],
    ] as const) {
      const name = extractResourceNameFromId(value, segment);
      if (name) {
        references.push({
          type,
          nameParts: [name],
          workspace: workspaceFromReference(value, workspace),
        });
      }
    }
  }

  return deduplicateDescriptors(references);
}

function extractResourceNameFromId(value: string, segment: string): string | undefined {
  const match = value.match(new RegExp(`(?:^|/)${segment}/([^/]+)(?:/|$)`, 'i'));
  return match?.[1] ? decodeArmSegment(match[1]) : undefined;
}

function workspaceFromReference(value: string, fallback?: string): string | undefined {
  const match = value.match(/\/workspaces\/([^/]+)/i);
  if (match?.[1]) {
    return decodeArmSegment(match[1]);
  }

  const isFullArmId =
    /\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.ApiManagement\/service\/[^/]+/i.test(
      value
    );
  return isFullArmId ? undefined : fallback;
}

function decodeArmSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    logger.warn(`Unable to decode ARM resource ID segment; using the raw value: ${String(error)}`);
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deduplicateDescriptors(descriptors: ResourceDescriptor[]): ResourceDescriptor[] {
  const seen = new Set<string>();
  return descriptors.filter((descriptor) => {
    const key = getResourceDescriptorKey(descriptor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
