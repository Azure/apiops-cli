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
import { publishResource, type ResourcePublishResult } from './resource-publisher.js';
import { logger } from '../lib/logger.js';
import { getNamePart } from '../lib/resource-path.js';
import { parseArmUri } from '../lib/resource-uri.js';
import { isWorkspaceScope, buildLinkPayload } from '../lib/workspace-link.js';
import { isLinkAlreadyExistsError } from '../clients/apim-client.js';

/**
 * Publish a Product with all its associations (APIs, Groups, Tags).
 * Creates product first, then publishes associations.
 */
export async function publishProduct(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  config: PublishConfig
): Promise<ResourcePublishResult> {
  try {
    const productName = getNamePart(descriptor.nameParts, 0);
    const productExisted = (await client.getResource(context, descriptor)) !== undefined;
    
    // Step 1: Publish the Product itself
    const productResult = await publishResource(client, store, context, descriptor, config);
    if (productResult.status !== 'success') {
      return productResult;
    }

    if (!productExisted) {
      await cleanupAutoCreatedProductResources(client, context, descriptor);
    }

    // Step 2: Publish ProductApi associations
    await publishProductAssociations(
      client,
      store,
      context,
      descriptor,
      config,
      'apis',
      ResourceType.ProductApi
    );

    // Step 3: Publish ProductGroup associations
    await publishProductAssociations(
      client,
      store,
      context,
      descriptor,
      config,
      'groups',
      ResourceType.ProductGroup
    );

    // Step 4: Publish ProductTag associations
    // Tags are stored in the product directory, need to check for tags
    await publishProductTags(client, store, context, descriptor, config);

    // Step 5: Publish ProductPolicy if exists
    const policyDescriptor: ResourceDescriptor = {
      type: ResourceType.ProductPolicy,
      nameParts: [productName],
      workspace: descriptor.workspace,
    };
    const policyContent = await store.readContent(config.sourceDir, policyDescriptor, 'policy');
    if (policyContent) {
      await publishResource(client, store, context, policyDescriptor, config);
      logger.debug(`Published policy for product: ${productName}`);
    }

    logger.info(`Published product with associations: ${productName}`);
    return {
      descriptor,
      status: 'success',
      action: 'put',
    };
  } catch (error) {
    return {
      descriptor,
      status: 'failed',
      action: 'noop',
      error: error instanceof Error ? error : new Error(String(error)),
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
async function publishProductAssociations(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor,
  config: PublishConfig,
  associationType: 'apis' | 'groups',
  resourceType: ResourceType
): Promise<void> {
  const productName = getNamePart(productDescriptor.nameParts, 0);
  
  // Read association file
  const entries = await store.readAssociation(
    config.sourceDir,
    productDescriptor,
    associationType
  );

  if (entries.length === 0) {
    logger.debug(`No ${associationType} associations for product: ${productName}`);
    return;
  }

  const workspaceScoped = !!productDescriptor.workspace || isWorkspaceScope(context);
  const meta = RESOURCE_TYPE_METADATA[resourceType];
  const linkProperty = meta.workspaceLinkIdProperty;
  // Map association type to the ARM resource type segment for building ARM IDs
  const resourceTypeSegment = associationType === 'apis' ? 'apis' : 'groups';

  // Create association for each name
  for (const entry of entries) {
    const name = entry.name;
    const assocDescriptor: ResourceDescriptor = {
      type: resourceType,
      nameParts: [productName, name],
      workspace: productDescriptor.workspace,
    };
    
    try {
      // In workspace scope, PUT with link payload; otherwise empty body.
      // Honor the stored scope so service-level link targets (e.g. the built-in
      // `administrators` group) are referenced at service scope rather than
      // being rebuilt as a non-existent workspace resource.
      let payload: Record<string, unknown> = {};
      if (workspaceScoped && linkProperty) {
        payload = buildLinkPayload(context, linkProperty, resourceTypeSegment, name, productDescriptor.workspace, entry.scope);
      }
      await client.putResource(context, assocDescriptor, payload);
      logger.debug(`Created ${resourceType} association: ${productName}/${name}`);
    } catch (error) {
      if (isLinkAlreadyExistsError(error)) {
        logger.debug(`${resourceType} association already exists: ${productName}/${name}`);
        continue;
      }
      logger.warn(`Failed to create ${resourceType} association ${productName}/${name}: ${String(error)}`);
    }
  }
}

/**
 * Publish ProductTag associations for a product.
 * Tags are stored in tags.json similar to apis.json and groups.json.
 * In workspace scope, uses `tags/{tag}/productLinks/{linkId}` endpoint.
 */
async function publishProductTags(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor,
  config: PublishConfig
): Promise<void> {
  const productName = getNamePart(productDescriptor.nameParts, 0);
  
  // Read tags from tags.json association file
  const tagEntries = await store.readAssociation(
    config.sourceDir,
    productDescriptor,
    'tags'
  );
  
  if (tagEntries.length === 0) {
    logger.debug(`No tag associations for product: ${productName}`);
    return;
  }

  const workspaceScoped = !!productDescriptor.workspace || isWorkspaceScope(context);
  const linkProperty = RESOURCE_TYPE_METADATA[ResourceType.ProductTag].workspaceLinkIdProperty;

  // Create association for each tag
  for (const tagEntry of tagEntries) {
    const tagName = tagEntry.name;
    const tagDescriptor: ResourceDescriptor = {
      type: ResourceType.ProductTag,
      nameParts: [productName, tagName],
      workspace: productDescriptor.workspace,
    };
    
    try {
      // The workspace ProductTag link references the product (productId), which
      // always lives in the workspace, so the link payload is workspace-scoped.
      let payload: Record<string, unknown> = {};
      if (workspaceScoped && linkProperty) {
        payload = buildLinkPayload(context, linkProperty, 'products', productName, productDescriptor.workspace);
      }
      await client.putResource(context, tagDescriptor, payload);
      logger.debug(`Created ProductTag association: ${productName}/${tagName}`);
    } catch (error) {
      if (isLinkAlreadyExistsError(error)) {
        logger.debug(`ProductTag association already exists: ${productName}/${tagName}`);
        continue;
      }
      logger.warn(`Failed to create ProductTag association ${productName}/${tagName}: ${String(error)}`);
    }
  }
  
  logger.info(`Published ${tagEntries.length} tags for product: ${productName}`);
}
