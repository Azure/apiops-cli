// ============================================================================
// All-Resources Source APIM — Build Verification Test Infrastructure
// ============================================================================
// Deploys an Azure API Management instance pre-populated with every resource
// type and API protocol variation that APIOps-v2 supports extracting/publishing.
//
// Usage:
//   az deployment group create -g <rg> -f source-apim.bicep
//
// Provisioning time: ~30-45 minutes (APIM Developer SKU)
// ============================================================================

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Unique name for the APIM instance.')
param apimName string = 'bvt-${uniqueString(resourceGroup().id)}-src-apim'

@description('Publisher email shown in the developer portal.')
param publisherEmail string

@description('Publisher name shown in the developer portal.')
param publisherName string = 'APIOps BVT'

@description('APIM SKU name. Use StandardV2/PremiumV2 for v2 tiers, or Developer/Premium for classic.')
@allowed(['Developer', 'Premium', 'StandardV2', 'PremiumV2'])
param skuName string = 'StandardV2'

@description('Application Insights name for logger/diagnostic testing.')
param appInsightsName string = 'bvt-${uniqueString(resourceGroup().id)}-src-ai'

@description('Event Hub namespace name for Event Hub logger testing.')
param eventHubNamespaceName string = 'bvt-${uniqueString(resourceGroup().id)}-src-eh'

@description('Key Vault name for NamedValue KeyVault reference testing.')
param keyVaultName string = 'bvt-${uniqueString(resourceGroup().id)}-src-kv'

@description('Log Analytics workspace name for Application Insights.')
param logAnalyticsName string = 'bvt-${uniqueString(resourceGroup().id)}-src-law'

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

var isClassicSku = skuName == 'Developer' || skuName == 'Premium'
var apimSkuCapacity = isClassicSku ? 1 : 1
var supportsSelfHostedGateway = isClassicSku
var supportsWorkspaces = skuName == 'Premium' || skuName == 'PremiumV2'

// Minimal but valid OpenAPI 3.0 spec
var openApiSpec = '''
openapi: "3.0.1"
info:
  title: Kitchen Sink REST API
  version: "1.0"
paths:
  /healthz:
    get:
      operationId: healthCheck
      summary: Health check endpoint
      responses:
        "200":
          description: OK
  /items:
    get:
      operationId: listItems
      summary: List all items
      responses:
        "200":
          description: OK
    post:
      operationId: createItem
      summary: Create an item
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
      responses:
        "201":
          description: Created
  /items/{id}:
    get:
      operationId: getItem
      summary: Get item by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: OK
'''

// Minimal but valid GraphQL schema
var graphqlSchema = '''
type Query {
  hero(episode: Episode): Character
  reviews(episode: Episode!): [Review]
}

type Mutation {
  createReview(episode: Episode!, review: ReviewInput!): Review
}

enum Episode {
  NEWHOPE
  EMPIRE
  JEDI
}

type Character {
  id: ID!
  name: String!
  appearsIn: [Episode]!
}

type Review {
  episode: Episode
  stars: Int!
  commentary: String
}

input ReviewInput {
  stars: Int!
  commentary: String
}
'''

// Minimal valid WSDL for SOAP API
var wsdlSpec = '''
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns:tns="http://tempuri.org/"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             name="CalculatorService"
             targetNamespace="http://tempuri.org/">
  <types>
    <xsd:schema targetNamespace="http://tempuri.org/">
      <xsd:element name="Add">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="a" type="xsd:int"/>
            <xsd:element name="b" type="xsd:int"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="AddResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="result" type="xsd:int"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
    </xsd:schema>
  </types>
  <message name="AddSoapIn">
    <part name="parameters" element="tns:Add"/>
  </message>
  <message name="AddSoapOut">
    <part name="parameters" element="tns:AddResponse"/>
  </message>
  <portType name="CalculatorSoap">
    <operation name="Add">
      <input message="tns:AddSoapIn"/>
      <output message="tns:AddSoapOut"/>
    </operation>
  </portType>
  <binding name="CalculatorSoapBinding" type="tns:CalculatorSoap">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="Add">
      <soap:operation soapAction="http://tempuri.org/Add"/>
      <input><soap:body use="literal"/></input>
      <output><soap:body use="literal"/></output>
    </operation>
  </binding>
  <service name="CalculatorService">
    <port name="CalculatorSoapPort" binding="tns:CalculatorSoapBinding">
      <soap:address location="https://src-soap-backend.example.com/calculator"/>
    </port>
  </service>
</definitions>
'''

