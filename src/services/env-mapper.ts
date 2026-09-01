// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ResourceType } from '../models/resource-types.js';
import type { ResourceDescriptor } from '../models/types.js';
import type { EnvironmentOverride, OverrideConfig } from '../models/config.js';

// Re-export for callers that previously imported EnvironmentOverride from here.
export type { EnvironmentOverride } from '../models/config.js';

export interface EnvMapping {
  prefix: string;
  suffix: string;
  appliesTo: ReadonlySet<ResourceType>;
  apiPathPrefix?: string;
}

/** Default resource types affixed when appliesTo is omitted. */
export const DEFAULT_APPLIES_TO: ReadonlySet<ResourceType> = new Set([
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
]);

/**
 * Types that cannot be affixed directly (singletons, association children, wikis).
 * These are handled via their parent's name — not via a direct appliesTo entry.
 */
export const NON_AFFIXABLE_TYPES: ReadonlySet<ResourceType> = new Set([
  // Singletons with fixed/derived names
  ResourceType.ServicePolicy,
  ResourceType.ApiPolicy,
  ResourceType.ProductPolicy,
  ResourceType.ApiOperationPolicy,
  ResourceType.GraphQLResolverPolicy,
  ResourceType.ApiWiki,
  ResourceType.ProductWiki,
  ResourceType.McpServer,
  // Association / child types — affixed via their parent
  ResourceType.ProductApi,
  ResourceType.ProductGroup,
  ResourceType.ProductTag,
  ResourceType.GatewayApi,
  ResourceType.ApiTag,
  ResourceType.ApiDiagnostic,
  ResourceType.ApiOperation,
  ResourceType.ApiSchema,
  ResourceType.ApiRelease,
  ResourceType.ApiTagDescription,
  ResourceType.GraphQLResolver,
]);

/**
 * Per-type mapping of each namePart index to the ResourceType it represents.
 * `null` means the segment is a positional sub-resource key that is NOT independently affixable.
 * Types absent from this map are top-level: nameParts[0] represents the type itself.
 */
const SEGMENT_TYPES: ReadonlyMap<ResourceType, ReadonlyArray<ResourceType | null>> = new Map([
  // No nameParts
  [ResourceType.ServicePolicy, []],

  // Singleton children: nameParts[0] is the parent resource name
  [ResourceType.ApiPolicy, [ResourceType.Api]],
  [ResourceType.ApiWiki, [ResourceType.Api]],
  [ResourceType.McpServer, [ResourceType.Api]],
  [ResourceType.ProductPolicy, [ResourceType.Product]],
  [ResourceType.ProductWiki, [ResourceType.Product]],

  // Association types: each segment is an independently-named resource
  [ResourceType.ProductApi, [ResourceType.Product, ResourceType.Api]],
  [ResourceType.ProductGroup, [ResourceType.Product, ResourceType.Group]],
  [ResourceType.ProductTag, [ResourceType.Product, ResourceType.Tag]],
  [ResourceType.GatewayApi, [ResourceType.Gateway, ResourceType.Api]],
  [ResourceType.ApiTag, [ResourceType.Api, ResourceType.Tag]],
  [ResourceType.ApiDiagnostic, [ResourceType.Api, ResourceType.Diagnostic]],

  // Sub-resource children: nameParts[0] = parent Api, nameParts[1] = scoped sub-resource key
  [ResourceType.ApiOperation, [ResourceType.Api, null]],
  [ResourceType.ApiOperationPolicy, [ResourceType.Api, null]],
  [ResourceType.ApiSchema, [ResourceType.Api, null]],
  [ResourceType.ApiRelease, [ResourceType.Api, null]],
  [ResourceType.ApiTagDescription, [ResourceType.Api, null]],
  [ResourceType.GraphQLResolver, [ResourceType.Api, null]],
  [ResourceType.GraphQLResolverPolicy, [ResourceType.Api, null]],
]);

/** Return undefined when no environment block is present or when prefix+suffix+apiPathPrefix are all empty and appliesTo is not set. */
export function buildEnvMapping(env: EnvironmentOverride | undefined): EnvMapping | undefined {
  if (env === undefined) return undefined;

  const prefix = env.namePrefix?.trim() ?? '';
  const suffix = env.nameSuffix?.trim() ?? '';
  const apiPathPrefix = env.apiPathPrefix?.trim() || undefined;

  if (prefix === '' && suffix === '' && apiPathPrefix === undefined && env.appliesTo === undefined) {
    return undefined;
  }

  // Convert string[] → ReadonlySet<ResourceType>, filtering out anything that isn't
  // a valid ResourceType. The validator surfaces a hard error for unknown types before
  // reaching this code, so in practice env.appliesTo is either undefined or all-valid.
  // The filter is a defensive fallback that keeps the internal set type-safe.
  const validTypes = new Set(Object.values(ResourceType) as string[]);
  const appliesTo: ReadonlySet<ResourceType> =
    env.appliesTo !== undefined
      ? new Set(env.appliesTo.filter((t) => validTypes.has(t)) as ResourceType[])
      : DEFAULT_APPLIES_TO;

  return apiPathPrefix !== undefined
    ? { prefix, suffix, appliesTo, apiPathPrefix }
    : { prefix, suffix, appliesTo };
}

