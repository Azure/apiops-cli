// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Product-specific extraction logic
 * Product associations (apis.json, groups.json, tags.json), product policies, product wikis.
 */

import { IApimClient } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ApimServiceContext, AssociationEntry, ResourceDescriptor } from '../models/types.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { FilterConfig } from '../models/config.js';
import { extractResourceName } from './resource-extractor.js';
import { logger } from '../lib/logger.js';
import { getNamePart } from '../lib/resource-path.js';
import { isWorkspaceScope, extractNameFromLink, extractLinkTarget } from '../lib/workspace-link.js';

/**
 * Result of product-specific extraction for a single product.
 */
export interface ProductExtractionResult {
  productName: string;
  apis: string[];
  groups: string[];
  policy: string | undefined;
  wiki: boolean;
  tags: string[];
  policies: string[];
}

/**
 * Extract all product-specific resources for a single product.
 * This includes API associations, group associations, policies, and wikis.
 */
export async function extractProductResources(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor,
  outputDir: string,
  _filter?: FilterConfig,
  _workspace?: string
): Promise<ProductExtractionResult> {
  const productName = getNamePart(productDescriptor.nameParts, 0);
  const result: ProductExtractionResult = {
    productName,
    apis: [],
    groups: [],
    policy: undefined,
    wiki: false,
    tags: [],
    policies: [],
  };

  // Extract product API associations
  result.apis = await extractProductAssociations(
    client, store, context, productDescriptor, outputDir, 'apis'
  );

  // Extract product group associations
  result.groups = await extractProductAssociations(
    client, store, context, productDescriptor, outputDir, 'groups'
  );

  // Extract product policy
  result.policy = await extractProductPolicy(
    client, store, context, productDescriptor, outputDir
  );
  if (result.policy) {
    result.policies.push(result.policy);
  }

  // Extract product wiki
  result.wiki = await extractProductWiki(
    client, store, context, productDescriptor, outputDir
  );

  // Extract product tags - store as tags.json association file.
  // In workspace scope, ProductTag uses `tags/{tag}/productLinks` (inverted
  // parent-child) which is handled separately by extractWorkspaceProductTags()
  // in the workspace extractor.
  if (!isWorkspaceScope(context)) {
    result.tags = await extractProductTags(
      client, store, context, productDescriptor, outputDir
    );
  }

  return result;
}

/**
 * Extract product association (apis or groups) and write to artifact store.
 */
async function extractProductAssociations(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor,
  outputDir: string,
  associationType: 'apis' | 'groups'
): Promise<string[]> {
  const entries: AssociationEntry[] = [];
  const resourceType = associationType === 'apis'
    ? ResourceType.ProductApi
    : ResourceType.ProductGroup;

  try {
    const resources = client.listResources(context, resourceType, productDescriptor);
    const workspaceScoped = isWorkspaceScope(context);
    const linkProperty = RESOURCE_TYPE_METADATA[resourceType].workspaceLinkIdProperty;

    for await (const json of resources) {
      try {
        if (workspaceScoped && linkProperty) {
          // Workspace link responses have an opaque link ID as `name` and
          // the actual resource ARM ID in `properties.<linkProperty>`.
          // Capture the linked resource's scope (service vs workspace) so
          // publish can rebuild the link target at the correct scope — e.g.
          // a workspace product linking the service-level `administrators` group.
          const target = extractLinkTarget(json, linkProperty);
          if (!target) {
            logger.warn(`Failed to extract ${associationType} link target from workspace link response`);
            continue;
          }
          entries.push({ name: target.name, scope: target.scope });
        } else {
          entries.push({ name: extractResourceName(json) });
        }
      } catch (error) {
        logger.warn(`Failed to extract ${associationType} association name: ${(error as Error).message}`);
      }
    }

    // Write association file
    if (entries.length > 0) {
      await store.writeAssociation(outputDir, productDescriptor, associationType, entries);
      logger.info(`Extracted ${entries.length} ${associationType} for product "${getNamePart(productDescriptor.nameParts, 0)}"`);
    }
  } catch (error) {
    logger.warn(`Failed to list ${associationType} for product "${getNamePart(productDescriptor.nameParts, 0)}": ${(error as Error).message}`);
  }

  return entries.map(entry => entry.name);
}

/**
 * Extract product tags and write to artifact store as tags.json.
 * Only used in service scope; workspace scope is handled by extractWorkspaceProductTags().
 */
async function extractProductTags(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor,
  outputDir: string
): Promise<string[]> {
  const entries: AssociationEntry[] = [];
  const workspaceScoped = isWorkspaceScope(context);
  const linkProperty = RESOURCE_TYPE_METADATA[ResourceType.ProductTag].workspaceLinkIdProperty;

  try {
    const resources = client.listResources(context, ResourceType.ProductTag, productDescriptor);

    for await (const json of resources) {
      try {
        if (workspaceScoped && linkProperty) {
          const target = extractLinkTarget(json, linkProperty);
          if (!target) {
            logger.warn('Failed to extract tag name from workspace link response');
            continue;
          }
          entries.push({ name: target.name, scope: target.scope });
        } else {
          entries.push({ name: extractResourceName(json) });
        }
      } catch (error) {
        logger.warn(`Failed to extract tag name: ${(error as Error).message}`);
      }
    }

    // Write tags association file
    if (entries.length > 0) {
      await store.writeAssociation(outputDir, productDescriptor, 'tags', entries);
      logger.info(`Extracted ${entries.length} tags for product "${getNamePart(productDescriptor.nameParts, 0)}"`);
    }
  } catch (error) {
    logger.warn(`Failed to list tags for product "${getNamePart(productDescriptor.nameParts, 0)}": ${(error as Error).message}`);
  }

  return entries.map(entry => entry.name);
}

