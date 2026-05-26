// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Local artifact loader for compare command
 * Loads APIM resources from local artifact directories
 */

import { IArtifactStore } from '../clients/iartifact-store.js';
import { logger } from '../lib/logger.js';
import { OverrideConfig } from '../models/config.js';
import { applyOverrides } from './override-merger.js';

/**
 * Load all resources from a local artifact directory
 * Returns an array of resource objects similar to IApimClient.listResources
 */
export async function loadLocalArtifacts(
  artifactStore: IArtifactStore,
  baseDir: string,
  overrides?: OverrideConfig,
): Promise<Map<string, Record<string, unknown>[]>> {
  logger.info(`Loading artifacts from ${baseDir}...`);

  // Get all resource descriptors from the artifact directory
  const descriptors = await artifactStore.listResources(baseDir);
  logger.debug(`Found ${descriptors.length} resource descriptors`);

  // Group resources by type
  const resourcesByType = new Map<string, Record<string, unknown>[]>();

  // Load each resource
  for (const descriptor of descriptors) {
    const resource = await artifactStore.readResource(baseDir, descriptor);
    if (!resource) {
      logger.warn(
        `Resource not found for descriptor: ${descriptor.type}/${descriptor.nameParts.join('/')}`,
      );
      continue;
    }

    // Apply overrides if provided
    const finalResource = overrides
      ? applyOverrides(descriptor, resource, overrides)
      : resource;

    // Group by resource type
    const typeKey = descriptor.type;
    if (!resourcesByType.has(typeKey)) {
      resourcesByType.set(typeKey, []);
    }
    resourcesByType.get(typeKey)!.push(finalResource);
  }

  logger.info(
    `Loaded ${descriptors.length} resources across ${resourcesByType.size} types`,
  );

  return resourcesByType;
}

/**
 * Get resources of a specific type from the loaded artifact map
 */
export function getResourcesOfType(
  resourceMap: Map<string, Record<string, unknown>[]>,
  resourceType: string,
): Record<string, unknown>[] {
  return resourceMap.get(resourceType) ?? [];
}
