// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * ResourceType enum and metadata
 * All 34 APIM resource types with ARM path suffixes, artifact directories, and info file names
 */

export enum ResourceType {
  NamedValue = 'NamedValue',
  Tag = 'Tag',
  Gateway = 'Gateway',
  VersionSet = 'VersionSet',
  Backend = 'Backend',
  Logger = 'Logger',
  Group = 'Group',
  Diagnostic = 'Diagnostic',
  PolicyFragment = 'PolicyFragment',
  ServicePolicy = 'ServicePolicy',
  Product = 'Product',
  ProductPolicy = 'ProductPolicy',
  ProductApi = 'ProductApi',
  ProductGroup = 'ProductGroup',
  ProductTag = 'ProductTag',
  Api = 'Api',
  ApiPolicy = 'ApiPolicy',
  ApiTag = 'ApiTag',
  ApiDiagnostic = 'ApiDiagnostic',
  ApiOperation = 'ApiOperation',
  ApiOperationPolicy = 'ApiOperationPolicy',
  GatewayApi = 'GatewayApi',
  Subscription = 'Subscription',
  GlobalSchema = 'GlobalSchema',
  PolicyRestriction = 'PolicyRestriction',
  Documentation = 'Documentation',
  ApiSchema = 'ApiSchema',
  ApiRelease = 'ApiRelease',
  ApiTagDescription = 'ApiTagDescription',
  ApiWiki = 'ApiWiki',
  ProductWiki = 'ProductWiki',
  GraphQLResolver = 'GraphQLResolver',
  GraphQLResolverPolicy = 'GraphQLResolverPolicy',
  /** MCP (Model Context Protocol) server configuration per API. Singleton per API. */
  McpServer = 'McpServer',
  /** Workspace container (Premium/StandardV2/PremiumV2). */
  Workspace = 'Workspace',
}

/**
 * Pure-data descriptor for a single APIM resource type.
 *
 * Both `armPathSuffix` and `artifactDirectory` use positional placeholders
 * `{0}`, `{1}`, … that map directly to `ResourceDescriptor.nameParts[i]`.
 * All fill / reverse-parse logic lives in resource-path.ts and resource-uri.ts.
 *
 * Examples:
 *   armPathSuffix:    'namedValues/{0}'                        nameParts: [name]
 *   armPathSuffix:    'apis/{0}/tags/{1}'                      nameParts: [apiName, tagName]
 *   armPathSuffix:    'apis/{0}/operations/{1}/policies/policy' nameParts: [apiName, opName]
 *   armPathSuffix:    'policies/policy'                        nameParts: []
 */
export interface ResourceTypeMetadata {
  readonly armPathSuffix: string;
  readonly artifactDirectory: string;
  readonly infoFile: string | null;
  readonly supportsGet: boolean;
  /**
   * True when the LIST endpoint returns a shallow payload that omits fields
   * required for round-trip publish. When true, extraction must issue an
   * individual GET per item to fetch the complete resource.
   */
  readonly listOmitsFields?: boolean;
  /**
   * True when this resource type is supported at the workspace scope.
   * Used by workspace-extractor to derive the set of types to extract
   * without maintaining a separate hardcoded list.
   */
  readonly workspaceSupported?: boolean;
  /**
   * Alternative ARM path suffix used in workspace scope.
   * Some association resources use a different "links" endpoint pattern
   * in workspace scope (e.g. `products/{0}/apiLinks/{1}` instead of
   * `products/{0}/apis/{1}`).
   */
  readonly workspaceArmPathSuffix?: string;
  /**
   * The property name in a workspace link response that contains the
   * linked resource's full ARM resource ID (e.g. 'apiId', 'groupId').
   * Only relevant when `workspaceArmPathSuffix` is set.
   */
  readonly workspaceLinkIdProperty?: string;
}

