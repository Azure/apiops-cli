// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Filter service
 * Load FilterConfig, apply inclusive allowlist per resource type,
 * case-insensitive matching, API root-name matching for revisions.
 */

import { FilterConfig, ApiSubFilter } from '../models/config.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { ResourceDescriptor } from '../models/types.js';
import { logger } from '../lib/logger.js';
import { getNamePart } from '../lib/resource-path.js';

/**
 * Map resource types to their corresponding FilterConfig field names.
 */
const FILTER_FIELD_MAP: Partial<Record<ResourceType, keyof FilterConfig>> = {
  [ResourceType.Api]: 'apis',
  [ResourceType.Backend]: 'backends',
  [ResourceType.Product]: 'products',
  [ResourceType.NamedValue]: 'namedValues',
  [ResourceType.Logger]: 'loggers',
  [ResourceType.Diagnostic]: 'diagnostics',
  [ResourceType.Tag]: 'tags',
  [ResourceType.PolicyFragment]: 'policyFragments',
  [ResourceType.Gateway]: 'gateways',
  [ResourceType.VersionSet]: 'versionSets',
  [ResourceType.Group]: 'groups',
  [ResourceType.Subscription]: 'subscriptions',
  [ResourceType.GlobalSchema]: 'schemas',
  [ResourceType.ServicePolicy]: 'policies',
  [ResourceType.PolicyRestriction]: 'policyRestrictions',
  [ResourceType.Documentation]: 'documentations',
  [ResourceType.Workspace]: 'workspaces',
};

/**
 * Child resource types that inherit filter status from their parent.
 * If the parent (e.g., Api or Product) passes the filter, all children are included.
 */
const PARENT_FILTER_MAP: Partial<Record<ResourceType, keyof FilterConfig>> = {
  [ResourceType.ApiPolicy]: 'apis',
  [ResourceType.ApiTag]: 'apis',
  [ResourceType.ApiDiagnostic]: 'apis',
  [ResourceType.ApiOperation]: 'apis',
  [ResourceType.ApiOperationPolicy]: 'apis',
  [ResourceType.ApiSchema]: 'apis',
  [ResourceType.ApiRelease]: 'apis',
  [ResourceType.ApiTagDescription]: 'apis',
  [ResourceType.ApiWiki]: 'apis',
  [ResourceType.GraphQLResolver]: 'apis',
  [ResourceType.GraphQLResolverPolicy]: 'apis',
  [ResourceType.ProductPolicy]: 'products',
  [ResourceType.ProductApi]: 'products',
  [ResourceType.ProductGroup]: 'products',
  [ResourceType.ProductTag]: 'products',
  [ResourceType.ProductWiki]: 'products',
  [ResourceType.GatewayApi]: 'gateways',
};

/**
 * Map API child resource types to their sub-filter key in ApiSubFilter.
 */
const API_SUB_FILTER_KEY_MAP: Partial<Record<ResourceType, keyof ApiSubFilter>> = {
  [ResourceType.ApiOperation]: 'operations',
  [ResourceType.ApiOperationPolicy]: 'operations',
  [ResourceType.ApiDiagnostic]: 'diagnostics',
  [ResourceType.ApiSchema]: 'schemas',
  [ResourceType.ApiRelease]: 'releases',
};

/**
 * Determines if a resource should be included based on the filter config.
 *
 * Rules:
 * - If no filter config is provided, all resources are included.
 * - If the filter field is undefined/absent for a resource type, all resources of that type are included.
 * - If the filter field is an empty array, NO resources of that type are included.
 * - Matching is case-insensitive.
 * - API filter matches root name; all revisions of matching root are included.
 * - Child resources inherit filter from their parent type.
 * - API sub-resource filters (operations, diagnostics, schemas, releases) are applied when specified.
 */
export function shouldIncludeResource(
  descriptor: ResourceDescriptor,
  filter?: FilterConfig
): boolean {
  if (!filter) {
    return true;
  }

  // Check direct filter field for this resource type
  const directField = FILTER_FIELD_MAP[descriptor.type];
  if (directField) {
    // Singleton resources (e.g., ServicePolicy) have nameParts: [] — use fixed name from ARM path
    const resourceName = descriptor.nameParts.length > 0
      ? getNamePart(descriptor.nameParts, 0)
      : getSingletonFilterName(descriptor.type);
    return matchesFilter(resourceName, filter[directField] as string[] | undefined);
  }

  // Check parent-based filter for child resource types
  const parentField = PARENT_FILTER_MAP[descriptor.type];
  if (parentField) {
    const parentName = getParentNameForFilter(descriptor);
    if (parentName) {
      // First check: is the parent included?
      if (!matchesFilter(parentName, filter[parentField] as string[] | undefined)) {
        return false;
      }

      // Second check: does the parent have sub-resource filters?
      if (parentField === 'apis' && filter.apiSubFilters) {
        return matchesApiSubFilter(descriptor, parentName, filter.apiSubFilters);
      }

      return true;
    }
  }

  // Unknown types are included by default
  return true;
}

/**
 * Get the fixed singleton name for a resource type from its ARM path.
 * E.g., ServicePolicy → "policy"
 */
function getSingletonFilterName(type: ResourceType): string {
  const meta = RESOURCE_TYPE_METADATA[type];
  return meta.armPathSuffix.split('/').pop() ?? '';
}

/**
 * Check if an API child resource passes the API sub-resource filter.
 * If the parent API has no sub-filter entry, all children are included.
 * If the parent API has a sub-filter, only specified children pass.
 */
