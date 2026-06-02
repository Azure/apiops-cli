# Artifact Directory Format

`apiops extract` writes APIM resources to a local directory as JSON information files, XML policy files, and API specification files. This reference documents the directory layout, naming conventions, and all 34 resource types.

## Overview

The artifact directory mirrors the APIM resource hierarchy. Each resource type has a defined:
- **Directory path** — where files are stored (templates use `{0}`, `{1}` for resource names)
- **Info file** — the JSON or XML file containing the resource definition

The default output directory is `./apim-artifacts`, configurable via `--output`:

```bash
apiops extract --output ./my-artifacts ...
```

---

## Directory Layout Example

```
apim-artifacts/
├── policy.xml                              # Service-level policy
├── apis/
│   └── petstore-api/
│       ├── apiInformation.json             # API definition
│       ├── policy.xml                      # API-level policy
│       ├── specification.yaml              # OpenAPI spec (if applicable)
│       ├── wiki.md                         # API wiki (if exists)
│       ├── mcpServerInformation.json       # MCP server config (if exists)
│       ├── operations/
│       │   └── get-pets/
│       │       └── policy.xml              # Operation-level policy
│       ├── tags/
│       │   └── production/
│       │       └── tagInformation.json
│       ├── diagnostics/
│       │   └── applicationinsights/
│       │       └── diagnosticInformation.json
│       ├── schemas/
│       │   └── pet-schema/
│       │       └── schemaInformation.json
│       ├── releases/
│       │   └── release-1/
│       │       └── releaseInformation.json
│       ├── tagDescriptions/
│       │   └── production/
│       │       └── tagDescriptionInformation.json
│       └── resolvers/                      # GraphQL APIs only
│           └── get-pets-resolver/
│               ├── resolverInformation.json
│               └── policy.xml
├── products/
│   └── starter/
│       ├── productInformation.json
│       ├── policy.xml
│       ├── apis.json                       # Product → API associations
│       ├── groups.json                     # Product → Group associations
│       └── wiki.md
├── backends/
│   └── petstore-backend/
│       └── backendInformation.json
├── namedValues/
│   └── api-key/
│       └── namedValueInformation.json
├── tags/
│   └── production/
│       └── tagInformation.json
├── policyFragments/
│   └── rate-limit/
│       └── policyFragmentInformation.json
├── loggers/
│   └── appinsights/
│       └── loggerInformation.json
├── diagnostics/
│   └── applicationinsights/
│       └── diagnosticInformation.json
├── gateways/
│   └── self-hosted/
│       ├── gatewayInformation.json
│       └── apis.json                       # Gateway → API associations
├── versionSets/
│   └── orders-version-set/
│       └── versionSetInformation.json
├── groups/
│   └── developers/
│       └── groupInformation.json
├── subscriptions/
│   └── team-a-sub/
│       └── subscriptionInformation.json
├── schemas/
│   └── shared-error-schema/
│       └── schemaInformation.json
├── policyRestrictions/
│   └── no-external-calls/
│       └── policyRestrictionInformation.json
└── documentations/
    └── getting-started/
        └── documentationInformation.json
```

---

## Resource Type Metadata

All 34 APIM resource types and their artifact mappings:

### Top-Level Resources

| Resource Type | Artifact Directory | Info File |
|--------------|-------------------|-----------|
| NamedValue | `namedValues/{name}` | `namedValueInformation.json` |
| Tag | `tags/{name}` | `tagInformation.json` |
| Gateway | `gateways/{name}` | `gatewayInformation.json` |
| VersionSet | `versionSets/{name}` | `versionSetInformation.json` |
| Backend | `backends/{name}` | `backendInformation.json` |
| Logger | `loggers/{name}` | `loggerInformation.json` |
| Group | `groups/{name}` | `groupInformation.json` |
| Diagnostic | `diagnostics/{name}` | `diagnosticInformation.json` |
| PolicyFragment | `policyFragments/{name}` | `policyFragmentInformation.json` |
| ServicePolicy | _(root directory)_ | `policy.xml` |
| Product | `products/{name}` | `productInformation.json` |
| Api | `apis/{name}` | `apiInformation.json` |
| Subscription | `subscriptions/{name}` | `subscriptionInformation.json` |
| GlobalSchema | `schemas/{name}` | `schemaInformation.json` |
| PolicyRestriction | `policyRestrictions/{name}` | `policyRestrictionInformation.json` |
| Documentation | `documentations/{name}` | `documentationInformation.json` |

### Product Child Resources

| Resource Type | Artifact Directory | Info File |
|--------------|-------------------|-----------|
| ProductPolicy | `products/{product}` | `policy.xml` |
| ProductApi | `products/{product}` | `apis.json` |
| ProductGroup | `products/{product}` | `groups.json` |
| ProductTag | `products/{product}` | _(embedded in productInformation.json)_ |
| ProductWiki | `products/{product}` | `wiki.md` |

