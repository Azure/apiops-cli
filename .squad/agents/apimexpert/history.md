# ApimExpert — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0)
- **User:** Elizabeth Maher
- **Stack:** TypeScript 6.x, Node.js 22 LTS, `@azure/identity` for auth, raw APIM REST API (no SDK for payloads)
- **APIM REST API base:** `https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{svc}`
- **Key rule:** Resource bodies are `Record<string, unknown>` — never typed DTOs. Unknown properties MUST be preserved.

## Learnings

### 2026-04-10: XML Response Handling in APIM Policy Endpoints

**Key finding:** APIM policy endpoints return raw XML instead of JSON-wrapped XML, requiring special handling in ApimClient.

**Affected endpoints:**
- ServicePolicy: `GET /policies/policy`
- ApiPolicy: `GET /apis/{name}/policies/policy`
- ApiOperationPolicy: `GET /apis/{name}/operations/{opName}/policies/policy`
- ProductPolicy: `GET /products/{name}/policies/policy`
- GraphQLResolverPolicy: `GET /apis/{name}/resolvers/{resolverName}/policies/policy`

**API quirk:** These endpoints return `Content-Type: application/xml` or sometimes return raw XML without proper Content-Type header. The response body is pure XML string, not JSON-wrapped.

**Resolution:** TypeScriptDev implemented text-first parsing in getResource:
1. Read response as text (not JSON)
2. Detect XML via `Content-Type: application/xml` or body sniffing (`startsWith('<')`)
3. For XML: wrap in ARM envelope `{ properties: { value: xmlContent, format: 'rawxml' } }`
4. For JSON: parse normally

**Callers don't need changes:** They already expect `properties.value` to contain the policy content, so the wrapping is transparent.

### 2026-04-21: Export format quirks per API type — SOAP 500s and synthetic GraphQL 406s

**APIM export format matrix (api-version 2024-05-01):**

| API type   | Primary format     | Fallback          | Notes                                           |
| ---------- | ------------------ | ----------------- | ----------------------------------------------- |
| `http`     | `openapi-link`     | —                 | Default. Also accepts `swagger-link`, `openapi+json-link`, `wadl-link`. |
| `soap`     | `wsdl-link`        | inline `wsdl`     | wsdl-link emitter 500s deterministically on many real-world APIs. |
| `graphql`  | `graphql-link`     | (skip)            | Synthetic GraphQL (schema as ApiSchema) returns 406 — skip export entirely. |
| `websocket`| (none)             | —                 | No traditional spec.                            |

**Inline (non-link) export endpoints:** `format=wsdl` | `wadl` | `swagger` | `openapi` | `openapi+json`
- Response shape: `{ properties: { value: "<xml-or-json-string>" } }` (api-version 2024-05-01; older versions use top-level `value`).
- Re-importable via PUT `?import=true&format=<matching-format>` with the value as `properties.value`.

**Synthetic vs pass-through GraphQL:** APIM has two GraphQL flavors:
- **Synthetic:** SDL stored as an ApiSchema child with `contentType` containing `'graphql'`. Export via `graphql-link` returns HTTP 406. Standard ApiSchema extraction captures the SDL.
- **Pass-through:** Remote GraphQL endpoint. Export via `graphql-link` returns a SAS blob link with the SDL.

Detection strategy in `api-extractor.ts#hasGraphQLSchemaResource`: list ApiSchema children, check for `contentType` containing `'graphql'`. If yes → skip export.

**SOAP 500 divergence from Azure/apiops:** The reference tool at `C:\Users\enewman\source\repos\azure\apiops` catches HTTP 500 on XML exports and skips the spec with comment *"Don't export XML specifications, as the non-link exports cannot be reimported."* This is incorrect — inline `format=wsdl` output **is** re-importable via PUT `?import=true&format=wsdl`. Our implementation uses this fallback to preserve round-trip capability.

**Retry policy for XML exports:** Pass `noRetryOn5xx=true` to `request()` for wsdl-link/wadl-link. The 500s are deterministic, not transient, so retries waste time. Fall back to inline format immediately.

### 2026-04-21: Authoritative APIM REST API schema source

Ground payload/response shape questions in the upstream REST API specs — not in
the SDK surface, reference docs, or ad-hoc observation.

**Source of truth:** <https://github.com/Azure/azure-rest-api-specs/tree/main/specification/apimanagement>

- Swagger/TypeSpec definitions per api-version (`stable/2024-05-01/`, etc.).
- Examples folder shows real request/response bodies, including the edge-case
  shapes we hit (e.g. inline WSDL export, synthetic GraphQL, named-value
  key-vault references, long-running op status envelopes).
- Use this when diagnosing: new api-version diffs, unexpected payload fields,
  export/import format semantics, resource-type discovery.

### 2026-05-13: APIM v1 → v2 SKU Migration Research

**Key findings for classic-to-v2 migration via apiops-cli:**

1. **No in-place upgrade path exists.** Microsoft confirms "Upgrade to v2 tiers from classic tiers" is "currently unavailable." The only path is side-by-side: create new v2 instance, recreate configuration.

2. **REST API surface is identical.** The same ARM resource paths (`api-version=2024-05-01`) work on both classic and v2 instances. All 34 resource types apiops-cli handles can be extracted from classic and published to v2 via the same endpoints.

3. **apiops-cli covers ~80-85% of migration today.** The standard extract→publish flow transfers APIs, products, backends, policies, tags, groups, schemas, and all child resources cleanly. Gaps: subscription key preservation (needs `listSecrets` flow), named value secret transfer (currently redacted), and pre-flight v2 compatibility checks.

4. **v2 feature gaps are significant blockers for some users:**
   - Self-hosted gateways: NOT available on any v2 tier
   - Multi-region deployment: NOT available on v2
   - Service Fabric backends: NOT available on v2
   - gRPC backends: NOT available on v2
   - Static IP: NOT available on v2
   - Backup/restore: NOT available on v2
   - Gateway buffered payload limit drops from 500 MiB to 2 MiB

5. **Subscription keys CAN be preserved** via `PUT /subscriptions/{sid}` with `properties.primaryKey`/`properties.secondaryKey`. Keys are write-only on GET but settable on PUT.

6. **Managed identity is the biggest manual effort.** New instance = new system-assigned identity = must re-grant RBAC on every downstream resource (Key Vault, Storage, Event Hub, etc.). User-assigned identities can be shared.

7. **Workspaces are NOT v2-exclusive.** Both Premium (classic) and PremiumV2 support workspaces.

**Research output:** `.squad/decisions.md` entry (merged from inbox), full analysis in `specs/sku-upgrade.md`

### 2026-05-14: Multi-Environment Promotion & Workspace Interaction

**Key findings:**
- Environment identity must stay outside artifact paths. Override files and pipeline stages handle env divergence.
- Workspaces ≠ environments. Workspaces = structural scoping (teams/products). Environments = deployment lifecycle.
- Sound: separate instances per env + optional workspaces for team isolation.
- Unsafe: single instance with workspace-per-env (requires path rewriting, violates §VII).
- Future enhancements: workspace-scoped overrides, workspace auto-discovery.

**Output:** `specs/multi-environment-workspaces.md`, decision in `.squad/decisions/inbox/apimexpert-multi-env-spec.md`

### 2026-05-13: APIM v1 → v2 SKU Migration Research