// Versioned API spec (v1)
var openApiSpecV1 = '''
openapi: "3.0.1"
info:
  title: Kitchen Sink Versioned API
  version: "v1"
paths:
  /status:
    get:
      operationId: getStatus-v1
      summary: Get status (v1)
      responses:
        "200":
          description: OK
'''

// Service-level policy XML (no <base /> allowed at service level)
var servicePolicyXml = '''
<policies>
  <inbound>
    <cors allow-credentials="false">
      <allowed-origins>
        <origin>https://developer.contoso.com</origin>
      </allowed-origins>
      <allowed-methods><method>GET</method><method>POST</method></allowed-methods>
      <allowed-headers><header>Content-Type</header><header>Authorization</header></allowed-headers>
    </cors>
  </inbound>
  <backend />
  <outbound />
  <on-error />
</policies>
'''

// API-level policy XML
var apiPolicyXml = '''
<policies>
  <inbound>
    <base />
    <set-header name="X-all-resources" exists-action="override">
      <value>true</value>
    </set-header>
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>
'''

// Operation-level policy XML
var operationPolicyXml = '''
<policies>
  <inbound>
    <base />
    <rate-limit calls="100" renewal-period="60" />
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>
'''

// Product policy XML (renewal-period max is 300 seconds)
var productPolicyXml = '''
<policies>
  <inbound>
    <base />
    <rate-limit calls="1000" renewal-period="300" />
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>
'''

// GraphQL resolver policy XML
var resolverPolicyXml = '''
<http-data-source>
  <http-request>
    <set-method>POST</set-method>
    <set-url>https://src-graphql-backend.example.com/api/hero</set-url>
    <set-header name="Content-Type" exists-action="override">
      <value>application/json</value>
    </set-header>
    <set-body>{"query":"{ countries { name code } }"}</set-body>
  </http-request>
</http-data-source>
'''

// Policy fragment: CORS
var corsFragmentXml = '''
<fragment>
  <cors allow-credentials="false">
    <allowed-origins>
      <origin>*</origin>
    </allowed-origins>
    <allowed-methods preflight-result-max-age="300">
      <method>*</method>
    </allowed-methods>
    <allowed-headers>
      <header>*</header>
    </allowed-headers>
  </cors>
</fragment>
'''

// Policy fragment: Rate limit
var rateLimitFragmentXml = '''
<fragment>
  <rate-limit calls="50" renewal-period="60" />
</fragment>
'''

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
  name: 'src-apim-logs'
  properties: {
    messageRetentionInDays: 1
    partitionCount: 2
  }
}

resource eventHubAuthRule 'Microsoft.EventHub/namespaces/authorizationRules@2024-01-01' = {
  parent: eventHubNamespace
  name: 'src-apim-send'
  properties: {
    rights: ['Send']
  }
}

// Key Vault (for NamedValue KeyVault reference)
// Using Access Policies instead of RBAC - policies apply synchronously (no propagation delay)
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
    accessPolicies: [] // Will be added after APIM is created
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource kvSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'src-secret-value'
  properties: {
    value: 'all-resources-secret-value'
  }
}

// ---------------------------------------------------------------------------
// APIM Service
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

// Grant APIM identity access to Key Vault secrets via Access Policy (synchronous - no RBAC propagation delay)
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
// TIER 1: Independent Resources
// ---------------------------------------------------------------------------

// --- Named Values ---
resource nvPlain 'Microsoft.ApiManagement/service/namedValues@2025-09-01-preview' = {
  parent: apim
  name: 'src-nv-plain'
  properties: {
    displayName: 'src-nv-plain'
    value: 'plain-text-value'
    tags: ['all-resources', 'plain']
  }
}

resource nvSecret 'Microsoft.ApiManagement/service/namedValues@2025-09-01-preview' = {
  parent: apim
  name: 'src-nv-secret'
  properties: {
    displayName: 'src-nv-secret'
    value: 'secret-value-redacted'
    secret: true
    tags: ['all-resources', 'secret']
  }
}

