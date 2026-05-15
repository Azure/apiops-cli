# APIM v1 → v2 SKU Migration Proposal

**Author:** ApiOpsLead  
**Date:** 2026-06-02  
**Status:** Proposal  
**Requested by:** Peter Hauge

---

## 1. Problem Statement

Azure API Management v1 SKUs (Developer, Basic, Standard, Premium) have no in-place upgrade path to v2 SKUs (BasicV2, StandardV2). Microsoft's guidance is to create a new v2 instance and manually recreate the configuration. This is painful for customers with hundreds of APIs, products, policies, and named values.

**The gap:** Users need to stand up a new v2 APIM instance and faithfully migrate their entire APIM configuration from the old v1 instance. This is more than a simple extract→publish because:

1. **APIM configuration** (APIs, products, policies, etc.) is only part of the story — surrounding Azure infrastructure (networking, identity, DNS, certificates) must also be reconfigured and is outside APIM's control plane.
2. **Subscription keys** are secrets that require a dedicated `listSecrets` + `PUT` flow to preserve, and cannot be extracted via standard GET.
3. **Data plane continuity** matters — there's a cutover window where traffic must shift from v1 to v2 with minimal disruption.
4. **v2 feature gaps** — certain v1 capabilities (self-hosted gateways, gRPC, Service Fabric backends, static IPs) are not available on v2 SKUs.

### Who benefits

- Enterprise customers running v1 Premium with 50-500+ APIs who need v2 features (e.g., workspace isolation, new networking options, cost optimization).
- Customers whose v1 SKUs are approaching end-of-support timelines.
- Any user already using apiops-cli for extract/publish who wants a guided migration path.

---

## 2. Proposed Approach: `apiops copy`

We propose a dedicated `apiops copy` command that reads configuration directly from a source APIM instance and writes it to a target APIM instance — no intermediate artifact files required.

```
apiops copy \
  --source-resource-group rg-old \
  --source-service-name apim-v1 \
  --target-resource-group rg-new \
  --target-service-name apim-v2 \
  --dry-run \
  --overrides ./overrides.v2.yaml
```

This internally instantiates two `IApimClient` instances (source + target) and streams resources directly in dependency order. The existing `IApimClient` interface already supports this — `listResources`/`getResource` on source, `putResource` on target.

Key behaviors:

- **`--dry-run`** — Preview exactly what would be created on v2 before committing. Essential for migration validation.
- **`--overrides`** — Apply v2-specific adjustments (backend URLs, named value references, logger resource IDs) during copy.
- **Idempotent** — PUT semantics mean the command can be safely re-run if interrupted.

---

## 3. User Experience on Migration

The table below summarizes every migration concern in one view. Scan it to assess how much of the migration `apiops copy` handles versus what requires new tooling or manual work.

