// ============================================================================
// Target APIM — Unmatched Resources (delete-unmatched coverage)
// ============================================================================
// Seeds extra "unmatched" child resources into an already-deployed target APIM
// instance. These resources do NOT exist in the source instance, so a publish
// run with --delete-unmatched must remove them and the round-trip compare phase
// then confirms the target matches the source.
//
// Deployed only when the round trip runs with -TestDeleteUnmatched. It targets
// the APIM service created by target-apim.bicep (referenced as existing).
//
// Usage:
//   az deployment group create -g <rg> -f target-apim-unmatched.bicep \
//     -p apimName=<name>
// ============================================================================

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@description('Name of the existing target APIM instance to seed with unmatched resources.')
param apimName string

// ---------------------------------------------------------------------------
// Existing APIM instance
// ---------------------------------------------------------------------------

resource apim 'Microsoft.ApiManagement/service@2025-09-01-preview' existing = {
  name: apimName
}

// ---------------------------------------------------------------------------
// Unmatched resources
// ---------------------------------------------------------------------------

// 1. Revisioned API (base + second revision) — the core --delete-unmatched
//    scenario: an API whose revisions must all be removed together.
resource apiRevisioned 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'tgt-unmatched-revisioned'
  properties: {
    displayName: 'TGT Unmatched Revisioned'
    description: 'Unmatched revisioned API seeded for delete-unmatched coverage'
    path: 'tgt/unmatched-revisioned'
    protocols: ['https']
    serviceUrl: 'https://tgt-unmatched-backend.example.com/api'
    subscriptionRequired: false
    apiType: 'http'
    isCurrent: true
  }
}

resource apiRevisionedRev2 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'tgt-unmatched-revisioned;rev=2'
  properties: {
    path: 'tgt/unmatched-revisioned'
    protocols: ['https']
    serviceUrl: 'https://tgt-unmatched-backend-v2.example.com/api'
    apiRevisionDescription: 'Second revision seeded for delete-unmatched coverage'
    sourceApiId: apiRevisioned.id
    apiType: 'http'
  }
}

// 2. Named value — an unmatched non-API resource type.
resource unmatchedNamedValue 'Microsoft.ApiManagement/service/namedValues@2025-09-01-preview' = {
  parent: apim
  name: 'tgt-unmatched-nv'
  properties: {
    displayName: 'tgt-unmatched-nv'
    value: 'unmatched-value'
    secret: false
  }
}

// 3. Backend — another unmatched resource type.
resource unmatchedBackend 'Microsoft.ApiManagement/service/backends@2025-09-01-preview' = {
  parent: apim
  name: 'tgt-unmatched-backend'
  properties: {
    url: 'https://tgt-unmatched-backend.example.com'
    protocol: 'http'
    description: 'Unmatched backend seeded for delete-unmatched coverage'
  }
}
