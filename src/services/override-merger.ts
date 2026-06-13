// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Override merger service
 * Apply environment-specific overrides from OverrideConfig to resource JSON payloads.
 * Deep-merges with case-insensitive key matching; supports nested sub-resource overrides.
 * Handles all Toolkit override sections with generic property passthrough.
 */

import { ResourceDescriptor } from '../models/types.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { OverrideConfig, OverrideSection, OverrideEntry } from '../models/config.js';
import { logger } from '../lib/logger.js';
import { getNameFromNameParts, isSingletonType } from '../lib/resource-path.js';

/**
 * Map resource types to their top-level override config section key.
 */
const OVERRIDE_SECTION_MAP: Partial<Record<ResourceType, keyof OverrideConfig>> = {
  [ResourceType.NamedValue]: 'namedValues',
  [ResourceType.Backend]: 'backends',
  [ResourceType.Api]: 'apis',
  [ResourceType.Diagnostic]: 'diagnostics',
  [ResourceType.Logger]: 'loggers',
  [ResourceType.ServicePolicy]: 'policies',
  [ResourceType.Gateway]: 'gateways',
  [ResourceType.VersionSet]: 'versionSets',
  [ResourceType.Group]: 'groups',
  [ResourceType.Subscription]: 'subscriptions',
  [ResourceType.Product]: 'products',
  [ResourceType.Tag]: 'tags',
  [ResourceType.PolicyFragment]: 'policyFragments',
  [ResourceType.Workspace]: 'workspaces',
};

/**
 * Map child resource types to their parent section and child key within the parent's children.
 * Used for nested override lookup (e.g., ApiDiagnostic → apis.children.diagnostics).
 * `namePartIndex` indicates which name part identifies the child (default: 1).
 */
const CHILD_OVERRIDE_MAP: Partial<Record<ResourceType, { parentSection: keyof OverrideConfig; childKey: string; namePartIndex?: number }>> = {
  [ResourceType.ApiDiagnostic]: { parentSection: 'apis', childKey: 'diagnostics' },
  [ResourceType.ApiOperation]: { parentSection: 'apis', childKey: 'operations' },
  [ResourceType.ApiPolicy]: { parentSection: 'apis', childKey: 'policies' },
  [ResourceType.ApiRelease]: { parentSection: 'apis', childKey: 'releases' },
  [ResourceType.ProductPolicy]: { parentSection: 'products', childKey: 'policies' },
};

/**
 * Map grandchild resource types for 3-level override lookup.
 * E.g., ApiOperationPolicy → apis.children.operations[op].children.policies[policy]
 */
const GRANDCHILD_OVERRIDE_MAP: Partial<Record<ResourceType, {
  parentSection: keyof OverrideConfig;
  childKey: string;
  grandchildKey: string;
}>> = {
  [ResourceType.ApiOperationPolicy]: { parentSection: 'apis', childKey: 'operations', grandchildKey: 'policies' },
};

/**
 * Apply environment overrides from OverrideConfig to a resource JSON payload.
 * Deep-merges matching override properties using case-insensitive key matching.
 * Supports both direct overrides and nested sub-resource overrides.
 * Returns a new object (does not mutate input).
 */
export function applyOverrides(
  descriptor: ResourceDescriptor,
  json: Record<string, unknown>,
  overrides: OverrideConfig | undefined
): Record<string, unknown> {
  if (!overrides) {
    return { ...json };
  }

  // Try direct override lookup first
  const directSection = OVERRIDE_SECTION_MAP[descriptor.type];
  if (directSection) {
    const section = overrides[directSection];
    if (!section) return { ...json };
    return applyFromSection(descriptor, json, section);
  }

  // Try nested child override lookup
  const childMapping = CHILD_OVERRIDE_MAP[descriptor.type];
  if (childMapping) {
    return applyNestedOverride(descriptor, json, overrides, childMapping);
  }

  // Try grandchild (3-level) override lookup
  const grandchildMapping = GRANDCHILD_OVERRIDE_MAP[descriptor.type];
  if (grandchildMapping) {
    return applyGrandchildOverride(descriptor, json, overrides, grandchildMapping);
  }

  return { ...json };
}

/**
 * Apply override from a direct section match.
 * For singleton resources (e.g., ServicePolicy with nameParts: []),
 * uses the fixed singleton name from the ARM path (e.g., "policy").
 */
function applyFromSection(
  descriptor: ResourceDescriptor,
  json: Record<string, unknown>,
  section: OverrideSection
): Record<string, unknown> {
  const resourceName = getSingletonOrNamePartName(descriptor);
  const entry = findEntryByName(section, resourceName);

  if (!entry) {
    return { ...json };
  }

  if (Object.keys(entry.properties).length === 0) {
    return { ...json };
  }

  // ARM resources have all overridable fields inside 'properties'
  let overrideProperties = entry.properties;

  // Strip apiRevision and isCurrent from API overrides — matches Toolkit behavior.
  // These fields should not be overridden per environment.
  if (descriptor.type === ResourceType.Api) {
    const { apiRevision, isCurrent, ...rest } = overrideProperties;
    if (apiRevision !== undefined || isCurrent !== undefined) {
      logger.warn(
        `Ignoring 'apiRevision' and/or 'isCurrent' in API override for '${resourceName}'; ` +
        `these fields cannot be overridden (matching Toolkit behavior).`
      );
    }
    overrideProperties = rest;
    if (Object.keys(overrideProperties).length === 0) {
      return { ...json };
    }
  }

  const wrappedOverride = { properties: overrideProperties };
  const result = deepMerge(json, wrappedOverride);

  logger.debug(
    `Applied overrides to ${descriptor.type} '${descriptor.nameParts.join('/')}'`,
    { overrideKeys: Object.keys(entry.properties) }
  );

  return result;
}

