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
import {
  getNameFromNameParts,
  getNamePart,
  getApiRootName,
  isApiRevisionName,
} from '../lib/resource-path.js';
import { logger } from '../lib/logger.js';
import { toCanonicalDescriptor } from './env-mapper.js';

/**
 * Drop ;rev=N API deletes whose base API (same workspace) is also queued for
 * deletion. The base API delete uses deleteRevisions=true and removes all
 * revisions in one call, so individual revision deletes are redundant and can
 * hit APIM's "Cannot delete the current revision of an API" error.
 *
 * Shared by the real delete path and the dry-run reporter so the preview
 * matches what publish would actually delete.
 */
export function filterRevisionDeletesHandledByBaseApi(
  descriptors: ResourceDescriptor[]
): ResourceDescriptor[] {
  const baseApiKeys = new Set<string>();
  for (const descriptor of descriptors) {
    if (descriptor.type !== ResourceType.Api) {
      continue;
    }
    const apiName = getNamePart(descriptor.nameParts, 0);
    if (!isApiRevisionName(apiName)) {
      baseApiKeys.add(`${descriptor.workspace ?? ''}::${apiName}`);
    }
  }

  if (baseApiKeys.size === 0) {
    return descriptors;
  }

  return descriptors.filter((descriptor) => {
    if (descriptor.type !== ResourceType.Api) {
      return true;
    }
    const apiName = getNamePart(descriptor.nameParts, 0);
    if (!isApiRevisionName(apiName)) {
      return true;
    }
    return !baseApiKeys.has(`${descriptor.workspace ?? ''}::${getApiRootName(apiName)}`);
  });
}

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
    // GatewayApi assignments are reconciled by computeGatewayApiDeleteActions
    // below (they require a parent gateway and cannot be listed generically).
    if (resourceType === ResourceType.GatewayApi) {
      continue;
    }
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

  // Gateway → API assignments cannot be enumerated by the generic loop above
  // (GatewayApi requires a parent gateway and GET is not supported at the
  // collection root). Reconcile them explicitly, scoped to the gateways that
  // the local artifacts actually track (including the built-in "managed"
  // gateway). This keeps the blast radius limited: gateways with no local
  // apis.json are never touched.
  const gatewayApiDeletes = await computeGatewayApiDeleteActions(
    client,
    store,
    context,
    config,
    localDescriptors
  );
  // Run association removals first (children before parents).
  deleteDescriptors.unshift(...gatewayApiDeletes);

  return deleteDescriptors;
}

/**
 * Reconcile per-gateway API assignments (ResourceType.GatewayApi).
 *
 * Only gateways that appear as a local GatewayApi artifact are considered, so a
 * workspace that does not track gateway associations is left completely
 * untouched. The desired API set for each gateway is read from its
 * `gateways/{gw}/apis.json` (the artifact store surfaces GatewayApi only as an
 * aggregate `nameParts = [gateway]` descriptor, with the API names living in the
 * file content), then any deployed assignment not in that desired set is queued
 * for deletion (i.e. the API is un-assigned from that gateway).
 */
async function computeGatewayApiDeleteActions(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  config: PublishConfig,
  localDescriptors: ResourceDescriptor[]
): Promise<ResourceDescriptor[]> {
  const { envMapping } = config;

  // Distinct gateway names that own a local GatewayApi artifact.
  const gatewayNames = new Set<string>();
  for (const descriptor of localDescriptors) {
    if (descriptor.type === ResourceType.GatewayApi) {
      const gatewayName = getNamePart(descriptor.nameParts, 0);
      if (gatewayName) {
        gatewayNames.add(gatewayName);
      }
    }
  }

  if (gatewayNames.size === 0) {
    return [];
  }

  const deletes: ResourceDescriptor[] = [];

  for (const gatewayName of gatewayNames) {
    const gatewayDescriptor: ResourceDescriptor = {
      type: ResourceType.Gateway,
      nameParts: [gatewayName],
    };

    // Desired API set (canonical names) from the gateway's apis.json artifact.
    let desiredApis: Set<string>;
    try {
      const entries = await store.readAssociation(config.sourceDir, gatewayDescriptor, 'apis');
      desiredApis = new Set(entries.map((entry) => entry.name));
    } catch (error) {
      logger.debug(
        `[delete-unmatched] Skipping gateway "${gatewayName}" API reconciliation (cannot read desired apis): ${(error as Error).message}`
      );
      continue;
    }

    try {
      for await (const apiJson of client.listResources(
        context,
        ResourceType.GatewayApi,
        gatewayDescriptor
      )) {
        const apiName = extractResourceName(apiJson);
        if (!apiName) {
          continue;
        }

        const deployedDescriptor: ResourceDescriptor = {
          type: ResourceType.GatewayApi,
          nameParts: [gatewayName, apiName],
        };

        // Compare the deployed API against the desired set using canonical names
        // so env-affixed deployments still match the un-affixed artifacts.
        let canonicalApiName = apiName;
        if (envMapping !== undefined) {
          const canonicalDescriptor = toCanonicalDescriptor(deployedDescriptor, envMapping);
          if (canonicalDescriptor === null) {
            // Belongs to another environment — do not touch.
            continue;
          }
          canonicalApiName = getNamePart(canonicalDescriptor.nameParts, 1);
        }

        if (!desiredApis.has(canonicalApiName)) {
          deletes.push(deployedDescriptor);
        }
      }
    } catch (error) {
      logger.debug(
        `[delete-unmatched] Skipping gateway "${gatewayName}" API reconciliation: ${(error as Error).message}`
      );
      continue;
    }
  }

  return deletes;
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