| Item | ✅ Already Supported | 🔨 New Feature Required | 👤 Must Be Done Manually |
|------|---------------------|------------------------|--------------------------|
| **APIs** (OpenAPI, GraphQL, SOAP, WebSocket) | ✅ Full round-trip via existing resource types | | |
| **API operations & operation policies** | ✅ `ApiOperation`, `ApiOperationPolicy` | | |
| **API schemas & specs** | ✅ `ApiSchema` (OpenAPI/GraphQL/WSDL/WADL) | | |
| **API releases & revisions (current)** | ✅ Current revision publishes cleanly | | |
| **API revisions (non-current)** | | 🔨 Historical revisions need ordering logic | |
| **API tags & tag descriptions** | ✅ `ApiTag`, `ApiTagDescription` | | |
| **API diagnostics** | ✅ `ApiDiagnostic` | | |
| **API wikis** | ✅ `ApiWiki` | | |
| **MCP Servers** | ✅ `McpServer` | | |
| **Products** (policies, API links, groups, tags, wikis) | ✅ Full `Product*` resource types | | |
| **Global / service-level policies** | ✅ `ServicePolicy` | | |
| **Policy fragments & restrictions** | ✅ `PolicyFragment`, `PolicyRestriction` | | |
| **Backends** | ✅ `Backend` — URLs migrated; use `--overrides` if URLs change | | |
| **Named values** (non-secret) | ✅ Plain-text named values round-trip | | |
| **Named values** (secrets / Key Vault refs) | ✅ Placeholders extracted | | 👤 Provide secret values via `--overrides` or configure Key Vault access for v2 managed identity |
| **Loggers & diagnostics** | ✅ `Logger`, `Diagnostic` — use `--overrides` if resource IDs change | | |
| **Tags & groups** | ✅ `Tag`, `Group` | | |
| **Version sets** | ✅ `VersionSet` | | |
| **Subscriptions** (metadata) | ✅ `Subscription` resource round-trips | | |
| **Subscription keys** (secrets) | | 🔨 Preservable via `PUT /subscriptions/{sid}` with `primaryKey`/`secondaryKey`, but requires new `listSecrets` flow | |
| **Global schemas** | ✅ `GlobalSchema` | | |
| **Documentation** | ✅ `Documentation` | | |
| **GraphQL resolvers & policies** | ✅ `GraphQLResolver`, `GraphQLResolverPolicy` | | |
| **Gateways & gateway-API associations** | ✅ `Gateway`, `GatewayApi` | | |
| **Workspace-scoped resources** | ✅ Workspace variants of all above | | |
| **OAuth / OIDC provider configs** | | 🔨 Currently excluded from extract; could be added for migration | |
| **Certificates** (client/CA certs) | | 🔨 Private key material not extractable via GET; needs import flow | |
| **External cache** (Redis connections) | | 🔨 Could be added as a resource type | |
| **Custom hostnames** | | | 👤 ARM-level config; bind on v2 instance directly |
| **Self-hosted gateways** | | | 👤 **Not supported on v2** — architecture change required |
| **Service Fabric backends** | | | 👤 **Not supported on v2** |
| **gRPC backends** | | | 👤 **Not supported on v2** |
| **v2 APIM instance creation** | | | 👤 ARM/Bicep/Terraform deployment; SKU selection, region, capacity |
| **VNet integration** | | | 👤 v2 uses VNet injection differently; network topology must be redesigned |
| **Private endpoints** | | | 👤 v2 supports private endpoints natively (v1 Premium only via VNet) |
| **NSG rules** | | | 👤 Security rules differ between v1 and v2 networking models |
| **Static IP configuration** | | | 👤 **v2 does not have static IPs** — update any IP-allowlisted consumers |
| **Managed identity** | | | 👤 System-assigned identity is instance-specific; user-assigned must be reassigned |
| **RBAC role assignments** | | | 👤 Permissions scoped to APIM resource ID which changes |
| **Key Vault access policies** | | | 👤 v2 managed identity needs Key Vault access if named values reference KV |
| **Entra ID / OAuth app registrations** | | | 👤 Redirect URIs or app registrations may reference old instance |
| **Custom domain DNS records** | | | 👤 CNAME/A records must point to v2's IP/hostname |
| **Multiple custom domains** | | | 👤 **Not supported on v2** — consolidate to single custom domain |
| **TLS/SSL certificates** | | | 👤 Upload to v2 or reference via Key Vault |
| **Traffic Manager / Front Door** | | | 👤 Update backend pools to point to v2 |
| **API consumer notification** | | | 👤 If subscription keys change, consumers need new keys |
| **Developer portal content** | | | 👤 Not an ARM resource; Microsoft provides a separate migration script |
| **Application Insights / monitoring** | | | 👤 Logger resource IDs may change; partially automatable via `--overrides` |
| **Event Grid events** | | | 👤 **Not supported on v2** |
| **Analytics / usage data** | | | 👤 Not transferable — historical metrics stay with v1 instance |
| **Quota / rate-limit counters** | | | 👤 Not transferable — counters reset on v2 |
| **Payload size (>2 MiB)** | | | 👤 v2 has 2 MiB payload buffer limit (vs 500 MiB on classic) — APIs with large payloads may break |
| **CI/CD pipeline updates** | | | 👤 Pipelines referencing old instance name/RG must be updated; `apiops init` can regenerate |
