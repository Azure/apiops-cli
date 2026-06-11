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

@description('APIM SKU name. Use BasicV2/StandardV2/PremiumV2 for v2 tiers, or Developer/Premium/Standard for classic.')
@allowed(['Developer', 'Premium', 'Standard', 'BasicV2', 'StandardV2', 'PremiumV2'])
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

var isClassicSku = skuName == 'Developer' || skuName == 'Premium' || skuName == 'Standard'
var apimSkuCapacity = isClassicSku ? 1 : 1
var supportsSelfHostedGateway = skuName == 'Developer' || skuName == 'Premium'
var supportsWorkspaces = skuName == 'Premium' || skuName == 'StandardV2' || skuName == 'PremiumV2'

// Minimal but valid OpenAPI 3.0 spec
var openApiSpec = '''
openapi: "3.0.1"
info:
  title: Kitchen Sink REST API
  version: "1.0"
paths:
  /todos/1:
    get:
      operationId: healthCheck
      summary: Health check endpoint
      responses:
        "200":
          description: OK
  /todos:
    get:
      operationId: listItems
      summary: List all items
      responses:
        "200":
          description: OK
  /todos/{id}:
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
  /todos/add:
    post:
      operationId: createItem
      summary: Create an item
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                todo:
                  type: string
                completed:
                  type: boolean
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


// Operation-level policy XML
var operationPolicyXml = '''
<policies>
  <inbound>
    <base />
    <return-response>
      <set-status code="200" reason="OK" />
      <set-header name="Content-Type" exists-action="override">
        <value>application/json</value>
      </set-header>
      <set-body>{"status":"ok","source":"apim-mcp-demo"}</set-body>
    </return-response>
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
    customProperties: {
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Protocols.Server.Http2': 'True'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Ssl30': 'False'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls10': 'False'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls11': 'False'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TripleDes168': 'False'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Ssl30': 'False'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls10': 'False'
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls11': 'False'
    }
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

// Activation-sensitive resources are deployed post-activation by run-phase1-deploy-source.ps1.

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

// Service policy is deployed post-activation by run-phase1-deploy-source.ps1.

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
    serviceUrl: 'https://dummyjson.com'
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
// mcpTools live directly on the API resource (not a child mcpServers resource)
// any() used because mcpTools is valid at runtime but absent from Bicep type definitions (BCP037)
resource apiMcpFromApi 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-mcp-from-api'
  dependsOn: [apiRestOpenapi]
  properties: any({
    displayName: 'KS MCP from Existing API'
    description: 'MCP server created by exposing an existing REST API in the instance as MCP tools'
    path: 'ks/mcp-from-api'
    protocols: ['https']
    subscriptionRequired: false
    type: 'mcp'
    mcpProperties: {
      endpoints: {
        mcp: {
          uriTemplate: '/mcp'
        }
      }
    }
    mcpTools: [
      {
        name: 'healthCheck'
        description: 'Health check endpoint'
        operationId: resourceId('Microsoft.ApiManagement/service/apis/operations', apimName, 'src-rest-openapi', 'healthCheck')
      }
      {
        name: 'listItems'
        description: 'List all items'
        operationId: resourceId('Microsoft.ApiManagement/service/apis/operations', apimName, 'src-rest-openapi', 'listItems')
      }
    ]
  })
}

// NOTE: MCP-typed APIs cannot host their own ApiOperation child resources.
// APIM rejects PUT apis/{mcpApi}/operations/* with
// "Operation entity cannot be defined for MCP API type".
// MCP tools are surfaced via the parent API's properties.mcpTools array
// (each entry's operationId references operations on a different,
// non-MCP API \u2014 e.g. src-rest-openapi above). ApiOperation BVT coverage
// is therefore provided by the REST APIs in this template, not by the MCP APIs.

resource backendMcpLearn 'Microsoft.ApiManagement/service/backends@2025-09-01-preview' = {
  parent: apim
  name: 'src-backend-mcp-learn'
  properties: {
    description: 'Backend for the public Microsoft Learn MCP server used by the existing-server demo'
    url: 'https://learn.microsoft.com'
    protocol: 'http'
  }
}

