@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Unique name for the APIM instance.')
param apimName string = 'bvt-${uniqueString(resourceGroup().id)}-redact-apim'

@description('Publisher email shown in the developer portal.')
param publisherEmail string

@description('Publisher name shown in the developer portal.')
param publisherName string = 'APIOps Redaction BVT'

@description('APIM SKU name.')
@allowed([
  'Developer'
  'Premium'
  'Standard'
  'BasicV2'
  'StandardV2'
  'PremiumV2'
])
param skuName string = 'StandardV2'

var openApiSpec = '''
openapi: "3.0.1"
info:
  title: Redact Secrets REST API
  version: "1.0"
paths:
  /todos/1:
    get:
      operationId: healthCheck
      summary: Health check
      responses:
        "200":
          description: OK
'''

var graphqlSchema = '''
type Query {
  hero: String
}
'''

resource apim 'Microsoft.ApiManagement/service@2025-09-01-preview' = {
  name: apimName
  location: location
  sku: {
    name: skuName
    capacity: 1
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
  }
}

resource nvPlain 'Microsoft.ApiManagement/service/namedValues@2025-09-01-preview' = {
  parent: apim
  name: 'rs-nv-plain'
  properties: {
    displayName: 'rs-nv-plain'
    value: 'plain-value'
  }
}

resource nvSecret 'Microsoft.ApiManagement/service/namedValues@2025-09-01-preview' = {
  parent: apim
  name: 'rs-nv-secret'
  properties: {
    displayName: 'rs-nv-secret'
    value: 'RS_SECRET_NAMED_VALUE_LITERAL'
    secret: true
  }
}

resource product 'Microsoft.ApiManagement/service/products@2025-09-01-preview' = {
  parent: apim
  name: 'rs-product'
  properties: {
    displayName: 'Redact Secrets Product'
    subscriptionRequired: true
    approvalRequired: false
    state: 'published'
  }
}

resource apiRest 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-redact-rest'
  properties: {
    displayName: 'Redact Secrets REST API'
    path: 'rs/rest'
    protocols: [
      'https'
    ]
    format: 'openapi'
    value: openApiSpec
    serviceUrl: 'https://example.org/redact-rest'
    subscriptionRequired: false
    apiType: 'http'
  }
}

resource apiGraphql 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'src-redact-graphql'
  properties: {
    displayName: 'Redact Secrets GraphQL API'
    path: 'rs/graphql'
    protocols: [
      'https'
    ]
    serviceUrl: 'https://example.org/redact-graphql'
    type: 'graphql'
    apiType: 'graphql'
  }
}

resource graphqlApiSchema 'Microsoft.ApiManagement/service/apis/schemas@2025-09-01-preview' = {
  parent: apiGraphql
  name: 'graphql'
  properties: {
    contentType: 'application/vnd.ms-azure-apim.graphql.schema'
    document: {
      value: graphqlSchema
    }
  }
}

resource graphqlResolver 'Microsoft.ApiManagement/service/apis/resolvers@2025-09-01-preview' = {
  parent: apiGraphql
  name: 'src-redact-resolver'
  properties: {
    displayName: 'Redact Resolver'
    path: 'Query/hero'
  }
  dependsOn: [
    graphqlApiSchema
  ]
}

output subscriptionId string = subscription().subscriptionId
output resourceGroupName string = resourceGroup().name
output apimServiceName string = apim.name
output skuName string = skuName
output location string = location