resource nvKeyVault 'Microsoft.ApiManagement/service/namedValues@2025-09-01-preview' = {
  parent: apim
  name: 'src-nv-keyvault'
  dependsOn: [kvAccessPolicy]
  properties: {
    displayName: 'src-nv-keyvault'
    keyVault: {
      secretIdentifier: '${keyVault.properties.vaultUri}secrets/src-secret-value'
    }
    secret: true
    tags: ['all-resources', 'keyvault']
  }
}

// --- Tags ---
resource tagEnv 'Microsoft.ApiManagement/service/tags@2025-09-01-preview' = {
  parent: apim
  name: 'src-tag-env'
  properties: {
    displayName: 'src-tag-env'
  }
}

resource tagTeam 'Microsoft.ApiManagement/service/tags@2025-09-01-preview' = {
  parent: apim
  name: 'src-tag-team'
  properties: {
    displayName: 'src-tag-team'
  }
}

// --- Gateway (self-hosted — classic SKUs only) ---
resource gateway 'Microsoft.ApiManagement/service/gateways@2025-09-01-preview' = if (supportsSelfHostedGateway) {
  parent: apim
  name: 'src-gateway-onprem'
  properties: {
    description: 'Kitchen sink self-hosted gateway for BVT'
    locationData: {
      name: 'On-Premises DC'
      city: 'Seattle'
      countryOrRegion: 'US'
    }
  }
}

// --- Version Set ---
resource versionSet 'Microsoft.ApiManagement/service/apiVersionSets@2025-09-01-preview' = {
  parent: apim
  name: 'src-versionset-urlpath'
  properties: {
    displayName: 'Kitchen Sink Versioned API'
    versioningScheme: 'Segment'
  }
}

// --- Backends ---
resource backendHttp 'Microsoft.ApiManagement/service/backends@2025-09-01-preview' = {
  parent: apim
  name: 'src-backend-http'
  properties: {
    description: 'Simple HTTP backend'
    url: 'https://src-backend.example.com/api'
    protocol: 'http'
    tls: {
      validateCertificateChain: true
      validateCertificateName: true
    }
  }
}

resource backendFunction 'Microsoft.ApiManagement/service/backends@2025-09-01-preview' = {
  parent: apim
  name: 'src-backend-function'
  properties: {
    description: 'Azure Function backend stub'
    url: 'https://src-func-app.azurewebsites.net/api'
    protocol: 'http'
    resourceId: '${environment().resourceManager}subscriptions/${subscription().subscriptionId}/resourceGroups/${resourceGroup().name}/providers/Microsoft.Web/sites/src-func-app'
  }
}

resource backendLogicApp 'Microsoft.ApiManagement/service/backends@2025-09-01-preview' = {
  parent: apim
  name: 'src-backend-logicapp'
  properties: {
    description: 'Logic App backend stub'
    url: 'https://src-logic-app.azurewebsites.net/api'
    protocol: 'http'
    resourceId: '${environment().resourceManager}subscriptions/${subscription().subscriptionId}/resourceGroups/${resourceGroup().name}/providers/Microsoft.Logic/workflows/src-logic-app'
  }
}

// NOTE: Service Fabric backend omitted - requires actual certificate uploaded to APIM

resource backendCircuitBreaker 'Microsoft.ApiManagement/service/backends@2025-09-01-preview' = {
  parent: apim
  name: 'src-backend-circuit-breaker'
  properties: {
    description: 'Backend with circuit breaker configuration'
    url: 'https://src-cb-backend.example.com/api'
    protocol: 'http'
    circuitBreaker: {
      rules: [
        {
          name: 'src-breaker-rule'
          failureCondition: {
            count: 5
            interval: 'PT1M'
            statusCodeRanges: [
              { min: 500, max: 599 }
            ]
          }
          tripDuration: 'PT30S'
          acceptRetryAfter: true
        }
      ]
    }
  }
}

resource backendPool 'Microsoft.ApiManagement/service/backends@2025-09-01-preview' = {
  parent: apim
  name: 'src-backend-pool'
  properties: {
    description: 'Backend pool referencing multiple backends'
    type: 'Pool'
    pool: {
      services: [
        { id: backendHttp.id, priority: 1, weight: 80 }
        { id: backendCircuitBreaker.id, priority: 1, weight: 20 }
      ]
    }
  }
}

