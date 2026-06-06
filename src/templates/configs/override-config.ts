// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T047: Sample override configuration template per environment
 * Generates environment-specific configuration.{env}.yaml files
 */

export function generateOverrideConfig(environment: string): string {
  return `# APIM Override Configuration for ${environment} environment
# Customize resource properties for this specific environment

# Override named values (e.g., API keys, connection strings)
# namedValues:
#   - name: api-key
#     properties:
#       value: "${environment}-api-key-value"
#   - name: connection-string
#     properties:
#       value: "Server=${environment}-db.example.com;Database=mydb"
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

# Override API service URLs
# apis:
#   - name: echo-api
#     properties:
#       serviceUrl: "https://${environment}-echo.example.com"
#   - name: petstore-api
#     properties:
#       serviceUrl: "https://${environment}-petstore.example.com"

# Override diagnostic logger references
# diagnostics:
#   - name: applicationinsights
#     properties:
#       loggerId: "appinsights-logger-${environment}"

# Override logger credentials or resource IDs
# loggers:
#   - name: appinsights-logger
#     properties:
#       resourceId: "/subscriptions/xxxxx/resourceGroups/${environment}-rg/providers/microsoft.insights/components/${environment}-appinsights"
`;
}
