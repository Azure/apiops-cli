@description('Existing APIM name to apply activation-sensitive child resources to.')
param apimName string

@description('APIM SKU name. Classic SKUs support docs/wiki/policyRestriction.')
@allowed(['Developer', 'Premium', 'BasicV2', 'StandardV2', 'PremiumV2'])
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

var mcpApiPolicyXml = '''
<policies>
	<inbound>
		<base />
		<set-variable name="rpcMethod" value="@((context.Request.Body?.As&lt;Newtonsoft.Json.Linq.JObject&gt;(preserveContent: true)?[&quot;method&quot;]?.ToString()) ?? string.Empty)" />
		<set-variable name="rpcId" value="@((context.Request.Body?.As&lt;Newtonsoft.Json.Linq.JObject&gt;(preserveContent: true)?[&quot;id&quot;]?.ToString()) ?? &quot;1&quot;)" />
		<set-variable name="toolName" value="@((context.Request.Body?.As&lt;Newtonsoft.Json.Linq.JObject&gt;(preserveContent: true)?.SelectToken(&quot;params.name&quot;)?.ToString()) ?? string.Empty)" />
		<set-variable name="petStatus" value="@((context.Request.Body?.As&lt;Newtonsoft.Json.Linq.JObject&gt;(preserveContent: true)?.SelectToken(&quot;params.arguments.status&quot;)?.ToString()) ?? &quot;available&quot;)" />
		<set-variable name="petId" value="@((context.Request.Body?.As&lt;Newtonsoft.Json.Linq.JObject&gt;(preserveContent: true)?.SelectToken(&quot;params.arguments.petId&quot;)?.ToString()) ?? &quot;1&quot;)" />
		<choose>
			<when condition="@((string)context.Variables[&quot;rpcMethod&quot;] == &quot;initialize&quot;)">
				<return-response>
					<set-status code="200" reason="OK" />
					<set-header name="Content-Type" exists-action="override">
						<value>application/json</value>
					</set-header>
					<set-header name="MCP-Protocol-Version" exists-action="override">
						<value>2025-03-26</value>
					</set-header>
					<set-body>@{
            var req = context.Request.Body?.As<Newtonsoft.Json.Linq.JObject>(preserveContent: true) ?? new Newtonsoft.Json.Linq.JObject();
            var idRaw = req["id"]?.ToString() ?? "1";
            long idLong;
            Newtonsoft.Json.Linq.JToken idToken = long.TryParse(idRaw, out idLong) ? (Newtonsoft.Json.Linq.JToken)new Newtonsoft.Json.Linq.JValue(idLong) : new Newtonsoft.Json.Linq.JValue(idRaw);
            var response = new Newtonsoft.Json.Linq.JObject
            {
              ["jsonrpc"] = "2.0",
              ["id"] = idToken,
              ["result"] = new Newtonsoft.Json.Linq.JObject
              {
                ["protocolVersion"] = "2025-03-26",
                ["serverInfo"] = new Newtonsoft.Json.Linq.JObject
                {
                  ["name"] = "apim-mcp-demo",
                  ["version"] = "1.1.0"
                },
                ["capabilities"] = new Newtonsoft.Json.Linq.JObject
                {
                  ["tools"] = new Newtonsoft.Json.Linq.JObject()
                }
              }
            };
            return response.ToString(Newtonsoft.Json.Formatting.None);
          }</set-body>
				</return-response>
			</when>
			<when condition="@((string)context.Variables[&quot;rpcMethod&quot;] == &quot;tools/list&quot;)">
				<return-response>
					<set-status code="200" reason="OK" />
					<set-header name="Content-Type" exists-action="override">
						<value>application/json</value>
					</set-header>
					<set-body>@{
            var req = context.Request.Body?.As<Newtonsoft.Json.Linq.JObject>(preserveContent: true) ?? new Newtonsoft.Json.Linq.JObject();
            var idRaw = req["id"]?.ToString() ?? "1";
            long idLong;
            Newtonsoft.Json.Linq.JToken idToken = long.TryParse(idRaw, out idLong) ? (Newtonsoft.Json.Linq.JToken)new Newtonsoft.Json.Linq.JValue(idLong) : new Newtonsoft.Json.Linq.JValue(idRaw);
            var tools = new Newtonsoft.Json.Linq.JArray
            {
              new Newtonsoft.Json.Linq.JObject
              {
                ["name"] = "findPetsByStatus",
                ["description"] = "Find pets by status from the Petstore API",
                ["inputSchema"] = new Newtonsoft.Json.Linq.JObject
                {
                  ["type"] = "object",
                  ["properties"] = new Newtonsoft.Json.Linq.JObject
                  {
                    ["status"] = new Newtonsoft.Json.Linq.JObject
                    {
                      ["type"] = "string",
                      ["enum"] = new Newtonsoft.Json.Linq.JArray { "available", "pending", "sold" }
                    }
                  },
                  ["required"] = new Newtonsoft.Json.Linq.JArray { "status" }
                }
              },
              new Newtonsoft.Json.Linq.JObject
              {
                ["name"] = "getPetById",
                ["description"] = "Get a pet by ID from the Petstore API",
                ["inputSchema"] = new Newtonsoft.Json.Linq.JObject
                {
                  ["type"] = "object",
                  ["properties"] = new Newtonsoft.Json.Linq.JObject
                  {
                    ["petId"] = new Newtonsoft.Json.Linq.JObject
                    {
                      ["type"] = "integer"
                    }
                  },
                  ["required"] = new Newtonsoft.Json.Linq.JArray { "petId" }
                }
              }
            };

            var response = new Newtonsoft.Json.Linq.JObject
            {
              ["jsonrpc"] = "2.0",
              ["id"] = idToken,
              ["result"] = new Newtonsoft.Json.Linq.JObject { ["tools"] = tools }
            };
            return response.ToString(Newtonsoft.Json.Formatting.None);
          }</set-body>
				</return-response>
			</when>
			<when condition="@((string)context.Variables[&quot;rpcMethod&quot;] == &quot;tools/call&quot; &amp;&amp; (string)context.Variables[&quot;toolName&quot;] == &quot;findPetsByStatus&quot;)">
				<send-request mode="new" response-variable-name="petstoreResp" timeout="20" ignore-error="false">
					<set-url>@($"https://petstore3.swagger.io/api/v3/pet/findByStatus?status={(string)context.Variables[&quot;petStatus&quot;]}")</set-url>
					<set-method>GET</set-method>
				</send-request>
				<set-variable name="petstoreBody" value="@(((IResponse)context.Variables[&quot;petstoreResp&quot;]).Body.As&lt;string&gt;(preserveContent: true))" />
				<return-response>
					<set-status code="200" reason="OK" />
					<set-header name="Content-Type" exists-action="override">
						<value>application/json</value>
					</set-header>
					<set-body>@{
            var req = context.Request.Body?.As<Newtonsoft.Json.Linq.JObject>(preserveContent: true) ?? new Newtonsoft.Json.Linq.JObject();
            var idRaw = req["id"]?.ToString() ?? "1";
            long idLong;
            Newtonsoft.Json.Linq.JToken idToken = long.TryParse(idRaw, out idLong) ? (Newtonsoft.Json.Linq.JToken)new Newtonsoft.Json.Linq.JValue(idLong) : new Newtonsoft.Json.Linq.JValue(idRaw);
            var text = (string)context.Variables["petstoreBody"];
            var response = new Newtonsoft.Json.Linq.JObject
            {
              ["jsonrpc"] = "2.0",
              ["id"] = idToken,
              ["result"] = new Newtonsoft.Json.Linq.JObject
              {
                ["content"] = new Newtonsoft.Json.Linq.JArray
                {
                  new Newtonsoft.Json.Linq.JObject
                  {
                    ["type"] = "text",
                    ["text"] = text
                  }
                }
              }
            };
            return response.ToString(Newtonsoft.Json.Formatting.None);
          }</set-body>
				</return-response>
			</when>
			<when condition="@((string)context.Variables[&quot;rpcMethod&quot;] == &quot;tools/call&quot; &amp;&amp; (string)context.Variables[&quot;toolName&quot;] == &quot;getPetById&quot;)">
				<send-request mode="new" response-variable-name="petstoreResp" timeout="20" ignore-error="false">
					<set-url>@($"https://petstore3.swagger.io/api/v3/pet/{(string)context.Variables[&quot;petId&quot;]}")</set-url>
					<set-method>GET</set-method>
				</send-request>
				<set-variable name="petstoreBody" value="@(((IResponse)context.Variables[&quot;petstoreResp&quot;]).Body.As&lt;string&gt;(preserveContent: true))" />
				<return-response>
					<set-status code="200" reason="OK" />
					<set-header name="Content-Type" exists-action="override">
						<value>application/json</value>
					</set-header>
					<set-body>@{
            var req = context.Request.Body?.As<Newtonsoft.Json.Linq.JObject>(preserveContent: true) ?? new Newtonsoft.Json.Linq.JObject();
            var idRaw = req["id"]?.ToString() ?? "1";
            long idLong;
            Newtonsoft.Json.Linq.JToken idToken = long.TryParse(idRaw, out idLong) ? (Newtonsoft.Json.Linq.JToken)new Newtonsoft.Json.Linq.JValue(idLong) : new Newtonsoft.Json.Linq.JValue(idRaw);
            var text = (string)context.Variables["petstoreBody"];
            var response = new Newtonsoft.Json.Linq.JObject
            {
              ["jsonrpc"] = "2.0",
              ["id"] = idToken,
              ["result"] = new Newtonsoft.Json.Linq.JObject
              {
                ["content"] = new Newtonsoft.Json.Linq.JArray
                {
                  new Newtonsoft.Json.Linq.JObject
                  {
                    ["type"] = "text",
                    ["text"] = text
                  }
                }
              }
            };
            return response.ToString(Newtonsoft.Json.Formatting.None);
          }</set-body>
				</return-response>
			</when>
			<when condition="@((string)context.Variables[&quot;rpcMethod&quot;] == &quot;notifications/initialized&quot;)">
				<return-response>
					<set-status code="202" reason="Accepted" />
				</return-response>
			</when>
			<otherwise>
				<return-response>
					<set-status code="200" reason="OK" />
					<set-header name="Content-Type" exists-action="override">
						<value>application/json</value>
					</set-header>
					<set-body>@{
            var req = context.Request.Body?.As<Newtonsoft.Json.Linq.JObject>(preserveContent: true) ?? new Newtonsoft.Json.Linq.JObject();
            var idRaw = req["id"]?.ToString() ?? "1";
            long idLong;
            Newtonsoft.Json.Linq.JToken idToken = long.TryParse(idRaw, out idLong) ? (Newtonsoft.Json.Linq.JToken)new Newtonsoft.Json.Linq.JValue(idLong) : new Newtonsoft.Json.Linq.JValue(idRaw);
            var response = new Newtonsoft.Json.Linq.JObject
            {
              ["jsonrpc"] = "2.0",
              ["id"] = idToken,
              ["error"] = new Newtonsoft.Json.Linq.JObject
              {
                ["code"] = -32601,
                ["message"] = "Method not found"
              }
            };
            return response.ToString(Newtonsoft.Json.Formatting.None);
          }</set-body>
				</return-response>
			</otherwise>
		</choose>
	</inbound>
	<backend>
		<base />
	</backend>
	<outbound>
		<base />
	</outbound>
	<on-error>
		<base />
	</on-error>
</policies>
'''

