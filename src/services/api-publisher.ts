/**
 * T032: API publisher with revision handling
 * Create root API first, then revisions in numeric order with forced revision numbers.
 * Publish operations, policies, schemas, releases, resolvers, tag descriptions, wikis per FR-024.
 * Handle SOAP/WSDL import via ?import=true&format=wsdl-link query parameter.
 */

import type { IApimClient } from '../clients/iapim-client.js';
import type { IArtifactStore } from '../clients/iartifact-store.js';
import type { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import type { PublishConfig } from '../models/config.js';
import { ResourceType } from '../models/resource-types.js';
import { publishResource, type ResourcePublishResult } from './resource-publisher.js';
import { runParallel } from '../lib/parallel-runner.js';
import { applyOverrides } from './override-merger.js';
import { logger } from '../lib/logger.js';
import { getNamePart } from '../lib/resource-path.js';

/**
 * API child resource types that should be published after the API itself
 */
const API_CHILD_TYPES: ResourceType[] = [
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
];

/**
 * Publish an API with all its revisions and child resources.
 * Creates root API first, then revisions in numeric order.
 * Handles SOAP/WSDL import via ?import=true&format=wsdl-link.
 */
export async function publishApi(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  config: PublishConfig
): Promise<ResourcePublishResult> {
  try {
    // Step 1: Publish root API (with spec import if available)
    const rootResult = await publishRootApi(client, store, context, descriptor, config);
    if (rootResult.status !== 'success') {
      return rootResult;
    }

    // Step 2: Find and publish revisions in numeric order
    await publishApiRevisions(client, store, context, descriptor, config);

    // Step 3: Publish child resources in parallel
    // When a spec was imported, operations and schemas are auto-created by APIM
    await publishApiChildren(client, store, context, descriptor, config, rootResult.specImported);

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

/**
 * Maps spec file format to APIM ContentFormat for inline import.
 */
function getImportFormat(specFormat: string, _apiType?: string): string | undefined {
  switch (specFormat) {
    case 'yaml':
      return 'openapi';
    case 'json':
      // Swagger 2.0 uses swagger-json, OpenAPI 3.x uses openapi+json.
      // Default to openapi+json as the more modern format — APIM accepts both.
      return 'openapi+json';
    case 'wsdl':
      return 'wsdl';
    case 'wadl':
      return 'wadl-xml';
    case 'graphql':
      // GraphQL schemas are managed via the ApiSchema resource, not via
      // the import properties. Return undefined so we skip injection.
      return undefined;
    default:
      return undefined;
  }
}

interface RootApiResult {
  status: 'success' | 'skipped';
  specImported: boolean;
}

/**
 * Publish the root API (apiInformation.json).
 * When a specification file exists alongside the API metadata, injects
 * `properties.format` and `properties.value` into the PUT body so APIM
 * imports the spec and auto-creates operations + schemas.
 */
async function publishRootApi(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  config: PublishConfig
): Promise<RootApiResult & ResourcePublishResult> {
  let json = await store.readResource(config.sourceDir, descriptor);
  if (!json) {
    return {
      descriptor,
      status: 'skipped',
      action: 'noop',
      specImported: false,
    };
  }

  // Apply overrides
  json = applyOverrides(descriptor, json, config.overrides);

  // Try to read the specification file for this API
  let specImported = false;
  const specResult = await store.readContent(config.sourceDir, descriptor, 'specification');
  if (specResult) {
    const properties = json.properties as Record<string, unknown> | undefined;
    const apiType = properties?.type as string | undefined;
    const importFormat = getImportFormat(specResult.format ?? 'yaml', apiType);

    if (importFormat) {
      // Strip null-valued properties that cause validation errors in
      // APIM's spec-import mode (e.g. "backendId": null → HTTP 400).
      const cleanProps: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(properties ?? {})) {
        if (val !== null) {
          cleanProps[key] = val;
        }
      }

      // Inject the spec into the PUT body for APIM to import
      json = {
        ...json,
        properties: {
          ...cleanProps,
          format: importFormat,
          value: specResult.content,
        },
      };
      specImported = true;
      logger.info(`Including ${specResult.format} specification in API import for "${getNamePart(descriptor.nameParts, 0)}"`);
    }
  }

  // PUT the API resource to APIM
  await client.putResource(context, descriptor, json);

  return {
    descriptor,
    status: 'success',
    action: 'put',
    specImported,
  };
}

/**
 * Find and publish API revisions in numeric order
 */
async function publishApiRevisions(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  config: PublishConfig
): Promise<void> {
  // List all resources from store
  const allDescriptors = await store.listResources(config.sourceDir);

  // Find revision descriptors for this API
  const revisionDescriptors = allDescriptors.filter(
    (d) =>
      d.type === ResourceType.Api &&
      getNamePart(d.nameParts, 0).startsWith(`${getNamePart(apiDescriptor.nameParts, 0)};rev=`)
  );

  // Sort revisions by revision number
  const sortedRevisions = revisionDescriptors.sort((a, b) => {
    const revA = extractRevisionNumber(getNamePart(a.nameParts, 0));
    const revB = extractRevisionNumber(getNamePart(b.nameParts, 0));
    return revA - revB;
  });

  // Publish each revision in order
  for (const revDescriptor of sortedRevisions) {
    await publishResource(client, store, context, revDescriptor, config);
  }
}

/**
 * Resource types that are auto-created by APIM when importing a spec.
 * These should be skipped when a specification was included in the API PUT.
 */
const SPEC_MANAGED_CHILD_TYPES = new Set<ResourceType>([
  ResourceType.ApiSchema,
  ResourceType.ApiOperation,
]);

/**
 * Publish all child resources of an API in parallel.
 * When specImported is true, skips ApiSchema and ApiOperation since APIM
 * auto-creates those from the imported specification.
 */
async function publishApiChildren(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  config: PublishConfig,
  specImported: boolean = false
): Promise<void> {
  // List all resources from store
  const allDescriptors = await store.listResources(config.sourceDir);

  // Find child descriptors for this API
  const childDescriptors = allDescriptors.filter(
    (d) =>
      API_CHILD_TYPES.includes(d.type) &&
      getNamePart(d.nameParts, 0) === getNamePart(apiDescriptor.nameParts, 0) &&
      !(specImported && SPEC_MANAGED_CHILD_TYPES.has(d.type))
  );

  // Publish in parallel with concurrency limit
  const tasks = childDescriptors.map(
    (childDescriptor) => () =>
      publishResource(client, store, context, childDescriptor, config)
  );

  await runParallel(tasks, 5);
}

/**
 * Extract revision number from API name (e.g., "my-api;rev=2" -> 2)
 */
function extractRevisionNumber(apiName: string): number {
  const match = /;rev=(\d+)/.exec(apiName);
  return match ? parseInt(match[1], 10) : 0;
}
