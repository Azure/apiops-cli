// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Transitive dependency resolver
 * Scan policies for named value, backend, policy fragment, logger and schema
 * refs; apiInformation.json for apiVersionSetId; diagnostics for their
 * logger; logger and backend credentials for named values; API and product
 * links for their tags and groups. A policy attribute set to a named value
 * (backend-id="{{name}}") also needs the resource that value names.
 * Fixed-point expansion; --no-transitive bypass.
 */

import { isBuiltInGroup, ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { AssociationEntry, ResourceDescriptor } from '../models/types.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import { armNameAfter, armReferenceWorkspace } from '../lib/arm-id.js';
import { getResourceDescriptorKey } from '../lib/resource-path.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import { logger } from '../lib/logger.js';
import { runParallel } from '../lib/parallel-runner.js';

/** Artifact files read at once while scanning references: the extract's own concurrency. */
export const REFERENCE_SCAN_CONCURRENCY = 5;

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

/**
 * The artifact types scanArtifactReferences can find references in: policies,
 * and the types findTransitiveDependencies and product links read. Keep it in
 * step with them.
 */
const REFERENCING_TYPES = new Set<ResourceType>([
  ...POLICY_RESOURCE_TYPES,
  ResourceType.Api,
  ResourceType.ApiTag,
  ResourceType.Diagnostic,
  ResourceType.ApiDiagnostic,
  ResourceType.Logger,
  ResourceType.Backend,
  ResourceType.PolicyFragment,
  ResourceType.Product,
]);

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
 * The names a `<set-body template="liquid">` body may reference named values
 * by: each `{{name}}` there whose name a named value could have. APIM
 * substitutes a named value inside a Liquid body when one has that name, and
 * leaves every other `{{ ... }}` (with spaces, a filter, or no such named
 * value, like `{{body.id}}`) to Liquid. So each is a reference only when a
 * named value with that name exists; callers check before following one, and
 * skip the rest without an error. XML comments are ignored.
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
 * `<set-body template="liquid">` body, are ignored: most of those are Liquid
 * output. The bare `{{name}}`s there that APIM substitutes when a named value
 * has that name are found by scanLiquidNamedValueCandidates, for callers to
 * check.
 */
export function scanPolicyReferences(policyXml: string): TransitiveDependency[] {
  const scannable = stripNonReferenceContent(policyXml);
  const dependencies = scanNamedValueReferences(scannable);

  for (const { type, value } of scanReferenceAttributes(scannable)) {
    if (!value.startsWith('@') && !value.includes('{{')) {
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

/** The non-empty values of the policy attributes that name a resource, trimmed. */
function scanReferenceAttributes(scannable: string): Array<{ type: ResourceType; value: string }> {
  const attributes: Array<{ type: ResourceType; value: string }> = [];
  for (const { type, pattern } of POLICY_REFERENCE_PATTERNS) {
    for (const match of scannable.matchAll(pattern)) {
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

  const name = armNameAfter(versionSetId, 'apiVersionSets');
  if (!name) {
    return undefined;
  }

  return {
    type: ResourceType.VersionSet,
    name,
  };
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

    // A diagnostic sends its data to the logger named by properties.loggerId, in the diagnostic's own
    // scope. APIM returns a workspace diagnostic's loggerId without the workspace segment
    // (.../service/{name}/loggers/{logger}), so the ID can't say which scope the logger is in; publish
    // makes the same assumption when it rebuilds the ID.
    if (descriptor.type === ResourceType.Diagnostic || descriptor.type === ResourceType.ApiDiagnostic) {
      const loggerId = properties?.loggerId;
      const name = typeof loggerId === 'string' ? armNameAfter(loggerId, 'loggers') : undefined;
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
            const name = armNameAfter(service.id, 'backends');
            if (name) {
              dependencies.push({
                type: ResourceType.Backend,
                nameParts: [name],
                workspace: armReferenceWorkspace(service.id, descriptor.workspace),
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

  dependencies.push(...findNamedValueTargetDependencies(namedValueTargets, resources));

  return deduplicateDescriptors(dependencies);
}

/**
 * The resources that policy attributes name through a named value
 * (backend-id="{{backend-name}}"), for the named values among `resources`.
 * A reference matches a named value in its own scope by display name, as APIM
 * resolves it, falling back to the resource name. A secret named value's value
 * isn't known, nor is a Key Vault one's, and a value that is itself a policy
 * expression or named value reference names no resource here.
 */
function findNamedValueTargetDependencies(
  targets: ReadonlyArray<NamedValueTarget & { workspace?: string }>,
  resources: ReadonlyArray<{ descriptor: ResourceDescriptor; json: Record<string, unknown> }>
): ResourceDescriptor[] {
  if (targets.length === 0) {
    return [];
  }
  const namedValueKey = (name: string, workspace: string | undefined): string =>
    getResourceDescriptorKey({ type: ResourceType.NamedValue, nameParts: [name], workspace });
  // The name each named value's value gives, or undefined when it gives none.
  const byName = new Map<string, string | undefined>();
  const byDisplayName = new Map<string, string | undefined>();
  for (const { descriptor, json } of resources) {
    if (descriptor.type !== ResourceType.NamedValue) {
      continue;
    }
    const name = namedValueTargetName(json);
    byName.set(namedValueKey(descriptor.nameParts[0] ?? '', descriptor.workspace), name);
    const displayName = (json.properties as Record<string, unknown> | undefined)?.displayName;
    if (typeof displayName === 'string') {
      byDisplayName.set(namedValueKey(displayName, descriptor.workspace), name);
    }
  }

  const dependencies: ResourceDescriptor[] = [];
  for (const { type, namedValue, workspace } of targets) {
    const key = namedValueKey(namedValue, workspace);
    const name = byDisplayName.has(key) ? byDisplayName.get(key) : byName.get(key);
    if (name) {
      dependencies.push({ type, nameParts: [name], workspace });
    }
  }
  return dependencies;
}

/**
 * The resource name a named value's value gives a policy attribute set to it,
 * or undefined when it gives none: a secret named value's value isn't known,
 * nor is a Key Vault one's, and a value that is itself a policy expression or
 * named value reference names no resource here.
 */
export function namedValueTargetName(json: Record<string, unknown>): string | undefined {
  const properties = json.properties as Record<string, unknown> | undefined;
  const value = typeof properties?.value === 'string' ? properties.value.trim() : '';
  return properties?.secret === true || value.startsWith('@') || value.includes('{{') ? undefined : value || undefined;
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
 */
export async function indexNamedValueTargetTypes(
  store: Pick<IArtifactStore, 'readContent' | 'readResource'>,
  sourceDir: string,
  selected: ReadonlyArray<ResourceDescriptor>,
  available: ReadonlyArray<ResourceDescriptor>,
  resolve: (reference: ResourceDescriptor) => Promise<ResourceDescriptor | undefined>
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
          return [(await store.readContent(sourceDir, descriptor, 'policy'))?.content];
        }
        const properties = (await store.readResource(sourceDir, descriptor))?.properties as Record<string, unknown> | undefined;
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
 * The groups and tags a product links to, read from its groups.json and
 * tags.json association files.
 */
export async function readProductLinkDependencies(
  store: Pick<IArtifactStore, 'readAssociation'>,
  baseDir: string,
  product: ResourceDescriptor
): Promise<ResourceDescriptor[]> {
  const dependencies: ResourceDescriptor[] = [];
  for (const associationType of ['groups', 'tags'] as const) {
    const entries = await store.readAssociation(baseDir, product, associationType);
    dependencies.push(...findAssociationDependencies(product, associationType, entries));
  }
  return dependencies;
}

/** A named value artifact, read to learn what a policy attribute set to it names. */
export type NamedValueReader = (
  reference: ResourceDescriptor
) => Promise<{ descriptor: ResourceDescriptor; json: Record<string, unknown> } | undefined>;

/**
 * Read intrinsic dependencies from one on-disk artifact.
 *
 * A product's group and tag links pull in those groups and tags. API,
 * product and gateway targets of links and subscriptions are independently
 * selected composite resources, not transitive dependencies.
 *
 * @param readNamedValue - Reads the named value a `{{reference}}` resolves to,
 *   so a policy attribute set to one (backend-id="{{backend-name}}") also
 *   gives the resource its value names. Without it, only the named value is.
 */
export async function scanArtifactReferences(
  store: IArtifactStore,
  sourceDir: string,
  descriptor: ResourceDescriptor,
  readNamedValue?: NamedValueReader
): Promise<ResourceDescriptor[]> {
  if (!REFERENCING_TYPES.has(descriptor.type)) {
    return [];
  }
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
  if (json && descriptor.type === ResourceType.Api) {
    apis.set(descriptor.nameParts.join('/'), json);
  }

  const resources = json ? [{ descriptor, json }] : [];
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
      }
    }
  }

  references.push(...findTransitiveDependencies(policies, apis, descriptor.workspace, resources));

  // A {{name}} in a Liquid body is a reference only when such a named value
  // exists; one that resolves to no artifact is simply not followed.
  const fragmentProperties = descriptor.type === ResourceType.PolicyFragment
    ? (json?.properties as Record<string, unknown> | undefined)
    : undefined;
  for (const text of [...policies.values(), fragmentProperties?.value, fragmentProperties?.policyContent]) {
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

  if (descriptor.type === ResourceType.Product) {
    references.push(...await readProductLinkDependencies(store, sourceDir, descriptor));
  }

  return deduplicateDescriptors(references);
}

/**
 * Resolve the references scanArtifactReferences returns to the artifacts
 * they name. Policies reference named values as {{displayName}}, which can
 * differ from the resource name the artifact is stored under: as in APIM
 * (and on extract), the display name decides and the resource name is the
 * fallback. Named value artifacts are read once, on the first named value
 * reference.
 *
 * @param available - The artifacts references can resolve to
 * @param readResource - Reads an artifact's JSON
 * @param onUnreadable - Called for a named value artifact that can't be read,
 *   so a {{reference}} to its display name may resolve to nothing
 */
export function createArtifactReferenceResolver(
  available: ReadonlyArray<ResourceDescriptor>,
  readResource: (descriptor: ResourceDescriptor) => Promise<Record<string, unknown> | undefined>,
  onUnreadable?: (descriptor: ResourceDescriptor) => void
): (reference: ResourceDescriptor) => Promise<ResourceDescriptor | undefined> {
  const byKey = new Map(available.map((descriptor) => [getResourceDescriptorKey(descriptor), descriptor]));
  let byDisplayName: Promise<Map<string, ResourceDescriptor>> | undefined;
  return async (reference) => {
    const key = getResourceDescriptorKey(reference);
    if (reference.type !== ResourceType.NamedValue) {
      return byKey.get(key);
    }
    byDisplayName ??= indexNamedValuesByDisplayName(available, readResource, onUnreadable);
    return (await byDisplayName).get(key) ?? byKey.get(key);
  };
}

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
 * The named value artifacts keyed as a `{{displayName}}` reference to them
 * would be (case-insensitive, like every descriptor key).
 */
async function indexNamedValuesByDisplayName(
  available: ReadonlyArray<ResourceDescriptor>,
  readResource: (descriptor: ResourceDescriptor) => Promise<Record<string, unknown> | undefined>,
  onUnreadable?: (descriptor: ResourceDescriptor) => void
): Promise<Map<string, ResourceDescriptor>> {
  const index = new Map<string, ResourceDescriptor>();
  for (const descriptor of available.filter((d) => d.type === ResourceType.NamedValue)) {
    let json: Record<string, unknown> | undefined;
    try {
      json = await readResource(descriptor);
    } catch (error) {
      logger.warn(`Unable to read ${buildResourceLabel(descriptor)} to match {{references}} by display name: ${String(error)}`);
      onUnreadable?.(descriptor);
      continue;
    }
    const displayName = (json?.properties as Record<string, unknown> | undefined)?.displayName;
    if (typeof displayName === 'string') {
      index.set(getResourceDescriptorKey({ ...descriptor, nameParts: [displayName] }), descriptor);
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
      const name = armNameAfter(value, segment);
      if (name) {
        references.push({
          type,
          nameParts: [name],
          workspace: armReferenceWorkspace(value, workspace),
        });
      }
    }
  }

  return deduplicateDescriptors(references);
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
