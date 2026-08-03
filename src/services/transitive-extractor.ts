// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
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
  const extractedDescriptors: ResourceDescriptor[] = [];
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

    const tasks = newDeps.map((dep) => async () => {
      try {
        const dependencyContext =
          serviceContext && dep.workspace !== workspace ? serviceContext : context;
        const json = await client.getResource(dependencyContext, dep);
        if (json) {
          const safeJson = redactSecrets(dep, json);
          await store.writeResource(outputDir, dep, safeJson);
          logger.info(`Extracted transitive dependency ${buildResourceLabel(dep)}`);
          return { dep, json: safeJson };
        }
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
