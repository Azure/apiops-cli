/**
 * T034: Dry-run reporter
 * Compare artifact resources vs APIM state, output [DRY RUN] PUT/DELETE/SKIP lines.
 * Summary counts per contracts/cli-commands.md.
 */

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import type { PublishConfig } from '../models/config.js';
import { getTopologicalOrder } from '../lib/dependency-graph.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import { logger } from '../lib/logger.js';
import { computeDeleteActions } from './delete-unmatched-service.js';

export interface DryRunAction {
  operation: 'PUT' | 'DELETE' | 'SKIP';
  type: string;
  name: string;
  descriptor: ResourceDescriptor;
}

export interface DryRunReport {
  actions: DryRunAction[];
  summary: { creates: number; deletes: number; skips: number };
}

/**
 * Generate a dry-run report without making any changes.
 * Compares artifact resources vs APIM state.
 * Outputs [DRY RUN] lines per contracts/cli-commands.md format.
 */
export async function generateDryRunReport(
  store: IArtifactStore,
  client: IApimClient,
  context: ApimServiceContext,
  config: PublishConfig,
  targetDescriptors: ResourceDescriptor[],
  incrementalDeletedDescriptors: ResourceDescriptor[] = []
): Promise<DryRunReport> {
  const actions: DryRunAction[] = [];
  let creates = 0;
  let deletes = 0;
  let skips = 0;

  // Process in topological order
  const orderedTypes = getTopologicalOrder();
  const descriptorsByType = groupDescriptorsByType(targetDescriptors);

  for (const resourceType of orderedTypes) {
    const descriptors = descriptorsByType.get(resourceType) || [];

    for (const descriptor of descriptors) {
      try {
        // Check if resource exists in APIM
        const existsInApim = await client.getResource(context, descriptor);

        if (existsInApim) {
          // Resource exists - would be updated
          const action: DryRunAction = {
            operation: 'PUT',
            type: descriptor.type,
            name: formatResourceName(descriptor),
            descriptor,
          };
          actions.push(action);
          creates++;
          logger.info(`[DRY RUN] PUT ${buildResourceLabel(descriptor)}`);
        } else {
          // Resource doesn't exist - would be created
          const action: DryRunAction = {
            operation: 'PUT',
            type: descriptor.type,
            name: formatResourceName(descriptor),
            descriptor,
          };
          actions.push(action);
          creates++;
          logger.info(`[DRY RUN] PUT ${buildResourceLabel(descriptor)} (new)`);
        }
      } catch {
        // Error checking - skip
        const action: DryRunAction = {
          operation: 'SKIP',
          type: descriptor.type,
          name: formatResourceName(descriptor),
          descriptor,
        };
        actions.push(action);
        skips++;
        logger.info(`[DRY RUN] SKIP ${buildResourceLabel(descriptor)} (error)`);
      }
    }
  }

  // In incremental mode, use precomputed deleted descriptors from git diff.
  // Otherwise, if delete-unmatched is enabled, calculate full unmatched deletes.
  if (incrementalDeletedDescriptors.length > 0) {
    for (const descriptor of incrementalDeletedDescriptors) {
      try {
        const existing = await client.getResource(descriptor, context);

        if (existing) {
          const action: DryRunAction = {
            operation: 'DELETE',
            type: descriptor.type,
            name: formatResourceName(descriptor),
            descriptor,
          };
          actions.push(action);
          deletes++;
          logger.info(`[DRY RUN] DELETE ${buildResourceLabel(descriptor)}`);
        } else {
          const action: DryRunAction = {
            operation: 'SKIP',
            type: descriptor.type,
            name: formatResourceName(descriptor),
            descriptor,
          };
          actions.push(action);
          skips++;
          logger.info(`[DRY RUN] SKIP ${buildResourceLabel(descriptor)} (already absent)`);
        }
      } catch {
        const action: DryRunAction = {
          operation: 'SKIP',
          type: descriptor.type,
          name: formatResourceName(descriptor),
          descriptor,
        };
        actions.push(action);
        skips++;
        logger.info(`[DRY RUN] SKIP ${buildResourceLabel(descriptor)} (error)`);
      }
    }
  } else if (config.deleteUnmatched) {
    const deleteActions = await computeDeleteActionsForDryRun(
      client,
      store,
      context,
      config,
      targetDescriptors
    );

    for (const descriptor of deleteActions) {
      const action: DryRunAction = {
        operation: 'DELETE',
        type: descriptor.type,
        name: formatResourceName(descriptor),
        descriptor,
      };
      actions.push(action);
      deletes++;
      logger.info(`[DRY RUN] DELETE ${buildResourceLabel(descriptor)}`);
    }
  }

  const summary = { creates, deletes, skips };
  logger.info(`[DRY RUN] Summary: ${creates} creates/updates, ${deletes} deletes, ${skips} skips`);

  return { actions, summary };
}

/**
 * Group descriptors by resource type
 */
function groupDescriptorsByType(
  descriptors: ResourceDescriptor[]
): Map<string, ResourceDescriptor[]> {
  const map = new Map<string, ResourceDescriptor[]>();
  for (const descriptor of descriptors) {
    const existing = map.get(descriptor.type) || [];
    existing.push(descriptor);
    map.set(descriptor.type, existing);
  }
  return map;
}

/**
 * Format resource name for display
 */
function formatResourceName(descriptor: ResourceDescriptor): string {
  return descriptor.nameParts.join('/');
}

/**
 * Compute delete actions for dry-run by delegating to delete-unmatched-service.
 */
async function computeDeleteActionsForDryRun(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  config: PublishConfig,
  _targetDescriptors: ResourceDescriptor[]
): Promise<ResourceDescriptor[]> {
  return computeDeleteActions(client, store, context, config);
}
