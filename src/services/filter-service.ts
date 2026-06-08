// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T024: Filter service
 * Load FilterConfig, apply inclusive allowlist per resource type,
 * case-insensitive matching, API root-name matching for revisions.
 */

import { FilterConfig, ApiSubFilter } from '../models/config.js';
import { ResourceType } from '../models/resource-types.js';
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
    return matchesFilter(getNamePart(descriptor.nameParts, 0), filter[directField] as string[] | undefined);
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

  // ServicePolicy has no filter — always included
  if (descriptor.type === ResourceType.ServicePolicy) {
    return true;
  }

  // Unknown types are included by default
  return true;
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
 * Match a resource name against a filter allowlist.
 *
 * - undefined allowlist → include all (no filter for this type)
 * - empty array → include none
 * - non-empty array → case-insensitive match
 */
function matchesFilter(name: string, allowlist: string[] | undefined): boolean {
  if (allowlist === undefined) {
    return true;
  }

  if (allowlist.length === 0) {
    return false;
  }

  const lowerName = name.toLowerCase();
  // For APIs, also match by root name (strip revision suffix)
  const lowerRoot = extractRootApiName(lowerName);

  return allowlist.some((allowed) => {
    const lowerAllowed = allowed.toLowerCase();
    return lowerName === lowerAllowed || lowerRoot === lowerAllowed;
  });
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
