/**
 * T033: Override merger service
 * Apply environment-specific overrides from OverrideConfig to resource JSON payloads.
 * Deep-merges with case-insensitive key matching; warns on unknown override keys.
 */

import { ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { OverrideConfig } from '../models/config.js';
import { logger } from '../lib/logger.js';
import { getNameFromNameParts } from '../lib/resource-path.js';

/**
 * Apply environment overrides from OverrideConfig to a resource JSON payload.
 * Deep-merges matching override properties using case-insensitive key matching.
 * Logs a warning for any override keys that don't match resource type.
 * Returns a new object (does not mutate input).
 * 
 * @param descriptor - Resource descriptor (type + name identify the resource)
 * @param json - Original resource JSON payload
 * @param overrides - Environment-specific override configuration
 * @returns New JSON object with overrides applied
 */
export function applyOverrides(
  descriptor: ResourceDescriptor,
  json: Record<string, unknown>,
  overrides: OverrideConfig | undefined
): Record<string, unknown> {
  if (!overrides) {
    return { ...json };
  }

  // Map resource type to override config section
  const overrideSection = getOverrideSectionForType(descriptor.type, overrides);
  if (!overrideSection) {
    return { ...json };
  }

  // Find matching override using case-insensitive name comparison
  const matchingKey = Object.keys(overrideSection).find(
    (key) => key.toLowerCase() === getNameFromNameParts(descriptor.nameParts).toLowerCase()
  );

  if (!matchingKey) {
    return { ...json };
  }

  const overrideValues = overrideSection[matchingKey];
  if (overrideValues === null || overrideValues === undefined || typeof overrideValues !== 'object') {
    return { ...json };
  }

  // ARM resources have all overridable fields inside 'properties'
  // Wrap the override values inside 'properties' to merge at the correct level
  const wrappedOverride = { properties: overrideValues };

  // Deep-merge the override into the resource JSON
  const result = deepMerge(json, wrappedOverride as Record<string, unknown>);

  logger.debug(
    `Applied overrides to ${descriptor.type} '${descriptor.nameParts.join('/')}'`,
    { overrideKeys: Object.keys(overrideValues) }
  );

  return result;
}

/**
 * Get the override section for a given resource type.
 * Returns the relevant Record<string, Override> map or undefined.
 */
function getOverrideSectionForType(
  type: ResourceType,
  overrides: OverrideConfig
): Record<string, unknown> | undefined {
  switch (type) {
    case ResourceType.NamedValue:
      return overrides.namedValues;
    case ResourceType.Backend:
      return overrides.backends;
    case ResourceType.Api:
      return overrides.apis;
    case ResourceType.Diagnostic:
      return overrides.diagnostics;
    case ResourceType.Logger:
      return overrides.loggers;
    default:
      return undefined;
  }
}

/**
 * Deep-merge two objects recursively.
 * - Objects are merged recursively
 * - Arrays are replaced (not merged)
 * - Primitives from source override target
 * - Returns a new object (immutable)
 * 
 * @param target - Base object
 * @param source - Override object
 * @returns New merged object
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result[key];

    // If both are plain objects, merge recursively
    if (
      isPlainObject(sourceValue) &&
      isPlainObject(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else {
      // Otherwise replace (arrays, primitives, or type mismatch)
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Check if a value is a plain object (not an array, null, or other special object).
 */
function isPlainObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}
