// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * API-specific extraction logic
 * API revisions, API specifications, operations & operation policies,
 * GraphQL resolvers & resolver policies, API tags, diagnostics, schemas,
 * releases, tag descriptions, wikis.
 */

import { IApimClient, ApiSpecDialect } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { FilterConfig } from '../models/config.js';
import { shouldIncludeResource } from './filter-service.js';
import { extractResourceType, ExtractedResource } from './resource-extractor.js';
import { redactAndWarnPolicySecrets } from './secret-redactor.js';
import { logger } from '../lib/logger.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import { getNamePart } from '../lib/resource-path.js';
import { normalizeWsdl } from '../lib/wsdl-normalizer.js';
import { isWorkspaceScope, extractNameFromLink } from '../lib/workspace-link.js';

/**
 * Result of API-specific extraction for a single API.
 */
export interface ApiExtractionResult {
  apiName: string;
  errorCount: number;
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
  mcpServer: boolean;
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
  const apiName = getNamePart(apiDescriptor.nameParts, 0);
  const result: ApiExtractionResult = {
    apiName,
    errorCount: 0,
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
    mcpServer: false,
    resolvers: [],
    resolverPolicies: [],
    policies: [],
  };

  // Extract API revisions
  result.revisions = await extractApiRevisions(
    client, store, context, apiName, outputDir, filter, workspace
  );
  result.errorCount += result.revisions.filter((revision) => revision.status === 'error').length;

  // Extract API schemas FIRST. For synthetic GraphQL APIs the SDL lives in an
  // ApiSchema resource; by extracting schemas first we can detect that case
  // from the results and skip the (failing) spec export — avoiding a redundant
  // `list schemas` probe per GraphQL-typed API at scale.
  const schemaResult = await extractResourceType(
    client, store, context, ResourceType.ApiSchema,
    outputDir, filter, apiDescriptor, workspace
  );
  result.schemas = schemaResult.extracted;
  result.errorCount += schemaResult.errorCount;

  // Extract API specification (uses already-extracted schemas to detect
  // synthetic GraphQL without a second list call).
  const specificationResult = await extractApiSpecification(
    client, store, context, apiDescriptor, apiJson, outputDir, result.schemas
  );
  result.specification = specificationResult.extracted;
  result.errorCount += specificationResult.errorCount;

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
  result.errorCount += opsResult.errorCount;

  // Extract API tags
  // In workspace scope, the classic `apis/{api}/tags` endpoint returns HTTP 500.
  // Workspace uses `tags/{tag}/apiLinks` (inverted parent-child). Skip here;
  // workspace-scoped API tag extraction is handled separately by
  // extractWorkspaceApiTags() in the workspace extractor after all APIs/tags
  // are available.
  if (!isWorkspaceScope(context)) {
    const tagsResult = await extractResourceType(
      client, store, context, ResourceType.ApiTag,
      outputDir, filter, apiDescriptor, workspace
    );
    result.tags = tagsResult.extracted;
    result.errorCount += tagsResult.errorCount;
  }

  // Extract API diagnostics
  const diagResult = await extractResourceType(
    client, store, context, ResourceType.ApiDiagnostic,
    outputDir, filter, apiDescriptor, workspace
  );
  result.diagnostics = diagResult.extracted;
  result.errorCount += diagResult.errorCount;

  // Extract API releases
  const releaseResult = await extractResourceType(
    client, store, context, ResourceType.ApiRelease,
    outputDir, filter, apiDescriptor, workspace
  );
  result.releases = releaseResult.extracted;
  result.errorCount += releaseResult.errorCount;

  // Extract API tag descriptions (not supported in workspace scope)
  if (!workspace) {
    const tagDescResult = await extractResourceType(
      client, store, context, ResourceType.ApiTagDescription,
      outputDir, filter, apiDescriptor, workspace
    );
    result.tagDescriptions = tagDescResult.extracted;
    result.errorCount += tagDescResult.errorCount;
  }

  // Extract API wiki
  const wikiResult = await extractApiWiki(
    client, store, context, apiDescriptor, outputDir
  );
  result.wiki = wikiResult.extracted;
  result.errorCount += wikiResult.errorCount;

