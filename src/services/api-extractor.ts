/**
 * T022: API-specific extraction logic
 * API revisions, API specifications, operations & operation policies,
 * GraphQL resolvers & resolver policies, API tags, diagnostics, schemas,
 * releases, tag descriptions, wikis.
 */

import { IApimClient } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import { FilterConfig } from '../models/config.js';
import { shouldIncludeResource } from './filter-service.js';
import { extractResourceType, ExtractedResource } from './resource-extractor.js';
import { logger } from '../lib/logger.js';
import { buildResourceLabel } from '../lib/resource-uri.js';

/**
 * Result of API-specific extraction for a single API.
 */
export interface ApiExtractionResult {
  apiName: string;
  revisions: ExtractedResource[];
  specification: boolean;
  operations: ExtractedResource[];
  operationPolicies: ExtractedResource[];
  tags: ExtractedResource[];
  diagnostics: ExtractedResource[];
  schemas: ExtractedResource[];
  releases: ExtractedResource[];
  tagDescriptions: ExtractedResource[];
  wiki: boolean;
  resolvers: ExtractedResource[];
  resolverPolicies: ExtractedResource[];
  policies: string[];
}

/**
 * Extract all API-specific resources for a single API.
 * This includes revisions, specifications, operations, policies, etc.
 */
export async function extractApiResources(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  apiJson: Record<string, unknown>,
  outputDir: string,
  filter?: FilterConfig,
  workspace?: string
): Promise<ApiExtractionResult> {
  const apiName = apiDescriptor.name;
  const result: ApiExtractionResult = {
    apiName,
    revisions: [],
    specification: false,
    operations: [],
    operationPolicies: [],
    tags: [],
    diagnostics: [],
    schemas: [],
    releases: [],
    tagDescriptions: [],
    wiki: false,
    resolvers: [],
    resolverPolicies: [],
    policies: [],
  };

  // Extract API revisions
  result.revisions = await extractApiRevisions(
    client, store, context, apiName, outputDir, filter, workspace
  );

  // Extract API specification
  result.specification = await extractApiSpecification(
    client, store, context, apiDescriptor, apiJson, outputDir
  );

  // Extract API policy
  const policyContent = await extractApiPolicy(
    client, store, context, apiDescriptor, outputDir
  );
  if (policyContent) {
    result.policies.push(policyContent);
  }

  // Extract operations and their policies
  const opsResult = await extractApiOperations(
    client, store, context, apiDescriptor, outputDir, filter, workspace
  );
  result.operations = opsResult.operations;
  result.operationPolicies = opsResult.operationPolicies;
  result.policies.push(...opsResult.policies);

  // Extract API tags
  const tagsResult = await extractResourceType(
    client, store, context, ResourceType.ApiTag,
    outputDir, filter, apiDescriptor, workspace
  );
  result.tags = tagsResult.extracted;

  // Extract API diagnostics
  const diagResult = await extractResourceType(
    client, store, context, ResourceType.ApiDiagnostic,
    outputDir, filter, apiDescriptor, workspace
  );
  result.diagnostics = diagResult.extracted;

  // Extract API schemas
  const schemaResult = await extractResourceType(
    client, store, context, ResourceType.ApiSchema,
    outputDir, filter, apiDescriptor, workspace
  );
  result.schemas = schemaResult.extracted;

  // Extract API releases
  const releaseResult = await extractResourceType(
    client, store, context, ResourceType.ApiRelease,
    outputDir, filter, apiDescriptor, workspace
  );
  result.releases = releaseResult.extracted;

  // Extract API tag descriptions
  const tagDescResult = await extractResourceType(
    client, store, context, ResourceType.ApiTagDescription,
    outputDir, filter, apiDescriptor, workspace
  );
  result.tagDescriptions = tagDescResult.extracted;

  // Extract API wiki
  result.wiki = await extractApiWiki(
    client, store, context, apiDescriptor, outputDir
  );

  // Extract GraphQL resolvers and their policies
  const resolverResult = await extractGraphQLResolvers(
    client, store, context, apiDescriptor, apiJson, outputDir, filter, workspace
  );
  result.resolvers = resolverResult.resolvers;
  result.resolverPolicies = resolverResult.resolverPolicies;
  result.policies.push(...resolverResult.policies);

  return result;
}

