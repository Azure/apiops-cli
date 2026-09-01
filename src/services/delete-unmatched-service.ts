// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Delete unmatched resources service
 * List current APIM resources, diff against artifact descriptors,
 * generate DELETE actions in reverse dependency order.
 * Requires --delete-unmatched flag per FR-017.
 *
 * ## Env-namespace scoping
 *
 * When `config.envMapping` is set (multi-env shared-APIM mode), each deployed
 * resource is tested against the current env's namespace before being considered
 * for deletion. Resources whose names do NOT carry the env prefix/suffix are
 * silently skipped — they belong to another environment running on the same APIM.
 * Deployed names are then converted to canonical form for comparison against the
 * local artifact set (which always stores canonical names).
 *
 * ### Known caveat — "prefix dropped mid-life"
 * If an env mapping was previously active (resources were published as `dev-foo`)
 * and the config is later changed to have no prefix (or a different prefix), the
 * old affixed resources will no longer match the namespace and will be silently
 * skipped rather than deleted.  The user must manually clean up orphaned resources
 * in that scenario.
 */

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import type { PublishConfig } from '../models/config.js';
import { ResourceType } from '../models/resource-types.js';
import { getTopologicalOrder } from '../lib/dependency-graph.js';
import { getNameFromNameParts } from '../lib/resource-path.js';
import { logger } from '../lib/logger.js';
import { toCanonicalDescriptor } from './env-mapper.js';

/**
 * Built-in groups that should never be deleted
 */
const BUILT_IN_GROUPS = ['administrators', 'developers', 'guests'];

/**
 * System resources that should never be deleted
 */
const SYSTEM_RESOURCES = new Set<string>([
  'master', // Master product
  'unlimited', // Unlimited product
  'starter', // Starter product
  'echo-api', // Echo API (system test API)
]);

/**
 * List APIM resources not in local artifacts.
 * Returns descriptors to DELETE in reverse dependency order.
 * Used when --delete-unmatched flag is set.
 *
 * When `config.envMapping` is present the function operates in namespace-scoped
 * mode: only resources that belong to the current env's namespace are considered
 * for deletion.  Resources outside the namespace (other envs on the same APIM)
 * are skipped.  BUILT_IN_GROUPS and SYSTEM_RESOURCES are always preserved,
 * checked against the **canonical** (un-affixed) name.
 */
export async function computeDeleteActions(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  config: PublishConfig
): Promise<ResourceDescriptor[]> {
  // List all resources from local artifacts (always in canonical / un-affixed form)
  const localDescriptors = await store.listResources(config.sourceDir);
  const localSet = createResourceSet(localDescriptors);

  const { envMapping } = config;

  const deleteDescriptors: ResourceDescriptor[] = [];

  // Get topological order and reverse it for deletion
  const orderedTypes = getTopologicalOrder();
  const reverseOrder = [...orderedTypes].reverse();

  // For each resource type in reverse dependency order
  for (const resourceType of reverseOrder) {
    try {
      // List all resources of this type in APIM
      const apimResources = client.listResources(context, resourceType);

      for await (const resource of apimResources) {
        const deployedDescriptor = parseResourceDescriptor(resource, resourceType);

        if (!deployedDescriptor) {
          continue;
        }

        if (envMapping !== undefined) {
          // ── Namespace-scoped mode ────────────────────────────────────────────
          // Convert deployed → canonical; null means outside this env's namespace.
          const canonicalDescriptor = toCanonicalDescriptor(deployedDescriptor, envMapping);

          if (canonicalDescriptor === null) {
            // Resource belongs to another environment — do NOT delete.
            const skipName = deployedDescriptor.nameParts[0] ?? resourceType;
            logger.debug(
              `[delete-unmatched] Skipping ${resourceType}/${skipName}: outside env namespace`
            );
            continue;
          }

          // System-resource check uses the canonical (un-affixed) name.
          if (isSystemResource(canonicalDescriptor)) {
            continue;
          }

          // Compare canonical key against the local artifact set.
          if (!localSet.has(getResourceKey(canonicalDescriptor))) {
            // Not in local artifacts → mark the **deployed** descriptor for deletion
            // so client.deleteResource receives the actual APIM resource name.
            deleteDescriptors.push(deployedDescriptor);
          }
        } else {
          // ── Original behaviour (no env mapping) ─────────────────────────────
          if (isSystemResource(deployedDescriptor)) {
            continue;
          }

          const resourceKey = getResourceKey(deployedDescriptor);
          if (!localSet.has(resourceKey)) {
            deleteDescriptors.push(deployedDescriptor);
          }
        }
      }
    } catch {
      // Ignore errors listing resources (e.g., resource type not supported in this APIM instance)
      continue;
    }
  }

  return deleteDescriptors;
}

