@description('Existing APIM name to apply activation-sensitive child resources to.')
param apimName string

@description('APIM SKU name. Classic SKUs support docs/wiki/policyRestriction.')
@allowed(['Developer', 'Premium', 'StandardV2', 'PremiumV2'])
param skuName string

var isClassicSku = skuName == 'Developer' || skuName == 'Premium'

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

resource apim 'Microsoft.ApiManagement/service@2025-09-01-preview' existing = {
  name: apimName
}

resource productStarter 'Microsoft.ApiManagement/service/products@2025-09-01-preview' existing = {
  parent: apim
  name: 'src-product-starter'
}

resource productPremium 'Microsoft.ApiManagement/service/products@2025-09-01-preview' existing = {
  parent: apim
  name: 'src-product-premium'
}

resource apiRestOpenapi 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' existing = {
  parent: apim
  name: 'src-rest-openapi'
}

resource servicePolicy 'Microsoft.ApiManagement/service/policies@2025-09-01-preview' = {
  parent: apim
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: servicePolicyXml
  }
}

resource productPremiumPolicy 'Microsoft.ApiManagement/service/products/policies@2025-09-01-preview' = {
  parent: productPremium
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: productPolicyXml
  }
}

resource apiRestPolicy 'Microsoft.ApiManagement/service/apis/policies@2025-09-01-preview' = {
  parent: apiRestOpenapi
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: apiPolicyXml
  }
}

resource policyRestriction 'Microsoft.ApiManagement/service/policyRestrictions@2025-09-01-preview' = if (isClassicSku) {
  parent: apim
  name: 'src-restriction-ip'
  properties: {
    scope: '/products/src-product-starter'
    requireBase: 'true'
  }
}
