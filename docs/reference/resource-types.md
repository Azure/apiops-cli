# Supported Resource Types

apiops-cli supports **34 Azure API Management resource types** for extraction and publishing. This reference lists every resource type, its ARM path, artifact directory layout, and info file name.

## How to Read This Reference

| Column | Description |
|--------|-------------|
| **Resource Type** | Internal name used in logs and dependency graph |
| **ARM Path** | Azure Resource Manager sub-path under the APIM service resource |
| **Artifact Directory** | Directory structure in extracted artifacts (`{0}`, `{1}` = resource name segments) |
| **Info File** | JSON or XML file containing resource properties |

> **Tip:** Use the **Artifact Directory** column to understand where `apiops extract` writes each resource, and where `apiops publish` reads from.

---

## Service-Level Resources

These resources exist at the APIM service scope — they are not children of any other resource.

| Resource Type | ARM Path | Artifact Directory | Info File | Description |
|---------------|----------|-------------------|-----------|-------------|
| NamedValue | `/namedValues/{name}` | `namedValues/{0}` | `namedValueInformation.json` | Key-value pairs for use in policies (e.g., secrets, connection strings) |
| Tag | `/tags/{name}` | `tags/{0}` | `tagInformation.json` | Labels for organizing APIs and products |
| Gateway | `/gateways/{name}` | `gateways/{0}` | `gatewayInformation.json` | Self-hosted gateway definitions |
| VersionSet | `/apiVersionSets/{name}` | `versionSets/{0}` | `versionSetInformation.json` | Groups API versions together (by path, header, or query) |
| Backend | `/backends/{name}` | `backends/{0}` | `backendInformation.json` | Backend service endpoints referenced by policies |
| Logger | `/loggers/{name}` | `loggers/{0}` | `loggerInformation.json` | Logging destinations (Application Insights, Event Hub) |
| Group | `/groups/{name}` | `groups/{0}` | `groupInformation.json` | User groups for access control |
| Diagnostic | `/diagnostics/{name}` | `diagnostics/{0}` | `diagnosticInformation.json` | Logging/diagnostic settings (references a Logger) |
| PolicyFragment | `/policyFragments/{name}` | `policyFragments/{0}` | `policyFragmentInformation.json` | Reusable policy XML snippets |
| ServicePolicy | `/policies/policy` | *(root)* | `policy.xml` | Global policy applied to all APIs |
| GlobalSchema | `/schemas/{name}` | `schemas/{0}` | `schemaInformation.json` | Service-level schemas (shared across APIs) |
| PolicyRestriction | `/policyRestrictions/{name}` | `policyRestrictions/{0}` | `policyRestrictionInformation.json` | Rules restricting which policies can be used |
| Documentation | `/documentations/{name}` | `documentations/{0}` | `documentationInformation.json` | Service-level documentation resources |
| Subscription | `/subscriptions/{name}` | `subscriptions/{0}` | `subscriptionInformation.json` | API/product subscription keys |

## Product Resources

Resources scoped to a specific product.

| Resource Type | ARM Path | Artifact Directory | Info File | Description |
|---------------|----------|-------------------|-----------|-------------|
| Product | `/products/{name}` | `products/{0}` | `productInformation.json` | Product definition (groups APIs for access control and rate limiting) |
| ProductPolicy | `/products/{name}/policies/policy` | `products/{0}` | `policy.xml` | Policy applied to all APIs within a product |
| ProductApi | `/products/{name}/apis/{api}` | `products/{0}` | `apis.json` | Association linking an API to a product |
| ProductGroup | `/products/{name}/groups/{group}` | `products/{0}` | `groups.json` | Association linking a user group to a product |
| ProductTag | `/products/{name}/tags/{tag}` | `products/{0}` | *(embedded in productInformation.json)* | Tag applied to a product |
| ProductWiki | `/products/{name}/wikis/default` | `products/{0}` | `wiki.md` | Markdown documentation page for a product |

## API Resources

Resources scoped to a specific API.