/**
 * Create a set of resource keys from descriptors for fast lookup
 */
function createResourceSet(descriptors: ResourceDescriptor[]): Set<string> {
  const set = new Set<string>();
  for (const descriptor of descriptors) {
    set.add(getResourceKey(descriptor));
  }
  return set;
}

/**
 * Get unique key for a resource descriptor
 */
function getResourceKey(descriptor: ResourceDescriptor): string {
  return [descriptor.type, ...descriptor.nameParts, descriptor.workspace ?? ''].join('::');
}

/**
 * Parse resource descriptor from APIM resource JSON.
 *
 * Supports an optional `nameParts` string-array property on the resource object
 * for structured multi-segment descriptors (used by tests and future structured
 * APIM client responses).  Falls back to extracting from `name` or `id`.
 */
function parseResourceDescriptor(
  resource: Record<string, unknown>,
  resourceType: ResourceType
): ResourceDescriptor | null {
  // If the resource carries pre-parsed nameParts, use them directly.
  if (
    Array.isArray(resource.nameParts) &&
    resource.nameParts.every((p: unknown) => typeof p === 'string')
  ) {
    // Safe after the .every() guard; filter preserves order and produces string[].
    const nameParts = resource.nameParts.filter((p): p is string => typeof p === 'string');
    const workspace =
      typeof resource.workspace === 'string' ? resource.workspace : undefined;
    return { type: resourceType, nameParts, ...(workspace !== undefined ? { workspace } : {}) };
  }

  // Extract name from resource
  const name = extractResourceName(resource);
  if (!name) {
    return null;
  }

  // Build descriptor based on resource type
  const descriptor: ResourceDescriptor = {
    type: resourceType,
    nameParts: [name],
  };

  return descriptor;
}

/**
 * Extract resource name from APIM resource JSON
 */
function extractResourceName(resource: Record<string, unknown>): string | null {
  // Try to get name from 'name' property
  if (typeof resource.name === 'string') {
    return resource.name;
  }

  // Try to get from 'id' property (ARM resource ID)
  if (typeof resource.id === 'string') {
    const parts = resource.id.split('/');
    return parts[parts.length - 1] || null;
  }

  return null;
}

/**
 * Check if a resource is a system resource that should not be deleted.
 * The descriptor's nameParts should be in canonical (un-affixed) form when
 * called under env-namespace mode.
 */
function isSystemResource(descriptor: ResourceDescriptor): boolean {
  if (descriptor.nameParts.length === 0) return false;
  const ownName = getNameFromNameParts(descriptor.nameParts).toLowerCase();

  // Check built-in groups
  if (descriptor.type === ResourceType.Group) {
    if (BUILT_IN_GROUPS.includes(ownName)) {
      return true;
    }
  }

  // Check system products and APIs
  if (
    descriptor.type === ResourceType.Product ||
    descriptor.type === ResourceType.Api
  ) {
    if (SYSTEM_RESOURCES.has(ownName)) {
      return true;
    }
  }

  // Check if group name starts with built-in prefix
  if (descriptor.type === ResourceType.Group) {
    if (ownName.startsWith('built-in')) {
      return true;
    }
  }

  return false;
}