var mcpExistingServerPolicyXml = '''
<policies>
  <inbound>
    <base />
    <set-variable name="requestBody" value="@(context.Request.Body?.As&lt;string&gt;(preserveContent: true) ?? string.Empty)" />
    <set-variable name="sessionId" value="@(context.Request.Headers.GetValueOrDefault(&quot;Mcp-Session-Id&quot;, string.Empty))" />
    <set-variable name="protocolVersion" value="@(context.Request.Headers.GetValueOrDefault(&quot;MCP-Protocol-Version&quot;, &quot;2025-03-26&quot;))" />
    <send-request mode="new" response-variable-name="learnResp" timeout="60" ignore-error="false">
      <set-url>https://learn.microsoft.com/api/mcp</set-url>
      <set-method>@(context.Request.Method)</set-method>
      <set-header name="Accept" exists-action="override">
        <value>@(context.Request.Headers.GetValueOrDefault(&quot;Accept&quot;, &quot;text/event-stream&quot;))</value>
      </set-header>
      <set-header name="Content-Type" exists-action="override">
        <value>@(context.Request.Headers.GetValueOrDefault(&quot;Content-Type&quot;, &quot;application/json&quot;))</value>
      </set-header>
      <set-header name="MCP-Protocol-Version" exists-action="override">
        <value>@((string)context.Variables[&quot;protocolVersion&quot;])</value>
      </set-header>
      <set-header name="Mcp-Session-Id" exists-action="override">
        <value>@((string)context.Variables[&quot;sessionId&quot;])</value>
      </set-header>
      <set-body>@((string)context.Variables[&quot;requestBody&quot;])</set-body>
    </send-request>
    <return-response response-variable-name="learnResp" />
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

resource apiMcpFromApi 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' existing = {
  parent: apim
  name: 'src-mcp-from-api'
}

resource apiMcpExistingServer 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' existing = {
  parent: apim
  name: 'src-mcp-existing-server'
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

resource apiMcpFromApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2025-09-01-preview' = {
  parent: apiMcpFromApi
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: mcpApiPolicyXml
  }
}

resource apiMcpExistingServerPolicy 'Microsoft.ApiManagement/service/apis/policies@2025-09-01-preview' = {
  parent: apiMcpExistingServer
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: mcpExistingServerPolicyXml
  }
}

resource policyRestriction 'Microsoft.ApiManagement/service/policyRestrictions@2025-09-01-preview' = if (isClassicSku) {
  parent: apim
  name: 'src-restriction-ip'
  properties: {
    scope: '/products/${productStarter.name}'
    requireBase: 'true'
  }
}