/** Convenience: extract environment block from OverrideConfig then buildEnvMapping. */
export function buildEnvMappingFromOverrides(overrides: OverrideConfig | undefined): EnvMapping | undefined {
  if (overrides === undefined) return undefined;
  return buildEnvMapping(overrides.environment);
}

/**
 * Convert a deployed descriptor to its canonical (un-affixed) form.
 *
 * Returns `null` when the descriptor is outside this env's namespace
 * (i.e. belongs to another environment — do NOT delete it).
 *
 * - For top-level types: checks and strips the affix on `nameParts[0]`.
 * - For child/association types: checks `nameParts[0]` (the parent segment)
 *   against the parent's ResourceType. All segments are converted per their
 *   SEGMENT_TYPES entry; positional sub-resource keys (null) are kept as-is.
 * - For ServicePolicy (empty nameParts): returned unchanged (no affix, no namespace check).
 * - When type ∉ appliesTo: namespace scoping does not apply → returned unchanged.
 */
export function toCanonicalDescriptor(d: ResourceDescriptor, m: EnvMapping): ResourceDescriptor | null {
  const segTypes = SEGMENT_TYPES.get(d.type);

  if (segTypes !== undefined) {
    // Child / association type
    if (d.nameParts.length === 0) return d; // ServicePolicy (no nameParts)

    // nameParts[0] is the parent segment — it determines namespace membership
    const parentSegType = segTypes.length > 0 ? segTypes[0] : null;
    if (parentSegType !== null && !isInEnvNamespace(d.nameParts[0], parentSegType, m)) {
      return null; // parent belongs to another env
    }

    const newParts = d.nameParts.map((part, i) => {
      const segType = i < segTypes.length ? segTypes[i] : null;
      if (segType === null || segType === undefined) return part; // positional sub-resource key
      return toCanonicalName(part, segType, m) ?? part; // defensive fallback
    });
    return { ...d, nameParts: newParts };
  }

  // Top-level type
  if (d.nameParts.length === 0) return d;
  if (!isInEnvNamespace(d.nameParts[0], d.type, m)) return null;
  const canonicalFirst = toCanonicalName(d.nameParts[0], d.type, m);
  if (canonicalFirst === undefined) return null; // defensive
  return { ...d, nameParts: [canonicalFirst, ...d.nameParts.slice(1)] };
}

export function toDeployedName(name: string, type: ResourceType, m: EnvMapping): string {
  if (!m.appliesTo.has(type)) return name;
  return `${m.prefix}${name}${m.suffix}`;
}

/**
 * deployed → canonical name.
 * Returns undefined if deployedName does not belong to this env's namespace when type ∈ appliesTo.
 * Returns input unchanged when type ∉ appliesTo.
 */
export function toCanonicalName(deployedName: string, type: ResourceType, m: EnvMapping): string | undefined {
  if (!m.appliesTo.has(type)) return deployedName;
  if (!isInEnvNamespace(deployedName, type, m)) return undefined;

  let name = deployedName;
  if (m.prefix) name = name.slice(m.prefix.length);
  if (m.suffix) name = name.slice(0, name.length - m.suffix.length);
  return name;
}

/**
 * true iff deployedName has the env's prefix+suffix for this type.
 * When type ∉ appliesTo → returns true (namespace scoping doesn't apply to this type).
 */
export function isInEnvNamespace(deployedName: string, type: ResourceType, m: EnvMapping): boolean {
  if (!m.appliesTo.has(type)) return true;
  if (deployedName.length < m.prefix.length + m.suffix.length) return false;
  return deployedName.startsWith(m.prefix) && deployedName.endsWith(m.suffix);
}

/**
 * Rewrite a descriptor by affixing name segments based on the segment's associated ResourceType.
 * For top-level types: nameParts[0] is affixed if type ∈ appliesTo.
 * For singleton children (ApiPolicy, ProductPolicy, etc.): nameParts[0] (parent name) is affixed if parent type ∈ appliesTo.
 * For association types (ProductApi, ApiTag, etc.): each segment is affixed if its type ∈ appliesTo.
 * For sub-resource children (ApiOperation, ApiSchema, etc.): only nameParts[0] (parent) is affixed; sub-resource keys are unchanged.
 * The workspace field is NOT affixed (workspace container rename is handled separately).
 */
export function mapDescriptor(d: ResourceDescriptor, m: EnvMapping): ResourceDescriptor {
  const segTypes = SEGMENT_TYPES.get(d.type);

  if (segTypes !== undefined) {
    const newParts = d.nameParts.map((part, i) => {
      const segType = i < segTypes.length ? segTypes[i] : null;
      if (segType === null || segType === undefined) return part;
      return toDeployedName(part, segType, m);
    });
    return { ...d, nameParts: newParts };
  }

  // Top-level type: affix nameParts[0] if this type ∈ appliesTo
  if (d.nameParts.length === 0) return d;
  const [first, ...rest] = d.nameParts;
  return { ...d, nameParts: [toDeployedName(first, d.type, m), ...rest] };
}
