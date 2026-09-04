// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Product publisher with association handling
 * Publish product and its associations (ProductApi, ProductGroup, ProductTag)
 */

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import type { PublishConfig } from '../models/config.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import {
  evaluateAssociationEligibility,
  planAssociationPublications,
  publishResource,
  type AssociationPublicationPlan,
  type ResourcePublishResult,
} from './resource-publisher.js';
import { logger } from '../lib/logger.js';
import { getNamePart, getResourceDescriptorKey, sameResourceDescriptor } from '../lib/resource-path.js';
import { parseArmUri } from '../lib/resource-uri.js';
import { isWorkspaceScope, buildLinkPayload } from '../lib/workspace-link.js';
import { isLinkAlreadyExistsError } from '../clients/apim-client.js';
import { mapDescriptor, toDeployedName } from './env-mapper.js';

export type ProductAssociationPublicationPlan = AssociationPublicationPlan;

export interface ProductPolicyPublicationPlan {
  descriptor: ResourceDescriptor;
  eligible: boolean;
}

/**
 * Publish a Product with all its associations (APIs, Groups, Tags).
 * Creates product first, then publishes associations.
 */
export async function publishProduct(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  config: PublishConfig,
  allowedDescriptors?: ResourceDescriptor[]
): Promise<ResourcePublishResult> {
  const productName = getNamePart(descriptor.nameParts, 0);
  const deployedProductDescriptor = config.envMapping
    ? mapDescriptor(descriptor, config.envMapping)
    : descriptor;
  let productExisted: boolean;
  try {
    productExisted =
      (await client.getResource(context, deployedProductDescriptor)) !== undefined;
  } catch (error) {
    return {
      descriptor,
      status: 'failed',
      action: 'noop',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  // Step 1: Publish the Product itself
  const productResult = await publishResource(client, store, context, descriptor, config);
  if (productResult.status !== 'success') {
    return productResult;
  }

  try {
    if (!productExisted) {
      await cleanupAutoCreatedProductResources(client, context, deployedProductDescriptor);
    }

    // Steps 2-4: Publish ProductApi, ProductGroup, and ProductTag associations.
    const associationPlans = await planProductAssociationPublications(
      store,
      context,
      descriptor,
      config,
      allowedDescriptors
    );
    const relatedResults = await publishProductAssociationPlans(client, context, associationPlans);

    // Step 5: Publish ProductPolicy if exists
    const policyPlan = await planProductPolicyPublication(
      store,
      descriptor,
      config,
      allowedDescriptors
    );
    if (policyPlan?.eligible) {
      relatedResults.push(
        await publishResource(client, store, context, policyPlan.descriptor, config)
      );
      logger.debug(`Published policy for product: ${productName}`);
    }

    logger.info(`Published product with associations: ${productName}`);
    return {
      descriptor,
      status: 'success',
      action: 'put',
      relatedResults,
    };
  } catch (error) {
    return {
      ...productResult,
      relatedResults: [{
        descriptor,
        status: 'failed',
        action: 'noop',
        error: error instanceof Error ? error : new Error(String(error)),
      }],
    };
  }
}

async function cleanupAutoCreatedProductResources(
  client: IApimClient,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor
): Promise<void> {
  await cleanupProductGroups(client, context, productDescriptor);
}

async function cleanupProductGroups(
  client: IApimClient,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor
): Promise<void> {
  const productName = getNamePart(productDescriptor.nameParts, 0);
  let deleted = 0;

  for await (const productGroup of client.listResources(
    context,
    ResourceType.ProductGroup,
    productDescriptor
  )) {
    const descriptor = parseProductGroupDescriptor(productGroup, context);
    if (!descriptor || descriptor.workspace !== productDescriptor.workspace) {
      continue;
    }

    try {
      const removed = await client.deleteResource(context, descriptor);
      if (removed) {
        deleted++;
      }
    } catch (error) {
      logger.warn(
        `Failed to delete auto-created product group ${descriptor.nameParts.join('/')}: ${String(error)}`
      );
    }
  }

  if (deleted > 0) {
    logger.info(`Deleted ${deleted} auto-created product group(s) for product: ${productName}`);
  }
}

function parseProductGroupDescriptor(
  productGroup: Record<string, unknown>,
  context: ApimServiceContext
): ResourceDescriptor | undefined {
  if (typeof productGroup.id === 'string') {
    const parsed = parseArmUri(productGroup.id, context);
    if (parsed?.type === ResourceType.ProductGroup) {
      return parsed;
    }
  }

  return undefined;
}

/**
 * Publish associations (ProductApi or ProductGroup) for a product.
 * In workspace scope, uses the link endpoint with a link payload body.
 */
export async function planProductAssociationPublications(
  store: IArtifactStore,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor,
  config: PublishConfig,
  allowedDescriptors?: ResourceDescriptor[]
): Promise<ProductAssociationPublicationPlan[]> {
  const productName = getNamePart(productDescriptor.nameParts, 0);
  const apiPlans = await planAssociationPublications(
    store,
    context,
    {
      type: ResourceType.ProductApi,
      nameParts: [productName],
      workspace: productDescriptor.workspace,
    },
    config,
    'apis',
    allowedDescriptors
  );
  const groupPlans = await planAssociationPublications(
    store,
    context,
    {
      type: ResourceType.ProductGroup,
      nameParts: [productName],
      workspace: productDescriptor.workspace,
    },
    config,
    'groups',
    allowedDescriptors
  );
  const tagEntries = await store.readAssociation(
    config.sourceDir,
    productDescriptor,
    'tags'
  );
  const workspaceScoped = !!productDescriptor.workspace || isWorkspaceScope(context);
  const linkProperty = RESOURCE_TYPE_METADATA[ResourceType.ProductTag].workspaceLinkIdProperty;
  const tagPlans: ProductAssociationPublicationPlan[] = [];

  for (const tagEntry of tagEntries) {
    const tagName = tagEntry.name;
    const descriptor: ResourceDescriptor = {
      type: ResourceType.ProductTag,
      nameParts: [productName, tagName],
      workspace: productDescriptor.workspace,
      ...(tagEntry.scope ? { targetScope: tagEntry.scope } : {}),
    };
    const targetDescriptor: ResourceDescriptor = {
      type: ResourceType.Tag,
      nameParts: [tagName],
      workspace: productDescriptor.workspace,
    };
    const eligibility = await evaluateAssociationEligibility(
      store,
      targetDescriptor,
      config,
      allowedDescriptors
    );
    const deployedDescriptor = config.envMapping
      ? mapDescriptor(descriptor, config.envMapping)
      : descriptor;
    const deployedProductName = config.envMapping
      ? toDeployedName(productName, ResourceType.Product, config.envMapping)
      : productName;
    const payload = workspaceScoped && linkProperty
      ? buildLinkPayload(
          context,
          linkProperty,
          'products',
          deployedProductName,
          deployedDescriptor.workspace
        )
      : {};
    tagPlans.push({
      descriptor,
      deployedDescriptor,
      target: targetDescriptor,
      payload,
      ...eligibility,
    });
  }

  const seen = new Set<string>();
  return [...apiPlans, ...groupPlans, ...tagPlans].filter((plan) => {
    const key = getResourceDescriptorKey(plan.descriptor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function planProductPolicyPublication(
  store: IArtifactStore,
  productDescriptor: ResourceDescriptor,
  config: PublishConfig,
  allowedDescriptors?: ResourceDescriptor[]
): Promise<ProductPolicyPublicationPlan | undefined> {
  const descriptor: ResourceDescriptor = {
    type: ResourceType.ProductPolicy,
    nameParts: [getNamePart(productDescriptor.nameParts, 0)],
    workspace: productDescriptor.workspace,
  };
  const content = await store.readContent(config.sourceDir, descriptor, 'policy');
  if (!content) {
    return undefined;
  }
  return {
    descriptor,
    eligible: isDescriptorAllowed(descriptor, config, allowedDescriptors),
  };
}

async function publishProductAssociationPlans(
  client: IApimClient,
  context: ApimServiceContext,
  plans: ProductAssociationPublicationPlan[]
): Promise<ResourcePublishResult[]> {
  const results: ResourcePublishResult[] = [];
  for (const plan of plans) {
    if (!plan.eligible) {
      logger.warn(
        `Skipping ${plan.descriptor.type} association "${plan.descriptor.nameParts.join('/')}": ${plan.reason}`
      );
      results.push({
        descriptor: plan.descriptor,
        status: 'skipped',
        action: 'noop',
      });
      continue;
    }

    try {
      await client.putResource(context, plan.deployedDescriptor, plan.payload);
      logger.debug(
        `Created ${plan.descriptor.type} association: ${plan.descriptor.nameParts.join('/')}`
      );
      results.push({
        descriptor: plan.descriptor,
        status: 'success',
        action: 'put',
      });
    } catch (error) {
      if (isLinkAlreadyExistsError(error)) {
        logger.debug(
          `${plan.descriptor.type} association already exists: ${plan.descriptor.nameParts.join('/')}`
        );
        results.push({
          descriptor: plan.descriptor,
          status: 'success',
          action: 'put',
        });
        continue;
      }
      logger.warn(
        `Failed to create ${plan.descriptor.type} association ${plan.descriptor.nameParts.join('/')}: ${String(error)}`
      );
      results.push({
        descriptor: plan.descriptor,
        status: 'failed',
        action: 'put',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  return results;
}

function isDescriptorAllowed(
  descriptor: ResourceDescriptor,
  config: PublishConfig,
  allowedDescriptors?: ResourceDescriptor[]
): boolean {
  if (!allowedDescriptors) {
    return true;
  }

  if (allowedDescriptors.some((allowed) => sameResourceDescriptor(allowed, descriptor))) {
    return true;
  }

  // Incremental mode only diffs changed files; an unchanged product policy
  // can still need republishing when its product does.
  return config.commitId !== undefined;
}