resource apiMcpExistingServer 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-mcp-existing-server'
  properties: any({
    displayName: 'KS MCP Existing Server Demo'
    description: 'Working demo that exposes the public Microsoft Learn MCP server through APIM using a policy-based MCP proxy'
    path: 'ks/mcp-existing'
    protocols: ['https']
    subscriptionRequired: false
    type: 'mcp'
    backendId: backendMcpLearn.name
    mcpProperties: {
      endpoints: {
        mcp: {
          uriTemplate: '/mcp'
        }
      }
    }
  })
}

resource apiA2aRuntimeMock 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-a2a-runtime-mock'
  properties: {
    displayName: 'KS A2A Runtime Mock'
    description: 'Mock runtime API used as the backend for the A2A demo API'
    path: 'ks/a2a-weather'
    protocols: ['https']
    serviceUrl: 'https://httpbin.org'
    subscriptionRequired: false
    apiType: 'http'
  }
}

resource apiA2aRuntimeCardOperation 'Microsoft.ApiManagement/service/apis/operations@2025-09-01-preview' = {
  parent: apiA2aRuntimeMock
  name: 'get-agent-card'
  properties: {
    displayName: 'Get agent card'
    method: 'GET'
    urlTemplate: '/.well-known/agent-card.json'
    responses: [
      {
        statusCode: 200
        description: 'OK'
        representations: [
          {
            contentType: 'application/json'
          }
        ]
      }
    ]
  }
}

resource apiA2aRuntimeCardPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2025-09-01-preview' = {
  parent: apiA2aRuntimeCardOperation
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: '''<policies><inbound><base /><return-response><set-status code="200" reason="OK" /><set-header name="Content-Type" exists-action="override"><value>application/json</value></set-header><set-body>@("{\"protocolVersion\":\"0.3.0\",\"name\":\"KS A2A Weather Agent\",\"description\":\"Demo A2A weather agent served entirely by APIM policies\",\"url\":\"https://" + context.Request.OriginalUrl.Host + "/ks/a2a-weather\",\"preferredTransport\":\"JSONRPC\",\"version\":\"1.0.0\",\"capabilities\":{\"streaming\":false,\"pushNotifications\":false,\"stateTransitionHistory\":false},\"defaultInputModes\":[\"text/plain\"],\"defaultOutputModes\":[\"text/plain\"],\"skills\":[{\"id\":\"get_weather\",\"name\":\"Get weather\",\"description\":\"Returns current weather conditions for a city\",\"tags\":[\"weather\",\"demo\"],\"examples\":[\"What is the weather in Seattle?\",\"weather in Paris\"],\"inputModes\":[\"text/plain\"],\"outputModes\":[\"text/plain\"]}]}")</set-body></return-response></inbound><backend><base /></backend><outbound><base /></outbound><on-error><base /></on-error></policies>'''
  }
}

resource apiA2aRuntimeCardLegacyOperation 'Microsoft.ApiManagement/service/apis/operations@2025-09-01-preview' = {
  parent: apiA2aRuntimeMock
  name: 'get-agent-card-legacy'
  properties: {
    displayName: 'Get agent card (legacy path)'
    method: 'GET'
    urlTemplate: '/.well-known/agent.json'
    responses: [
      {
        statusCode: 200
        description: 'OK'
        representations: [
          {
            contentType: 'application/json'
          }
        ]
      }
    ]
  }
}

resource apiA2aRuntimeCardLegacyPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2025-09-01-preview' = {
  parent: apiA2aRuntimeCardLegacyOperation
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: '''<policies><inbound><base /><return-response><set-status code="200" reason="OK" /><set-header name="Content-Type" exists-action="override"><value>application/json</value></set-header><set-body>@("{\"protocolVersion\":\"0.3.0\",\"name\":\"KS A2A Weather Agent\",\"description\":\"Demo A2A weather agent served entirely by APIM policies\",\"url\":\"https://" + context.Request.OriginalUrl.Host + "/ks/a2a-weather\",\"preferredTransport\":\"JSONRPC\",\"version\":\"1.0.0\",\"capabilities\":{\"streaming\":false,\"pushNotifications\":false,\"stateTransitionHistory\":false},\"defaultInputModes\":[\"text/plain\"],\"defaultOutputModes\":[\"text/plain\"],\"skills\":[{\"id\":\"get_weather\",\"name\":\"Get weather\",\"description\":\"Returns current weather conditions for a city\",\"tags\":[\"weather\",\"demo\"],\"examples\":[\"What is the weather in Seattle?\",\"weather in Paris\"],\"inputModes\":[\"text/plain\"],\"outputModes\":[\"text/plain\"]}]}")</set-body></return-response></inbound><backend><base /></backend><outbound><base /></outbound><on-error><base /></on-error></policies>'''
  }
}

resource apiA2aRuntimeJsonRpcOperation 'Microsoft.ApiManagement/service/apis/operations@2025-09-01-preview' = {
  parent: apiA2aRuntimeMock
  name: 'post-jsonrpc'
  properties: {
    displayName: 'JSON-RPC endpoint'
    method: 'POST'
    urlTemplate: '/'
    request: {
      representations: [
        {
          contentType: 'application/json'
        }
      ]
    }
    responses: [
      {
        statusCode: 200
        description: 'OK'
        representations: [
          {
            contentType: 'application/json'
          }
        ]
      }
    ]
  }
}

resource apiA2aRuntimeJsonRpcPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2025-09-01-preview' = {
  parent: apiA2aRuntimeJsonRpcOperation
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: '''<policies>
  <inbound>
    <base />
    <set-variable name="reqBody" value='@(context.Request.Body.As<Newtonsoft.Json.Linq.JObject>(preserveContent: true))' />
    <set-variable name="rpcId" value='@{ var t = ((Newtonsoft.Json.Linq.JObject)context.Variables["reqBody"])["id"]; return t != null ? t.ToString(Newtonsoft.Json.Formatting.None) : "1"; }' />
    <set-variable name="rpcMethod" value='@((string)((Newtonsoft.Json.Linq.JObject)context.Variables["reqBody"])["method"] ?? "")' />
    <choose>
      <when condition='@((string)context.Variables["rpcMethod"] != "message/send")'>
        <return-response>
          <set-status code="200" reason="OK" />
          <set-header name="Content-Type" exists-action="override"><value>application/json</value></set-header>
          <set-body>@("{\"jsonrpc\":\"2.0\",\"id\":" + (string)context.Variables["rpcId"] + ",\"error\":{\"code\":-32601,\"message\":\"Method not found: " + (string)context.Variables["rpcMethod"] + "\"}}")</set-body>
        </return-response>
      </when>
    </choose>
    <set-variable name="city" value='@{
      var parts = ((Newtonsoft.Json.Linq.JObject)context.Variables["reqBody"]).SelectToken("params.message.parts") as Newtonsoft.Json.Linq.JArray;
      string text = "";
      if (parts != null) { foreach (var p in parts) { if ((string)p["kind"] == "text") { text = (string)p["text"] ?? ""; break; } } }
      string city = text.Trim();
      int idx = text.ToLowerInvariant().IndexOf(" in ");
      if (idx >= 0) { city = text.Substring(idx + 4).Trim(); }
      city = city.TrimEnd("?.!,".ToCharArray()).Trim();
      if (string.IsNullOrWhiteSpace(city)) { city = "Seattle"; }
      return city;
    }' />
    <send-request mode="new" response-variable-name="geoResp" timeout="10" ignore-error="true">
      <set-url>@($"https://geocoding-api.open-meteo.com/v1/search?count=1&amp;name={System.Uri.EscapeDataString((string)context.Variables["city"])}")</set-url>
      <set-method>GET</set-method>
    </send-request>
    <set-variable name="latlon" value='@{
      try {
        var r = (IResponse)context.Variables["geoResp"];
        if (r == null || r.StatusCode != 200) { return (string)null; }
        var body = r.Body.As<Newtonsoft.Json.Linq.JObject>();
        var arr = body["results"] as Newtonsoft.Json.Linq.JArray;
        if (arr == null || arr.Count == 0) { return (string)null; }
        var first = arr[0] as Newtonsoft.Json.Linq.JObject;
        if (first == null || first["latitude"] == null || first["longitude"] == null) { return (string)null; }
        string lat = first["latitude"].ToString(Newtonsoft.Json.Formatting.None);
        string lon = first["longitude"].ToString(Newtonsoft.Json.Formatting.None);
        string resolved = (string)first["name"];
        string country = (string)first["country"];
        return lat + "|" + lon + "|" + resolved + "|" + (country ?? "");
      } catch {
        return (string)null;
      }
    }' />
    <choose>
      <when condition='@(context.Variables["latlon"] == null)'>
        <set-variable name="reply" value='@("Sorry, I could not find a location named " + (string)context.Variables["city"] + ".")' />
      </when>
      <otherwise>
        <send-request mode="new" response-variable-name="wxResp" timeout="10" ignore-error="true">
          <set-url>@{
            var ll = ((string)context.Variables["latlon"]).Split('|');
            return "https://api.open-meteo.com/v1/forecast?latitude=" + ll[0] + "&amp;longitude=" + ll[1] + "&amp;current=temperature_2m,weather_code,wind_speed_10m&amp;temperature_unit=fahrenheit&amp;wind_speed_unit=mph";
          }</set-url>
          <set-method>GET</set-method>
        </send-request>
        <set-variable name="reply" value='@{
          var ll = ((string)context.Variables["latlon"]).Split('|');
          string place = ll.Length >= 4 && !string.IsNullOrEmpty(ll[3]) ? (ll[2] + ", " + ll[3]) : ll[2];
          var r = (IResponse)context.Variables["wxResp"];
          if (r == null || r.StatusCode != 200) { return "Weather for " + place + " is currently unavailable."; }
          var cur = r.Body.As<Newtonsoft.Json.Linq.JObject>()["current"] as Newtonsoft.Json.Linq.JObject;
          if (cur == null) { return "Weather for " + place + " is currently unavailable."; }
          double tempF = (double)cur["temperature_2m"];
          int code = cur["weather_code"] != null ? (int)cur["weather_code"] : -1;
          double wind = cur["wind_speed_10m"] != null ? (double)cur["wind_speed_10m"] : 0.0;
          var codes = new System.Collections.Generic.Dictionary<int, string> {
            {0,"clear sky"},{1,"mainly clear"},{2,"partly cloudy"},{3,"overcast"},
            {45,"fog"},{48,"depositing rime fog"},
            {51,"light drizzle"},{53,"moderate drizzle"},{55,"dense drizzle"},
            {56,"light freezing drizzle"},{57,"dense freezing drizzle"},
            {61,"light rain"},{63,"moderate rain"},{65,"heavy rain"},
            {66,"light freezing rain"},{67,"heavy freezing rain"},
            {71,"light snow"},{73,"moderate snow"},{75,"heavy snow"},{77,"snow grains"},
            {80,"rain showers"},{81,"moderate rain showers"},{82,"violent rain showers"},
            {85,"light snow showers"},{86,"heavy snow showers"},
            {95,"thunderstorm"},{96,"thunderstorm with light hail"},{99,"thunderstorm with heavy hail"}
          };
          string cond = codes.ContainsKey(code) ? codes[code] : ("weather code " + code);
          return "Weather in " + place + ": " + tempF.ToString("F0") + "°F, " + cond + ", wind " + wind.ToString("F0") + " mph (live data from Open-Meteo).";
        }' />
      </otherwise>
    </choose>
    <return-response>
      <set-status code="200" reason="OK" />
      <set-header name="Content-Type" exists-action="override"><value>application/json</value></set-header>
      <set-body>@{
        string replyJson = Newtonsoft.Json.JsonConvert.SerializeObject((string)context.Variables["reply"]);
        string taskId = System.Guid.NewGuid().ToString();
        string contextId = System.Guid.NewGuid().ToString();
        string artifactId = System.Guid.NewGuid().ToString();
        string msgId = System.Guid.NewGuid().ToString();
        string ts = System.DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        return "{\"jsonrpc\":\"2.0\",\"id\":" + (string)context.Variables["rpcId"] + ",\"result\":{\"kind\":\"task\",\"id\":\"" + taskId + "\",\"contextId\":\"" + contextId + "\",\"status\":{\"state\":\"completed\",\"timestamp\":\"" + ts + "\"},\"artifacts\":[{\"artifactId\":\"" + artifactId + "\",\"name\":\"weather-reply\",\"parts\":[{\"kind\":\"text\",\"text\":" + replyJson + "}]}],\"history\":[{\"kind\":\"message\",\"role\":\"agent\",\"messageId\":\"" + msgId + "\",\"parts\":[{\"kind\":\"text\",\"text\":" + replyJson + "}]}]}}";
      }</set-body>
    </return-response>
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>'''
  }
}

