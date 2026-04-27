/**
 * T021: Resource type extractor
 * Generic extract logic: list resources via IApimClient, write each to IArtifactStore.
 * Handles all 33 types using ResourceType metadata. Preserves opaque JSON per FR-009.
 */

import { IApimClient } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { redactSecrets } from './secret-redactor.js';
import { shouldIncludeResource } from './filter-service.js';
import { FilterConfig } from '../models/config.js';
import { logger } from '../lib/logger.js';
import { buildResourceLabel } from '../lib/resource-uri.js';

/**
 * Result of extracting a single resource.
 */
export interface ExtractedResource {
  descriptor: ResourceDescriptor;
  json: Record<string, unknown>;
  status: 'success' | 'error';
  error?: string;
}

/**
 * Result of extracting all resources of a given type.
 */
export interface TypeExtractionResult {
  type: ResourceType;
  extracted: ExtractedResource[];
  totalCount: number;
  errorCount: number;
}

/**
 * Extract the ARM resource name from a raw JSON object.
 * ARM resources have a 'name' field at the top level.
 */
export function extractResourceName(json: Record<string, unknown>): string {
  const name = json.name as string | undefined;
  if (!name) {
    throw new Error('Resource JSON missing required "name" field');
  }
  return name;
}

/**
 * Extract all resources of a given type from APIM and write to artifact store.
 *
 * @param client - APIM REST client
 * @param store - Artifact file store
 * @param context - APIM service context
 * @param type - Resource type to extract
 * @param outputDir - Output directory
 * @param filter - Optional filter config
 * @param parent - Parent descriptor for child resources
 * @param workspace - Optional workspace name
 * @returns Extraction result
 */
export async function extractResourceType(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  type: ResourceType,
  outputDir: string,
  filter?: FilterConfig,
  parent?: ResourceDescriptor,
  workspace?: string
): Promise<TypeExtractionResult> {
  const result: TypeExtractionResult = {
    type,
    extracted: [],
    totalCount: 0,
    errorCount: 0,
  };

  try {
    const resources = client.listResources(context, type, parent);

    for await (const json of resources) {
      result.totalCount++;

      let descriptor: ResourceDescriptor | undefined;
      try {
        const name = extractResourceName(json);
        descriptor = buildDescriptor(type, name, parent, workspace);

        // Apply filter
        if (!shouldIncludeResource(descriptor, filter)) {
          logger.debug(`Filtered out ${buildResourceLabel(descriptor)}`);
          continue;
        }

        // Apply secret redaction
        const safeJson = redactSecrets(descriptor, json);

        // Write to artifact store (preserves opaque JSON per FR-009)
        await store.writeResource(outputDir, descriptor, safeJson);

        result.extracted.push({
          descriptor,
          json: safeJson,
          status: 'success',
        });

        logger.info(`Extracted ${buildResourceLabel(descriptor)}`);
      } catch (error) {
        result.errorCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const failedDescriptor = descriptor ?? buildDescriptor(type, 'unknown', parent, workspace);
        logger.error(`Failed to extract ${buildResourceLabel(failedDescriptor)}: ${errorMessage}`);
        result.extracted.push({
          descriptor: failedDescriptor,
          json: {},
          status: 'error',
          error: errorMessage,
        });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to list ${type}: ${errorMessage}`);
    result.errorCount++;
  }

  return result;
}

/**
 * Extract a single resource by descriptor and write to artifact store.
 */
export async function extractSingleResource(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  outputDir: string
): Promise<ExtractedResource> {
  try {
    const json = await client.getResource(context, descriptor);

    if (!json) {
      return {
        descriptor,
        json: {},
        status: 'error',
        error: `Resource not found: ${descriptor.type} "${descriptor.name}"`,
      };
    }

    // Apply secret redaction
    const safeJson = redactSecrets(descriptor, json);

    // Write to artifact store
    await store.writeResource(outputDir, descriptor, safeJson);

    logger.info(`Extracted ${buildResourceLabel(descriptor)}`);

    return { descriptor, json: safeJson, status: 'success' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to extract ${buildResourceLabel(descriptor)}: ${errorMessage}`);
    return { descriptor, json: {}, status: 'error', error: errorMessage };
  }
}

/**
 * Build a ResourceDescriptor for a given type, name, optional parent, and workspace.
 */
function buildDescriptor(
  type: ResourceType,
  name: string,
  parent?: ResourceDescriptor,
  workspace?: string
): ResourceDescriptor {
  const descriptor: ResourceDescriptor = { type, name, workspace };

  // Set parent based on resource type hierarchy
  if (parent) {
    switch (type) {
      // API children — parent is API name
      case ResourceType.ApiPolicy:
      case ResourceType.ApiTag:
      case ResourceType.ApiDiagnostic:
      case ResourceType.ApiOperation:
      case ResourceType.ApiSchema:
      case ResourceType.ApiRelease:
      case ResourceType.ApiTagDescription:
      case ResourceType.ApiWiki:
      case ResourceType.GraphQLResolver:
        descriptor.parent = parent.name;
        break;

      // Operation children — grandparent is API, parent is operation
      case ResourceType.ApiOperationPolicy:
        descriptor.grandparent = parent.parent;
        descriptor.parent = parent.name;
        break;

      // Resolver children — grandparent is API, parent is resolver
      case ResourceType.GraphQLResolverPolicy:
        descriptor.grandparent = parent.parent;
        descriptor.parent = parent.name;
        break;

      // Product children — parent is product name
      case ResourceType.ProductPolicy:
      case ResourceType.ProductApi:
      case ResourceType.ProductGroup:
      case ResourceType.ProductTag:
      case ResourceType.ProductWiki:
        descriptor.parent = parent.name;
        break;

      // Gateway children
      case ResourceType.GatewayApi:
        descriptor.parent = parent.name;
        break;

      default:
        break;
    }
  }

  return descriptor;
}

/**
 * Check if a resource type is a singleton (no list, only get).
 * E.g., ServicePolicy is always "policy", ApiWiki is "default".
 */
export function isSingletonType(type: ResourceType): boolean {
  return type === ResourceType.ServicePolicy ||
    type === ResourceType.ApiWiki ||
    type === ResourceType.ProductWiki;
}

/**
 * Check if a resource type is a child type requiring a parent.
 */
export function isChildType(type: ResourceType): boolean {
  const childTypes: ResourceType[] = [
    ResourceType.ApiPolicy,
    ResourceType.ApiTag,
    ResourceType.ApiDiagnostic,
    ResourceType.ApiOperation,
    ResourceType.ApiOperationPolicy,
    ResourceType.ApiSchema,
    ResourceType.ApiRelease,
    ResourceType.ApiTagDescription,
    ResourceType.ApiWiki,
    ResourceType.GraphQLResolver,
    ResourceType.GraphQLResolverPolicy,
    ResourceType.ProductPolicy,
    ResourceType.ProductApi,
    ResourceType.ProductGroup,
    ResourceType.ProductTag,
    ResourceType.ProductWiki,
    ResourceType.GatewayApi,
  ];
  return childTypes.includes(type);
}