export const RESOURCE_TYPE_METADATA: Record<ResourceType, ResourceTypeMetadata> = {
  [ResourceType.NamedValue]: {
    armPathSuffix: 'namedValues/{0}',
    artifactDirectory: 'namedValues/{0}',
    infoFile: 'namedValueInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.Tag]: {
    armPathSuffix: 'tags/{0}',
    artifactDirectory: 'tags/{0}',
    infoFile: 'tagInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.Gateway]: {
    armPathSuffix: 'gateways/{0}',
    artifactDirectory: 'gateways/{0}',
    infoFile: 'gatewayInformation.json',
    supportsGet: true,
  },
  [ResourceType.VersionSet]: {
    armPathSuffix: 'apiVersionSets/{0}',
    artifactDirectory: 'versionSets/{0}',
    infoFile: 'versionSetInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.Backend]: {
    armPathSuffix: 'backends/{0}',
    artifactDirectory: 'backends/{0}',
    infoFile: 'backendInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.Logger]: {
    armPathSuffix: 'loggers/{0}',
    artifactDirectory: 'loggers/{0}',
    infoFile: 'loggerInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.Group]: {
    armPathSuffix: 'groups/{0}',
    artifactDirectory: 'groups/{0}',
    infoFile: 'groupInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.Diagnostic]: {
    armPathSuffix: 'diagnostics/{0}',
    artifactDirectory: 'diagnostics/{0}',
    infoFile: 'diagnosticInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.PolicyFragment]: {
    armPathSuffix: 'policyFragments/{0}',
    artifactDirectory: 'policyFragments/{0}',
    infoFile: 'policyFragmentInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.ServicePolicy]: {
    armPathSuffix: 'policies/policy',
    artifactDirectory: '',
    infoFile: 'policy.xml',
    supportsGet: true,
  },
  [ResourceType.Product]: {
    armPathSuffix: 'products/{0}',
    artifactDirectory: 'products/{0}',
    infoFile: 'productInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.ProductPolicy]: {
    armPathSuffix: 'products/{0}/policies/policy',
    artifactDirectory: 'products/{0}',
    infoFile: 'policy.xml',
    supportsGet: true,
  },
  [ResourceType.ProductApi]: {
    armPathSuffix: 'products/{0}/apis/{1}',
    artifactDirectory: 'products/{0}',
    infoFile: 'apis.json',
    supportsGet: false,
    workspaceArmPathSuffix: 'products/{0}/apiLinks/{1}',
    workspaceLinkIdProperty: 'apiId',
  },
  [ResourceType.ProductGroup]: {
    armPathSuffix: 'products/{0}/groups/{1}',
    artifactDirectory: 'products/{0}',
    infoFile: 'groups.json',
    supportsGet: false,
    workspaceArmPathSuffix: 'products/{0}/groupLinks/{1}',
    workspaceLinkIdProperty: 'groupId',
  },
  [ResourceType.ProductTag]: {
    armPathSuffix: 'products/{0}/tags/{1}',
    artifactDirectory: 'products/{0}',
    infoFile: null, // Embedded in productInformation.json
    supportsGet: false,
    workspaceArmPathSuffix: 'tags/{1}/productLinks/{0}',
    workspaceLinkIdProperty: 'productId',
  },
  [ResourceType.Api]: {
    armPathSuffix: 'apis/{0}',
    artifactDirectory: 'apis/{0}',
    infoFile: 'apiInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.ApiPolicy]: {
    armPathSuffix: 'apis/{0}/policies/policy',
    artifactDirectory: 'apis/{0}',
    infoFile: 'policy.xml',
    supportsGet: true,
  },
  [ResourceType.ApiTag]: {
    armPathSuffix: 'apis/{0}/tags/{1}',
    artifactDirectory: 'apis/{0}/tags/{1}',
    infoFile: 'tagInformation.json',
    supportsGet: true,
    workspaceArmPathSuffix: 'tags/{1}/apiLinks/{0}',
    workspaceLinkIdProperty: 'apiId',
  },
  [ResourceType.ApiDiagnostic]: {
    armPathSuffix: 'apis/{0}/diagnostics/{1}',
    artifactDirectory: 'apis/{0}/diagnostics/{1}',
    infoFile: 'diagnosticInformation.json',
    supportsGet: true,
  },
  [ResourceType.ApiOperation]: {
    armPathSuffix: 'apis/{0}/operations/{1}',
    artifactDirectory: 'apis/{0}/operations/{1}',
    infoFile: 'operationInformation.json',
    supportsGet: true,
  },
  [ResourceType.ApiOperationPolicy]: {
    armPathSuffix: 'apis/{0}/operations/{1}/policies/policy',
    artifactDirectory: 'apis/{0}/operations/{1}',
    infoFile: 'policy.xml',
    supportsGet: true,
  },
  [ResourceType.GatewayApi]: {
    armPathSuffix: 'gateways/{0}/apis/{1}',
    artifactDirectory: 'gateways/{0}',
    infoFile: 'apis.json',
    supportsGet: false,
  },
  [ResourceType.Subscription]: {
    armPathSuffix: 'subscriptions/{0}',
    artifactDirectory: 'subscriptions/{0}',
    infoFile: 'subscriptionInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.GlobalSchema]: {
    armPathSuffix: 'schemas/{0}',
    artifactDirectory: 'schemas/{0}',
    infoFile: 'schemaInformation.json',
    supportsGet: true,
    workspaceSupported: true,
  },
  [ResourceType.PolicyRestriction]: {
    armPathSuffix: 'policyRestrictions/{0}',
    artifactDirectory: 'policyRestrictions/{0}',
    infoFile: 'policyRestrictionInformation.json',
    supportsGet: true,
  },
  [ResourceType.Documentation]: {
    armPathSuffix: 'documentations/{0}',
    artifactDirectory: 'documentations/{0}',
    infoFile: 'documentationInformation.json',
    supportsGet: true,
  },
  [ResourceType.ApiSchema]: {
    armPathSuffix: 'apis/{0}/schemas/{1}',
    artifactDirectory: 'apis/{0}/schemas/{1}',
    infoFile: 'schemaInformation.json',
    supportsGet: true,
    listOmitsFields: true, // LIST omits properties.document (GraphQL SDL, XSD, JSON schema body)
  },
  [ResourceType.ApiRelease]: {
    armPathSuffix: 'apis/{0}/releases/{1}',
    artifactDirectory: 'apis/{0}/releases/{1}',
    infoFile: 'releaseInformation.json',
    supportsGet: true,
    listOmitsFields: true, // LIST omits properties.apiId
  },
  [ResourceType.ApiTagDescription]: {
    armPathSuffix: 'apis/{0}/tagDescriptions/{1}',
    artifactDirectory: 'apis/{0}/tagDescriptions/{1}',
    infoFile: 'tagDescriptionInformation.json',
    supportsGet: true,
  },
  [ResourceType.ApiWiki]: {
    armPathSuffix: 'apis/{0}/wikis/default',
    artifactDirectory: 'apis/{0}',
    infoFile: 'wiki.md',
    supportsGet: true,
  },
  [ResourceType.ProductWiki]: {
    armPathSuffix: 'products/{0}/wikis/default',
    artifactDirectory: 'products/{0}',
    infoFile: 'wiki.md',
    supportsGet: true,
  },
  [ResourceType.GraphQLResolver]: {
    armPathSuffix: 'apis/{0}/resolvers/{1}',
    artifactDirectory: 'apis/{0}/resolvers/{1}',
    infoFile: 'resolverInformation.json',
    supportsGet: true,
  },
  [ResourceType.GraphQLResolverPolicy]: {
    armPathSuffix: 'apis/{0}/resolvers/{1}/policies/policy',
    artifactDirectory: 'apis/{0}/resolvers/{1}',
    infoFile: 'policy.xml',
    supportsGet: true,
  },
  [ResourceType.McpServer]: {
    // Singleton MCP (Model Context Protocol) server configuration per API.
    // ARM path: apis/{apiId}/mcpServers/default
    armPathSuffix: 'apis/{0}/mcpServers/default',
    artifactDirectory: 'apis/{0}',
    infoFile: 'mcpServerInformation.json',
    supportsGet: true,
  },
  [ResourceType.Workspace]: {
    armPathSuffix: 'workspaces/{0}',
    artifactDirectory: 'workspaces/{0}',
    infoFile: 'workspaceInformation.json',
    supportsGet: true,
  },
};
