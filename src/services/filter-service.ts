// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T024: Filter service
 * Load FilterConfig, apply inclusive allowlist per resource type,
 * case-insensitive matching, API root-name matching for revisions.
 */

import { FilterConfig } from '../models/config.js';
import { ResourceType } from '../models/resource-types.js';
import { ResourceDescriptor } from '../models/types.js';
import { logger } from '../lib/logger.js';
import { getNamePart } from '../lib/resource-path.js';

/**
 * Map resource types to their corresponding FilterConfig field names.
 */
const FILTER_FIELD_MAP: Partial<Record<ResourceType, keyof FilterConfig>> = {
  [ResourceType.Api]: 'apiNames',
  [ResourceType.Backend]: 'backendNames',
  [ResourceType.Product]: 'productNames',
  [ResourceType.NamedValue]: 'namedValueNames',
  [ResourceType.Logger]: 'loggerNames',
  [ResourceType.Diagnostic]: 'diagnosticNames',
  [ResourceType.Tag]: 'tagNames',
  [ResourceType.PolicyFragment]: 'policyFragmentNames',
  [ResourceType.Gateway]: 'gatewayNames',
  [ResourceType.VersionSet]: 'versionSetNames',
  [ResourceType.Group]: 'groupNames',
  [ResourceType.Subscription]: 'subscriptionNames',
  [ResourceType.GlobalSchema]: 'schemaNames',
  [ResourceType.PolicyRestriction]: 'policyRestrictionNames',
  [ResourceType.Documentation]: 'documentationNames',
};

/**
 * Child resource types that inherit filter status from their parent.
 * If the parent (e.g., Api or Product) passes the filter, all children are included.
 */
const PARENT_FILTER_MAP: Partial<Record<ResourceType, keyof FilterConfig>> = {
  [ResourceType.ApiPolicy]: 'apiNames',
  [ResourceType.ApiTag]: 'apiNames',
  [ResourceType.ApiDiagnostic]: 'apiNames',
  [ResourceType.ApiOperation]: 'apiNames',
  [ResourceType.ApiOperationPolicy]: 'apiNames',
  [ResourceType.ApiSchema]: 'apiNames',
  [ResourceType.ApiRelease]: 'apiNames',
  [ResourceType.ApiTagDescription]: 'apiNames',
  [ResourceType.ApiWiki]: 'apiNames',
  [ResourceType.GraphQLResolver]: 'apiNames',
  [ResourceType.GraphQLResolverPolicy]: 'apiNames',
  [ResourceType.ProductPolicy]: 'productNames',
  [ResourceType.ProductApi]: 'productNames',
  [ResourceType.ProductGroup]: 'productNames',
  [ResourceType.ProductTag]: 'productNames',
  [ResourceType.ProductWiki]: 'productNames',
  [ResourceType.GatewayApi]: 'gatewayNames',
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
    return matchesFilter(getNamePart(descriptor.nameParts, 0), filter[directField]);
  }

  // Check parent-based filter for child resource types
  const parentField = PARENT_FILTER_MAP[descriptor.type];
  if (parentField) {
    const parentName = getParentNameForFilter(descriptor);
    if (parentName) {
      return matchesFilter(parentName, filter[parentField]);
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
 * Get the parent name to use for filter matching.
 * Uses PARENT_FILTER_MAP to determine which name-part is the parent, and
 * applies revision-suffix stripping for API children.
 */
function getParentNameForFilter(descriptor: ResourceDescriptor): string | undefined {
  const parentName = getNamePart(descriptor.nameParts, 0);
  // API children need revision suffix stripped (e.g. "my-api;rev=2" → "my-api")
  return PARENT_FILTER_MAP[descriptor.type] === 'apiNames'
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
