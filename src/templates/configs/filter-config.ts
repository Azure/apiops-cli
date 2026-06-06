// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T047: Sample filter configuration template
 * Generates a sample configuration.extractor.yaml file
 */

export function generateFilterConfig(): string {
  return `# APIM Extract Filter Configuration
# Customize this file to control which resources are extracted

# Extract only specific APIs by name
# apis:
#   - echo-api
#   - petstore-api

# Extract only specific products
# products:
#   - starter
#   - unlimited

# Extract only specific backends
# backends:
#   - backend-api
#   - legacy-backend

# Extract only specific named values
# namedValues:
#   - api-key
#   - connection-string

# Extract only specific loggers
# loggers:
#   - appinsights-logger

# Extract only specific diagnostics
# diagnostics:
#   - applicationinsights

# Extract only specific tags
# tags:
#   - production
#   - external

# Extract only specific policy fragments
# policyFragments:
#   - rate-limit-fragment
#   - cors-fragment

# Extract only specific gateways
# gateways:
#   - default
#   - internal-gateway

# Extract only specific version sets
# versionSets:
#   - payments-v1

# Extract only specific groups
# groups:
#   - administrators

# Extract only specific subscriptions
# subscriptions:
#   - starter-subscription

# Extract only specific schemas
# schemas:
#   - pet-schema

# Extract only specific policy restrictions
# policyRestrictions:
#   - global-policy-restriction

# Extract only specific documentations
# documentations:
#   - getting-started

# Extract only specific workspaces
# workspaces:
#   - dev-workspace

# Filter behavior:
# - Leave a section commented out to include ALL resources of that type
# - Set a section to an empty array ([]) to exclude ALL resources of that type
#   Example:
#   gateways: []
#   subscriptions: []
`;
}