/**
 * Extract product-level policy.
 */
async function extractProductPolicy(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor,
  outputDir: string
): Promise<string | undefined> {
  const policyDescriptor: ResourceDescriptor = {
    type: ResourceType.ProductPolicy,
    nameParts: [...productDescriptor.nameParts],
    workspace: productDescriptor.workspace,
  };

  const policyJson = await client.getResource(context, policyDescriptor);
  if (!policyJson) {
    return undefined;
  }

  const properties = policyJson.properties as Record<string, unknown> | undefined;
  const policyContent = properties?.value as string | undefined;

  if (policyContent) {
    await store.writeContent(outputDir, policyDescriptor, policyContent, 'policy');
    logger.debug(`Extracted policy for product "${getNamePart(productDescriptor.nameParts, 0)}"`);
    return policyContent;
  }

  return undefined;
}

/**
 * Extract product wiki.
 */
async function extractProductWiki(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  productDescriptor: ResourceDescriptor,
  outputDir: string
): Promise<boolean> {
  try {
    const wikiDescriptor: ResourceDescriptor = {
      type: ResourceType.ProductWiki,
      nameParts: [...productDescriptor.nameParts],
      workspace: productDescriptor.workspace,
    };

    const wikiJson = await client.getResource(context, wikiDescriptor);
    if (!wikiJson) {
      return false;
    }

    await store.writeResource(outputDir, wikiDescriptor, wikiJson);
    logger.info(`Extracted wiki for product "${getNamePart(productDescriptor.nameParts, 0)}"`);
    return true;
  } catch (error) {
    logger.debug(`No wiki for product "${getNamePart(productDescriptor.nameParts, 0)}": ${(error as Error).message}`);
    return false;
  }
}

/**
 * Extract product tag associations in workspace scope using the tag-centric
 * `tags/{tag}/productLinks` endpoint.
 *
 * In workspace scope the classic `products/{product}/tags` endpoint is
 * undocumented and at risk of future removal. Instead, tag-to-product
 * associations are exposed via each tag's `productLinks` collection.
 *
 * @param client - APIM REST client
 * @param store - Artifact file store
 * @param context - Workspace-scoped APIM context
 * @param extractedTagNames - Tag names already extracted for this workspace
 * @param extractedProducts - Extracted product descriptors
 * @param outputDir - Output directory
 * @param workspace - Workspace name
 * @returns Number of product-tag associations discovered
 */
export async function extractWorkspaceProductTags(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  extractedTagNames: string[],
  extractedProducts: Array<{ descriptor: ResourceDescriptor }>,
  outputDir: string,
  _workspace: string
): Promise<number> {
  const linkProperty = RESOURCE_TYPE_METADATA[ResourceType.ProductTag].workspaceLinkIdProperty;
  if (!linkProperty) {
    return 0;
  }

  // Build a map of product name → tags for that product
  const productTagsMap = new Map<string, string[]>();

  for (const tagName of extractedTagNames) {
    // Do NOT set workspace on this descriptor — context.baseUrl already includes
    // the workspace prefix and buildArmUri would double it.
    const tagDescriptor: ResourceDescriptor = {
      type: ResourceType.Tag,
      nameParts: [tagName],
    };

    try {
      for await (const linkJson of client.listResources(context, ResourceType.ProductTag, tagDescriptor)) {
        const productName = extractNameFromLink(linkJson, linkProperty);
        if (!productName) {
          logger.warn(`Failed to extract product name from tag "${tagName}" productLink response`);
          continue;
        }

        if (!productTagsMap.has(productName)) {
          productTagsMap.set(productName, []);
        }
        productTagsMap.get(productName)!.push(tagName);
      }
    } catch (error) {
      logger.warn(`Failed to list productLinks for tag "${tagName}": ${(error as Error).message}`);
    }
  }

  // Write tags.json for each product that has tag associations
  let count = 0;
  for (const product of extractedProducts) {
    const productName = getNamePart(product.descriptor.nameParts, 0);
    const tags = productTagsMap.get(productName);
    if (tags && tags.length > 0) {
      // Tags discovered here are workspace tags (listed within workspace scope).
      const entries: AssociationEntry[] = tags.map(name => ({ name, scope: 'workspace' }));
      await store.writeAssociation(outputDir, product.descriptor, 'tags', entries);
      logger.info(`Extracted ${tags.length} tags for workspace product "${productName}"`);
      count += tags.length;
    }
  }

  return count;
}
