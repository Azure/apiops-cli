// ============================================================================
// Target APIM Instance — Blank service with supporting infrastructure
// ============================================================================
// Deploys a blank Azure API Management instance (no child resources) plus
// the supporting infrastructure (App Insights, Event Hub, Key Vault) needed
// for the extract→publish round-trip integration test.
//
// The supporting infra is required because extracted loggers reference
// App Insights resource IDs, named values reference Key Vault URIs, etc.
//
// Usage:
//   az deployment group create -g <rg> -f target-apim.bicep \
//     -p apimName=<name> publisherEmail=<email> skuName=<sku>
// ============================================================================

// ---------------------------------------------------------------------------
// Parameters (same interface as source-apim.bicep)
// ---------------------------------------------------------------------------

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Unique name for the APIM instance.')
param apimName string = 'bvt-${uniqueString(resourceGroup().id)}-tgt-apim'

@description('Publisher email shown in the developer portal.')
param publisherEmail string

@description('Publisher name shown in the developer portal.')
param publisherName string = 'APIOps BVT'

@description('APIM SKU name. Must match the source instance SKU.')
@allowed(['Developer', 'Premium', 'Standard', 'StandardV2', 'PremiumV2'])
param skuName string = 'StandardV2'

@description('Application Insights name for logger/diagnostic testing.')
param appInsightsName string = 'bvt-${uniqueString(resourceGroup().id)}-tgt-ai'

@description('Event Hub namespace name for Event Hub logger testing.')
param eventHubNamespaceName string = 'bvt-${uniqueString(resourceGroup().id)}-tgt-eh'

@description('Key Vault name for NamedValue KeyVault reference testing.')
param keyVaultName string = 'bvt-${uniqueString(resourceGroup().id)}-tgt-kv'

@description('Log Analytics workspace name for Application Insights.')
param logAnalyticsName string = 'bvt-${uniqueString(resourceGroup().id)}-tgt-law'

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

var isClassicSku = skuName == 'Developer' || skuName == 'Premium' || skuName == 'Standard'
var apimSkuCapacity = isClassicSku ? 1 : 1

// ---------------------------------------------------------------------------
// Supporting Resources
// ---------------------------------------------------------------------------

// Log Analytics Workspace (required for workspace-based Application Insights)
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// Application Insights (for Logger + Diagnostic)
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// Event Hub Namespace (for Event Hub Logger)
resource eventHubNamespace 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: eventHubNamespaceName
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 1
  }
}

resource eventHub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = {
  parent: eventHubNamespace
  name: 'tgt-eh-logs'
  properties: {
    messageRetentionInDays: 1
    partitionCount: 2
  }
}

resource eventHubAuthRule 'Microsoft.EventHub/namespaces/authorizationRules@2024-01-01' = {
  parent: eventHubNamespace
  name: 'tgt-eh-send'
  properties: {
    rights: ['Send']
  }
}

// Key Vault (for NamedValue KeyVault reference)
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: false
    accessPolicies: []
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource kvSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'tgt-secret-value'
  properties: {
    value: 'source-apim-secret-value'
  }
}

// ---------------------------------------------------------------------------
// APIM Service (blank — no child resources)
// ---------------------------------------------------------------------------

resource apim 'Microsoft.ApiManagement/service@2025-09-01-preview' = {
  name: apimName
  location: location
  sku: {
    name: skuName
    capacity: apimSkuCapacity
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
  }
}

resource kvAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = {
  name: 'add'
  parent: keyVault
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: apim.identity.principalId
        permissions: {
          secrets: ['get']
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

@description('APIM service name — use as --service-name for APIOps CLI')
output apimServiceName string = apim.name

@description('Resource group name — use as --resource-group for APIOps CLI')
output resourceGroupName string = resourceGroup().name

@description('Azure subscription ID — use as --subscription-id for APIOps CLI')
output subscriptionId string = subscription().subscriptionId

@description('APIM gateway URL')
output gatewayUrl string = apim.properties.gatewayUrl

@description('APIM SKU used')
output skuName string = skuName

@description('Application Insights instrumentation key')
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey

@description('Application Insights resource ID')
output appInsightsResourceId string = appInsights.id

@description('Event Hub namespace name')
output eventHubNamespaceName string = eventHubNamespace.name

@description('Key Vault name')
output keyVaultName string = keyVault.name

@description('Key Vault URI')
output keyVaultUri string = keyVault.properties.vaultUri
