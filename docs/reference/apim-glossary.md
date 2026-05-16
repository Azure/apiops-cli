# APIM Concepts Glossary

A quick reference to Azure API Management (APIM) terminology for developers new to the platform. Each term includes how it appears in apiops-cli artifacts.

> For comprehensive documentation, see [Azure API Management documentation](https://learn.microsoft.com/en-us/azure/api-management/).

---

## Terms

### API

A REST, SOAP, GraphQL, or WebSocket endpoint definition managed by APIM. Each API has a base path, one or more protocols, and a set of operations.

- **Microsoft Docs:** [APIs in API Management](https://learn.microsoft.com/en-us/azure/api-management/api-management-key-concepts#apis)
- **In artifacts:** `apis/{name}/apiInformation.json`

---

### API Operation

An individual endpoint within an API — a specific HTTP method + URL path combination (e.g., `GET /pets`, `POST /orders`).

- **Microsoft Docs:** [API operations](https://learn.microsoft.com/en-us/azure/api-management/api-management-key-concepts#api-operations)
- **In artifacts:** `apis/{api}/operations/{operation}/` — operations have no info file, only `policy.xml` if a policy is set

---

### Product

A bundle of one or more APIs with access policies and subscription requirements. Products control which APIs are available to developers and under what terms.

- **Microsoft Docs:** [Products](https://learn.microsoft.com/en-us/azure/api-management/api-management-key-concepts#products)
- **In artifacts:** `products/{name}/productInformation.json`, with `apis.json` and `groups.json` for associations

---

### Subscription

An access key pair (primary + secondary) that developers use to call APIs through products. Subscriptions enforce usage quotas and rate limits.

- **Microsoft Docs:** [Subscriptions](https://learn.microsoft.com/en-us/azure/api-management/api-management-subscriptions)
- **In artifacts:** `subscriptions/{name}/subscriptionInformation.json`

---

### Named Value

A key-value store for reusable configuration data — connection strings, API keys, feature flags. Named values can reference Azure Key Vault secrets for secure storage.

- **Microsoft Docs:** [Named values](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-properties)
- **In artifacts:** `namedValues/{name}/namedValueInformation.json`

---

### Backend

A backend service definition specifying the URL and optional credentials for the service behind an API. Policies use `set-backend-service` to route requests.

- **Microsoft Docs:** [Backends](https://learn.microsoft.com/en-us/azure/api-management/backends)
- **In artifacts:** `backends/{name}/backendInformation.json`

---

### Policy

XML-based middleware that runs on API requests and responses. Policies handle rate limiting, caching, request/response transformation, authentication, and more. Policies apply at four scopes: service (global), product, API, and operation.

- **Microsoft Docs:** [Policies](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-policies)
- **In artifacts:** `policy.xml` at the relevant scope (root, `apis/{name}/`, `apis/{name}/operations/{op}/`, `products/{name}/`)

---

### Policy Fragment

A reusable snippet of policy XML that can be included in other policies via `<include-fragment>`. Useful for shared logic like standard rate limiting or CORS headers.

- **Microsoft Docs:** [Policy fragments](https://learn.microsoft.com/en-us/azure/api-management/policy-fragments)
- **In artifacts:** `policyFragments/{name}/policyFragmentInformation.json`

---

### Tag

A label for organizing APIs, products, and operations. Tags appear in the developer portal for navigation and grouping.

- **Microsoft Docs:** [Tags](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-use-tags)
- **In artifacts:** `tags/{name}/tagInformation.json` (service-level), `apis/{api}/tags/{tag}/tagInformation.json` (API-level)

---

### Logger

A logging target — typically Azure Application Insights or Azure Event Hub. Loggers define where diagnostic data is sent.

- **Microsoft Docs:** [Logging](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-use-azure-monitor)
- **In artifacts:** `loggers/{name}/loggerInformation.json`

---

### Diagnostic

A logging configuration that links a logger to an API (or the entire service). Diagnostics control what gets logged — headers, body, sampling rate.

- **Microsoft Docs:** [Diagnostics](https://learn.microsoft.com/en-us/azure/api-management/diagnostic-logs-reference)
- **In artifacts:** `diagnostics/{name}/diagnosticInformation.json` (service-level), `apis/{api}/diagnostics/{name}/diagnosticInformation.json` (API-level)

---

### Gateway

A self-hosted gateway for running APIM in hybrid or multi-cloud environments. Self-hosted gateways run as containers on your infrastructure while managed by your APIM instance.

- **Microsoft Docs:** [Self-hosted gateway](https://learn.microsoft.com/en-us/azure/api-management/self-hosted-gateway-overview)
- **In artifacts:** `gateways/{name}/gatewayInformation.json`, with `apis.json` for gateway-API associations

---

### Version Set

A versioning strategy for APIs. Defines how API versions are differentiated — by URL path segment, query string parameter, or HTTP header.

- **Microsoft Docs:** [API versioning](https://learn.microsoft.com/en-us/azure/api-management/api-management-versions)
- **In artifacts:** `versionSets/{name}/versionSetInformation.json`

---

### Group

A developer group used for product access control. Built-in groups include Administrators, Developers, and Guests. Custom groups restrict which products specific developers can access.

- **Microsoft Docs:** [Groups](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-create-groups)
- **In artifacts:** `groups/{name}/groupInformation.json`

---

### Global Schema

A shared JSON or XML schema that can be referenced across multiple APIs for request/response validation.

- **Microsoft Docs:** [Schemas](https://learn.microsoft.com/en-us/azure/api-management/validate-content-policy)
- **In artifacts:** `schemas/{name}/schemaInformation.json`

---

### Workspace

An isolated environment within a single APIM instance. Workspaces allow separate teams to manage their own APIs, products, and policies independently.

- **Microsoft Docs:** [Workspaces](https://learn.microsoft.com/en-us/azure/api-management/workspaces-overview)
- **In artifacts:** Extracted when included in the `workspaceNames` [filter](../guides/filtering-resources.md)

---

## Related

- [Artifact Directory Format](artifact-format.md) — how these resources map to files
- [Filtering Resources](../guides/filtering-resources.md) — extract specific resource types
- [Configuration Reference](configuration.md) — all CLI flags and config options
- [Getting Started](../getting-started.md) — your first extract → publish cycle