// 10. A2A API with JSON-RPC runtime and agent card settings
// any() used because A2A properties are runtime-supported but may not be present
// in this API version's Bicep type definitions.
resource apiA2a 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-a2a-weather-agent'
  properties: any({
    displayName: 'KS A2A Weather Agent'
    description: 'A2A API exposing JSON-RPC runtime and an APIM-mediated agent card'
    path: 'ks/a2a-managed'
    protocols: ['https']
    type: 'a2a'
    isAgent: true
    agent: {
      id: 'src-a2a-weather-agent'
    }
    a2aProperties: {
      agentCardPath: '/.well-known/agent-card.json'
      agentCardBackendUrl: 'https://${apim.name}.azure-api.net/ks/a2a-weather/.well-known/agent-card.json'
    }
    jsonRpcProperties: {
      backendUrl: 'https://${apim.name}.azure-api.net'
      path: '/ks/a2a-weather'
    }
    subscriptionRequired: false
  })
}

// ---------------------------------------------------------------------------
// TIER 3: Child Resources
// ---------------------------------------------------------------------------

// Product policy is deployed post-activation by run-phase1-deploy-source.ps1.

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

// Product wiki is deployed post-activation by run-phase1-deploy-source.ps1.

// API policy is deployed post-activation by run-phase1-deploy-source.ps1.

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

// API wiki is deployed post-activation by run-phase1-deploy-source.ps1.

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

// --- Workspace Product ↔ API association (via apiLinks endpoint) ---
resource wsProductApiLink 'Microsoft.ApiManagement/service/workspaces/products/apiLinks@2025-09-01-preview' = if (supportsWorkspaces) {
  parent: wsProduct
  name: 'src-ws-api-rest-link'
  properties: {
    apiId: wsApi.id
  }
}

// --- Workspace API ↔ Tag association (via tag apiLinks endpoint) ---
resource wsApiTagLink 'Microsoft.ApiManagement/service/workspaces/tags/apiLinks@2025-09-01-preview' = if (supportsWorkspaces) {
  parent: wsTag
  name: 'src-ws-api-rest-link'
  properties: {
    apiId: wsApi.id
  }
}

// NOTE: Workspace-scoped tagDescriptions (Microsoft.ApiManagement/service/workspaces/apis/tagDescriptions)
// is NOT supported by APIM — the endpoint returns HTTP 500. Skipped until APIM adds support.

// --- Workspace Product ↔ Tag association (via tag productLinks endpoint) ---
resource wsProductTagLink 'Microsoft.ApiManagement/service/workspaces/tags/productLinks@2025-09-01-preview' = if (supportsWorkspaces) {
  parent: wsTag
  name: 'src-ws-product-link'
  properties: {
    productId: wsProduct.id
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
