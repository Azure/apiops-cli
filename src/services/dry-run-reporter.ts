// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Dry-run reporter
 * Compare artifact resources vs APIM state, output [DRY RUN] PUT/DELETE/SKIP lines.
 * Summary counts per contracts/cli-commands.md.
 */

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import type { PublishConfig } from '../models/config.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { getTopologicalOrder } from '../lib/dependency-graph.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import { getResourceDescriptorKey } from '../lib/resource-path.js';
import { logger } from '../lib/logger.js';
import { computeDeleteActions } from './delete-unmatched-service.js';
import { applyOverrides } from './override-merger.js';
import {
  evaluateResourceEligibility,
  planAssociationPublications,
  resolveAssociationDeleteDescriptor,
  type PublishEligibility,
} from './resource-publisher.js';
import {
  planProductAssociationPublications,
  planProductPolicyPublication,
} from './product-publisher.js';
import { API_CHILD_TYPES, planApiPublication } from './api-publisher.js';
import { mapDescriptor } from './env-mapper.js';

export interface DryRunAction {
  operation: 'PUT' | 'PATCH' | 'DELETE' | 'SKIP';
  type: string;
  name: string;
  descriptor: ResourceDescriptor;
  reason?: string;
  error?: string;
}

export interface DryRunReport {
  actions: DryRunAction[];
  summary: { creates: number; patches: number; deletes: number; skips: number };
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
  let patches = 0;
  let deletes = 0;
  let skips = 0;

  const publicationPlans = await planDryRunPublications(
    store,
    context,
    config,
    targetDescriptors,
    incrementalDeletedDescriptors
  );

  // Process in topological order
  const orderedTypes = getTopologicalOrder();
  const plansByType = groupPlansByType(publicationPlans);

  for (const resourceType of orderedTypes) {
    const plans = plansByType.get(resourceType) || [];

    for (const plan of plans) {
      const descriptor = plan.descriptor;
      if (!plan.eligible) {
        const action: DryRunAction = {
          operation: 'SKIP',
          type: descriptor.type,
          name: formatResourceName(descriptor),
          descriptor,
          reason: plan.reason,
        };
        actions.push(action);
        skips++;
        logger.info(
          `[DRY RUN] SKIP ${buildResourceLabel(descriptor)} (${plan.reason ?? 'ineligible'})`
        );
        continue;
      }

      try {
        const supportsGet = RESOURCE_TYPE_METADATA[descriptor.type].supportsGet;
        const deployedDescriptor = config.envMapping
          ? mapDescriptor(descriptor, config.envMapping)
          : descriptor;
        const existsInApim = supportsGet
          ? await client.getResource(context, deployedDescriptor)
          : undefined;

        const operation = plan.operation ?? 'PUT';
        if (existsInApim) {
          // Resource exists - would be updated
          const action: DryRunAction = {
            operation,
            type: descriptor.type,
            name: formatResourceName(descriptor),
            descriptor,
          };
          actions.push(action);
          if (operation === 'PATCH') {
            patches++;
          } else {
            creates++;
          }
          logger.info(`[DRY RUN] ${operation} ${buildResourceLabel(descriptor)}`);
        } else {
          // Resource doesn't exist - would be created
          const action: DryRunAction = {
            operation,
            type: descriptor.type,
            name: formatResourceName(descriptor),
            descriptor,
          };
          actions.push(action);
          if (operation === 'PATCH') {
            patches++;
          } else {
            creates++;
          }
          logger.info(`[DRY RUN] ${operation} ${buildResourceLabel(descriptor)} (new)`);
        }
      } catch (error) {
        const errorMessage = `existence check failed: ${String(error)}`;
        const action: DryRunAction = {
          operation: 'SKIP',
          type: descriptor.type,
          name: formatResourceName(descriptor),
          descriptor,
          reason: errorMessage,
          error: errorMessage,
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
        const deployedDescriptor = config.envMapping
          ? mapDescriptor(descriptor, config.envMapping)
          : descriptor;
        const resolvedDescriptor = await resolveAssociationDeleteDescriptor(
          client,
          context,
          deployedDescriptor
        );
        const supportsGet = RESOURCE_TYPE_METADATA[descriptor.type].supportsGet;
        const existing = resolvedDescriptor
          ? supportsGet
            ? await client.getResource(context, resolvedDescriptor)
            : {}
          : undefined;

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
            reason: 'resource is already absent',
          };
          actions.push(action);
          skips++;
          logger.info(`[DRY RUN] SKIP ${buildResourceLabel(descriptor)} (already absent)`);
        }
      } catch (error) {
        const errorMessage = `existence check failed: ${String(error)}`;
        const action: DryRunAction = {
          operation: 'SKIP',
          type: descriptor.type,
          name: formatResourceName(descriptor),
          descriptor,
          reason: errorMessage,
          error: errorMessage,
        };
        actions.push(action);
        skips++;
        logger.info(`[DRY RUN] SKIP ${buildResourceLabel(descriptor)} (error)`);
      }
    }
  } else if (config.deleteUnmatched && !config.commitId) {
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

  const summary = { creates, patches, deletes, skips };
  logger.info(`[DRY RUN] Summary: ${creates} creates/updates, ${patches} patches, ${deletes} deletes, ${skips} skips`);

  return { actions, summary };
}