/**
 * Apply nested child override (e.g., ApiDiagnostic under apis.children.diagnostics).
 *
 * nameParts layout varies by resource type:
 * - Named children (ApiDiagnostic, ApiOperation, ApiRelease): [parentName, childName]
 * - Singleton children (ApiPolicy, ProductPolicy): [parentName] (child name is always "policy")
 */
function applyNestedOverride(
  descriptor: ResourceDescriptor,
  json: Record<string, unknown>,
  overrides: OverrideConfig,
  mapping: { parentSection: keyof OverrideConfig; childKey: string }
): Record<string, unknown> {
  const parentSection = overrides[mapping.parentSection];
  if (!parentSection) return { ...json };

  const parentName = descriptor.nameParts[0];
  if (!parentName) return { ...json };

  const parentEntry = findEntryByName(parentSection, parentName);
  if (!parentEntry?.children) return { ...json };

  const childSection = parentEntry.children[mapping.childKey];
  if (!childSection) return { ...json };

  // For singleton children (e.g., ApiPolicy), the name is fixed (e.g., "policy"),
  // NOT in nameParts. For named children, it's nameParts[1].
  const childName = isSingletonType(descriptor.type)
    ? getSingletonName(descriptor.type)
    : descriptor.nameParts[1];
  if (!childName) return { ...json };

  const childEntry = findEntryByName(childSection, childName);
  if (!childEntry || Object.keys(childEntry.properties).length === 0) {
    return { ...json };
  }

  const wrappedOverride = { properties: childEntry.properties };
  const result = deepMerge(json, wrappedOverride);

  logger.debug(
    `Applied nested overrides to ${descriptor.type} '${descriptor.nameParts.join('/')}'`,
    { overrideKeys: Object.keys(childEntry.properties) }
  );

  return result;
}

/**
 * Apply grandchild (3-level) override.
 * E.g., ApiOperationPolicy: apis[apiName].children.operations[opName].children.policies[policy]
 *
 * nameParts layout for ApiOperationPolicy: [apiName, operationName]
 * The grandchild name is always the fixed singleton name (e.g., "policy").
 */
function applyGrandchildOverride(
  descriptor: ResourceDescriptor,
  json: Record<string, unknown>,
  overrides: OverrideConfig,
  mapping: { parentSection: keyof OverrideConfig; childKey: string; grandchildKey: string }
): Record<string, unknown> {
  const parentSection = overrides[mapping.parentSection];
  if (!parentSection) return { ...json };

  const parentName = descriptor.nameParts[0];
  if (!parentName) return { ...json };

  const parentEntry = findEntryByName(parentSection, parentName);
  if (!parentEntry?.children) return { ...json };

  const childSection = parentEntry.children[mapping.childKey];
  if (!childSection) return { ...json };

  const childName = descriptor.nameParts[1];
  if (!childName) return { ...json };

  const childEntry = findEntryByName(childSection, childName);
  if (!childEntry?.children) return { ...json };

  const grandchildSection = childEntry.children[mapping.grandchildKey];
  if (!grandchildSection) return { ...json };

  // Grandchild is always a singleton (e.g., "policy") — name is NOT in nameParts
  const grandchildName = getSingletonName(descriptor.type);
  if (!grandchildName) return { ...json };

  const grandchildEntry = findEntryByName(grandchildSection, grandchildName);
  if (!grandchildEntry || Object.keys(grandchildEntry.properties).length === 0) {
    return { ...json };
  }

  const wrappedOverride = { properties: grandchildEntry.properties };
  const result = deepMerge(json, wrappedOverride);

  logger.debug(
    `Applied grandchild overrides to ${descriptor.type} '${descriptor.nameParts.join('/')}'`,
    { overrideKeys: Object.keys(grandchildEntry.properties) }
  );

  return result;
}

/**
 * Get the resource name for override lookup, handling singletons correctly.
 * - Top-level singletons (ServicePolicy with nameParts: []) use the fixed singleton name
 * - Named resources use the last element of nameParts
 */
function getSingletonOrNamePartName(descriptor: ResourceDescriptor): string {
  if (descriptor.nameParts.length === 0) {
    // Top-level singleton (e.g., ServicePolicy)
    const name = getSingletonName(descriptor.type);
    if (!name) {
      throw new RangeError(
        `getSingletonOrNamePartName: ${descriptor.type} has empty nameParts ` +
        `but no known singleton name`
      );
    }
    return name;
  }
  return getNameFromNameParts(descriptor.nameParts);
}

/**
 * Get the fixed singleton name for a resource type from its ARM path.
 * E.g., ServicePolicy → "policy", ApiPolicy → "policy", ApiWiki → "default"
 * Returns undefined if the resource type is not a singleton.
 */
function getSingletonName(type: ResourceType): string | undefined {
  if (!isSingletonType(type)) return undefined;
  const meta = RESOURCE_TYPE_METADATA[type];
  return meta.armPathSuffix.split('/').pop();
}

/**
 * Find an override entry by name using case-insensitive matching.
 */
function findEntryByName(section: OverrideSection, name: string): OverrideEntry | undefined {
  const lowerName = name.toLowerCase();
  const matchingKey = Object.keys(section).find(
    (key) => key.toLowerCase() === lowerName
  );
  return matchingKey ? section[matchingKey] : undefined;
}

/**
 * Deep-merge two objects recursively.
 * - Objects are merged recursively
 * - Arrays are replaced (not merged)
 * - Primitives from source override target
 * - Returns a new object (immutable)
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result[key];

    if (
      isPlainObject(sourceValue) &&
      isPlainObject(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

function isPlainObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}