// --- Loggers ---
resource loggerAppInsights 'Microsoft.ApiManagement/service/loggers@2025-09-01-preview' = {
  parent: apim
  name: 'src-logger-appinsights'
  properties: {
    loggerType: 'applicationInsights'
    description: 'Application Insights logger for BVT'
    resourceId: appInsights.id
    credentials: {
      instrumentationKey: appInsights.properties.InstrumentationKey
    }
  }
}

resource loggerEventHub 'Microsoft.ApiManagement/service/loggers@2025-09-01-preview' = {
  parent: apim
  name: 'src-logger-eventhub'
  properties: {
    loggerType: 'azureEventHub'
    description: 'Event Hub logger for BVT'
    credentials: {
      name: eventHub.name
      connectionString: eventHubAuthRule.listKeys().primaryConnectionString
    }
  }
}

// --- Group ---
resource groupInternal 'Microsoft.ApiManagement/service/groups@2025-09-01-preview' = {
  parent: apim
  name: 'src-group-internal'
  properties: {
    displayName: 'Kitchen Sink Internal Group'
    description: 'Custom group for BVT testing'
    type: 'custom'
  }
}

// --- Policy Fragments ---
resource fragmentCors 'Microsoft.ApiManagement/service/policyFragments@2025-09-01-preview' = {
  parent: apim
  name: 'src-fragment-cors'
  properties: {
    description: 'CORS policy fragment'
    format: 'rawxml'
    value: corsFragmentXml
  }
}

resource fragmentRateLimit 'Microsoft.ApiManagement/service/policyFragments@2025-09-01-preview' = {
  parent: apim
  name: 'src-fragment-ratelimit'
  properties: {
    description: 'Rate limit policy fragment'
    format: 'rawxml'
    value: rateLimitFragmentXml
  }
}

// --- Global Schema ---
resource globalSchema 'Microsoft.ApiManagement/service/schemas@2025-09-01-preview' = {
  parent: apim
  name: 'src-schema-json'
  properties: {
    schemaType: 'json'
    description: 'Kitchen sink JSON schema'
    document: {
      type: 'object'
      properties: {
        id: { type: 'string' }
        name: { type: 'string' }
        status: { type: 'string', enum: ['active', 'inactive'] }
      }
      required: ['id', 'name']
    }
  }
}

// --- Policy Restriction (classic SKUs only - not supported in V2 tiers) ---
resource policyRestriction 'Microsoft.ApiManagement/service/policyRestrictions@2025-09-01-preview' = if (isClassicSku) {
  parent: apim
  name: 'src-restriction-ip'
  properties: {
    scope: 'All'
    requireBase: 'true'
  }
}

// --- Documentation (classic SKUs only - V2 tiers use different documentation mechanism) ---
resource documentation 'Microsoft.ApiManagement/service/documentations@2025-09-01-preview' = if (isClassicSku) {
  parent: apim
  name: 'src-doc-getting-started'
  properties: {
    title: 'Getting Started'
    content: '# Getting Started\n\nThis is the kitchen sink APIM instance for BVT testing.\n\n## Quick Start\n\nUse the APIOps CLI to extract and publish configurations.'
  }
}

// ---------------------------------------------------------------------------
// TIER 2: Resources with Dependencies
// ---------------------------------------------------------------------------

// --- Diagnostic ---
resource diagnostic 'Microsoft.ApiManagement/service/diagnostics@2025-09-01-preview' = {
  parent: apim
  name: 'applicationinsights'
  properties: {
    loggerId: loggerAppInsights.id
    alwaysLog: 'allErrors'
    sampling: {
      samplingType: 'fixed'
      percentage: 100
    }
    logClientIp: true
  }
}

// --- Service Policy ---
resource servicePolicy 'Microsoft.ApiManagement/service/policies@2025-09-01-preview' = {
  parent: apim
  name: 'policy'
  dependsOn: [nvPlain, fragmentCors, fragmentRateLimit]
  properties: {
    format: 'rawxml'
    value: servicePolicyXml
  }
}

// --- Products ---
resource productStarter 'Microsoft.ApiManagement/service/products@2025-09-01-preview' = {
  parent: apim
  name: 'src-product-starter'
  properties: {
    displayName: 'Kitchen Sink Starter'
    description: 'Starter product for BVT — limited access'
    subscriptionRequired: true
    approvalRequired: false
    state: 'published'
    terms: 'By subscribing you agree to the terms of use.'
  }
}

