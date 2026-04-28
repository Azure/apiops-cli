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
}

export const RESOURCE_TYPE_METADATA: Record<ResourceType, ResourceTypeMetadata> = {
  [ResourceType.NamedValue]: {
    armPathSuffix: 'namedValues/{0}',
    artifactDirectory: 'namedValues/{0}',
    infoFile: 'namedValueInformation.json',
  },
  [ResourceType.Tag]: {
    armPathSuffix: 'tags/{0}',
    artifactDirectory: 'tags/{0}',
    infoFile: 'tagInformation.json',
  },
  [ResourceType.Gateway]: {
    armPathSuffix: 'gateways/{0}',
    artifactDirectory: 'gateways/{0}',
    infoFile: 'gatewayInformation.json',
  },
  [ResourceType.VersionSet]: {
    armPathSuffix: 'apiVersionSets/{0}',
    artifactDirectory: 'versionSets/{0}',
    infoFile: 'versionSetInformation.json',
  },
  [ResourceType.Backend]: {
    armPathSuffix: 'backends/{0}',
    artifactDirectory: 'backends/{0}',
    infoFile: 'backendInformation.json',
  },
  [ResourceType.Logger]: {
    armPathSuffix: 'loggers/{0}',
    artifactDirectory: 'loggers/{0}',
    infoFile: 'loggerInformation.json',
  },
  [ResourceType.Group]: {
    armPathSuffix: 'groups/{0}',
    artifactDirectory: 'groups/{0}',
    infoFile: 'groupInformation.json',
  },
  [ResourceType.Diagnostic]: {
    armPathSuffix: 'diagnostics/{0}',
    artifactDirectory: 'diagnostics/{0}',
    infoFile: 'diagnosticInformation.json',
  },
  [ResourceType.PolicyFragment]: {
    armPathSuffix: 'policyFragments/{0}',
    artifactDirectory: 'policyFragments/{0}',
    infoFile: 'policyFragmentInformation.json',
  },
  [ResourceType.ServicePolicy]: {
    armPathSuffix: 'policies/policy',
    artifactDirectory: '',
    infoFile: 'policy.xml',
  },
  [ResourceType.Product]: {
    armPathSuffix: 'products/{0}',
    artifactDirectory: 'products/{0}',
    infoFile: 'productInformation.json',
  },
  [ResourceType.ProductPolicy]: {
    armPathSuffix: 'products/{0}/policies/policy',
    artifactDirectory: 'products/{0}',
    infoFile: 'policy.xml',
  },
  [ResourceType.ProductApi]: {
    armPathSuffix: 'products/{0}/apis/{1}',
    artifactDirectory: 'products/{0}',
    infoFile: 'apis.json',
  },
  [ResourceType.ProductGroup]: {
    armPathSuffix: 'products/{0}/groups/{1}',
    artifactDirectory: 'products/{0}',
    infoFile: 'groups.json',
  },
  [ResourceType.ProductTag]: {
    armPathSuffix: 'products/{0}/tags/{1}',
    artifactDirectory: 'products/{0}',
    infoFile: null, // Embedded in productInformation.json
  },
  [ResourceType.Api]: {
    armPathSuffix: 'apis/{0}',
    artifactDirectory: 'apis/{0}',
    infoFile: 'apiInformation.json',
  },
  [ResourceType.ApiPolicy]: {
    armPathSuffix: 'apis/{0}/policies/policy',
    artifactDirectory: 'apis/{0}',
    infoFile: 'policy.xml',
  },
  [ResourceType.ApiTag]: {
    armPathSuffix: 'apis/{0}/tags/{1}',
    artifactDirectory: 'apis/{0}/tags/{1}',
    infoFile: 'tagInformation.json',
  },
  [ResourceType.ApiDiagnostic]: {
    armPathSuffix: 'apis/{0}/diagnostics/{1}',
    artifactDirectory: 'apis/{0}/diagnostics/{1}',
    infoFile: 'diagnosticInformation.json',
  },
  [ResourceType.ApiOperation]: {
    armPathSuffix: 'apis/{0}/operations/{1}',
    artifactDirectory: 'apis/{0}/operations/{1}',
    infoFile: null,
  },
  [ResourceType.ApiOperationPolicy]: {
    armPathSuffix: 'apis/{0}/operations/{1}/policies/policy',
    artifactDirectory: 'apis/{0}/operations/{1}',
    infoFile: 'policy.xml',
  },
  [ResourceType.GatewayApi]: {
    armPathSuffix: 'gateways/{0}/apis/{1}',
    artifactDirectory: 'gateways/{0}',
    infoFile: 'apis.json',
  },
  [ResourceType.Subscription]: {
    armPathSuffix: 'subscriptions/{0}',
    artifactDirectory: 'subscriptions/{0}',
    infoFile: 'subscriptionInformation.json',
  },
  [ResourceType.GlobalSchema]: {
    armPathSuffix: 'schemas/{0}',
    artifactDirectory: 'schemas/{0}',
    infoFile: 'schemaInformation.json',
  },
  [ResourceType.PolicyRestriction]: {
    armPathSuffix: 'policyRestrictions/{0}',
    artifactDirectory: 'policyRestrictions/{0}',
    infoFile: 'policyRestrictionInformation.json',
  },
  [ResourceType.Documentation]: {
    armPathSuffix: 'documentations/{0}',
    artifactDirectory: 'documentations/{0}',
    infoFile: 'documentationInformation.json',
  },
  [ResourceType.ApiSchema]: {
    armPathSuffix: 'apis/{0}/schemas/{1}',
    artifactDirectory: 'apis/{0}/schemas/{1}',
    infoFile: 'schemaInformation.json',
  },
  [ResourceType.ApiRelease]: {
    armPathSuffix: 'apis/{0}/releases/{1}',
    artifactDirectory: 'apis/{0}/releases/{1}',
    infoFile: 'releaseInformation.json',
  },
  [ResourceType.ApiTagDescription]: {
    armPathSuffix: 'apis/{0}/tagDescriptions/{1}',
    artifactDirectory: 'apis/{0}/tagDescriptions/{1}',
    infoFile: 'tagDescriptionInformation.json',
  },
  [ResourceType.ApiWiki]: {
    armPathSuffix: 'apis/{0}/wikis/default',
    artifactDirectory: 'apis/{0}',
    infoFile: 'wiki.md',
  },
  [ResourceType.ProductWiki]: {
    armPathSuffix: 'products/{0}/wikis/default',
    artifactDirectory: 'products/{0}',
    infoFile: 'wiki.md',
  },
  [ResourceType.GraphQLResolver]: {
    armPathSuffix: 'apis/{0}/resolvers/{1}',
    artifactDirectory: 'apis/{0}/resolvers/{1}',
    infoFile: 'resolverInformation.json',
  },
  [ResourceType.GraphQLResolverPolicy]: {
    armPathSuffix: 'apis/{0}/resolvers/{1}/policies/policy',
    artifactDirectory: 'apis/{0}/resolvers/{1}',
    infoFile: 'policy.xml',
  },
};
