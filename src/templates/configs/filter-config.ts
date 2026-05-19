// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T047: Sample filter configuration template
 * Generates a sample configuration.extract.yaml file
 */

export function generateFilterConfig(): string {
  return `# APIM Extract Filter Configuration
# Customize this file to control which resources are extracted

# Extract only specific APIs by name
# apiNames:
#   - echo-api
#   - petstore-api

# Extract only specific products
# productNames:
#   - starter
#   - unlimited

# Extract only specific backends
# backendNames:
#   - backend-api
#   - legacy-backend

# Extract only specific named values
# namedValueNames:
#   - api-key
#   - connection-string

# Extract only specific loggers
# loggerNames:
#   - appinsights-logger

# Extract only specific diagnostics
# diagnosticNames:
#   - applicationinsights

# Extract only specific tags
# tagNames:
#   - production
#   - external

# Extract only specific policy fragments
# policyFragmentNames:
#   - rate-limit-fragment
#   - cors-fragment

# Uncomment to extract ALL resources (default behavior if no filters specified)
# Leave all sections commented to extract everything
`;
}
