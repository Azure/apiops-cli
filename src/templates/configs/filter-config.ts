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

# Extract only specific gateways
# gatewayNames:
#   - default
#   - internal-gateway

# Extract only specific version sets
# versionSetNames:
#   - payments-v1

# Extract only specific groups
# groupNames:
#   - administrators

# Extract only specific subscriptions
# subscriptionNames:
#   - starter-subscription

# Extract only specific schemas
# schemaNames:
#   - pet-schema

# Extract only specific policy restrictions
# policyRestrictionNames:
#   - global-policy-restriction

# Extract only specific documentations
# documentationNames:
#   - getting-started

# Extract only specific workspaces
# workspaceNames:
#   - dev-workspace

# Filter behavior:
# - Leave a section commented out to include ALL resources of that type
# - Set a section to an empty array ([]) to exclude ALL resources of that type
#   Example:
#   gatewayNames: []
#   subscriptionNames: []
`;
}