/**
 * Extract API revisions.
 * Lists revisions and extracts each as a sub-folder with ;rev=N naming.
 */
async function extractApiRevisions(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiName: string,
  outputDir: string,
  filter?: FilterConfig,
  workspace?: string
): Promise<ExtractedResource[]> {
  const results: ExtractedResource[] = [];

  try {
    const revisions = client.listApiRevisions(context, apiName);

    for await (const revision of revisions) {
      try {
        const revNumber = (revision.apiRevision ?? revision.revisionNumber) as string | undefined;
        if (!revNumber || revNumber === '1') {
          // Skip revision 1 — it's the main API
          continue;
        }

        const revName = `${apiName};rev=${revNumber}`;
        const descriptor: ResourceDescriptor = {
          type: ResourceType.Api,
          name: revName,
          workspace,
        };

        // Check filter — use root API name for matching
        if (!shouldIncludeResource(descriptor, filter)) {
          continue;
        }

        // Get full revision resource
        const revJson = await client.getResource(context, descriptor);
        if (revJson) {
          await store.writeResource(outputDir, descriptor, revJson);
          results.push({ descriptor, json: revJson, status: 'success' });
          logger.info(`Extracted revision ${buildResourceLabel(descriptor)}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to extract revision: ${errorMessage}`);
        results.push({
          descriptor: { type: ResourceType.Api, name: `${apiName};rev=?` },
          json: {},
          status: 'error',
          error: errorMessage,
        });
      }
    }
  } catch (error) {
    logger.warn(`Failed to list revisions for API "${apiName}": ${(error as Error).message}`);
  }

  return results;
}

/**
 * Extract API specification (OpenAPI/GraphQL/WSDL/WADL).
 * WebSocket APIs do not have an OpenAPI specification — skip with a debug log.
 */
async function extractApiSpecification(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  apiJson: Record<string, unknown>,
  outputDir: string
): Promise<boolean> {
  const properties = apiJson.properties as Record<string, unknown> | undefined;
  const apiType = properties?.type as string | undefined;
  if (apiType?.toLowerCase() === 'websocket') {
    logger.debug(`OpenAPI does not apply to WebSocket APIs`);
    return false;
  }

  try {
    const spec = await client.getApiSpecification(context, apiDescriptor.name, apiType);
    if (!spec) {
      logger.debug(`No specification found for API "${apiDescriptor.name}"`);
      return false;
    }

    await store.writeContent(
      outputDir,
      apiDescriptor,
      spec.content,
      'specification',
      spec.format
    );

    logger.info(`Extracted specification ${buildResourceLabel(apiDescriptor)} (${spec.format})`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to extract specification ${buildResourceLabel(apiDescriptor)}: ${errorMessage}`);
    return false;
  }
}

/**
 * Extract API-level policy.
 */
async function extractApiPolicy(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  outputDir: string
): Promise<string | undefined> {
  const policyDescriptor: ResourceDescriptor = {
    type: ResourceType.ApiPolicy,
    name: apiDescriptor.name,
    workspace: apiDescriptor.workspace,
  };

  const policyJson = await client.getResource(context, policyDescriptor);
  if (!policyJson) {
    return undefined;
  }

  const properties = policyJson.properties as Record<string, unknown> | undefined;
  const policyContent = properties?.value as string | undefined;

  if (policyContent) {
    await store.writeContent(
      outputDir,
      policyDescriptor,
      policyContent,
      'policy'
    );
    logger.debug(`Extracted ${buildResourceLabel(policyDescriptor)}`);
    return policyContent;
  }

  return undefined;
}

/**
 * Extract API operations and their policies.
 */
async function extractApiOperations(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  outputDir: string,
  filter?: FilterConfig,
  workspace?: string
): Promise<{
  operations: ExtractedResource[];
  operationPolicies: ExtractedResource[];
  policies: string[];
}> {
  const operations: ExtractedResource[] = [];
  const operationPolicies: ExtractedResource[] = [];
  const policies: string[] = [];

  // Extract operations
  const opsResult = await extractResourceType(
    client, store, context, ResourceType.ApiOperation,
    outputDir, filter, apiDescriptor, workspace
  );
  operations.push(...opsResult.extracted);

  // Extract operation policies for each operation
  for (const op of opsResult.extracted) {
    if (op.status !== 'success') continue;

    const opPolicyDescriptor: ResourceDescriptor = {
      type: ResourceType.ApiOperationPolicy,
      name: apiDescriptor.name,
      parent: op.descriptor.name,
      grandparent: apiDescriptor.name,
      workspace,
    };

    const policyJson = await client.getResource(context, opPolicyDescriptor);
    if (!policyJson) continue;

    const properties = policyJson.properties as Record<string, unknown> | undefined;
    const policyContent = properties?.value as string | undefined;

    if (policyContent) {
      await store.writeContent(outputDir, opPolicyDescriptor, policyContent, 'policy');
      operationPolicies.push({
        descriptor: opPolicyDescriptor,
        json: policyJson,
        status: 'success',
      });
      policies.push(policyContent);
      logger.debug(`Extracted ${buildResourceLabel(opPolicyDescriptor)}`);
    }
  }

  return { operations, operationPolicies, policies };
}

/**
 * Extract API wiki content.
 */
async function extractApiWiki(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  outputDir: string
): Promise<boolean> {
  const wikiDescriptor: ResourceDescriptor = {
    type: ResourceType.ApiWiki,
    name: apiDescriptor.name,
    workspace: apiDescriptor.workspace,
  };

  try {
    const wikiJson = await client.getResource(context, wikiDescriptor);
    if (!wikiJson) {
      return false;
    }

    // Extract markdown content from wiki JSON
    const properties = wikiJson.properties as Record<string, unknown> | undefined;
    const documents = properties?.documents as Array<{ documentationId: string; title: string }> | undefined;

    if (documents) {
      // Write wiki info as markdown — use writeResource (not writeContent with 'policy')
      // since there is no dedicated 'wiki' content type in IArtifactStore
      const content = documents.map((d) => `# ${d.title}\n\n${d.documentationId}`).join('\n\n');
      const markdownJson = { ...wikiJson, _markdownContent: content };
      await store.writeResource(outputDir, wikiDescriptor, markdownJson);
    } else {
      // Write the raw JSON
      await store.writeResource(outputDir, wikiDescriptor, wikiJson);
    }
    logger.info(`Extracted ${buildResourceLabel(wikiDescriptor)}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.debug(`No wiki ${buildResourceLabel(wikiDescriptor)}: ${errorMessage}`);
    return false;
  }
}

/**
 * Extract GraphQL resolvers and their policies.
 */
async function extractGraphQLResolvers(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  apiJson: Record<string, unknown>,
  outputDir: string,
  filter?: FilterConfig,
  workspace?: string
): Promise<{
  resolvers: ExtractedResource[];
  resolverPolicies: ExtractedResource[];
  policies: string[];
}> {
  const resolvers: ExtractedResource[] = [];
  const resolverPolicies: ExtractedResource[] = [];
  const policies: string[] = [];

  // Only extract resolvers for GraphQL APIs — use the already-fetched apiJson
  const properties = apiJson.properties as Record<string, unknown> | undefined;
  const apiType = properties?.type as string | undefined;
  if (apiType?.toLowerCase() !== 'graphql') {
    return { resolvers, resolverPolicies, policies };
  }

  // Extract resolvers
  const resolverResult = await extractResourceType(
    client, store, context, ResourceType.GraphQLResolver,
    outputDir, filter, apiDescriptor, workspace
  );
  resolvers.push(...resolverResult.extracted);

  // Extract resolver policies
  for (const resolver of resolverResult.extracted) {
    if (resolver.status !== 'success') continue;

    const resolverPolicyDescriptor: ResourceDescriptor = {
      type: ResourceType.GraphQLResolverPolicy,
      name: apiDescriptor.name,
      parent: resolver.descriptor.name,
      grandparent: apiDescriptor.name,
      workspace,
    };

    const policyJson = await client.getResource(context, resolverPolicyDescriptor);
    if (!policyJson) continue;

    const props = policyJson.properties as Record<string, unknown> | undefined;
    const policyContent = props?.value as string | undefined;

    if (policyContent) {
      await store.writeContent(outputDir, resolverPolicyDescriptor, policyContent, 'policy');
      resolverPolicies.push({
        descriptor: resolverPolicyDescriptor,
        json: policyJson,
        status: 'success',
      });
      policies.push(policyContent);
      logger.debug(`Extracted ${buildResourceLabel(resolverPolicyDescriptor)}`);
    }
  }

  return { resolvers, resolverPolicies, policies };
}
