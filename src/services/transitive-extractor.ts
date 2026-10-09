// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { getResourceDescriptorKey } from '../lib/resource-path.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import { logger } from '../lib/logger.js';
import { runParallel } from '../lib/parallel-runner.js';
import { redactSecrets } from './secret-redactor.js';
import { findTransitiveDependencies } from './transitive-resolver.js';

const DEFAULT_CONCURRENCY = 5;

export interface TransitiveResourceArtifact {
  descriptor: ResourceDescriptor;
  json: Record<string, unknown>;
}

export interface TransitiveExtractionResult {
  extractedDescriptors: ResourceDescriptor[];
  errorCount: number;
}

interface TransitiveTaskResult {
  dep: ResourceDescriptor;
  json?: Record<string, unknown>;
  /** Resolved to a resource already extracted under its real name. */
  skipped?: boolean;
}

/**
 * Per-context (keyed by baseUrl) index of named value displayName → resource name.
 * Stored as promises so concurrent tasks share a single LIST call.
 */
type NamedValueNameIndex = Map<string, Promise<Map<string, string>>>;

async function loadNamedValueNames(
  client: IApimClient,
  context: ApimServiceContext
): Promise<Map<string, string>> {
  const byDisplayName = new Map<string, string>();
  try {
    for await (const json of client.listResources(context, ResourceType.NamedValue)) {
      const name = json.name;
      const displayName = (json.properties as Record<string, unknown> | undefined)?.displayName;
      if (typeof name === 'string' && typeof displayName === 'string') {
        byDisplayName.set(displayName, name);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to list named values for display name resolution; ` +
      `falling back to resolving {{references}} as resource names: ${message}`
    );
  }
  return byDisplayName;
}

/**
 * Policies reference named values as {{displayName}}, but the ARM GET endpoint
 * is keyed by resource name. Map the reference to the resource name when they
 * differ; otherwise return the descriptor unchanged.
 */
async function resolveNamedValueDescriptor(
  client: IApimClient,
  context: ApimServiceContext,
  dep: ResourceDescriptor,
  index: NamedValueNameIndex
): Promise<ResourceDescriptor> {
  let names = index.get(context.baseUrl);
  if (!names) {
    names = loadNamedValueNames(client, context);
    index.set(context.baseUrl, names);
  }

  const ref = dep.nameParts[0] ?? '';
  const name = (await names).get(ref);
  if (!name || name === ref) {
    return dep;
  }

  logger.debug(`Resolved named value reference "{{${ref}}}" to resource name "${name}"`);
  return { ...dep, nameParts: [name] };
}

export async function extractTransitiveDependencies(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  outputDir: string,
  policies: Map<string, string>,
  apis: Map<string, Record<string, unknown>>,
  resources: TransitiveResourceArtifact[],
  alreadyExtracted: ResourceDescriptor[],
  workspace?: string,
  serviceContext?: ApimServiceContext
): Promise<TransitiveExtractionResult> {
  const attempted = new Set(alreadyExtracted.map(getResourceDescriptorKey));
  const claimedNamedValues = new Set(alreadyExtracted.map(getResourceDescriptorKey));
  const extractedDescriptors: ResourceDescriptor[] = [];
  const namedValueIndex: NamedValueNameIndex = new Map();
  let errorCount = 0;
  let foundDependencies = false;

  while (true) {
    const newDeps = findTransitiveDependencies(
      policies,
      apis,
      workspace,
      resources
    ).filter((dep) => !attempted.has(getResourceDescriptorKey(dep)));

    if (newDeps.length === 0) {
      if (!foundDependencies) {
        logger.debug('No additional transitive dependencies found');
      }
      return { extractedDescriptors, errorCount };
    }

    foundDependencies = true;
    logger.info(`Found ${newDeps.length} transitive dependencies to extract`);
    for (const dep of newDeps) {
      attempted.add(getResourceDescriptorKey(dep));
    }

    const tasks = newDeps.map((dep) => async (): Promise<TransitiveTaskResult> => {
      try {
        const dependencyContext =
          serviceContext && dep.workspace !== workspace ? serviceContext : context;
        let target = dep;
        if (dep.type === ResourceType.NamedValue) {
          target = await resolveNamedValueDescriptor(client, dependencyContext, dep, namedValueIndex);
          const targetKey = getResourceDescriptorKey(target);
          if (claimedNamedValues.has(targetKey)) {
            return { dep: target, skipped: true };
          }
          claimedNamedValues.add(targetKey);
        }
        const json = await client.getResource(dependencyContext, target);
        if (json) {
          const safeJson = redactSecrets(target, json);
          await store.writeResource(outputDir, target, safeJson);
          logger.info(`Extracted transitive dependency ${buildResourceLabel(target)}`);
          return { dep: target, json: safeJson };
        }
        logger.warn(`Transitive dependency ${buildResourceLabel(target)} was not found`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Failed to extract transitive dependency ${buildResourceLabel(dep)}: ${message}`
        );
      }
      return { dep };
    });

    const taskResults = await runParallel(tasks, DEFAULT_CONCURRENCY);
    for (const taskResult of taskResults) {
      const value = taskResult.status === 'fulfilled' ? taskResult.value : undefined;
      if (value?.skipped) {
        continue;
      }
      if (!value?.json) {
        errorCount++;
        continue;
      }

      extractedDescriptors.push(value.dep);
      resources.push({
        descriptor: value.dep,
        json: value.json,
      });
    }
  }
}
