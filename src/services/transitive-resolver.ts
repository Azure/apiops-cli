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
import { type NamedValueEntry, NamedValueNames, namedValueNamesByScope } from './named-value-names.js';

/**
 * Reference detection patterns for policy XML content.
 */
const NAMED_VALUE_PATTERN = /\{\{([^}]+)\}\}/g;
const BACKEND_PATTERN = /<set-backend-service\s+backend-id="([^"]+)"/g;
const FRAGMENT_PATTERN = /<include-fragment\s+fragment-id="([^"]+)"/g;

/**
 * One XML attribute (`name="value"` or `name='value'`) with its leading
 * whitespace. Matching whole attributes, rather than any character up to `>`,
 * lets a value contain `>` (as policy expressions can).
 */
const XML_ATTRIBUTE = String.raw`\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*')`;

/**
 * XML comments: references inside them are not in effect. Only a closed
 * comment is removed, so a stray `<!--` (for example in a policy expression
 * string) cannot hide the rest of the policy.
 */
const XML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

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
 * Policy XML with the parts that cannot reference other resources removed:
 * XML comments, and the bodies of Liquid templates.
 */
function stripNonReferenceContent(policyXml: string): string {
  return policyXml
    .replace(XML_COMMENT_PATTERN, '')
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
  const uncommented = policyXml.replace(XML_COMMENT_PATTERN, (comment) => ' '.repeat(comment.length));
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
  for (const body of policyXml.replace(XML_COMMENT_PATTERN, '').matchAll(LIQUID_BODY_PATTERN)) {
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

const POLICY_RESOURCE_TYPES = new Set<ResourceType>([
  ResourceType.ServicePolicy,
  ResourceType.ApiPolicy,
  ResourceType.ApiOperationPolicy,
  ResourceType.ProductPolicy,
  ResourceType.GraphQLResolverPolicy,
]);

/**
 * Scan policy XML content for references to other resources.
 *
 * Detects:
 * - Named values: {{namedValueName}} syntax
 * - Backends: <set-backend-service backend-id="backendName">
 * - Policy fragments: <include-fragment fragment-id="fragmentName">
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

  // Backend references
  for (const match of scannable.matchAll(BACKEND_PATTERN)) {
    if (match[1]) {
      dependencies.push({
        type: ResourceType.Backend,
        name: match[1].trim(),
      });
    }
  }

  // Policy fragment references
  for (const match of scannable.matchAll(FRAGMENT_PATTERN)) {
    if (match[1]) {
      dependencies.push({
        type: ResourceType.PolicyFragment,
        name: match[1].trim(),
      });
    }
  }

  return dependencies;
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
 * Build a set of descriptors from transitive dependency scanning.
 * Returns additional descriptors that should be extracted.
 */
export function findTransitiveDependencies(
  policies: Map<string, string>,
  apis: Map<string, Record<string, unknown>>,
  workspace?: string,
  resources: ReadonlyArray<{
    descriptor: ResourceDescriptor;
    json: Record<string, unknown>;
  }> = []
): ResourceDescriptor[] {
  const dependencies: ResourceDescriptor[] = [];

  for (const [, policyXml] of policies) {
    for (const dep of scanPolicyReferences(policyXml)) {
      dependencies.push({ type: dep.type, nameParts: [dep.name], workspace });
    }
  }

  for (const [, apiJson] of apis) {
    const dep = scanApiVersionSetReference(apiJson);
    if (dep) {
      dependencies.push({ type: dep.type, nameParts: [dep.name], workspace });
    }
  }

  for (const { descriptor, json } of resources) {
    const properties = json.properties as Record<string, unknown> | undefined;

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
      }
    }
  }

  return deduplicateDescriptors(dependencies);
}

/**
 * Read intrinsic dependencies from one on-disk artifact.
 *
 * Association and subscription targets are links to independently selected
 * composite resources, not transitive dependencies.
 */
export async function scanArtifactReferences(
  store: IArtifactStore,
  sourceDir: string,
  descriptor: ResourceDescriptor
): Promise<ResourceDescriptor[]> {
  const references: ResourceDescriptor[] = [];
  const policies = new Map<string, string>();
  const apis = new Map<string, Record<string, unknown>>();

  if (POLICY_RESOURCE_TYPES.has(descriptor.type)) {
    const content = await store.readContent(sourceDir, descriptor, 'policy');
    if (content) {
      policies.set(descriptor.nameParts.join('/'), content.content);
    }
  }

  const infoFile = RESOURCE_TYPE_METADATA[descriptor.type]?.infoFile;
  const json = POLICY_RESOURCE_TYPES.has(descriptor.type) || !infoFile?.endsWith('.json')
    ? undefined
    : await store.readResource(sourceDir, descriptor);
  if (json) {
    if (descriptor.type === ResourceType.Api) {
      apis.set(descriptor.nameParts.join('/'), json);
    }

  }

  references.push(
    ...findTransitiveDependencies(
      policies,
      apis,
      descriptor.workspace,
      json ? [{ descriptor, json }] : []
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
