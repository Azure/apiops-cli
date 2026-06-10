// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T022: API-specific extraction logic
 * API revisions, API specifications, operations & operation policies,
 * GraphQL resolvers & resolver policies, API tags, diagnostics, schemas,
 * releases, tag descriptions, wikis.
 */

import { IApimClient } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { FilterConfig } from '../models/config.js';
import { shouldIncludeResource } from './filter-service.js';
import { extractResourceType, ExtractedResource } from './resource-extractor.js';
import { logger } from '../lib/logger.js';
import { buildResourceLabel } from '../lib/resource-uri.js';
import { getNamePart } from '../lib/resource-path.js';
import { isWorkspaceScope, extractNameFromLink } from '../lib/workspace-link.js';

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
  mcpServer: boolean;
  resolvers: ExtractedResource[];
  resolverPolicies: ExtractedResource[];
  policies: string[];
}

function getApiProperties(apiJson: Record<string, unknown>): Record<string, unknown> | undefined {
  return apiJson.properties as Record<string, unknown> | undefined;
}

function hasEmbeddedMcpConfiguration(apiJson: Record<string, unknown>): boolean {
  const properties = getApiProperties(apiJson);
  if (!properties) {
    return false;
  }

  // Check if mcpTools has actual content (non-empty array), excluding null
  const mcpTools = properties.mcpTools as unknown[] | undefined | null;
  if (Array.isArray(mcpTools) && mcpTools.length > 0) {
    return true;
  }

  // Check if mcpProperties exists and is not null or undefined
  if (properties.mcpProperties != null) {
    return true;
  }

  // MCP APIs created from an existing MCP server are wired purely via
  // backendId + (optionally absent) mcpProperties. A non-null backendId on a
  // type='mcp' API is itself an MCP server configuration we must capture.
  if (typeof properties.backendId === 'string' && properties.backendId.length > 0) {
    return true;
  }

  return false;
}

function buildEmbeddedMcpServerResource(
  apiJson: Record<string, unknown>,
  backendUrl?: string
): Record<string, unknown> {
  const properties = getApiProperties(apiJson) ?? {};
  const resourceProperties: Record<string, unknown> = {};

  // Clone mcpProperties so we can augment it with serverUrl without mutating
  // the caller's apiJson.
  let mcpProperties: Record<string, unknown> | undefined;
  if (properties.mcpProperties && typeof properties.mcpProperties === 'object') {
    mcpProperties = { ...(properties.mcpProperties as Record<string, unknown>) };
  } else if (backendUrl) {
    mcpProperties = {};
  }

  if (mcpProperties && backendUrl && mcpProperties.serverUrl === undefined) {
    mcpProperties.serverUrl = backendUrl;
  }

  if (mcpProperties !== undefined) {
    resourceProperties.mcpProperties = mcpProperties;
  }
  if (properties.mcpTools !== undefined) {
    resourceProperties.mcpTools = properties.mcpTools;
  }
  // Preserve the link to the upstream backend so the MCP server sidecar is
  // self-describing for MCP-from-existing-MCP-server APIs.
  if (typeof properties.backendId === 'string' && properties.backendId.length > 0) {
    resourceProperties.backendId = properties.backendId;
  }

  return {
    name: 'default',
    properties: resourceProperties,
  };

}

/**
 * For an MCP API wired to a backend via `backendId`, fetch that backend and
 * return its `properties.url` so the MCP sidecar can carry the actual upstream
 * server URL. Returns undefined when the API has no backendId, the backend
 * cannot be fetched, or the backend has no url.
 */
