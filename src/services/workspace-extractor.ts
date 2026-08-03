// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Workspace-scoped extraction
 * List workspaces, extract workspace-scoped resources under workspaces/{name}/
 * using same resource-extractor with workspace context prefix.
 */
import { IApimClient } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { FilterConfig } from '../models/config.js';
import { extractResourceType, ExtractedResource } from './resource-extractor.js';
import { extractApiResources, extractWorkspaceApiTags } from './api-extractor.js';
import { extractProductResources, extractWorkspaceProductTags } from './product-extractor.js';
import { logger } from '../lib/logger.js';
import { getNamePart } from '../lib/resource-path.js';
import {
  isWildcardPattern,
  resolveWorkspaceFilter,
  shouldIncludeResource,
} from './filter-service.js';
import {
  extractTransitiveDependencies,
  type TransitiveResourceArtifact,
} from './transitive-extractor.js';

export { resolveWorkspaceFilter };

/**
 * Types that can exist at the workspace level, derived from RESOURCE_TYPE_METADATA.
 * Enumerated in declaration order for deterministic iteration.
 * A type is workspace-capable when its metadata has `workspaceSupported: true`.
 */
const WORKSPACE_SUPPORTED_TYPES: ResourceType[] = Object.values(ResourceType).filter(
  (type) => RESOURCE_TYPE_METADATA[type].workspaceSupported === true
);

export interface WorkspaceExtractionResult {
  workspaceName: string;
  resourceCount: number;
  errorCount: number;
}

/**
 * Extract resources from all workspaces.
 
 * @param client - APIM REST client
 * @param store - Artifact file store
 * @param context - APIM service context
 * @param outputDir - Output directory
 * @param filter - Optional filter config (workspace names come from here)
 * @returns Results per workspace
 */
export async function extractWorkspaces(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  outputDir: string,
  filter?: FilterConfig,
  includeTransitive: boolean = false
): Promise<WorkspaceExtractionResult[]> {
  const results: WorkspaceExtractionResult[] = [];
  let workspaceNames: string[];

  if (filter?.workspaces !== undefined) {
    // Defined workspace filter: use exactly the specified list.
    // Empty array = exclude all workspaces (extract none).
    if (filter.workspaces.length === 0) {
      logger.debug('Workspace filter is empty array — excluding all workspaces');
      return results;
    }

    const requiresDiscovery = filter.workspaces.some(
      (entry) => isWildcardPattern(entry) || entry.startsWith('!')
    );
    if (requiresDiscovery) {
      // Wildcards and exclusions require discovery so shared filter semantics
      // can be applied against actual workspace names.
      const discovered = await discoverWorkspaceNames(client, context);
      workspaceNames = discovered.filter((name) =>
        shouldIncludeResource(
          { type: ResourceType.Workspace, nameParts: [name] },
          { workspaces: filter.workspaces }
        )
      );

      // Warn about exact (non-wildcard) entries that didn't match any discovered workspace
      for (const entry of filter.workspaces) {
        if (!entry.startsWith('!') && !isWildcardPattern(entry)) {
          const matched = discovered.some((d) => d.toLowerCase() === entry.toLowerCase());
          if (!matched) {
            logger.warn(`Workspace filter entry "${entry}" did not match any discovered workspace`);
          }
        }
      }
    } else {
      workspaceNames = filter.workspaces;
    }
  } else {
    // No workspace filter defined — discover all workspaces
    workspaceNames = await discoverWorkspaceNames(client, context);
  }

  if (workspaceNames.length === 0) {
    logger.debug('No workspaces found — skipping workspace extraction');
    return results;
  }

  logger.info(`Extracting ${workspaceNames.length} workspace(s)...`);

  for (const wsName of workspaceNames) {
    // Persist the workspace container itself so publish can recreate it
    // before workspace-scoped children (named values, APIs, products, etc.).
    const wsDescriptor = { type: ResourceType.Workspace, nameParts: [wsName] };
    const wsJson = await client.getResource(context, wsDescriptor);
    if (!wsJson) {
      logger.error(
        `Workspace container "${wsName}" was discovered but could not be read. Continuing with workspace child extraction.`
      );
    } else {
      await store.writeResource(outputDir, wsDescriptor, wsJson);
    }

    const wsResult = await extractWorkspace(
      client, store, context, wsName, outputDir,
      resolveWorkspaceFilter(wsName, filter),
      includeTransitive
    );
    results.push(wsResult);
  }

  return results;
}

