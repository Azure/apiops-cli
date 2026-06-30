
@description('APIM service name.')
param apimName string

var servicePolicyXml = '''
<policies>
  <inbound>
    <set-header name="Authorization" exists-action="override"><value>Bearer SERVICE_AUTH_SECRET_LITERAL</value></set-header>
    <set-header name="Authorization" exists-action="override"><value>Bearer {{rs-nv-secret}}</value></set-header>
    <set-header name="Ocp-Apim-Subscription-Key" exists-action="override"><value>SERVICE_OCP_SECRET_LITERAL</value></set-header>
    <set-header name="x-functions-key" exists-action="override"><value>SERVICE_FUNCTIONS_KEY_LITERAL</value></set-header>
    <set-header name="api-key" exists-action="override"><value>SERVICE_API_KEY_LITERAL</value></set-header>
    <set-header name="api-key" exists-action="override"><value>{{rs-nv-secret}}</value></set-header>
    <set-query-parameter name="code" exists-action="override"><value>SERVICE_QUERY_CODE_LITERAL</value></set-query-parameter>
    <set-query-parameter name="sig" exists-action="override"><value>SERVICE_QUERY_SIG_LITERAL</value></set-query-parameter>
    <set-query-parameter name="subscription-key" exists-action="override"><value>SERVICE_QUERY_SUBSCRIPTION_LITERAL</value></set-query-parameter>
    <authentication-basic username="svc-user" password="SERVICE_BASIC_PASSWORD_LITERAL" />
    <authentication-certificate thumbprint="SERVICE_CERT_THUMBPRINT_LITERAL" />
    <validate-jwt header-name="Authorization">
      <issuer-signing-keys><key>SERVICE_SIGNING_KEY_LITERAL</key></issuer-signing-keys>
      <decryption-keys><key>SERVICE_DECRYPT_KEY_LITERAL</key></decryption-keys>
    </validate-jwt>
    <set-header name="x-storage-connection" exists-action="override"><value>DefaultEndpointsProtocol=https;AccountName=storageacct;AccountKey=SERVICE_ACCOUNT_KEY_LITERAL;EndpointSuffix=core.windows.net</value></set-header>
    <set-header name="x-servicebus-connection" exists-action="override"><value>Endpoint=sb://foo.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SERVICE_SHARED_ACCESS_KEY_LITERAL</value></set-header>
    <set-header name="x-ai-connection" exists-action="override"><value>InstrumentationKey=AI-INSTRUMENTATION-KEY-LITERAL</value></set-header>
  </inbound>
  <backend />
  <outbound />
  <on-error />
</policies>
'''

var productPolicyXml = '''
<policies>
  <inbound>
    <base />
    <set-header name="Authorization" exists-action="override"><value>Bearer PRODUCT_AUTH_SECRET_LITERAL</value></set-header>
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>
'''

var apiPolicyXml = '''
<policies>
  <inbound>
    <base />
    <set-query-parameter name="code" exists-action="override"><value>API_QUERY_CODE_LITERAL</value></set-query-parameter>
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>
'''

var operationPolicyXml = '''
<policies>
  <inbound>
    <base />
    <authentication-basic username="op-user" password="OPERATION_BASIC_PASSWORD_LITERAL" />
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>
'''

var resolverPolicyXml = '''
<http-data-source>
  <http-request>
    <set-method>GET</set-method>
    <set-url>https://example.org/graphql-resolver</set-url>
    <set-header name="x-resolver-connection" exists-action="override"><value>Endpoint=sb://foo.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=RESOLVER_SHARED_ACCESS_KEY_LITERAL</value></set-header>
  </http-request>
</http-data-source>
'''

resource apim 'Microsoft.ApiManagement/service@2025-09-01-preview' existing = {
  name: apimName
}

resource product 'Microsoft.ApiManagement/service/products@2025-09-01-preview' existing = {
  parent: apim
  name: 'rs-product'
}

resource apiRest 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' existing = {
  parent: apim
  name: 'src-redact-rest'
}

resource apiGraphql 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' existing = {
  parent: apim
  name: 'src-redact-graphql'
}

resource graphqlResolver 'Microsoft.ApiManagement/service/apis/resolvers@2025-09-01-preview' existing = {
  parent: apiGraphql
  name: 'src-redact-resolver'
}

resource servicePolicy 'Microsoft.ApiManagement/service/policies@2025-09-01-preview' = {
  parent: apim
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: servicePolicyXml
  }
}

resource productPolicy 'Microsoft.ApiManagement/service/products/policies@2025-09-01-preview' = {
  parent: product
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: productPolicyXml
  }
}

resource apiPolicy 'Microsoft.ApiManagement/service/apis/policies@2025-09-01-preview' = {
  parent: apiRest
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: apiPolicyXml
  }
}

resource operationPolicy 'Microsoft.ApiManagement/service/apis/operations/policies@2025-09-01-preview' = {
  name: '${apim.name}/src-redact-rest/healthCheck/policy'
  properties: {
    format: 'rawxml'
    value: operationPolicyXml
  }
}

resource resolverPolicy 'Microsoft.ApiManagement/service/apis/resolvers/policies@2025-09-01-preview' = {
  parent: graphqlResolver
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: resolverPolicyXml
  }
}
