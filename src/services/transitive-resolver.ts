// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T025: Transitive dependency resolver
 * Scan policies for named value refs, backend refs, policy fragment refs.
 * Scan apiInformation.json for apiVersionSetId.
 * Fixed-point expansion; --no-transitive bypass.
 */

import { FilterConfig } from '../models/config.js';
import { ResourceType } from '../models/resource-types.js';
import { ResourceDescriptor } from '../models/types.js';
import { logger } from '../lib/logger.js';

/**
 * Reference detection patterns for policy XML content.
 */
const NAMED_VALUE_PATTERN = /\{\{([^}]+)\}\}/g;
const BACKEND_PATTERN = /<set-backend-service\s+backend-id="([^"]+)"/g;
const FRAGMENT_PATTERN = /<include-fragment\s+fragment-id="([^"]+)"/g;

/**
 * Represents a discovered transitive dependency.
 */
export interface TransitiveDependency {
  type: ResourceType;
  name: string;
}

/**
 * Scan policy XML content for references to other resources.
 *
 * Detects:
 * - Named values: {{namedValueName}} syntax
 * - Backends: <set-backend-service backend-id="backendName">
 * - Policy fragments: <include-fragment fragment-id="fragmentName">
 */
export function scanPolicyReferences(policyXml: string): TransitiveDependency[] {
  const dependencies: TransitiveDependency[] = [];

  // Named value references
  for (const match of policyXml.matchAll(NAMED_VALUE_PATTERN)) {
    if (match[1]) {
      dependencies.push({
        type: ResourceType.NamedValue,
        name: match[1].trim(),
      });
    }
  }

  // Backend references
  for (const match of policyXml.matchAll(BACKEND_PATTERN)) {
    if (match[1]) {
      dependencies.push({
        type: ResourceType.Backend,
        name: match[1].trim(),
      });
    }
  }

  // Policy fragment references
  for (const match of policyXml.matchAll(FRAGMENT_PATTERN)) {
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

  // Extract version set name from ARM resource ID
  // Format: /subscriptions/.../apiVersionSets/{name}
  const parts = versionSetId.split('/');
  const name = parts[parts.length - 1];
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
  currentFilter: FilterConfig,
  extractedNamedValues: Map<string, Record<string, unknown>> = new Map()
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

    // Scan extracted named values for references to other named values.
    for (const [name, namedValueJson] of extractedNamedValues) {
      const currentNamedValues = expanded.namedValueNames;
      if (currentNamedValues !== undefined) {
        const isIncluded = currentNamedValues.some((n) => n.toLowerCase() === name.toLowerCase());
        if (!isIncluded) {
          continue;
        }
      }

      for (const ref of scanNamedValueReferences(namedValueJson)) {
        if (addToFilter(expanded, ref)) {
          changed = true;
        }
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
  const fieldMap: Partial<Record<ResourceType, keyof FilterConfig>> = {
    [ResourceType.NamedValue]: 'namedValueNames',
    [ResourceType.Backend]: 'backendNames',
    [ResourceType.PolicyFragment]: 'policyFragmentNames',
    [ResourceType.VersionSet]: 'versionSetNames',
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
  if (current.some((n) => n.toLowerCase() === lowerName)) {
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
  namedValues: Map<string, Record<string, unknown>> = new Map()
): ResourceDescriptor[] {
  const dependencies: ResourceDescriptor[] = [];
  const seen = new Set<string>();
  const namedValueKeyToName = new Map<string, string>();

  const addDependency = (dep: TransitiveDependency): boolean => {
    const key = `${dep.type}:${dep.name.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    dependencies.push({ type: dep.type, nameParts: [dep.name] });
    return true;
  };

  // Build once so each queue lookup stays O(1) during chain expansion.
  for (const [name] of namedValues) {
    namedValueKeyToName.set(name.toLowerCase(), name);
  }

  const namedValueQueue: string[] = [];

  // Scan all policies
  for (const [, policyXml] of policies) {
    for (const dep of scanPolicyReferences(policyXml)) {
      if (addDependency(dep) && dep.type === ResourceType.NamedValue) {
        namedValueQueue.push(dep.name);
      }
    }
  }

  // Scan API version set references
  for (const [, apiJson] of apis) {
    const dep = scanApiVersionSetReference(apiJson);
    if (dep && addDependency(dep) && dep.type === ResourceType.NamedValue) {
      namedValueQueue.push(dep.name);
    }
  }

  // Expand named value chains (e.g. A references B, B references C).
  while (namedValueQueue.length > 0) {
    const currentName = namedValueQueue.shift()!;
    const canonicalName = namedValueKeyToName.get(currentName.toLowerCase());
    if (!canonicalName) {
      continue;
    }

    const namedValueJson = namedValues.get(canonicalName);
    if (!namedValueJson) {
      continue;
    }

    for (const dep of scanNamedValueReferences(namedValueJson)) {
      if (addDependency(dep) && dep.type === ResourceType.NamedValue) {
        namedValueQueue.push(dep.name);
      }
    }
  }

  return dependencies;
}

/**
 * Scan named value JSON payload for references to other named values.
 */
function scanNamedValueReferences(namedValueJson: Record<string, unknown>): TransitiveDependency[] {
  const refs: TransitiveDependency[] = [];
  const stack: unknown[] = [namedValueJson];

  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === 'string') {
      for (const match of value.matchAll(NAMED_VALUE_PATTERN)) {
        if (match[1]) {
          refs.push({
            type: ResourceType.NamedValue,
            name: match[1].trim(),
          });
        }
      }
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        stack.push(item);
      }
      continue;
    }

    if (value && typeof value === 'object') {
      for (const child of Object.values(value as Record<string, unknown>)) {
        stack.push(child);
      }
    }
  }

  return refs;
}