async function extractWorkspace(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  workspaceName: string,
  outputDir: string,
  filter?: FilterConfig,
  includeTransitive: boolean = false
): Promise<WorkspaceExtractionResult> {
  logger.info(`Extracting workspace "${workspaceName}"...`);

  let resourceCount = 0;
  let errorCount = 0;

  // Create workspace-scoped context
  // Workspace resources are accessed via the same base URL but with /workspaces/{name} prefix
  const wsContext: ApimServiceContext = {
    ...context,
    baseUrl: `${context.baseUrl}/workspaces/${encodeURIComponent(workspaceName)}`,
  };

  // Track extracted tags and APIs for workspace-specific ApiTag extraction
  let extractedTagNames: string[] = [];
  const extractedApiNames = new Set<string>();
  let extractedProducts: ExtractedResource[] = [];
  const extractedDescriptors: ResourceDescriptor[] = [];
  const resources: TransitiveResourceArtifact[] = [];
  const policies = new Map<string, string>();
  const apis = new Map<string, Record<string, unknown>>();

  for (const type of WORKSPACE_SUPPORTED_TYPES) {
    try {
      const result = await extractResourceType(
        client, store, wsContext, type,
        outputDir, filter, undefined, workspaceName
      );
      resourceCount += result.extracted.filter((r) => r.status === 'success').length;
      errorCount += result.errorCount;
      for (const extracted of result.extracted) {
        if (extracted.status === 'success') {
          extractedDescriptors.push(extracted.descriptor);
          resources.push({
            descriptor: extracted.descriptor,
            json: extracted.json,
          });
        }
      }

      // Track extracted tags for later ApiTag/ProductTag extraction
      if (type === ResourceType.Tag) {
        extractedTagNames = result.extracted
          .filter((r) => r.status === 'success')
          .map((r) => getNamePart(r.descriptor.nameParts, 0));
      }

      // Handle API-specific extraction for APIs in the workspace
      if (type === ResourceType.Api) {
        for (const api of result.extracted) {
          if (api.status !== 'success') continue;
          extractedApiNames.add(getNamePart(api.descriptor.nameParts, 0));
          try {
            const apiResult = await extractApiResources(
              client, store, wsContext, api.descriptor, api.json,
              outputDir, filter, workspaceName
            );
            const apiName = getNamePart(api.descriptor.nameParts, 0);
            apis.set(apiName, api.json);
            for (let index = 0; index < apiResult.policies.length; index++) {
              const policy = apiResult.policies[index];
              if (policy !== undefined) {
                policies.set(`api:${apiName}:policy:${index}`, policy);
              }
            }
            resourceCount += apiResult.operations.length +
              apiResult.tags.length +
              apiResult.schemas.length;
          } catch (error) {
            logger.warn(`Failed to extract API details for workspace "${workspaceName}": ${(error as Error).message}`);
            errorCount++;
          }
        }
      }

      // Handle product-specific extraction for products in the workspace
      if (type === ResourceType.Product) {
        extractedProducts = result.extracted.filter((r) => r.status === 'success');
        for (const product of extractedProducts) {
          try {
            const productResult = await extractProductResources(
              client, store, wsContext, product.descriptor,
              outputDir, filter, workspaceName
            );
            const productName = getNamePart(product.descriptor.nameParts, 0);
            for (let index = 0; index < productResult.policies.length; index++) {
              const policy = productResult.policies[index];
              if (policy !== undefined) {
                policies.set(`product:${productName}:policy:${index}`, policy);
              }
            }
            resourceCount++;
          } catch (error) {
            logger.warn(`Failed to extract product details for workspace "${workspaceName}": ${(error as Error).message}`);
            errorCount++;
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to extract ${type} from workspace "${workspaceName}": ${(error as Error).message}`);
      errorCount++;
    }
  }

  // Extract workspace API tags using the tag-centric apiLinks endpoint.
  // This must happen after both Tags and APIs are extracted since the
  // workspace scope uses `tags/{tag}/apiLinks` (inverted parent-child).
  if (extractedTagNames.length > 0 && extractedApiNames.size > 0) {
    try {
      const apiTagCount = await extractWorkspaceApiTags(
        client, store, wsContext, extractedTagNames, extractedApiNames,
        outputDir, workspaceName
      );
      resourceCount += apiTagCount;
    } catch (error) {
      logger.warn(`Failed to extract API tags for workspace "${workspaceName}": ${(error as Error).message}`);
      errorCount++;
    }
  }

  // Extract workspace product tags using the tag-centric productLinks endpoint.
  // Similar to ApiTag, workspace ProductTag uses `tags/{tag}/productLinks`.
  if (extractedTagNames.length > 0 && extractedProducts.length > 0) {
    try {
      const productTagCount = await extractWorkspaceProductTags(
        client, store, wsContext, extractedTagNames, extractedProducts,
        outputDir, workspaceName
      );
      resourceCount += productTagCount;
    } catch (error) {
      logger.warn(`Failed to extract product tags for workspace "${workspaceName}": ${(error as Error).message}`);
      errorCount++;
    }
  }

  if (includeTransitive && filter) {
    logger.info(`Resolving transitive dependencies for workspace "${workspaceName}"...`);
    const transitiveResult = await extractTransitiveDependencies(
      client,
      store,
      wsContext,
      outputDir,
      policies,
      apis,
      resources,
      extractedDescriptors,
      workspaceName,
      context
    );
    resourceCount += transitiveResult.extractedDescriptors.length;
    errorCount += transitiveResult.errorCount;
  }

  logger.info(`Workspace "${workspaceName}": extracted ${resourceCount} resources, ${errorCount} errors`);

  return { workspaceName, resourceCount, errorCount };
}

/**
 * Discover all workspace names from APIM.
 */
async function discoverWorkspaceNames(
  client: IApimClient,
  context: ApimServiceContext
): Promise<string[]> {
  const names: string[] = [];
  for await (const item of client.listResources(context, ResourceType.Workspace)) {
    const name = item['name'];
    if (typeof name === 'string') {
      names.push(name);
    }
  }
  return names;
}
