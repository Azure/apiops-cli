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
import { NamedValueNames, type NamedValueEntry } from './named-value-names.js';

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
  /** Resolved to a resource already extracted or claimed by another reference. */
  skipped?: boolean;
}

/**
 * Per-context (keyed by baseUrl) NamedValueNames of the named values APIM
 * lists. Stored as promises so concurrent tasks share a single LIST call.
 */
type NamedValueNameIndex = Map<string, Promise<ListedNamedValues>>;

interface ListedNamedValues {
  names: NamedValueNames;
  /** False when the named values couldn't be listed, so `names` is incomplete. */
  listed: boolean;
}

async function loadNamedValueNames(
  client: IApimClient,
  context: ApimServiceContext
): Promise<ListedNamedValues> {
  const entries: NamedValueEntry[] = [];
  try {
    for await (const json of client.listResources(context, ResourceType.NamedValue)) {
      if (typeof json.name === 'string') {
        entries.push({ name: json.name, displayName: (json.properties as Record<string, unknown> | undefined)?.displayName });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to list named values for display name resolution; ` +
      `falling back to resolving {{references}} as resource names: ${message}`
    );
    return { names: new NamedValueNames(entries), listed: false };
  }
  return { names: new NamedValueNames(entries), listed: true };
}

/** The named value name index for a context, listed once and shared. */
function namedValueNames(
  client: IApimClient,
  context: ApimServiceContext,
  index: NamedValueNameIndex
): Promise<ListedNamedValues> {
  let names = index.get(context.baseUrl);
  if (!names) {
    names = loadNamedValueNames(client, context);
    index.set(context.baseUrl, names);
  }
  return names;
}

/**
 * Policies reference named values as {{displayName}}, but the ARM GET endpoint
 * is keyed by resource name: the named value a reference names, under its
 * resource name. Undefined when the named values were listed and none has the
 * reference as its display name (APIM matches display names only). When they
 * couldn't be listed, the reference is tried as the resource name, which it
 * usually also is.
 */
async function resolveNamedValueDescriptor(
  client: IApimClient,
  context: ApimServiceContext,
  dep: ResourceDescriptor,
  index: NamedValueNameIndex
): Promise<ResourceDescriptor | undefined> {
  const ref = dep.nameParts[0] ?? '';
  const { names, listed } = await namedValueNames(client, context, index);
  const name = names.resolve(ref);
  if (name === undefined) {
    return listed ? undefined : dep;
  }
  if (name === ref) {
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
  // A {{reference}} to an extracted named value's name can be another named
  // value's display name, so named value references are only compared with
  // what is extracted once resolved (claimedNamedValues).
  const attempted = new Set(
    alreadyExtracted.filter((descriptor) => descriptor.type !== ResourceType.NamedValue).map(getResourceDescriptorKey)
  );
  const claimedNamedValues = new Set(alreadyExtracted.map(getResourceDescriptorKey));
  const extractedDescriptors: ResourceDescriptor[] = [];
  const namedValueIndex: NamedValueNameIndex = new Map();
  const contextFor = (dep: ResourceDescriptor): ApimServiceContext =>
    serviceContext && dep.workspace !== workspace ? serviceContext : context;
  let errorCount = 0;
  let foundDependencies = false;

  while (true) {
    const found = findTransitiveDependencies(
      policies,
      apis,
      workspace,
      resources
    ).filter((dep) => !attempted.has(getResourceDescriptorKey(dep)));
    const newDeps: ResourceDescriptor[] = [];
    for (const dep of found) {
      if (dep.type !== ResourceType.NamedValue) {
        newDeps.push(dep);
        continue;
      }
      const resolved = await resolveNamedValueDescriptor(client, contextFor(dep), dep, namedValueIndex);
      if (!resolved) {
        // APIM accepts only references to display names, so none is expected.
        attempted.add(getResourceDescriptorKey(dep));
        logger.warn(`No named value has the display name {{${dep.nameParts[0] ?? ''}}}, so it was not extracted`);
      } else if (!claimedNamedValues.has(getResourceDescriptorKey(resolved))) {
        newDeps.push(dep);
      }
    }

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
        const dependencyContext = contextFor(dep);
        let target = dep;
        if (dep.type === ResourceType.NamedValue) {
          const resolved = await resolveNamedValueDescriptor(client, dependencyContext, dep, namedValueIndex);
          if (!resolved) {
            return { dep, skipped: true };
          }
          target = resolved;
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