resource productPremium 'Microsoft.ApiManagement/service/products@2025-09-01-preview' = {
  parent: apim
  name: 'src-product-premium'
  properties: {
    displayName: 'Kitchen Sink Premium'
    description: 'Premium product for BVT — full access'
    subscriptionRequired: true
    approvalRequired: true
    subscriptionsLimit: 10
    state: 'published'
  }
}

// ---------------------------------------------------------------------------
// APIs
// ---------------------------------------------------------------------------

// 1. REST API with OpenAPI spec
resource apiRestOpenapi 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-rest-openapi'
  properties: {
    displayName: 'KS REST OpenAPI'
    description: 'Kitchen sink REST API imported from OpenAPI spec'
    path: 'ks/rest'
    protocols: ['https']
    format: 'openapi'
    value: openApiSpec
    serviceUrl: 'https://src-backend.example.com/api'
    subscriptionRequired: false
    apiType: 'http'
  }
}

// 2. SOAP pass-through API
resource apiSoapPassthrough 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-soap-passthrough'
  properties: {
    displayName: 'KS SOAP Pass-Through'
    description: 'Kitchen sink SOAP pass-through API from WSDL'
    path: 'ks/soap'
    protocols: ['https']
    format: 'wsdl'
    value: wsdlSpec
    serviceUrl: 'https://src-soap-backend.example.com/calculator'
    apiType: 'soap'
    wsdlSelector: {
      wsdlServiceName: 'CalculatorService'
      wsdlEndpointName: 'CalculatorSoapPort'
    }
    type: 'soap'
  }
}

// 3. GraphQL Synthetic API (inline schema)
resource apiGraphqlSynthetic 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-graphql-synthetic'
  properties: {
    displayName: 'KS GraphQL Synthetic'
    description: 'Kitchen sink synthetic GraphQL API with inline schema'
    path: 'ks/graphql'
    protocols: ['https']
    serviceUrl: 'https://src-graphql-backend.example.com/graphql'
    type: 'graphql'
    apiType: 'graphql'
  }
}

// GraphQL schema for synthetic API (must be created separately)
resource graphqlSyntheticSchema 'Microsoft.ApiManagement/service/apis/schemas@2025-09-01-preview' = {
  parent: apiGraphqlSynthetic
  name: 'graphql'
  properties: {
    contentType: 'application/vnd.ms-azure-apim.graphql.schema'
    document: {
      value: graphqlSchema
    }
  }
}

// 4. GraphQL Pass-through API
resource apiGraphqlPassthrough 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-graphql-passthrough'
  properties: {
    displayName: 'KS GraphQL Pass-Through'
    description: 'Kitchen sink pass-through GraphQL API'
    path: 'ks/graphql-pt'
    protocols: ['https']
    serviceUrl: 'https://src-graphql-pt-backend.example.com/graphql'
    type: 'graphql'
    apiType: 'graphql'
  }
}

// GraphQL schema for passthrough API
resource graphqlPassthroughSchema 'Microsoft.ApiManagement/service/apis/schemas@2025-09-01-preview' = {
  parent: apiGraphqlPassthrough
  name: 'graphql'
  properties: {
    contentType: 'application/vnd.ms-azure-apim.graphql.schema'
    document: {
      value: graphqlSchema
    }
  }
}

// 5. WebSocket API
resource apiWebsocket 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-websocket'
  properties: {
    displayName: 'KS WebSocket'
    description: 'Kitchen sink WebSocket API'
    path: 'ks/ws'
    protocols: ['wss']
    serviceUrl: 'wss://echo.websocket.events'
    type: 'websocket'
    apiType: 'websocket'
  }
}

// 6. Versioned REST API (v1 via version set)
resource apiVersionedV1 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-rest-versioned-v1'
  properties: {
    displayName: 'KS REST Versioned'
    description: 'Kitchen sink versioned REST API (v1)'
    path: 'ks/versioned'
    protocols: ['https']
    format: 'openapi'
    value: openApiSpecV1
    serviceUrl: 'https://src-versioned-backend.example.com/api'
    apiVersion: 'v1'
    apiVersionSetId: versionSet.id
    subscriptionRequired: false
    apiType: 'http'
  }
}

