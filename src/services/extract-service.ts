/**
 * T020: Extraction orchestrator
 * Coordinates resource type extraction across dependency tiers
 * using dependency-graph.ts and parallel-runner.ts.
 * Per-resource status output per FR-023.
 */

import { IApimClient } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ExtractConfig, FilterConfig } from '../models/config.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import {
  TIER_1_RESOURCES,
  TIER_2_RESOURCES,
  TIER_3_RESOURCES,
} from '../lib/dependency-graph.js';
import { runParallel } from '../lib/parallel-runner.js';
import {
  extractResourceType,
  TypeExtractionResult,
  isSingletonType,
} from './resource-extractor.js';
import { extractApiResources, ApiExtractionResult } from './api-extractor.js';
import { extractProductResources, ProductExtractionResult } from './product-extractor.js';
import { extractWorkspaces, WorkspaceExtractionResult } from './workspace-extractor.js';
import {
  findTransitiveDependencies,
} from './transitive-resolver.js';
import { logger } from '../lib/logger.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import { EXIT_SUCCESS, EXIT_PARTIAL, EXIT_FATAL } from '../lib/exit-codes.js';
import { getNamePart, getNameFromNameParts } from '../lib/resource-path.js';

/** Maximum concurrency for parallel extraction within a tier */
const DEFAULT_CONCURRENCY = 5;

/**
 * Overall extraction result.
 */
export interface ExtractionResult {
  /** Total resources extracted */
  totalExtracted: number;
  /** Total errors encountered */
  totalErrors: number;
  /** Per-type results */
  typeResults: TypeExtractionResult[];
  /** API-specific results */
  apiResults: ApiExtractionResult[];
  /** Product-specific results */
  productResults: ProductExtractionResult[];
  /** Workspace results */
  workspaceResults: WorkspaceExtractionResult[];
  /** All extracted resource descriptors */
  extractedDescriptors: ResourceDescriptor[];
  /** All policy content collected (for transitive resolution) */
  collectedPolicies: Map<string, string>;
  /** Exit code: 0=success, 1=partial failure, 2=fatal error */
  exitCode: number;
}

/**
 * Run the full extraction orchestration.
 *
 * Extraction proceeds in dependency tiers (1-4), with resources within
 * each tier extracted in parallel. After tier 2, API-specific and
 * product-specific sub-extractions run. Transitive dependency resolution
 * happens after all tiers complete if enabled.
 */
