# ApimExpert — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.specify/memory/constitution.md` (v2.1.0)
- **User:** Elizabeth Maher
- **Stack:** TypeScript 5.x, Node.js 22 LTS, `@azure/identity` for auth, raw APIM REST API (no SDK for payloads)
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

<!-- Append new learnings here after each session -->