// 7. Revisioned REST API (with multiple revisions)
resource apiRevisioned 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-rest-revisioned'
  properties: {
    displayName: 'KS REST Revisioned'
    description: 'Kitchen sink REST API with revisions'
    path: 'ks/revisioned'
    protocols: ['https']
    format: 'openapi'
    value: openApiSpec
    serviceUrl: 'https://src-revisioned-backend.example.com/api'
    subscriptionRequired: false
    apiType: 'http'
    isCurrent: true
  }
}

// Create revision 2 of the revisioned API
resource apiRevisionedRev2 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-rest-revisioned;rev=2'
  properties: {
    path: 'ks/revisioned'
    protocols: ['https']
    serviceUrl: 'https://src-revisioned-backend-v2.example.com/api'
    apiRevisionDescription: 'Second revision for BVT testing'
    sourceApiId: apiRevisioned.id
    apiType: 'http'
  }
}

// 8. MCP API created from an existing REST API in the instance
resource apiMcpFromApi 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-mcp-from-api'
  properties: {
    displayName: 'KS MCP from Existing API'
    description: 'MCP server created by exposing an existing REST API in the instance as MCP tools'
    path: 'ks/mcp-from-api'
    protocols: ['https']
    serviceUrl: 'https://src-mcp-from-api-backend.example.com/api'
    subscriptionRequired: false
    type: 'mcp'
    apiType: 'mcp'
  }
}

// 9. MCP API created from an existing (external) public MCP server
resource apiMcpFromExternal 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-mcp-from-external'
  properties: {
    displayName: 'KS MCP from External Server'
    description: 'MCP server repackaging a public external MCP server via APIM'
    path: 'ks/mcp-external'
    protocols: ['https']
    serviceUrl: 'https://api.githubcopilot.com/mcp'
    subscriptionRequired: false
    type: 'mcp'
    apiType: 'mcp'
  }
}

// ---------------------------------------------------------------------------
// TIER 3: Child Resources
// ---------------------------------------------------------------------------

// --- Product Policy ---
resource productPremiumPolicy 'Microsoft.ApiManagement/service/products/policies@2025-09-01-preview' = {
  parent: productPremium
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: productPolicyXml
  }
}

// --- Product API Associations ---
resource productStarterApiRest 'Microsoft.ApiManagement/service/products/apis@2025-09-01-preview' = {
  parent: productStarter
  name: 'src-rest-openapi'
  dependsOn: [apiRestOpenapi]
}

resource productStarterApiSoap 'Microsoft.ApiManagement/service/products/apis@2025-09-01-preview' = {
  parent: productStarter
  name: 'src-soap-passthrough'
  dependsOn: [apiSoapPassthrough]
}

resource productPremiumApiRest 'Microsoft.ApiManagement/service/products/apis@2025-09-01-preview' = {
  parent: productPremium
  name: 'src-rest-openapi'
  dependsOn: [apiRestOpenapi]
}

resource productPremiumApiGraphql 'Microsoft.ApiManagement/service/products/apis@2025-09-01-preview' = {
  parent: productPremium
  name: 'src-graphql-synthetic'
  dependsOn: [apiGraphqlSynthetic]
}

// --- Product Group Associations ---
resource productStarterGroupDev 'Microsoft.ApiManagement/service/products/groups@2025-09-01-preview' = {
  parent: productStarter
  name: 'developers'
}

resource productPremiumGroupInternal 'Microsoft.ApiManagement/service/products/groups@2025-09-01-preview' = {
  parent: productPremium
  name: 'src-group-internal'
  dependsOn: [groupInternal]
}

// --- Product Tags ---
resource productStarterTag 'Microsoft.ApiManagement/service/products/tags@2025-09-01-preview' = {
  parent: productStarter
  name: 'src-tag-env'
  dependsOn: [tagEnv]
}

// --- Product Wiki (classic SKUs only - documentation dependency) ---
resource productStarterWiki 'Microsoft.ApiManagement/service/products/wikis@2025-09-01-preview' = if (isClassicSku) {
  parent: productStarter
  name: 'default'
  properties: {
    documents: [
      {
        documentationId: 'src-doc-getting-started'
      }
    ]
  }
  dependsOn: [documentation]
}

// --- API Policy ---
resource apiRestPolicy 'Microsoft.ApiManagement/service/apis/policies@2025-09-01-preview' = {
  parent: apiRestOpenapi
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: apiPolicyXml
  }
}