### API Child Resources

| Resource Type | Artifact Directory | Info File |
|--------------|-------------------|-----------|
| ApiPolicy | `apis/{api}` | `policy.xml` |
| ApiTag | `apis/{api}/tags/{tag}` | `tagInformation.json` |
| ApiDiagnostic | `apis/{api}/diagnostics/{diagnostic}` | `diagnosticInformation.json` |
| ApiOperation | `apis/{api}/operations/{operation}` | _(none)_ |
| ApiOperationPolicy | `apis/{api}/operations/{operation}` | `policy.xml` |
| ApiSchema | `apis/{api}/schemas/{schema}` | `schemaInformation.json` |
| ApiRelease | `apis/{api}/releases/{release}` | `releaseInformation.json` |
| ApiTagDescription | `apis/{api}/tagDescriptions/{tagDescription}` | `tagDescriptionInformation.json` |
| ApiWiki | `apis/{api}` | `wiki.md` |
| GraphQLResolver | `apis/{api}/resolvers/{resolver}` | `resolverInformation.json` |
| GraphQLResolverPolicy | `apis/{api}/resolvers/{resolver}` | `policy.xml` |
| McpServer | `apis/{api}` | `mcpServerInformation.json` |

### Gateway Child Resources

| Resource Type | Artifact Directory | Info File |
|--------------|-------------------|-----------|
| GatewayApi | `gateways/{gateway}` | `apis.json` |

---

## JSON Info File Structure

Each `*Information.json` file contains the ARM resource properties extracted from APIM. The structure follows the Azure REST API response format:

```json
{
  "properties": {
    "displayName": "Petstore API",
    "path": "petstore",
    "protocols": ["https"],
    "serviceUrl": "https://petstore.example.com",
    "subscriptionRequired": true
  }
}
```

Key points:
- The top-level wrapper is `{ "properties": { ... } }` — matching the ARM resource shape
- Resource names are derived from directory names, not from inside the JSON
- APIM-managed fields (like `id`, `type`, `name`) are **not** stored — they're reconstructed at publish time
- Association files (`apis.json`, `groups.json`) contain arrays of resource references

### Association Files

Product-API and Gateway-API associations use array files:

```json
// products/starter/apis.json
[
  { "name": "petstore-api" },
  { "name": "orders-api" }
]
```

```json
// products/starter/groups.json
[
  { "name": "developers" },
  { "name": "partners" }
]
```

---

## Policy XML Files

Policy files are raw APIM policy XML. They appear at three levels:

| Level | Location | Scope |
|-------|----------|-------|
| Service | `policy.xml` (root) | Applies to all APIs |
| API | `apis/{name}/policy.xml` | Applies to all operations in the API |
| Operation | `apis/{name}/operations/{op}/policy.xml` | Applies to a specific operation |
| Product | `products/{name}/policy.xml` | Applies to APIs within the product |
| GraphQL Resolver | `apis/{name}/resolvers/{resolver}/policy.xml` | Resolver-specific policy |

Example policy XML:

```xml
<policies>
  <inbound>
    <rate-limit calls="100" renewal-period="60" />
    <set-backend-service backend-id="petstore-backend" />
  </inbound>
  <backend>
    <forward-request />
  </backend>
  <outbound />
  <on-error />
</policies>
```

---

## Naming Conventions

- **Directory names** use the APIM resource name (usually lowercase, hyphenated)
- **Info file names** follow the pattern `{resourceType}Information.json`
- **Policy files** are always named `policy.xml`
- **API specifications** are named `specification.{ext}` (e.g., `specification.yaml`, `specification.json`, `specification.wsdl`)
  - Specification files are not exported for API types that don't use OpenAPI/WSDL artifacts (for example: WebSocket, MCP, A2A).
- **Wiki files** are named `wiki.md`

---

## Workspace Resources

APIM [workspaces](https://learn.microsoft.com/en-us/azure/api-management/workspaces-overview) provide isolated environments within a single APIM instance. When workspaces are extracted, their resources follow the same directory structure nested under a workspace directory.

Workspace resource extraction is controlled via the `workspaceNames` filter in your [filter configuration](../guides/filtering-resources.md).

---

## Related

- [apiops extract](../commands/extract.md) — extract command reference
- [apiops publish](../commands/publish.md) — publish command reference
- [Filtering Resources](../guides/filtering-resources.md) — control what gets extracted
- [Environment Overrides](../guides/environment-overrides.md) — modify values at publish time
- [Configuration Reference](configuration.md) — config priority chain
- [APIM Glossary](apim-glossary.md) — APIM resource terminology