| Resource Type | ARM Path | Artifact Directory | Info File | Description |
|---------------|----------|-------------------|-----------|-------------|
| Api | `/apis/{name}` | `apis/{0}` | `apiInformation.json` | API definition (REST, SOAP, GraphQL, WebSocket) |
| ApiPolicy | `/apis/{name}/policies/policy` | `apis/{0}` | `policy.xml` | Policy applied to all operations in an API |
| ApiTag | `/apis/{name}/tags/{tag}` | `apis/{0}/tags/{1}` | `tagInformation.json` | Tag applied to an API |
| ApiDiagnostic | `/apis/{name}/diagnostics/{diag}` | `apis/{0}/diagnostics/{1}` | `diagnosticInformation.json` | Diagnostic settings scoped to an API |
| ApiOperation | `/apis/{name}/operations/{op}` | `apis/{0}/operations/{1}` | `operationInformation.json` | Individual API operation (GET /users, POST /orders, etc.) |
| ApiOperationPolicy | `/apis/{name}/operations/{op}/policies/policy` | `apis/{0}/operations/{1}` | `policy.xml` | Policy applied to a specific API operation |
| ApiSchema | `/apis/{name}/schemas/{schema}` | `apis/{0}/schemas/{1}` | `schemaInformation.json` | Schema definition for request/response validation |
| ApiRelease | `/apis/{name}/releases/{release}` | `apis/{0}/releases/{1}` | `releaseInformation.json` | API release record (makes a revision current) |
| ApiTagDescription | `/apis/{name}/tagDescriptions/{tag}` | `apis/{0}/tagDescriptions/{1}` | `tagDescriptionInformation.json` | Extended tag description with external docs link |
| ApiWiki | `/apis/{name}/wikis/default` | `apis/{0}` | `wiki.md` | Markdown documentation page for an API |
| GraphQLResolver | `/apis/{name}/resolvers/{resolver}` | `apis/{0}/resolvers/{1}` | `resolverInformation.json` | GraphQL field resolver configuration |
| GraphQLResolverPolicy | `/apis/{name}/resolvers/{resolver}/policies/policy` | `apis/{0}/resolvers/{1}` | `policy.xml` | Policy applied to a GraphQL resolver |
| McpServer | `/apis/{name}/mcpServers/default` | `apis/{0}` | `mcpServerInformation.json` | MCP (Model Context Protocol) server linked to an API |

## Gateway Resources

Resources scoped to a self-hosted gateway.

| Resource Type | ARM Path | Artifact Directory | Info File | Description |
|---------------|----------|-------------------|-----------|-------------|
| GatewayApi | `/gateways/{name}/apis/{api}` | `gateways/{0}` | `apis.json` | Association linking an API to a self-hosted gateway |

## Notes

### LIST API Limitations

Some resource types have a `listOmitsFields` behavior — the LIST endpoint omits certain fields from the response. For these types, apiops-cli makes individual GET requests for each resource to capture the full payload:

- **ApiSchema** — LIST omits the schema `document` content
- **ApiRelease** — LIST omits release `notes`

### Artifact Directory Patterns

- `{0}` is replaced with the resource's display name (sanitized for filesystem use)
- `{1}` is replaced with the child resource's display name
- Resources without an info file (e.g., ApiOperation) are represented only by their child resources (e.g., operation policies)
- The `ServicePolicy` info file (`policy.xml`) lives at the artifact root, not in a subdirectory

### Example Directory Tree

```
apim-artifacts/
├── policy.xml                          # ServicePolicy
├── namedValues/
│   └── my-secret/
│       └── namedValueInformation.json
├── apis/
│   └── petstore/
│       ├── apiInformation.json
│       ├── policy.xml                  # ApiPolicy
│       ├── specification.yaml          # OpenAPI spec
│       ├── wiki.md                     # ApiWiki
│       ├── operations/
│       │   └── get-pets/
│       │       └── policy.xml          # ApiOperationPolicy
│       └── tags/
│           └── pets/
│               └── tagInformation.json # ApiTag
├── products/
│   └── starter/
│       ├── productInformation.json
│       ├── policy.xml                  # ProductPolicy
│       ├── apis.json                   # ProductApi associations
│       └── groups.json                 # ProductGroup associations
└── backends/
    └── my-backend/
        └── backendInformation.json
```

## Related Docs

- [Dependency Graph](./dependency-graph.md) — processing order and tier assignments
- [Exit Codes](./exit-codes.md) — understanding extraction/publish results
- [`apiops extract`](../commands/extract.md) — extract command reference
- [`apiops publish`](../commands/publish.md) — publish command reference
