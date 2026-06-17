// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Sample override configuration template per environment
 * Generates environment-specific configuration.{env}.yaml files
 */

export function generateOverrideConfig(environment: string): string {
  return `# APIM Override Configuration for ${environment} environment
# Customize resource properties for this specific environment
# For full format details and examples, see:
# https://github.com/Azure/apiops-cli/blob/main/docs/guides/environment-overrides.md

# Override named values (e.g., API keys, connection strings)
# namedValues:
#   - name: api-key
#     properties:
#       value: "{#[api-key]#}"
#   - name: connection-string
#     properties:
#       value: "{#[DB_Connection_String]#}"
#   - name: secret-from-keyvault
#     properties:
#       keyVault:
#         secretIdentifier: "https://${environment}-kv.vault.azure.net/secrets/my-secret"
#         identityClientId: "00000000-0000-0000-0000-000000000000"

# Override backend URLs per environment
# backends:
#   - name: backend-api
#     properties:
#       url: "https://${environment}-api.example.com"
#   - name: legacy-backend
#     properties:
#       url: "https://${environment}-legacy.example.com"
#       resourceId: "/subscriptions/.../sites/${environment}-backend"

# Override API service URLs (with optional nested sub-resource overrides)
# apis:
#   - name: echo-api
#     properties:
#       serviceUrl: "https://${environment}-echo.example.com"
#   - name: petstore-api
#     properties:
#       serviceUrl: "https://${environment}-petstore.example.com"
#       displayName: "Petstore API (${environment})"
#     diagnostics:
#       - name: applicationinsights
#         properties:
#           loggerId: "appinsights-logger-${environment}"
#           verbosity: Error
#     policies:
#       - name: policy
#         properties:
#           format: rawxml

# Override diagnostic logger references
# diagnostics:
#   - name: applicationinsights
#     properties:
#       loggerId: "appinsights-logger-${environment}"
#       verbosity: Error

# Override logger credentials or resource IDs
# loggers:
#   - name: appinsights-logger
#     properties:
#       loggerType: applicationInsights
#       resourceId: "/subscriptions/xxxxx/resourceGroups/${environment}-rg/providers/microsoft.insights/components/${environment}-appinsights"
#       isBuffered: true
#       credentials:
#         instrumentationKey: "<APP-INSIGHTS-INSTRUMENTATION-KEY>"

# Override service-level policies
# policies:
#   - name: policy
#     properties:
#       format: rawxml

# Override gateway properties
# gateways:
#   - name: on-prem-gateway
#     properties:
#       locationData:
#         name: "${environment} datacenter"

# Override version sets, groups, subscriptions, products, tags, policy fragments
# versionSets:
#   - name: my-version-set
#     properties:
#       displayName: "My Version Set (${environment})"
# products:
#   - name: starter
#     properties:
#       displayName: "Starter Plan (${environment})"
# tags:
#   - name: env-tag
#     properties:
#       displayName: "${environment}"
`;
}
