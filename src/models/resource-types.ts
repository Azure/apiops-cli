/**
 * T006: ResourceType enum and metadata
 * All 33 APIM resource types with ARM path suffixes, artifact directories, and info file names
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
}

export interface ResourceTypeMetadata {
  armPathSuffix: string;
  artifactDirectory: string;
  infoFile: string | null;
}

/** Placeholder tokens used in artifactDirectory patterns */
export const PLACEHOLDER_NAME = '{name}' as const;
export const PLACEHOLDER_PARENT_NAME = '{parent-name}' as const;
export const PLACEHOLDER_GRANDPARENT_NAME = '{grandparent-name}' as const;

export const RESOURCE_TYPE_METADATA: Record<ResourceType, ResourceTypeMetadata> = {
  [ResourceType.NamedValue]: {
    armPathSuffix: '/namedValues/{name}',
    artifactDirectory: `namedValues/${PLACEHOLDER_NAME}/`,
    infoFile: 'namedValueInformation.json',
  },
  [ResourceType.Tag]: {
    armPathSuffix: '/tags/{name}',
    artifactDirectory: `tags/${PLACEHOLDER_NAME}/`,
    infoFile: 'tagInformation.json',
  },
  [ResourceType.Gateway]: {
    armPathSuffix: '/gateways/{name}',
    artifactDirectory: `gateways/${PLACEHOLDER_NAME}/`,
    infoFile: 'gatewayInformation.json',
  },
  [ResourceType.VersionSet]: {
    armPathSuffix: '/apiVersionSets/{name}',
    artifactDirectory: `versionSets/${PLACEHOLDER_NAME}/`,
    infoFile: 'versionSetInformation.json',
  },
  [ResourceType.Backend]: {
    armPathSuffix: '/backends/{name}',
    artifactDirectory: `backends/${PLACEHOLDER_NAME}/`,
    infoFile: 'backendInformation.json',
  },
  [ResourceType.Logger]: {
    armPathSuffix: '/loggers/{name}',
    artifactDirectory: `loggers/${PLACEHOLDER_NAME}/`,
    infoFile: 'loggerInformation.json',
  },
  [ResourceType.Group]: {
    armPathSuffix: '/groups/{name}',
    artifactDirectory: `groups/${PLACEHOLDER_NAME}/`,
    infoFile: 'groupInformation.json',
  },
  [ResourceType.Diagnostic]: {
    armPathSuffix: '/diagnostics/{name}',
    artifactDirectory: `diagnostics/${PLACEHOLDER_NAME}/`,
    infoFile: 'diagnosticInformation.json',
  },
  [ResourceType.PolicyFragment]: {
    armPathSuffix: '/policyFragments/{name}',
    artifactDirectory: `policyFragments/${PLACEHOLDER_NAME}/`,
    infoFile: 'policyFragmentInformation.json',
  },
  [ResourceType.ServicePolicy]: {
    armPathSuffix: '/policies/policy',
    artifactDirectory: '',
    infoFile: 'policy.xml',
  },
  [ResourceType.Product]: {
    armPathSuffix: '/products/{name}',
    artifactDirectory: `products/${PLACEHOLDER_NAME}/`,
    infoFile: 'productInformation.json',
  },
  [ResourceType.ProductPolicy]: {
    armPathSuffix: '/products/{name}/policies/policy',
    artifactDirectory: `products/${PLACEHOLDER_NAME}/`,
    infoFile: 'policy.xml',
  },
  [ResourceType.ProductApi]: {
    armPathSuffix: '/products/{name}/apis/{apiName}',
    artifactDirectory: `products/${PLACEHOLDER_NAME}/`,
    infoFile: 'apis.json',
  },
  [ResourceType.ProductGroup]: {
    armPathSuffix: '/products/{name}/groups/{groupName}',
    artifactDirectory: `products/${PLACEHOLDER_NAME}/`,
    infoFile: 'groups.json',
  },
  [ResourceType.ProductTag]: {
    armPathSuffix: '/products/{name}/tags/{tagName}',
    artifactDirectory: `products/${PLACEHOLDER_NAME}/`,
    infoFile: null, // Embedded in productInformation.json
  },
  [ResourceType.Api]: {
    armPathSuffix: '/apis/{name}',
    artifactDirectory: `apis/${PLACEHOLDER_NAME}/`,
    infoFile: 'apiInformation.json',
  },
  [ResourceType.ApiPolicy]: {
    armPathSuffix: '/apis/{name}/policies/policy',
    artifactDirectory: `apis/${PLACEHOLDER_NAME}/`,
    infoFile: 'policy.xml',
  },
  [ResourceType.ApiTag]: {
    armPathSuffix: '/apis/{apiName}/tags/{tagName}',
    artifactDirectory: `apis/${PLACEHOLDER_PARENT_NAME}/tags/${PLACEHOLDER_NAME}/`,
    infoFile: 'tagInformation.json',
  },
  [ResourceType.ApiDiagnostic]: {
    armPathSuffix: '/apis/{apiName}/diagnostics/{diagName}',
    artifactDirectory: `apis/${PLACEHOLDER_PARENT_NAME}/diagnostics/${PLACEHOLDER_NAME}/`,
    infoFile: 'diagnosticInformation.json',
  },
  [ResourceType.ApiOperation]: {
    armPathSuffix: '/apis/{apiName}/operations/{opName}',
    artifactDirectory: `apis/${PLACEHOLDER_PARENT_NAME}/operations/${PLACEHOLDER_NAME}/`,
    infoFile: null,
  },
  [ResourceType.ApiOperationPolicy]: {
    armPathSuffix: '/apis/{name}/operations/{opName}/policies/policy',
    artifactDirectory: `apis/${PLACEHOLDER_GRANDPARENT_NAME}/operations/${PLACEHOLDER_PARENT_NAME}/`,
    infoFile: 'policy.xml',
  },
  [ResourceType.GatewayApi]: {
    armPathSuffix: '/gateways/{name}/apis/{apiName}',
    artifactDirectory: `gateways/${PLACEHOLDER_NAME}/`,
    infoFile: 'apis.json',
  },
  [ResourceType.Subscription]: {
    armPathSuffix: '/subscriptions/{name}',
    artifactDirectory: `subscriptions/${PLACEHOLDER_NAME}/`,
    infoFile: 'subscriptionInformation.json',
  },
  [ResourceType.GlobalSchema]: {
    armPathSuffix: '/schemas/{name}',
    artifactDirectory: `schemas/${PLACEHOLDER_NAME}/`,
    infoFile: 'schemaInformation.json',
  },
  [ResourceType.PolicyRestriction]: {
    armPathSuffix: '/policyRestrictions/{name}',
    artifactDirectory: `policyRestrictions/${PLACEHOLDER_NAME}/`,
    infoFile: 'policyRestrictionInformation.json',
  },
  [ResourceType.Documentation]: {
    armPathSuffix: '/documentations/{name}',
    artifactDirectory: `documentations/${PLACEHOLDER_NAME}/`,
    infoFile: 'documentationInformation.json',
  },
  [ResourceType.ApiSchema]: {
    armPathSuffix: '/apis/{apiName}/schemas/{schemaName}',
    artifactDirectory: `apis/${PLACEHOLDER_PARENT_NAME}/schemas/${PLACEHOLDER_NAME}/`,
    infoFile: 'schemaInformation.json',
  },
  [ResourceType.ApiRelease]: {
    armPathSuffix: '/apis/{apiName}/releases/{releaseName}',
    artifactDirectory: `apis/${PLACEHOLDER_PARENT_NAME}/releases/${PLACEHOLDER_NAME}/`,
    infoFile: 'releaseInformation.json',
  },
  [ResourceType.ApiTagDescription]: {
    armPathSuffix: '/apis/{apiName}/tagDescriptions/{tagDescName}',
    artifactDirectory: `apis/${PLACEHOLDER_PARENT_NAME}/tagDescriptions/${PLACEHOLDER_NAME}/`,
    infoFile: 'tagDescriptionInformation.json',
  },
  [ResourceType.ApiWiki]: {
    armPathSuffix: '/apis/{name}/wikis/default',
    artifactDirectory: `apis/${PLACEHOLDER_NAME}/`,
    infoFile: 'wiki.md',
  },
  [ResourceType.ProductWiki]: {
    armPathSuffix: '/products/{name}/wikis/default',
    artifactDirectory: `products/${PLACEHOLDER_NAME}/`,
    infoFile: 'wiki.md',
  },
  [ResourceType.GraphQLResolver]: {
    armPathSuffix: '/apis/{apiName}/resolvers/{resolverName}',
    artifactDirectory: `apis/${PLACEHOLDER_PARENT_NAME}/resolvers/${PLACEHOLDER_NAME}/`,
    infoFile: 'resolverInformation.json',
  },
  [ResourceType.GraphQLResolverPolicy]: {
    armPathSuffix: '/apis/{name}/resolvers/{resolverName}/policies/policy',
    artifactDirectory: `apis/${PLACEHOLDER_GRANDPARENT_NAME}/resolvers/${PLACEHOLDER_PARENT_NAME}/`,
    infoFile: 'policy.xml',
  },
};