function matchesApiSubFilter(
  descriptor: ResourceDescriptor,
  parentApiName: string,
  apiSubFilters: Record<string, ApiSubFilter>
): boolean {
  // Find matching sub-filter using case-insensitive API name
  const lowerParent = parentApiName.toLowerCase();
  const matchingKey = Object.keys(apiSubFilters).find(
    (k) => k.toLowerCase() === lowerParent
  );

  if (!matchingKey) {
    // No sub-filter for this API — include all children
    return true;
  }

  const subFilter = apiSubFilters[matchingKey];
  const subFilterKey = API_SUB_FILTER_KEY_MAP[descriptor.type];

  if (!subFilterKey) {
    // This child type has no sub-filter support (e.g., ApiTag, ApiWiki) — include by default
    return true;
  }

  const allowlist = subFilter[subFilterKey];
  if (allowlist === undefined) {
    // Sub-filter for this API doesn't specify this child type — include all
    return true;
  }

  if (allowlist.length === 0) {
    // Explicitly empty = exclude all of this child type
    return false;
  }

  // Match the child's own name (second name part for ApiOperation, ApiDiagnostic, etc.)
  const childName = getNamePart(descriptor.nameParts, 1);
  return matchesFilter(childName, allowlist);
}

/**
 * Get the parent name to use for filter matching.
 * Uses PARENT_FILTER_MAP to determine which name-part is the parent, and
 * applies revision-suffix stripping for API children.
 */
function getParentNameForFilter(descriptor: ResourceDescriptor): string | undefined {
  const parentName = getNamePart(descriptor.nameParts, 0);
  // API children need revision suffix stripped (e.g. "my-api;rev=2" → "my-api")
  return PARENT_FILTER_MAP[descriptor.type] === 'apis'
    ? extractRootApiName(parentName)
    : parentName;
}

/**
 * Extract root API name from a potentially revision-qualified name.
 * E.g., "my-api;rev=2" → "my-api"
 */
export function extractRootApiName(name: string): string {
  const semiIndex = name.indexOf(';');
  return semiIndex >= 0 ? name.substring(0, semiIndex) : name;
}

/**
 * Check if a pattern contains wildcard characters (* or ?).
 */
export function isWildcardPattern(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?');
}

/**
 * Convert a glob-style wildcard pattern to a RegExp.
 * Supports:
 *  - `*` matches zero or more characters
 *  - `?` matches exactly one character
 * All other characters are escaped for literal matching.
 * Matching is case-insensitive.
 */
export function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`, 'i');
}

/** Warn once per pattern that looks likely to cause slow matching. */
const warnedPatterns = new Set<string>();

/**
 * Match a string against a glob-style wildcard pattern (case-insensitive).
 * Logs a warning for patterns with many wildcards that may be slow.
 */
export function wildcardMatch(pattern: string, text: string): boolean {
  const starCount = (pattern.match(/\*/g) ?? []).length;
  if (starCount > 4 && !warnedPatterns.has(pattern)) {
    warnedPatterns.add(pattern);
    logger.warn(
      `Filter pattern "${pattern}" has ${starCount} wildcards and may be slow to evaluate`
    );
  }
  return wildcardToRegex(pattern).test(text);
}

/**
 * Check whether a single filter entry matches a resource name.
 * Handles both exact (case-insensitive) and wildcard matching, and
 * matches against the API root name (revision-suffix stripped) as well.
 */
function entryMatches(entry: string, lowerName: string, lowerRoot: string): boolean {
  if (isWildcardPattern(entry)) {
    return wildcardMatch(entry, lowerName) || wildcardMatch(entry, lowerRoot);
  }
  const lowerEntry = entry.toLowerCase();
  return lowerName === lowerEntry || lowerRoot === lowerEntry;
}

/**
 * Match a resource name against a filter allowlist.
 *
 * - undefined allowlist → include all (no filter for this type)
 * - empty array → include none
 * - non-empty array → case-insensitive exact match or wildcard pattern match
 *
 * Wildcard patterns use `*` (zero or more characters) and `?` (single character).
 *
 * Negation: entries beginning with `!` are treated as exclusions. Exclusions
 * are evaluated after inclusions for the same list:
 *   - If the list contains only exclusions, an implicit `*` include is assumed
 *     ("include everything, then subtract").
 *   - Otherwise a resource is included iff at least one inclusion matches
 *     AND no exclusion matches.
 * `!` must be the first character to be interpreted as negation; `foo!bar`
 * is a literal name. `!` cannot appear in a valid APIM resource name, so a
 * leading `!` is unambiguous.
 */
function matchesFilter(name: string, allowlist: string[] | undefined): boolean {
  if (allowlist === undefined) {
    return true;
  }

  if (allowlist.length === 0) {
    return false;
  }

  const includes: string[] = [];
  const excludes: string[] = [];
  for (const entry of allowlist) {
    if (entry.startsWith('!')) {
      excludes.push(entry.slice(1));
    } else {
      includes.push(entry);
    }
  }

  const lowerName = name.toLowerCase();
  // For APIs, also match by root name (strip revision suffix)
  const lowerRoot = extractRootApiName(lowerName);

  // Pure-exclusion list is treated as "include-all, then subtract".
  const included =
    includes.length === 0
      ? true
      : includes.some((entry) => entryMatches(entry, lowerName, lowerRoot));

  if (!included) {
    return false;
  }

  return !excludes.some((entry) => entryMatches(entry, lowerName, lowerRoot));
}

/**
 * Filter a list of resource descriptors based on filter config.
 */
export function filterResources(
  descriptors: ResourceDescriptor[],
  filter?: FilterConfig
): ResourceDescriptor[] {
  if (!filter) {
    return descriptors;
  }

  const filtered = descriptors.filter((d) => shouldIncludeResource(d, filter));
  const excluded = descriptors.length - filtered.length;

  if (excluded > 0) {
    logger.debug(`Filter excluded ${excluded} of ${descriptors.length} resources`);
  }

  return filtered;
}