async function resolveLinkedBackendUrl(
  client: IApimClient,
  context: ApimServiceContext,
  apiJson: Record<string, unknown>,
  workspace?: string
): Promise<string | undefined> {
  const properties = getApiProperties(apiJson);
  const backendId = properties?.backendId;
  if (typeof backendId !== 'string' || backendId.length === 0) {
    return undefined;
  }

  // backendId may be either a bare resource name or a full ARM resource id.
  // We only consume the trailing name segment for descriptor lookup.
  const backendName = backendId.includes('/') ? backendId.split('/').pop()! : backendId;

  try {
    const backendJson = await client.getResource(context, {
      type: ResourceType.Backend,
      nameParts: [backendName],
      workspace,
    });
    const url = (backendJson?.properties as Record<string, unknown> | undefined)?.url;
    return typeof url === 'string' && url.length > 0 ? url : undefined;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.debug(`Could not resolve backend "${backendName}" for MCP server URL: ${errorMessage}`);
    return undefined;
  }
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

  // Extract API schemas FIRST. For synthetic GraphQL APIs the SDL lives in an
  // ApiSchema resource; by extracting schemas first we can detect that case
  // from the results and skip the (failing) spec export — avoiding a redundant
  // `list schemas` probe per GraphQL-typed API at scale.
  const schemaResult = await extractResourceType(
    client, store, context, ResourceType.ApiSchema,
    outputDir, filter, apiDescriptor, workspace
  );
  result.schemas = schemaResult.extracted;

  // Extract API specification (uses already-extracted schemas to detect
  // synthetic GraphQL without a second list call).
  result.specification = await extractApiSpecification(
    client, store, context, apiDescriptor, apiJson, outputDir, result.schemas
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
  }

  // Extract API diagnostics
  const diagResult = await extractResourceType(
    client, store, context, ResourceType.ApiDiagnostic,
    outputDir, filter, apiDescriptor, workspace
  );
  result.diagnostics = diagResult.extracted;

  // Extract API releases
  const releaseResult = await extractResourceType(
    client, store, context, ResourceType.ApiRelease,
    outputDir, filter, apiDescriptor, workspace
  );
  result.releases = releaseResult.extracted;

  // Extract API tag descriptions (not supported in workspace scope)
  if (!workspace) {
    const tagDescResult = await extractResourceType(
      client, store, context, ResourceType.ApiTagDescription,
      outputDir, filter, apiDescriptor, workspace
    );
    result.tagDescriptions = tagDescResult.extracted;
  }

  // Extract API wiki
  result.wiki = await extractApiWiki(
    client, store, context, apiDescriptor, outputDir
  );

  // Extract MCP server configuration (singleton per API; silently skipped when not present)
  result.mcpServer = await extractApiMcpServer(
    client, store, context, apiDescriptor, apiJson, outputDir
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
    logger.warn(`Failed to list revisions for API "${apiName}": ${(error as Error).message}`);
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
): Promise<boolean> {
  const properties = apiJson.properties as Record<string, unknown> | undefined;
  const apiType = properties?.type as string | undefined;
  if (apiType?.toLowerCase() === 'websocket') {
    logger.debug(`OpenAPI does not apply to WebSocket APIs`);
    return false;
  }

  if (apiType?.toLowerCase() === 'mcp') {
    logger.debug(`Skipping spec export for MCP API "${getNamePart(apiDescriptor.nameParts, 0)}" — MCP APIs use the Model Context Protocol endpoint, not OpenAPI`);
    return false;
  }

  if (apiType?.toLowerCase() === 'a2a') {
    logger.debug(`Skipping spec export for A2A API "${getNamePart(apiDescriptor.nameParts, 0)}" — A2A APIs use JSON-RPC + agent card endpoints, not OpenAPI`);
    return false;
  }

  if (apiType?.toLowerCase() === 'graphql' && hasGraphQLSchema(extractedSchemas)) {
    logger.debug(
      `Skipping spec export for synthetic GraphQL API "${getNamePart(apiDescriptor.nameParts, 0)}" — schema is captured via ApiSchema`
    );
    return false;
  }

  try {
    const spec = await client.getApiSpecification(context, getNamePart(apiDescriptor.nameParts, 0), apiType);
    if (!spec) {
      logger.debug(`No specification found for API "${getNamePart(apiDescriptor.nameParts, 0)}"`);
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
      nameParts: [...op.descriptor.nameParts],
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
    nameParts: [...apiDescriptor.nameParts],
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
  const properties = getApiProperties(apiJson);
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
      nameParts: [...resolver.descriptor.nameParts],
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

/**
 * Extract MCP (Model Context Protocol) server configuration for an API.
 *
 * MCP configuration is embedded directly on the API resource
 * (`properties.mcpTools`, `properties.mcpProperties`, `properties.backendId`).
 * There is no separate child resource served by ARM — the
 * `apis/{id}/mcpServers/default` endpoint returns 404 even on working MCP APIs,
 * and `apis/{id}/mcpServers` returns 500 (no such collection). All MCP data
 * therefore comes from the API JSON itself.
 *
 * For MCP APIs created from an existing MCP server (the `backendId` pattern),
 * the upstream URL lives on the linked backend, not on the API. To make the
 * extracted `mcpServerInformation.json` self-describing, the extractor
 * resolves that backend and surfaces its URL as `mcpProperties.serverUrl`.
 */
async function extractApiMcpServer(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  apiDescriptor: ResourceDescriptor,
  apiJson: Record<string, unknown>,
  outputDir: string
): Promise<boolean> {
  const apiType = (getApiProperties(apiJson)?.type as string | undefined)?.toLowerCase();

  // Avoid creating MCP artifacts for non-MCP APIs unless they carry meaningful MCP metadata.
  if (apiType !== 'mcp' && !hasEmbeddedMcpConfiguration(apiJson)) {
    return false;
  }

  if (!hasEmbeddedMcpConfiguration(apiJson)) {
    return false;
  }

  const mcpDescriptor: ResourceDescriptor = {
    type: ResourceType.McpServer,
    nameParts: [...apiDescriptor.nameParts],
    workspace: apiDescriptor.workspace,
  };

  // Resolve the upstream backend URL so the MCP sidecar carries the actual
  // server URL (not just a backendId reference + uri template).
  const backendUrl = await resolveLinkedBackendUrl(client, context, apiJson, apiDescriptor.workspace);
  await store.writeResource(
    outputDir,
    mcpDescriptor,
    buildEmbeddedMcpServerResource(apiJson, backendUrl)
  );
  logger.info(`Extracted ${buildResourceLabel(mcpDescriptor)} from API metadata`);
  return true;
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
          logger.warn(`Failed to extract API name from tag "${tagName}" apiLink response`);
          continue;
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
    }
  }

  return count;
}
