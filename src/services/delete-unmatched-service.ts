/**
 * T035: Delete unmatched resources service
 * List current APIM resources, diff against artifact descriptors,
 * generate DELETE actions in reverse dependency order.
 * Requires --delete-unmatched flag per FR-017.
 */

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import type { PublishConfig } from '../models/config.js';
import { ResourceType } from '../models/resource-types.js';
import { getTopologicalOrder } from '../lib/dependency-graph.js';
import { getNameFromNameParts } from '../lib/resource-path.js';

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
 */
export async function computeDeleteActions(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  config: PublishConfig
): Promise<ResourceDescriptor[]> {
  // List all resources from local artifacts
  const localDescriptors = await store.listResources(config.sourceDir);
  const localSet = createResourceSet(localDescriptors);

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
        const descriptor = parseResourceDescriptor(resource, resourceType);
        
        if (!descriptor) {
          continue;
        }

        // Skip system resources
        if (isSystemResource(descriptor)) {
          continue;
        }

        // Check if resource exists in local artifacts
        const resourceKey = getResourceKey(descriptor);
        if (!localSet.has(resourceKey)) {
          // Resource exists in APIM but not in local artifacts - mark for deletion
          deleteDescriptors.push(descriptor);
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
 * Parse resource descriptor from APIM resource JSON
 */
function parseResourceDescriptor(
  resource: Record<string, unknown>,
  resourceType: ResourceType
): ResourceDescriptor | null {
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

  // Extract parent/grandparent from resource properties if needed
  // This depends on the resource structure from APIM
  // For now, we'll use a simple heuristic based on the resource type

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
 * Check if a resource is a system resource that should not be deleted
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
