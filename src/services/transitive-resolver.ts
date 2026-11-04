// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Transitive dependency resolver
 * Scan policies for named value, backend, policy fragment, logger and schema
 * refs; apiInformation.json for apiVersionSetId; diagnostics for their
 * logger; logger and backend credentials for named values; API and product
 * links for their tags and groups.
 * Fixed-point expansion; --no-transitive bypass.
 */

import { FilterConfig } from '../models/config.js';
import { isBuiltInGroup, ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { AssociationEntry, ResourceDescriptor } from '../models/types.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import { logger } from '../lib/logger.js';
import { getResourceDescriptorKey } from '../lib/resource-path.js';

/**
 * Reference detection patterns for policy XML content.
 */
const NAMED_VALUE_PATTERN = /\{\{([^}]+)\}\}/g;

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

/** Policy attributes that name another resource, by the type they name. */
const POLICY_REFERENCE_PATTERNS: ReadonlyArray<{ type: ResourceType; pattern: RegExp }> = [
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
 * XML comments: references inside them are not in effect. Only a closed
 * comment is removed, so a stray `<!--` (for example in a policy expression
 * string) cannot hide the rest of the policy.
 */
const XML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/**
 * The body of a `<set-body template="liquid">` element: its `{{ ... }}` are
 * Liquid output expressions, not named value references. A self-closing
 * set-body has no body and is not matched.
 */
const LIQUID_BODY_PATTERN = new RegExp(
  `(<set-body(?:${XML_ATTRIBUTE})*?\\s+template\\s*=\\s*(["'])liquid\\2(?:${XML_ATTRIBUTE})*\\s*>)` +
    `[\\s\\S]*?(<\\/set-body\\s*>)`,
  'gi'
);

/**
 * Policy XML with the parts that cannot reference other resources removed:
 * XML comments, and the bodies of Liquid templates.
 */
function stripNonReferenceContent(policyXml: string): string {
  return policyXml
    .replace(XML_COMMENT_PATTERN, '')
    .replace(LIQUID_BODY_PATTERN, (_match, open: string, _quote: string, close: string) => `${open}${close}`);
}

/**
 * Scan text for named value references ({{displayName}}).
 */
function scanNamedValueReferences(text: string): TransitiveDependency[] {
  const dependencies: TransitiveDependency[] = [];
  for (const match of text.matchAll(NAMED_VALUE_PATTERN)) {
    if (match[1]) {
      dependencies.push({ type: ResourceType.NamedValue, name: match[1].trim() });
    }
  }
  return dependencies;
}

/**
 * Scan policy XML content for references to other resources.
 *
 * Detects, with the attribute anywhere on the element and in either quote:
 * - Named values: {{namedValueName}} syntax
 * - Backends: <set-backend-service backend-id>, <llm-content-safety backend-id>,
 *   and embeddings-backend-id on the semantic cache lookup policies
 * - Policy fragments: <include-fragment fragment-id>
 * - Loggers: <log-to-eventhub logger-id>
 * - Schemas: validate-content's <content schema-id>
 *
 * A value that is a policy expression (`@...`) or a named value reference
 * (`{{...}}`, found by the named value scan) does not name a resource.
 * References inside XML comments, and `{{ ... }}` inside a
 * `<set-body template="liquid">` body (Liquid output, not named values), are
 * ignored.
 */
export function scanPolicyReferences(policyXml: string): TransitiveDependency[] {
  const scannable = stripNonReferenceContent(policyXml);
  const dependencies = scanNamedValueReferences(scannable);

  for (const { type, pattern } of POLICY_REFERENCE_PATTERNS) {
    for (const match of scannable.matchAll(pattern)) {
      const name = match[2]?.trim();
      if (name && !name.startsWith('@') && !name.includes('{{')) {
        dependencies.push({ type, name });
      }
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

    // A diagnostic sends its data to the logger named by properties.loggerId, in the diagnostic's own
    // scope. APIM returns a workspace diagnostic's loggerId without the workspace segment
    // (.../service/{name}/loggers/{logger}), so the ID can't say which scope the logger is in; publish
    // makes the same assumption when it rebuilds the ID.
    if (descriptor.type === ResourceType.Diagnostic || descriptor.type === ResourceType.ApiDiagnostic) {
      const loggerId = properties?.loggerId;
      const name = typeof loggerId === 'string' ? extractResourceNameFromId(loggerId, 'loggers') : undefined;
      if (name) {
        dependencies.push({
          type: ResourceType.Logger,
          nameParts: [name],
          workspace: descriptor.workspace,
        });
      }
    }

    // Logger and backend credentials can hold named value references (for
    // example the Application Insights key APIM stores as a named value).
    if (
      (descriptor.type === ResourceType.Logger || descriptor.type === ResourceType.Backend) &&
      properties?.credentials !== undefined
    ) {
      for (const dep of scanNamedValueReferences(JSON.stringify(properties.credentials))) {
        dependencies.push({ type: dep.type, nameParts: [dep.name], workspace: descriptor.workspace });
      }
    }

    // An API's tag link needs the tag itself.
    if (descriptor.type === ResourceType.ApiTag && descriptor.nameParts[1]) {
      dependencies.push({
        type: ResourceType.Tag,
        nameParts: [descriptor.nameParts[1]],
        workspace: descriptor.workspace,
      });
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
      }
    }
  }

  return deduplicateDescriptors(dependencies);
}

/**
 * The groups or tags a product's links (groups.json, tags.json) need. A link
 * recorded at service scope targets a service-level resource even when the
 * product is in a workspace. Built-in groups are left out.
 */
export function findAssociationDependencies(
  owner: ResourceDescriptor,
  associationType: 'groups' | 'tags',
  entries: ReadonlyArray<AssociationEntry>
): ResourceDescriptor[] {
  return deduplicateDescriptors(
    entries
      .map((entry) => associationTarget(owner, associationType, entry))
      // Built-in groups exist in every APIM instance, so they are not dependencies.
      .filter((target) => !isBuiltInGroup(target))
  );
}

/**
 * The group or tag a product's link entry points to. An entry recorded at
 * service scope targets a service-level resource even when the product is
 * in a workspace.
 */
export function associationTarget(
  owner: ResourceDescriptor,
  associationType: 'groups' | 'tags',
  entry: AssociationEntry
): ResourceDescriptor {
  return {
    type: associationType === 'groups' ? ResourceType.Group : ResourceType.Tag,
    nameParts: [entry.name],
    workspace: entry.scope === 'service' ? undefined : owner.workspace,
  };
}

/**
 * Read intrinsic dependencies from one on-disk artifact.
 *
 * A product's group and tag links pull in those groups and tags. API,
 * product and gateway targets of links and subscriptions are independently
 * selected composite resources, not transitive dependencies.
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

  if (descriptor.type === ResourceType.Product) {
    for (const associationType of ['groups', 'tags'] as const) {
      const entries = await store.readAssociation(sourceDir, descriptor, associationType);
      references.push(...findAssociationDependencies(descriptor, associationType, entries));
    }
  }

  return deduplicateDescriptors(references);
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