// --- API Tags ---
resource apiRestTagEnv 'Microsoft.ApiManagement/service/apis/tags@2025-09-01-preview' = {
  parent: apiRestOpenapi
  name: 'src-tag-env'
  dependsOn: [tagEnv]
}

resource apiRestTagTeam 'Microsoft.ApiManagement/service/apis/tags@2025-09-01-preview' = {
  parent: apiRestOpenapi
  name: 'src-tag-team'
  dependsOn: [tagTeam]
}

// --- API Diagnostic ---
resource apiRestDiagnostic 'Microsoft.ApiManagement/service/apis/diagnostics@2025-09-01-preview' = {
  parent: apiRestOpenapi
  name: 'applicationinsights'
  properties: {
    loggerId: loggerAppInsights.id
    alwaysLog: 'allErrors'
    sampling: {
      samplingType: 'fixed'
      percentage: 50
    }
  }
}

// --- API Operation Policy (on healthCheck operation) ---
// Note: Operations are created automatically from the OpenAPI spec import.
// We apply a policy to the GET /healthz operation (operationId: healthCheck).
resource apiRestOpPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2025-09-01-preview' = {
  name: '${apim.name}/src-rest-openapi/healthCheck/policy'
  dependsOn: [apiRestOpenapi]
  properties: {
    format: 'rawxml'
    value: operationPolicyXml
  }
}

// --- Explicit API Operation (on MCP from-API API for full coverage of ApiOperation resource type) ---
resource apiMcpOperation 'Microsoft.ApiManagement/service/apis/operations@2025-09-01-preview' = {
  parent: apiMcpFromApi
  name: 'src-mcp-invoke'
  properties: {
    displayName: 'Invoke MCP Tool'
    method: 'POST'
    urlTemplate: '/tools/invoke'
    description: 'Explicit operation for BVT coverage of ApiOperation resource type'
    responses: [
      {
        statusCode: 200
        description: 'Tool invocation result'
      }
    ]
  }
}

// --- MCP Server (from existing API) ---
resource mcpServerFromApi 'Microsoft.ApiManagement/service/apis/mcpServers@2025-09-01-preview' = {
  parent: apiMcpFromApi
  name: 'default'
  properties: {
    mcpTools: [
      {
        name: 'httpGet'
        description: 'Perform a GET request via the underlying REST API backend'
      }
      {
        name: 'httpPost'
        description: 'Perform a POST request via the underlying REST API backend'
      }
    ]
  }
}

// --- MCP Server (from external MCP server) ---
resource mcpServerFromExternal 'Microsoft.ApiManagement/service/apis/mcpServers@2025-09-01-preview' = {
  parent: apiMcpFromExternal
  name: 'default'
  properties: {
    mcpProperties: {
      serverUrl: 'https://api.githubcopilot.com/mcp'
    }
  }
}