export async function runExtraction(
  client: IApimClient,
  store: IArtifactStore,
  config: ExtractConfig
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    totalExtracted: 0,
    totalErrors: 0,
    typeResults: [],
    apiResults: [],
    productResults: [],
    workspaceResults: [],
    extractedDescriptors: [],
    collectedPolicies: new Map(),
    exitCode: EXIT_SUCCESS,
  };

  const { service, outputDir, filter } = config;

  logger.info(`Starting extraction from ${service.serviceName}...`);
  logger.debug(`Output directory: ${outputDir}`);

  try {
    // Phase 1: Extract Tier 1 resources (no dependencies)
    logger.info('Extracting tier 1 resources (independent)...');
    await extractTier(client, store, service, TIER_1_RESOURCES, outputDir, filter, result);

    // Phase 2: Extract Tier 2 resources (depend on tier 1)
    logger.info('Extracting tier 2 resources...');
    await extractTier(client, store, service, TIER_2_RESOURCES, outputDir, filter, result);

    // Phase 2.5: Extract API-specific and product-specific sub-resources
    await extractApiSubResources(client, store, service, outputDir, filter, result);
    await extractProductSubResources(client, store, service, outputDir, filter, result);

    // Phase 3: Extract Tier 3 child resources
    // Note: Many tier 3 types (ApiTag, ApiDiagnostic, etc.) are extracted as part
    // of API-specific extraction above, so we only extract non-API/product children here
    logger.info('Extracting tier 3 resources...');
    const tier3NonChild = TIER_3_RESOURCES.filter(
      (t) =>
        t === ResourceType.GatewayApi ||
        t === ResourceType.Subscription
    );
    await extractTier(client, store, service, tier3NonChild, outputDir, filter, result);

    // Extract gateway API associations
    await extractGatewayAssociations(client, store, service, outputDir, filter, result);

    // Phase 4: Tier 4 resources are extracted within API-specific extraction
    // (ApiOperationPolicy, GraphQLResolverPolicy are handled in api-extractor)

    // Phase 5: Extract service-level policy
    await extractServicePolicy(client, store, service, outputDir, result);

    // Phase 6: Transitive dependency resolution (if enabled)
    if (config.includeTransitive && filter) {
      await resolveAndExtractTransitive(client, store, service, outputDir, result);
    }

    // Phase 7: Extract workspace-scoped resources
    await extractWorkspaceResources(client, store, service, outputDir, filter, result);

    // Compute exit code
    if (result.totalErrors > 0 && result.totalExtracted > 0) {
      result.exitCode = EXIT_PARTIAL;
    } else if (result.totalErrors > 0 && result.totalExtracted === 0) {
      result.exitCode = EXIT_FATAL;
    }

    logger.info(
      `Extraction complete: ${result.totalExtracted} resources extracted, ${result.totalErrors} errors`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Fatal extraction error: ${errorMessage}`);
    result.exitCode = EXIT_FATAL;
    result.totalErrors++;
  }

  return result;
}

/**
 * Extract all resources of given types in parallel within a tier.
 * Collects results per-task and merges after all tasks complete to avoid
 * concurrent mutations on the shared result object.
 */
async function extractTier(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  types: ResourceType[],
  outputDir: string,
  filter: FilterConfig | undefined,
  result: ExtractionResult
): Promise<void> {
  const tasks = types.map((type) => async (): Promise<TypeExtractionResult | undefined> => {
    // Skip singleton types — they're handled separately
    if (isSingletonType(type)) {
      return undefined;
    }

    return extractResourceType(client, store, context, type, outputDir, filter);
  });

  const taskResults = await runParallel(tasks, DEFAULT_CONCURRENCY);

  // Merge results sequentially after parallel execution completes
  for (const taskResult of taskResults) {
    if (taskResult.status === 'fulfilled' && taskResult.value) {
      const typeResult = taskResult.value;
      result.typeResults.push(typeResult);
      result.totalExtracted += typeResult.extracted.filter((r) => r.status === 'success').length;
      result.totalErrors += typeResult.errorCount;

      for (const res of typeResult.extracted) {
        if (res.status === 'success') {
          result.extractedDescriptors.push(res.descriptor);
        }
      }
    }
  }
}

/**
 * Per-API extraction result with the source API name for policy key generation.
 */
interface ApiTaskResult {
  apiName: string;
  apiResult: ApiExtractionResult;
}

/**
 * Extract API sub-resources (revisions, specs, operations, etc.) for all extracted APIs.
 * Collects results per-task and merges after all tasks complete to avoid
 * concurrent mutations on the shared result object.
 */
async function extractApiSubResources(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  outputDir: string,
  filter: FilterConfig | undefined,
  result: ExtractionResult
): Promise<void> {
  const apiResults = result.typeResults.filter((r) => r.type === ResourceType.Api);

  for (const apiTypeResult of apiResults) {
    const apiTasks = apiTypeResult.extracted
      .filter((r) => r.status === 'success')
      .map((api) => async (): Promise<ApiTaskResult> => {
        const apiResult = await extractApiResources(
          client, store, context, api.descriptor, api.json, outputDir, filter
        );
        return { apiName: getNameFromNameParts(api.descriptor.nameParts), apiResult };
      });

    const taskResults = await runParallel(apiTasks, DEFAULT_CONCURRENCY);

    // Collect the per-API descriptors in the same order as tasks (for error attribution)
    const apis = apiTypeResult.extracted.filter((r) => r.status === 'success');

    // Merge results sequentially after parallel execution completes
    for (let i = 0; i < taskResults.length; i++) {
      const taskResult = taskResults[i];
      if (!taskResult) continue;

      if (taskResult.status === 'rejected') {
        const apiName = buildResourceLabel(apis[i].descriptor);
        logger.error(
          `Failed to extract sub-resources for API "${apiName}": ${taskResult.reason?.message}`
        );
        result.totalErrors++;
        continue;
      }

      if (!taskResult.value) continue;

      const { apiName, apiResult } = taskResult.value;
      result.apiResults.push(apiResult);

      // Count sub-resources
      const subCount =
        apiResult.revisions.filter((r) => r.status === 'success').length +
        (apiResult.specification ? 1 : 0) +
        apiResult.operations.filter((r) => r.status === 'success').length +
        apiResult.operationPolicies.filter((r) => r.status === 'success').length +
        apiResult.tags.filter((r) => r.status === 'success').length +
        apiResult.diagnostics.filter((r) => r.status === 'success').length +
        apiResult.schemas.filter((r) => r.status === 'success').length +
        apiResult.releases.filter((r) => r.status === 'success').length +
        apiResult.tagDescriptions.filter((r) => r.status === 'success').length +
        (apiResult.wiki ? 1 : 0) +
        apiResult.resolvers.filter((r) => r.status === 'success').length +
        apiResult.resolverPolicies.filter((r) => r.status === 'success').length;

      result.totalExtracted += subCount;

      // Collect policies for transitive resolution
      for (let pi = 0; pi < apiResult.policies.length; pi++) {
        const policyContent = apiResult.policies[pi];
        if (policyContent !== undefined) {
          const key = `api:${apiName}:policy:${pi}`;
          result.collectedPolicies.set(key, policyContent);
        }
      }

      // Track sub-resource descriptors
      for (const sub of [
        ...apiResult.operations,
        ...apiResult.operationPolicies,
        ...apiResult.tags,
        ...apiResult.diagnostics,
        ...apiResult.schemas,
        ...apiResult.releases,
        ...apiResult.tagDescriptions,
        ...apiResult.resolvers,
        ...apiResult.resolverPolicies,
      ]) {
        if (sub.status === 'success') {
          result.extractedDescriptors.push(sub.descriptor);
        }
      }
    }
  }
}

/**
 * Per-product extraction result with the source product name for policy key generation.
 */
interface ProductTaskResult {
  productName: string;
  prodResult: ProductExtractionResult;
}

/**
 * Extract product sub-resources for all extracted products.
 * Collects results per-task and merges after all tasks complete to avoid
 * concurrent mutations on the shared result object.
 */
async function extractProductSubResources(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  outputDir: string,
  filter: FilterConfig | undefined,
  result: ExtractionResult
): Promise<void> {
  const productResults = result.typeResults.filter((r) => r.type === ResourceType.Product);

  for (const productTypeResult of productResults) {
    const productTasks = productTypeResult.extracted
      .filter((r) => r.status === 'success')
      .map((product) => async (): Promise<ProductTaskResult> => {
        const prodResult = await extractProductResources(
          client, store, context, product.descriptor, outputDir, filter
        );
        return { productName: getNameFromNameParts(product.descriptor.nameParts), prodResult };
      });

    const taskResults = await runParallel(productTasks, DEFAULT_CONCURRENCY);

    // Collect the per-product descriptors in the same order as tasks (for error attribution)
    const products = productTypeResult.extracted.filter((r) => r.status === 'success');

    // Merge results sequentially after parallel execution completes
    for (let i = 0; i < taskResults.length; i++) {
      const taskResult = taskResults[i];
      if (!taskResult) continue;

      if (taskResult.status === 'rejected') {
        const productName = buildResourceLabel(products[i].descriptor);
        logger.error(
          `Failed to extract sub-resources for product "${productName}": ${taskResult.reason?.message}`
        );
        result.totalErrors++;
        continue;
      }

      if (!taskResult.value) continue;

      const { productName, prodResult } = taskResult.value;
      result.productResults.push(prodResult);

      // Count sub-resources (associations + policy + wiki)
      const subCount =
        (prodResult.apis.length > 0 ? 1 : 0) +
        (prodResult.groups.length > 0 ? 1 : 0) +
        (prodResult.policy ? 1 : 0) +
        (prodResult.wiki ? 1 : 0) +
        prodResult.tags.filter((r) => r.status === 'success').length;

      result.totalExtracted += subCount;

      // Collect policies for transitive resolution
      for (let pi = 0; pi < prodResult.policies.length; pi++) {
        const policyContent = prodResult.policies[pi];
        if (policyContent !== undefined) {
          const key = `product:${productName}:policy:${pi}`;
          result.collectedPolicies.set(key, policyContent);
        }
      }
    }
  }
}

/**
 * Extract service-level global policy.
 */
async function extractServicePolicy(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  outputDir: string,
  result: ExtractionResult
): Promise<void> {
  const descriptor: ResourceDescriptor = {
    type: ResourceType.ServicePolicy,
    nameParts: [],
  };

  const policyJson = await client.getResource(context, descriptor);
  if (!policyJson) {
    return;
  }

  const properties = policyJson.properties as Record<string, unknown> | undefined;
  const policyContent = properties?.value as string | undefined;

  if (policyContent) {
    await store.writeContent(outputDir, descriptor, policyContent, 'policy');
    result.totalExtracted++;
    result.extractedDescriptors.push(descriptor);
    result.collectedPolicies.set('service-policy', policyContent);
    logger.info('Extracted service-level policy');
  }
}

/**
 * Extract gateway API associations.
 */
async function extractGatewayAssociations(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  outputDir: string,
  _filter: FilterConfig | undefined,
  result: ExtractionResult
): Promise<void> {
  const gatewayResults = result.typeResults.filter((r) => r.type === ResourceType.Gateway);

  for (const gwTypeResult of gatewayResults) {
    for (const gw of gwTypeResult.extracted) {
      if (gw.status !== 'success') continue;

      try {
        const apiNames: string[] = [];
        const gwApis = client.listResources(context, ResourceType.GatewayApi, gw.descriptor);

        for await (const apiJson of gwApis) {
          const name = apiJson.name as string | undefined;
          if (name) {
            apiNames.push(name);
          }
        }

        if (apiNames.length > 0) {
          await store.writeAssociation(outputDir, gw.descriptor, 'apis', apiNames);
          result.totalExtracted++;
          logger.info(`Extracted ${apiNames.length} API associations for gateway "${getNamePart(gw.descriptor.nameParts, 0)}"`);
        }
      } catch (error) {
        logger.warn(`Failed to extract API associations for gateway "${getNamePart(gw.descriptor.nameParts, 0)}": ${(error as Error).message}`);
      }
    }
  }
}

/**
 * Result of extracting a single transitive dependency.
 */
interface TransitiveTaskResult {
  dep: ResourceDescriptor;
  success: boolean;
}

/**
 * Resolve transitive dependencies and extract any additional resources.
 * Collects results per-task and merges after all tasks complete to avoid
 * concurrent mutations on the shared result object.
 */
async function resolveAndExtractTransitive(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  outputDir: string,
  result: ExtractionResult
): Promise<void> {
  logger.info('Resolving transitive dependencies...');

  // Build maps for transitive resolution
  const apiJsonMap = new Map<string, Record<string, unknown>>();
  for (const apiResult of result.apiResults) {
    // Find the API's JSON from type results
    const apiTypeResults = result.typeResults.filter((r) => r.type === ResourceType.Api);
    for (const atr of apiTypeResults) {
      for (const extracted of atr.extracted) {
        if (extracted.status === 'success' && getNamePart(extracted.descriptor.nameParts, 0) === apiResult.apiName) {
          apiJsonMap.set(apiResult.apiName, extracted.json);
        }
      }
    }
  }

  // Find transitive dependencies
  const transitiveDeps = findTransitiveDependencies(
    result.collectedPolicies,
    apiJsonMap
  );

  // Filter out already-extracted resources
  // Use buildResourceLabel for the key — it handles singleton types (e.g.
  // ServicePolicy) whose nameParts are empty, avoiding a getNamePart crash.
  const alreadyExtracted = new Set(
    result.extractedDescriptors.map(
      (d) => `${d.type}:${buildResourceLabel(d).toLowerCase()}`
    )
  );

  const newDeps = transitiveDeps.filter(
    (dep) => !alreadyExtracted.has(`${dep.type}:${buildResourceLabel(dep).toLowerCase()}`)
  );

  if (newDeps.length === 0) {
    logger.debug('No additional transitive dependencies found');
    return;
  }

  logger.info(`Found ${newDeps.length} transitive dependencies to extract`);

  // Extract each transitive dependency
  const tasks = newDeps.map((dep) => async (): Promise<TransitiveTaskResult> => {
    try {
      const json = await client.getResource(context, dep);
      if (json) {
        await store.writeResource(outputDir, dep, json);
        logger.info(`Extracted transitive dependency ${buildResourceLabel(dep)}`);
        return { dep, success: true };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to extract transitive dependency ${buildResourceLabel(dep)}: ${errorMessage}`);
    }
    return { dep, success: false };
  });

  const taskResults = await runParallel(tasks, DEFAULT_CONCURRENCY);

  // Merge results sequentially after parallel execution completes
  for (const taskResult of taskResults) {
    if (taskResult.status === 'fulfilled' && taskResult.value) {
      if (taskResult.value.success) {
        result.totalExtracted++;
        result.extractedDescriptors.push(taskResult.value.dep);
      } else {
        result.totalErrors++;
      }
    }
  }
}

/**
 * Extract workspace-scoped resources.
 */
async function extractWorkspaceResources(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  outputDir: string,
  filter: FilterConfig | undefined,
  result: ExtractionResult
): Promise<void> {
  try {
    const wsResults = await extractWorkspaces(
      client, store, context, outputDir, filter
    );

    result.workspaceResults = wsResults;

    for (const ws of wsResults) {
      result.totalExtracted += ws.resourceCount;
      result.totalErrors += ws.errorCount;
    }
  } catch (error) {
    logger.warn(`Workspace extraction failed: ${(error as Error).message}`);
  }
}
