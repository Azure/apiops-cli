// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Sovereign cloud configuration
 * Maps the --cloud CLI flag to ARM base URLs and auth scopes for
 * Azure Public, China, US Government, and Germany clouds.
 */

/**
 * Cloud environment configuration containing ARM endpoint and auth scope.
 */
export interface CloudConfig {
  /** Azure Resource Manager base URL (e.g. https://management.azure.com) */
  readonly armBaseUrl: string;
  /** OAuth2 scope for ARM token requests */
  readonly authScope: string;
}

/**
 * Canonical short names accepted by the --cloud CLI flag.
 */
export type CloudName = 'public' | 'china' | 'usgov' | 'germany';

/**
 * Official Azure cloud environment names (long form).
 */
type OfficialCloudName = 'AzureCloud' | 'AzureChinaCloud' | 'AzureUSGovernment' | 'AzureGermanCloud';

const CLOUD_CONFIGS: Record<CloudName, CloudConfig> = {
  public: {
    armBaseUrl: 'https://management.azure.com',
    authScope: 'https://management.azure.com/.default',
  },
  china: {
    armBaseUrl: 'https://management.chinacloudapi.cn',
    authScope: 'https://management.chinacloudapi.cn/.default',
  },
  usgov: {
    armBaseUrl: 'https://management.usgovcloudapi.net',
    authScope: 'https://management.usgovcloudapi.net/.default',
  },
  germany: {
    armBaseUrl: 'https://management.microsoftazure.de',
    authScope: 'https://management.microsoftazure.de/.default',
  },
};

/** Map official long names to canonical short names */
const OFFICIAL_NAME_MAP: Record<OfficialCloudName, CloudName> = {
  AzureCloud: 'public',
  AzureChinaCloud: 'china',
  AzureUSGovernment: 'usgov',
  AzureGermanCloud: 'germany',
};

/**
 * Resolve a cloud name (short or official long form) to its configuration.
 * Throws if the name is not recognized.
 */
export function getCloudConfig(cloudName: string): CloudConfig {
  // Try short name first
  const shortName = cloudName as CloudName;
  if (CLOUD_CONFIGS[shortName]) {
    return CLOUD_CONFIGS[shortName];
  }

  // Try official long name
  const mapped = OFFICIAL_NAME_MAP[cloudName as OfficialCloudName];
  if (mapped) {
    return CLOUD_CONFIGS[mapped];
  }

  const validNames = [
    ...Object.keys(CLOUD_CONFIGS),
    ...Object.keys(OFFICIAL_NAME_MAP),
  ].join(', ');
  throw new Error(`Unknown cloud "${cloudName}". Valid values: ${validNames}`);
}

/**
 * Build the APIM ARM base URL for a given cloud, subscription, resource group,
 * and service name. Replaces the hardcoded buildBaseUrl functions in command files.
 */
export function buildArmBaseUrl(
  cloudName: string,
  subscriptionId: string,
  resourceGroup: string,
  serviceName: string,
): string {
  const config = getCloudConfig(cloudName);
  return `${config.armBaseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.ApiManagement/service/${encodeURIComponent(serviceName)}`;
}
