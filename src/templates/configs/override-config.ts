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
#   api-key:
#     value: "${environment}-api-key-value"
#   connection-string:
#     value: "Server=${environment}-db.example.com;Database=mydb"
#   secret-from-keyvault:
#     keyVault:
#       secretIdentifier: "https://${environment}-kv.vault.azure.net/secrets/my-secret"
#       identityClientId: "00000000-0000-0000-0000-000000000000"

# Override backend URLs per environment
# backends:
#   backend-api:
#     url: "https://${environment}-api.example.com"
#   legacy-backend:
#     url: "https://${environment}-legacy.example.com"

# Override API service URLs
# apis:
#   echo-api:
#     serviceUrl: "https://${environment}-echo.example.com"
#   petstore-api:
#     serviceUrl: "https://${environment}-petstore.example.com"

# Override diagnostic logger references
# diagnostics:
#   applicationinsights:
#     loggerId: "appinsights-logger-${environment}"

# Override logger credentials or resource IDs
# loggers:
#   appinsights-logger:
#     resourceId: "/subscriptions/xxxxx/resourceGroups/${environment}-rg/providers/microsoft.insights/components/${environment}-appinsights"
`;
}
