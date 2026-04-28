/**
 * T023: Product-specific extraction logic
 * Product associations (apis.json, groups.json), product policies, product wikis.
 */

import { IApimClient } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { FilterConfig } from '../models/config.js';
import { extractResourceType, extractResourceName, ExtractedResource } from './resource-extractor.js';
import { logger } from '../lib/logger.js';
import { getNamePart } from '../lib/resource-path.js';

/**
 * Result of product-specific extraction for a single product.
 */
export interface ProductExtractionResult {
  productName: string;
  apis: string[];
  groups: string[];
  policy: string | undefined;
  wiki: boolean;
  tags: ExtractedResource[];
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
  filter?: FilterConfig,
  workspace?: string
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

  // Extract product tags
  const tagResult = await extractResourceType(
    client, store, context, ResourceType.ProductTag,
    outputDir, filter, productDescriptor, workspace
  );
  result.tags = tagResult.extracted;

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
  const names: string[] = [];
  const resourceType = associationType === 'apis'
    ? ResourceType.ProductApi
    : ResourceType.ProductGroup;

  try {
    const resources = client.listResources(context, resourceType, productDescriptor);

    for await (const json of resources) {
      try {
        const name = extractResourceName(json);
        names.push(name);
      } catch (error) {
        logger.warn(`Failed to extract ${associationType} association name: ${(error as Error).message}`);
      }
    }

    // Write association file
    if (names.length > 0) {
      await store.writeAssociation(outputDir, productDescriptor, associationType, names);
      logger.info(`Extracted ${names.length} ${associationType} for product "${getNamePart(productDescriptor.nameParts, 0)}"`);
    }
  } catch (error) {
    logger.warn(`Failed to list ${associationType} for product "${getNamePart(productDescriptor.nameParts, 0)}": ${(error as Error).message}`);
  }

  return names;
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