/**
 * Group descriptors by resource type
 */
interface DryRunPublicationPlan extends PublishEligibility {
  descriptor: ResourceDescriptor;
  operation?: 'PUT' | 'PATCH';
}

async function planDryRunPublications(
  store: IArtifactStore,
  context: ApimServiceContext,
  config: PublishConfig,
  targetDescriptors: ResourceDescriptor[],
  deletedDescriptors: ResourceDescriptor[]
): Promise<DryRunPublicationPlan[]> {
  const plans: DryRunPublicationPlan[] = [];
  const seen = new Set<string>();
  const deletedKeys = new Set(deletedDescriptors.map(getResourceDescriptorKey));
  const productParents = new Set(
    targetDescriptors
      .filter((descriptor) => descriptor.type === ResourceType.Product)
      .map(parentScopeKey)
  );
  const apiParents = new Set(
    targetDescriptors
      .filter(
        (descriptor) =>
          descriptor.type === ResourceType.Api &&
          !/;rev=\d+$/i.test(descriptor.nameParts[0] ?? '')
      )
      .map(parentScopeKey)
  );

  const addPlan = (plan: DryRunPublicationPlan, allowDuplicate = false): void => {
    const key = `${plan.operation ?? 'PUT'}:${getResourceDescriptorKey(plan.descriptor)}`;
    if (!allowDuplicate && seen.has(key)) return;
    seen.add(key);
    plans.push(plan);
  };

  for (const descriptor of targetDescriptors) {
    if (
      descriptor.type === ResourceType.Api &&
      /;rev=\d+$/i.test(descriptor.nameParts[0] ?? '') &&
      apiParents.has(apiRootScopeKey(descriptor))
    ) {
      continue;
    }

    if (
      API_CHILD_TYPES.includes(descriptor.type) &&
      apiParents.has(parentScopeKey(descriptor))
    ) {
      continue;
    }

    if (
      isProductAssociation(descriptor.type) &&
      productParents.has(parentScopeKey(descriptor))
    ) {
      continue;
    }

    if (descriptor.type === ResourceType.Product) {
      if (deletedKeys.has(getResourceDescriptorKey(descriptor))) {
        addPlan({
          descriptor,
          eligible: false,
          reason: 'artifact not found',
        });
        continue;
      }
      addPlan({ descriptor, eligible: true });
      const associations = await planProductAssociationPublications(
        store,
        context,
        descriptor,
        config,
        targetDescriptors
      );
      for (const association of associations) {
        addPlan(association);
      }

      const policy = await planProductPolicyPublication(
        store,
        descriptor,
        config,
        targetDescriptors
      );
      if (policy?.eligible) {
        addPlan({ descriptor: policy.descriptor, eligible: true });
      }
      continue;
    }

    if (
      descriptor.type === ResourceType.Api &&
      !/;rev=\d+$/i.test(descriptor.nameParts[0] ?? '')
    ) {
      addPlan({ descriptor, eligible: true, operation: 'PUT' });
      const apiPlan = await planApiPublication(
        store,
        descriptor,
        config,
        targetDescriptors
      );
      for (const revision of apiPlan.revisions) {
        addPlan({ descriptor: revision, eligible: true, operation: 'PUT' });
      }
      if (apiPlan.alignActiveRevision) {
        addPlan({ descriptor, eligible: true, operation: 'PUT' }, true);
      }
      for (const child of apiPlan.childPuts) {
        if (child.type === ResourceType.ApiTag) {
          const eligibility = await evaluateResourceEligibility(store, child, config);
          if (
            eligibility.eligible &&
            !child.workspace &&
            !(await store.readResource(config.sourceDir, child))
          ) {
            addPlan({
              descriptor: child,
              eligible: false,
              reason: 'association artifact is missing',
              operation: 'PUT',
            });
          } else {
            addPlan({ descriptor: child, ...eligibility, operation: 'PUT' });
          }
        } else {
          addPlan({ descriptor: child, eligible: true, operation: 'PUT' });
        }
      }
      for (const operation of apiPlan.operationDescriptionPuts) {
        addPlan({ descriptor: operation, eligible: true, operation: 'PUT' });
      }
      for (const patch of apiPlan.operationPatches) {
        addPlan({ descriptor: patch.descriptor, eligible: true, operation: 'PATCH' });
      }
      continue;
    }

    if (
      descriptor.type === ResourceType.ProductApi ||
      descriptor.type === ResourceType.ProductGroup ||
      descriptor.type === ResourceType.GatewayApi
    ) {
      const associations = await planAssociationPublications(
        store,
        context,
        descriptor,
        config,
        undefined,
        targetDescriptors
      );
      for (const association of associations) {
        addPlan(association);
      }
      continue;
    }

    if (descriptor.type === ResourceType.ApiTag) {
      const eligibility = await evaluateResourceEligibility(
        store,
        descriptor,
        config
      );
      if (
        eligibility.eligible &&
        !descriptor.workspace &&
        !(await store.readResource(config.sourceDir, descriptor))
      ) {
        addPlan({ descriptor, eligible: false, reason: 'association artifact is missing' });
      } else {
        addPlan({ descriptor, ...eligibility });
      }
      continue;
    }

    if (descriptor.type === ResourceType.Subscription) {
      const artifact = await store.readResource(config.sourceDir, descriptor);
      if (!artifact) {
        addPlan({ descriptor, eligible: false, reason: 'resource artifact is missing' });
        continue;
      }
      const json = applyOverrides(descriptor, artifact, config.overrides);
      const eligibility = await evaluateResourceEligibility(
        store,
        descriptor,
        config,
        json
      );
      addPlan({ descriptor, ...eligibility });
      continue;
    }

    addPlan({ descriptor, eligible: true });
  }

  return plans;
}

function groupPlansByType(
  plans: DryRunPublicationPlan[]
): Map<string, DryRunPublicationPlan[]> {
  const map = new Map<string, DryRunPublicationPlan[]>();
  for (const plan of plans) {
    const existing = map.get(plan.descriptor.type) || [];
    existing.push(plan);
    map.set(plan.descriptor.type, existing);
  }
  return map;
}

function isProductAssociation(type: ResourceType): boolean {
  return [
    ResourceType.ProductApi,
    ResourceType.ProductGroup,
    ResourceType.ProductTag,
  ].includes(type);
}

function parentScopeKey(descriptor: ResourceDescriptor): string {
  return `${descriptor.workspace ?? ''}:${descriptor.nameParts[0] ?? ''}`.toLowerCase();
}

function apiRootScopeKey(descriptor: ResourceDescriptor): string {
  const apiName = (descriptor.nameParts[0] ?? '').replace(/;rev=\d+$/i, '');
  return `${descriptor.workspace ?? ''}:${apiName}`.toLowerCase();
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
