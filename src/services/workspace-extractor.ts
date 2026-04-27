/**
 * T027: Workspace-scoped extraction
 * List workspaces, extract workspace-scoped resources under workspaces/{name}/
 * using same resource-extractor with workspace context prefix.
 */

import { IApimClient } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ApimServiceContext } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { FilterConfig } from '../models/config.js';
import { extractResourceType } from './resource-extractor.js';
import { extractApiResources } from './api-extractor.js';
import { extractProductResources } from './product-extractor.js';
import { logger } from '../lib/logger.js';

/**
 * Types that can exist at the workspace level.
 * Not all APIM resource types support workspace scoping.
 */
const WORKSPACE_SUPPORTED_TYPES: ResourceType[] = [
  ResourceType.NamedValue,
  ResourceType.Tag,
  ResourceType.Backend,
  ResourceType.Logger,
  ResourceType.Diagnostic,
  ResourceType.PolicyFragment,
  ResourceType.Product,
  ResourceType.Api,
  ResourceType.Subscription,
  ResourceType.GlobalSchema,
  ResourceType.Documentation,
  ResourceType.Group,
];

/**
 * Result of extracting a single workspace.
 */
export interface WorkspaceExtractionResult {
  workspaceName: string;
  resourceCount: number;
  errorCount: number;
}

/**
 * Extract resources from all workspaces.
 *
 * Note: Workspace listing is not supported through the current IApimClient
 * interface (ResourceType doesn't include Workspace). This function accepts
 * workspace names from the filter config. If workspaceNames is not specified
 * in the filter, workspace extraction is skipped.
 *
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
  filter?: FilterConfig
): Promise<WorkspaceExtractionResult[]> {
  const results: WorkspaceExtractionResult[] = [];

  // Workspace names must be explicitly provided via filter config
  // since the IApimClient interface doesn't support listing workspaces
  const workspaceNames = filter?.workspaceNames;
  if (!workspaceNames || workspaceNames.length === 0) {
    logger.debug('No workspace names specified in filter — skipping workspace extraction');
    return results;
  }

  logger.info(`Extracting ${workspaceNames.length} workspace(s)...`);

  for (const wsName of workspaceNames) {
    const wsResult = await extractWorkspace(
      client, store, context, wsName, outputDir, filter
    );
    results.push(wsResult);
  }

  return results;
}

/**
 * Extract all resources from a single workspace.
 */
async function extractWorkspace(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  workspaceName: string,
  outputDir: string,
  filter?: FilterConfig
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

  // Extract each supported resource type within the workspace
  for (const type of WORKSPACE_SUPPORTED_TYPES) {
    try {
      const result = await extractResourceType(
        client, store, wsContext, type,
        outputDir, filter, undefined, workspaceName
      );
      resourceCount += result.extracted.filter((r) => r.status === 'success').length;
      errorCount += result.errorCount;

      // Handle API-specific extraction for APIs in the workspace
      if (type === ResourceType.Api) {
        for (const api of result.extracted) {
          if (api.status !== 'success') continue;
          try {
            const apiResult = await extractApiResources(
              client, store, wsContext, api.descriptor, api.json,
              outputDir, filter, workspaceName
            );
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
        for (const product of result.extracted) {
          if (product.status !== 'success') continue;
          try {
            await extractProductResources(
              client, store, wsContext, product.descriptor,
              outputDir, filter, workspaceName
            );
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

  logger.info(`Workspace "${workspaceName}": extracted ${resourceCount} resources, ${errorCount} errors`);

  return { workspaceName, resourceCount, errorCount };
}