// --- Explicit API Schema (on REST API for full coverage) ---
resource apiRestSchema 'Microsoft.ApiManagement/service/apis/schemas@2025-09-01-preview' = {
  parent: apiRestOpenapi
  name: 'src-rest-schema-item'
  properties: {
    contentType: 'application/vnd.oai.openapi.components+json'
    document: {
      components: {
        schemas: {
          Item: {
            type: 'object'
            properties: {
              id: { type: 'string' }
              name: { type: 'string' }
              createdAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  }
}

// --- API Tag Description ---
resource apiRestTagDescEnv 'Microsoft.ApiManagement/service/apis/tagDescriptions@2025-09-01-preview' = {
  parent: apiRestOpenapi
  name: 'src-tag-env'
  dependsOn: [tagEnv, apiRestTagEnv]
  properties: {
    description: 'Environment tag — indicates deployment environment'
    externalDocsDescription: 'Environment tagging guide'
    externalDocsUrl: 'https://docs.contoso.com/tags/env'
  }
}

// --- API Wiki (classic SKUs only - documentation dependency) ---
resource apiRestWiki 'Microsoft.ApiManagement/service/apis/wikis@2025-09-01-preview' = if (isClassicSku) {
  parent: apiRestOpenapi
  name: 'default'
  properties: {
    documents: [
      {
        documentationId: 'src-doc-getting-started'
      }
    ]
  }
  dependsOn: [documentation]
}

// --- API Release (on revisioned API) ---
resource apiRelease 'Microsoft.ApiManagement/service/apis/releases@2025-09-01-preview' = {
  parent: apiRevisioned
  name: 'src-release-1'
  properties: {
    apiId: apiRevisioned.id
    notes: 'Initial release for BVT testing'
  }
}

// --- GraphQL Resolver ---
resource graphqlResolver 'Microsoft.ApiManagement/service/apis/resolvers@2025-09-01-preview' = {
  parent: apiGraphqlSynthetic
  name: 'src-resolver-hero'
  properties: {
    displayName: 'Hero Resolver'
    description: 'Resolves hero query via HTTP data source'
    path: 'Query/hero'
  }
}

// --- GraphQL Resolver Policy ---
resource graphqlResolverPolicy 'Microsoft.ApiManagement/service/apis/resolvers/policies@2025-09-01-preview' = {
  parent: graphqlResolver
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: resolverPolicyXml
  }
}

// --- Gateway API Association (classic SKUs only) ---
resource gatewayApiRest 'Microsoft.ApiManagement/service/gateways/apis@2025-09-01-preview' = if (supportsSelfHostedGateway) {
  parent: gateway
  name: 'src-rest-openapi'
  dependsOn: [apiRestOpenapi]
  properties: {
    provisioningState: 'created'
  }
}

// --- Subscriptions ---
resource subAllApis 'Microsoft.ApiManagement/service/subscriptions@2025-09-01-preview' = {
  parent: apim
  name: 'src-sub-all-apis'
  properties: {
    displayName: 'Kitchen Sink All APIs Subscription'
    scope: '/apis'
    state: 'active'
  }
}

resource subProduct 'Microsoft.ApiManagement/service/subscriptions@2025-09-01-preview' = {
  parent: apim
  name: 'src-sub-product'
  properties: {
    displayName: 'Kitchen Sink Product Subscription'
    scope: productStarter.id
    state: 'active'
  }
}

// ---------------------------------------------------------------------------
// WORKSPACE (conditional — Developer v2 only)
// ---------------------------------------------------------------------------

resource workspace 'Microsoft.ApiManagement/service/workspaces@2025-09-01-preview' = if (supportsWorkspaces) {
  parent: apim
  name: 'src-workspace'
  properties: {
    displayName: 'Kitchen Sink Workspace'
    description: 'Workspace for BVT testing workspace-scoped extraction'
  }
}

resource wsBackend 'Microsoft.ApiManagement/service/workspaces/backends@2025-09-01-preview' = if (supportsWorkspaces) {
  parent: workspace
  name: 'src-ws-backend-http'
  properties: {
    description: 'Workspace-scoped HTTP backend'
    url: 'https://src-ws-backend.example.com/api'
    protocol: 'http'
  }
}

resource wsNamedValue 'Microsoft.ApiManagement/service/workspaces/namedValues@2025-09-01-preview' = if (supportsWorkspaces) {
  parent: workspace
  name: 'src-ws-nv-plain'
  properties: {
    displayName: 'src-ws-nv-plain'
    value: 'workspace-scoped-value'
    tags: ['workspace']
  }
}

resource wsTag 'Microsoft.ApiManagement/service/workspaces/tags@2025-09-01-preview' = if (supportsWorkspaces) {
  parent: workspace
  name: 'src-ws-tag'
  properties: {
    displayName: 'src-ws-tag'
  }
}

resource wsProduct 'Microsoft.ApiManagement/service/workspaces/products@2025-09-01-preview' = if (supportsWorkspaces) {
  parent: workspace
  name: 'src-ws-product'
  properties: {
    displayName: 'Workspace Product'
    description: 'Product scoped to workspace'
    subscriptionRequired: false
    state: 'published'
  }
}

resource wsApi 'Microsoft.ApiManagement/service/workspaces/apis@2025-09-01-preview' = if (supportsWorkspaces) {
  parent: workspace
  name: 'src-ws-api-rest'
  properties: {
    displayName: 'Workspace REST API'
    path: 'ks/ws/rest'
    protocols: ['https']
    serviceUrl: 'https://src-ws-api-backend.example.com/api'
    apiType: 'http'
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

@description('Whether workspace resources were deployed')
output workspaceDeployed bool = supportsWorkspaces

@description('Whether self-hosted gateway was deployed')
output gatewayDeployed bool = supportsSelfHostedGateway

@description('APIM SKU used')
output skuName string = skuName