  // Extract GraphQL resolvers and their policies
  const resolverResult = await extractGraphQLResolvers(
    client, store, context, apiDescriptor, apiJson, outputDir, filter, workspace
  );
  result.resolvers = resolverResult.resolvers;
  result.resolverPolicies = resolverResult.resolverPolicies;
  result.policies.push(...resolverResult.policies);
  result.errorCount += resolverResult.errorCount;

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
        // Skip the current revision — it is represented by the main API folder.
        // Using isCurrent (not a hard-coded '1') correctly handles APIs whose
        // current revision is not revision 1.
        if (!revNumber || revision.isCurrent === true) {
          continue;
        }

        const revName = `${apiName};rev=${revNumber}`;
        const descriptor: ResourceDescriptor = {
          type: ResourceType.Api,
          nameParts: [revName],
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
        } else {
          results.push({
            descriptor,
            json: {},
            status: 'error',
            error: `Revision disappeared during extraction: ${buildResourceLabel(descriptor)}`,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to extract revision: ${errorMessage}`);
        results.push({
          descriptor: { type: ResourceType.Api, nameParts: [`${apiName};rev=?`] },
          json: {},
          status: 'error',
          error: errorMessage,
        });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to list revisions for API "${apiName}": ${errorMessage}`);
    results.push({
      descriptor: { type: ResourceType.Api, nameParts: [`${apiName};rev=?`], workspace },
      json: {},
      status: 'error',
      error: errorMessage,
    });
  }

  return results;
}

/**
 * Extract API specification (OpenAPI/GraphQL/WSDL/WADL).
 * WebSocket APIs do not have an OpenAPI specification — skip with a debug log.
 * Synthetic GraphQL APIs (schema stored as an ApiSchema, no external SDL blob)
 * are detected by inspecting already-extracted schemas and skipped here —
 * their schema is captured by the ApiSchema extraction step. Pass-through
 * GraphQL APIs (linked to an external GraphQL server) export their SDL via
 * the graphql-link format.
 */
async function extractApiSpecification(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  apiJson: Record<string, unknown>,
  outputDir: string,
  extractedSchemas: ExtractedResource[]
): Promise<{ extracted: boolean; errorCount: number }> {
  const properties = apiJson.properties as Record<string, unknown> | undefined;
  const apiType = properties?.type as string | undefined;
  if (apiType?.toLowerCase() === 'websocket') {
    logger.debug(`OpenAPI does not apply to WebSocket APIs`);
    return { extracted: false, errorCount: 0 };
  }

  if (apiType?.toLowerCase() === 'mcp') {
    logger.debug(`Skipping spec export for MCP API "${getNamePart(apiDescriptor.nameParts, 0)}" — MCP APIs use the Model Context Protocol endpoint, not OpenAPI`);
    return { extracted: false, errorCount: 0 };
  }

  if (apiType?.toLowerCase() === 'a2a') {
    logger.debug(`Skipping spec export for A2A API "${getNamePart(apiDescriptor.nameParts, 0)}" — A2A APIs use JSON-RPC + agent card endpoints, not OpenAPI`);
    return { extracted: false, errorCount: 0 };
  }

  if (apiType?.toLowerCase() === 'graphql' && hasGraphQLSchema(extractedSchemas)) {
    logger.debug(
      `Skipping spec export for synthetic GraphQL API "${getNamePart(apiDescriptor.nameParts, 0)}" — schema is captured via ApiSchema`
    );
    return { extracted: false, errorCount: 0 };
  }

  // REST APIs natively imported as Swagger 2.0 expose auto-generated schemas
  // with the Swagger-definitions content type. Export them in their native
  // dialect so the exported spec matches the API's source format (OpenAPI 3.0
  // export would convert schema content types and drop parameter-level metadata
  // like `format`).
  const specDialect: ApiSpecDialect = hasSwaggerDefinitionSchema(extractedSchemas)
    ? 'swagger2'
    : 'openapi3';

  try {
    const spec = await client.getApiSpecification(context, getNamePart(apiDescriptor.nameParts, 0), apiType, specDialect);
    if (!spec) {
      logger.debug(`No specification found for API "${getNamePart(apiDescriptor.nameParts, 0)}"`);
      return { extracted: false, errorCount: 0 };
    }

    // APIM's WSDL export can emit wsdl:part references qualified with the wrong
    // namespace prefix and multiple service ports, which its own importer then
    // rejects. Normalize so the extracted artifact round-trips through publish.
    const content = spec.format === 'wsdl'
      ? normalizeWsdl(spec.content)
      : spec.content;

    await store.writeContent(
      outputDir,
      apiDescriptor,
      content,
      'specification',
      spec.format
    );

    logger.info(`Extracted specification ${buildResourceLabel(apiDescriptor)} (${spec.format})`);
    return { extracted: true, errorCount: 0 };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to extract specification ${buildResourceLabel(apiDescriptor)}: ${errorMessage}`);
    return { extracted: false, errorCount: 1 };
  }
}

/**
 * Returns true if any already-extracted ApiSchema resource has a contentType
 * indicating a GraphQL schema. Used to distinguish synthetic GraphQL APIs
 * (schema stored in APIM) from pass-through GraphQL APIs (schema fetched from
 * backend). Inspects schemas that were extracted prior to spec export, so no
 * extra list call is required.
 */
function hasGraphQLSchema(schemas: ExtractedResource[]): boolean {
  for (const schema of schemas) {
    const props = schema.json.properties as Record<string, unknown> | undefined;
    const contentType = (props?.contentType as string | undefined)?.toLowerCase() ?? '';
    if (contentType.includes('graphql')) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if any already-extracted ApiSchema resource has the Swagger 2.0
 * definitions content type (`application/vnd.ms-azure-apim.swagger.definitions+json`).
 * APIM stamps this content type on the auto-generated schema of APIs that were
 * natively imported as Swagger 2.0, whereas OpenAPI 3.0 APIs use
 * `application/vnd.oai.openapi.components+json`. Used to select Swagger 2.0
 * export so the original spec format round-trips faithfully.
 */
function hasSwaggerDefinitionSchema(schemas: ExtractedResource[]): boolean {
  for (const schema of schemas) {
    const props = schema.json.properties as Record<string, unknown> | undefined;
    const contentType = (props?.contentType as string | undefined)?.toLowerCase() ?? '';
    if (contentType.includes('swagger.definitions')) {
      return true;
    }
  }
  return false;
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
    nameParts: [...apiDescriptor.nameParts],
    workspace: apiDescriptor.workspace,
  };

  const policyJson = await client.getResource(context, policyDescriptor);
  if (!policyJson) {
    return undefined;
  }

  const properties = policyJson.properties as Record<string, unknown> | undefined;
  const policyContent = properties?.value as string | undefined;

  if (policyContent) {
    const redactedContent = redactAndWarnPolicySecrets(policyDescriptor, policyContent);
    await store.writeContent(
      outputDir,
      policyDescriptor,
      redactedContent,
      'policy'
    );
    logger.debug(`Extracted ${buildResourceLabel(policyDescriptor)}`);
    return redactedContent;
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
  errorCount: number;
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
      nameParts: [...op.descriptor.nameParts],
      workspace,
    };

    const policyJson = await client.getResource(context, opPolicyDescriptor);
    if (!policyJson) continue;

    const properties = policyJson.properties as Record<string, unknown> | undefined;
    const policyContent = properties?.value as string | undefined;

    if (policyContent) {
      const redactedContent = redactAndWarnPolicySecrets(opPolicyDescriptor, policyContent);
      await store.writeContent(outputDir, opPolicyDescriptor, redactedContent, 'policy');
      operationPolicies.push({
        descriptor: opPolicyDescriptor,
        json: policyJson,
        status: 'success',
      });
      policies.push(redactedContent);
      logger.debug(`Extracted ${buildResourceLabel(opPolicyDescriptor)}`);
    }
  }

  return { operations, operationPolicies, policies, errorCount: opsResult.errorCount };
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
): Promise<{ extracted: boolean; errorCount: number }> {
  const wikiDescriptor: ResourceDescriptor = {
    type: ResourceType.ApiWiki,
    nameParts: [...apiDescriptor.nameParts],
    workspace: apiDescriptor.workspace,
  };

  try {
    const wikiJson = await client.getResource(context, wikiDescriptor);
    if (!wikiJson) {
      return { extracted: false, errorCount: 0 };
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
    return { extracted: true, errorCount: 0 };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.debug(`No wiki ${buildResourceLabel(wikiDescriptor)}: ${errorMessage}`);
    return { extracted: false, errorCount: 1 };
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
  errorCount: number;
}> {
  const resolvers: ExtractedResource[] = [];
  const resolverPolicies: ExtractedResource[] = [];
  const policies: string[] = [];

  // Only extract resolvers for GraphQL APIs — use the already-fetched apiJson
  const properties = apiJson.properties as Record<string, unknown> | undefined;
  const apiType = properties?.type as string | undefined;
  if (apiType?.toLowerCase() !== 'graphql') {
    return { resolvers, resolverPolicies, policies, errorCount: 0 };
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
      nameParts: [...resolver.descriptor.nameParts],
      workspace,
    };

    const policyJson = await client.getResource(context, resolverPolicyDescriptor);
    if (!policyJson) continue;

    const props = policyJson.properties as Record<string, unknown> | undefined;
    const policyContent = props?.value as string | undefined;

    if (policyContent) {
      const redactedContent = redactAndWarnPolicySecrets(resolverPolicyDescriptor, policyContent);
      await store.writeContent(outputDir, resolverPolicyDescriptor, redactedContent, 'policy');
      resolverPolicies.push({
        descriptor: resolverPolicyDescriptor,
        json: policyJson,
        status: 'success',
      });
      policies.push(redactedContent);
      logger.debug(`Extracted ${buildResourceLabel(resolverPolicyDescriptor)}`);
    }
  }

  return { resolvers, resolverPolicies, policies, errorCount: resolverResult.errorCount };
}

/**
 * Extract API tag associations in workspace scope using the tag-centric
 * `tags/{tag}/apiLinks` endpoint.
 *
 * In workspace scope the classic `apis/{api}/tags` endpoint is not available
 * (HTTP 500). Instead, tag-to-API associations are exposed via each tag's
 * `apiLinks` collection. This function iterates all workspace tags and
 * discovers their linked APIs, then writes ApiTag artifacts.
 *
 * @param client - APIM REST client
 * @param store - Artifact file store
 * @param context - Workspace-scoped APIM context
 * @param extractedTagNames - Tag names already extracted for this workspace
 * @param extractedApiNames - API names already extracted for this workspace
 * @param outputDir - Output directory
 * @param workspace - Workspace name
 * @returns Number of ApiTag artifacts written
 */
export async function extractWorkspaceApiTags(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  extractedTagNames: string[],
  extractedApiNames: Set<string>,
  outputDir: string,
  workspace: string
): Promise<number> {
  const linkProperty = RESOURCE_TYPE_METADATA[ResourceType.ApiTag].workspaceLinkIdProperty;
  if (!linkProperty) {
    return 0;
  }

  let count = 0;

  for (const tagName of extractedTagNames) {
    // List apiLinks under this tag.
    // Do NOT set workspace on this descriptor — context.baseUrl already includes
    // the workspace prefix and buildArmUri would double it.
    const tagDescriptor: ResourceDescriptor = {
      type: ResourceType.Tag,
      nameParts: [tagName],
    };

    try {
      for await (const linkJson of client.listResources(context, ResourceType.ApiTag, tagDescriptor)) {
        const apiName = extractNameFromLink(linkJson, linkProperty);
        if (!apiName) {
          throw new Error(`Failed to extract API name from tag "${tagName}" apiLink response`);
        }

        // Only create ApiTag artifacts for APIs that were extracted
        if (!extractedApiNames.has(apiName)) {
          logger.debug(`Skipping apiLink for tag "${tagName}" → API "${apiName}" (API not extracted)`);
          continue;
        }

        // Write the ApiTag artifact
        const apiTagDescriptor: ResourceDescriptor = {
          type: ResourceType.ApiTag,
          nameParts: [apiName, tagName],
          workspace,
        };

        // ApiTag artifacts store a minimal tag information JSON
        const tagJson: Record<string, unknown> = {
          properties: {
            displayName: tagName,
          },
        };

        await store.writeResource(outputDir, apiTagDescriptor, tagJson);
        logger.info(`Extracted workspace ApiTag: ${apiName}/tags/${tagName}`);
        count++;
      }
    } catch (error) {
      logger.warn(`Failed to list apiLinks for tag "${tagName}": ${(error as Error).message}`);
      throw error;
    }
  }

  return count;
}
