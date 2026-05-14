# APIM v1 → v2 SKU Migration Proposal

**Author:** ApiOpsLead  
**Date:** 2026-06-02  
**Status:** Proposal (not yet a formal spec)  
**Requested by:** Peter Hauge

---

## 1. Problem Statement

Azure API Management v1 SKUs (Developer, Basic, Standard, Premium) have no in-place upgrade path to v2 SKUs (BasicV2, StandardV2). Microsoft's guidance is to create a new v2 instance and manually recreate the configuration. This is painful for customers with hundreds of APIs, products, policies, and named values.

**The gap:** Users need to stand up a new v2 APIM instance and faithfully migrate their entire APIM configuration from the old v1 instance. This is more than a simple extract→publish because:

1. **APIM configuration** (APIs, products, policies, etc.) is only part of the story — surrounding Azure infrastructure (networking, identity, DNS, certificates) must also be reconfigured and is outside APIM's control plane.
2. **Subscription keys** are secrets that cannot be extracted via the management API, so consumers holding v1 keys will need new keys or a key migration strategy.
3. **Data plane continuity** matters — there's a cutover window where traffic must shift from v1 to v2 with minimal disruption.

### Who benefits

- Enterprise customers running v1 Premium with 50-500+ APIs who need v2 features (e.g., workspace isolation, new networking options, cost optimization).
- Customers whose v1 SKUs are approaching end-of-support timelines.
- Any user already using apiops-cli for extract/publish who wants a guided migration path.

---

## 2. Proposed Approach

### Recommendation: Guided `extract` + `publish` with migration documentation

After analyzing the existing architecture, a **new dedicated command is not warranted at this stage**. Here's why:

| Option | Verdict | Rationale |
|--------|---------|-----------|
| `apiops migrate` command | ❌ Premature | Would imply the tool handles the full migration (networking, DNS, identity), but it can only handle APIM configuration. Overpromises. Violates Constitution §V (YAGNI). |
| `apiops copy` (direct source→target) | ⚠️ Future consideration | Technically feasible — read from source `IApimClient`, write to target `IApimClient` without intermediate files. But this bypasses the artifact store, loses auditability, and can't leverage git-based review. Worth revisiting in Phase 2. |
| Documentation + existing commands | ✅ Recommended MVP | `extract` from v1, `publish` to v2 already works. What's missing is a migration guide, pre-flight validation enhancements, and optional override templates for v2-specific adjustments. |

### MVP: Migration guide + pre-flight enhancements

The recommended approach for Phase 1:

```
# Step 1: Extract from v1 instance
apiops extract \
  --resource-group rg-old \
  --service-name apim-v1 \
  --output ./migration-artifacts

# Step 2: Review and adjust artifacts
# (apply overrides for v2-specific changes like backend URLs, named values)

# Step 3: Dry-run publish to v2 instance
apiops publish \
  --resource-group rg-new \
  --service-name apim-v2 \
  --source ./migration-artifacts \
  --overrides ./overrides.v2.yaml \
  --dry-run

# Step 4: Publish to v2 instance
apiops publish \
  --resource-group rg-new \
  --service-name apim-v2 \
  --source ./migration-artifacts \
  --overrides ./overrides.v2.yaml
```

### Future Phase 2: `apiops copy` command

If demand warrants it, a direct copy command would look like:

```
apiops copy \
  --source-resource-group rg-old \
  --source-service-name apim-v1 \
  --target-resource-group rg-new \
  --target-service-name apim-v2 \
  --dry-run \
  --overrides ./overrides.v2.yaml
```

This would internally instantiate two `IApimClient` instances (source + target) and stream resources directly. The `IApimClient` interface already supports this — `listResources`/`getResource` on source, `putResource` on target — but we'd need to handle dependency ordering without the artifact store's `listResources` scan.

---

## 3. What apiops-cli Can Migrate Automatically

Based on the current `IApimClient` interface and resource type coverage (34 `ResourceType` enum values):

### ✅ Fully supported via existing extract→publish

| Category | Resource Types | Notes |
|----------|---------------|-------|
| APIs | `Api`, `ApiPolicy`, `ApiOperation`, `ApiOperationPolicy`, `ApiTag`, `ApiDiagnostic`, `ApiSchema`, `ApiRelease`, `ApiTagDescription`, `ApiWiki`, `McpServer` | Full round-trip including revisions, specs (OpenAPI/GraphQL/WSDL/WADL) |
| Products | `Product`, `ProductPolicy`, `ProductApi`, `ProductGroup`, `ProductTag`, `ProductWiki` | Including API associations and group bindings |
| Policies | `ServicePolicy`, `PolicyFragment`, `PolicyRestriction` | Global, API-level, operation-level, product-level |
| Infrastructure | `Backend`, `NamedValue`, `Logger`, `Diagnostic` | Backend URLs, named values (with secret placeholders), loggers |
| Organization | `Tag`, `Group`, `Gateway`, `GatewayApi`, `VersionSet`, `Subscription`, `GlobalSchema`, `Documentation` | Tags, groups, gateways with API associations |
| GraphQL | `GraphQLResolver`, `GraphQLResolverPolicy` | Both synthetic and pass-through GraphQL APIs |
| Workspaces | Workspace-scoped variants of above | Via `workspace-extractor.ts` |

### ⚠️ Requires new capability or manual intervention

| Resource | Gap | Effort |
|----------|-----|--------|
| **Subscription keys** | APIM management API does not expose subscription key values on GET. Keys are write-only secrets. | Cannot automate — users must regenerate or use APIM's key export feature (if available in v2). |
| **Developer portal content** | Not an ARM resource — stored separately, managed via Developer Portal API. | Out of scope for apiops-cli. Microsoft provides a separate migration script. |
| **API revisions (non-current)** | `listApiRevisions` extracts metadata, but publishing non-current revisions requires careful ordering. | Partially supported — current revision publishes cleanly; historical revisions need validation. |
| **Certificates** | Client certificates, CA certificates bound to APIM. | Could be added to `ResourceType` enum if needed. Currently not extracted. |
| **Custom hostnames** | Bound at the APIM service level, not individual resources. | ARM-level configuration, not part of per-resource extract/publish. |
| **Cache (external)** | External Redis cache connections. | Could be added as a resource type. |

### Architecture reuse assessment

The existing architecture maps cleanly to the migration use case:

- **`IApimClient`** — Already parameterized by `ApimServiceContext` (subscriptionId, resourceGroup, serviceName). Source and target are just two different contexts. No code changes needed.
- **`IArtifactStore`** — The intermediate artifact directory serves as the migration staging area. Users can review, modify, and version-control artifacts before publishing to v2.
- **`ExtractConfig` / `PublishConfig`** — Already accept different service contexts. No config model changes needed.
- **`OverrideConfig`** — Critical for migration. Users will need to override backend URLs, named value references, and logger resource IDs that differ between v1 and v2 environments.
- **Dependency graph** — Tier-based ordering (extract tiers 1→4, publish tiers 1→4, delete tiers 4→1) ensures resources are created in the right order on the target.
- **`--dry-run`** — Essential for migration validation. Users can preview exactly what would be created on v2 before committing.
- **`--delete-unmatched`** — Should NOT be used during migration (target is empty). Default safe behavior per Constitution §IV.

---

## 4. What Must Be Done Manually

These items are outside APIM's management plane and cannot be handled by apiops-cli:

### Azure Infrastructure (must be configured before migration)

| Item | Why it's manual | When |
|------|----------------|------|
| **v2 APIM instance creation** | ARM/Bicep/Terraform deployment. SKU selection, region, capacity. | Before migration |
| **VNet integration** | v2 uses VNet injection differently than v1. Network topology must be redesigned. | Before migration |
| **Private endpoints** | v2 supports private endpoints natively (v1 Premium only via VNet). | Before migration |
| **NSG rules** | Security rules differ between v1 and v2 networking models. | Before migration |
| **Public IP configuration** | v2 may require different public IP setup. | Before migration |

### Identity & Access (must be configured before or after migration)

| Item | Why it's manual | When |
|------|----------------|------|
| **Managed identity** | System-assigned identity is instance-specific. User-assigned identity must be reassigned. | Before migration |
| **RBAC role assignments** | Permissions are scoped to the specific APIM resource ID which changes. | After migration |
| **Key Vault access policies** | If v1 named values reference Key Vault, the v2 managed identity needs Key Vault access. | Before migration |
| **AAD/Entra ID app registrations** | OAuth 2.0 server configurations may reference specific redirect URIs or app registrations. | After migration |

### DNS & Traffic (cutover window)

| Item | Why it's manual | When |
|------|----------------|------|
| **Custom domain DNS records** | CNAME/A records must point to v2's IP/hostname. | During cutover |
| **TLS/SSL certificates** | Must be uploaded to v2 instance or referenced via Key Vault. | Before cutover |
| **Traffic Manager / Front Door** | If using traffic management, update backend pools to point to v2. | During cutover |
| **API consumer notification** | If subscription keys change, consumers need new keys. | During cutover |

### Other

| Item | Why it's manual | When |
|------|----------------|------|
| **Developer portal** | Content is managed separately. Microsoft provides a migration script. | After configuration migration |
| **Self-hosted gateways** | Must be redeployed with new v2 configuration endpoint. | After migration |
| **Application Insights / monitoring** | Logger resources reference specific App Insights instances by resource ID. Use `--overrides` to update if the resource ID changes. | During migration (partially automatable via overrides) |
| **CI/CD pipeline updates** | Pipelines referencing the old instance name/RG must be updated. `apiops init` can regenerate. | After migration |

---

## 5. Pre-flight Validation

The tool should validate conditions before attempting migration. Some of these already exist (`validatePreFlight` in `IApimClient`); others would be new.

### Existing (already implemented)

- ✅ **Target service exists** — `validatePreFlight()` confirms resource group and APIM instance are reachable.
- ✅ **Authentication** — `@azure/identity` credential chain validates before any API calls.

### New checks for migration scenarios

| Check | Priority | Description |
|-------|----------|-------------|
| **Source service reachable** | P0 | Verify the source v1 instance exists and is accessible (for `extract`). |
| **Target is empty or compatible** | P1 | Warn if target already has resources that might conflict. List conflicts in `--dry-run` output. |
| **SKU feature parity** | P1 | Warn if source uses features not available in target SKU (e.g., v1 Premium multi-region → BasicV2 doesn't support multi-region). |
| **API version compatibility** | P2 | Verify target supports the REST API version used for extract. v2 SKUs may require newer API versions. |
| **Workspace support** | P2 | If source has workspaces (Premium only), verify target SKU supports workspaces. |
| **Gateway count limits** | P2 | v2 SKUs may have different self-hosted gateway limits. |
| **Resource count limits** | P3 | Some v2 SKUs have lower resource limits than v1 Premium. |

### Implementation approach

Pre-flight checks could be a standalone subcommand or integrated into `publish`:

```
# Option A: Standalone (recommended for migration workflows)
apiops validate \
  --resource-group rg-new \
  --service-name apim-v2 \
  --source ./migration-artifacts

# Option B: Enhanced dry-run (works today, just needs richer output)
apiops publish \
  --resource-group rg-new \
  --service-name apim-v2 \
  --source ./migration-artifacts \
  --dry-run
```

---

## 6. Risks and Limitations

### Subscription key preservation

**Risk: HIGH.** Subscription keys cannot be extracted from the APIM management API. Consumers using v1 subscription keys will need new keys from the v2 instance.

**Mitigations:**
- Document the key migration strategy clearly.
- Suggest a dual-running period where both v1 and v2 are active, allowing consumers to transition.
- If APIM ever exposes a key import/export API, we can add support.

### Data plane downtime during cutover

**Risk: MEDIUM.** There will be a window during DNS cutover where some requests hit v1 and others hit v2.

**Mitigations:**
- Recommend blue-green deployment pattern: run v2 in parallel, validate, then cut DNS.
- Document the recommended cutover sequence.
- `--dry-run` allows validation before committing.

### Policy compatibility between SKU versions

**Risk: LOW-MEDIUM.** Some policy expressions or features may behave differently on v2 runtime.

**Mitigations:**
- Document known policy compatibility differences.
- Recommend testing with a subset of APIs before full migration.
- Policies are extracted/published as opaque XML (Constitution §VII), so they'll round-trip faithfully — any incompatibility surfaces at runtime, not during publish.

### Idempotency (Constitution §IV)

**Risk: LOW.** The publish command is already idempotent by design — PUT operations create-or-update. Re-running migration is safe.

**Considerations:**
- If migration is interrupted partway, re-running `publish` will complete the remaining resources.
- `--delete-unmatched` should NOT be used during initial migration (target may have system-generated resources that shouldn't be deleted).
- Partial failure handling already exists via `EXIT_PARTIAL` (exit code 1).

### Secret safety (Constitution §VIII)

**Risk: LOW.** Named values marked as secrets are already extracted as placeholders (Key Vault references or empty markers). During migration, users must provide secret values via `--overrides` or configure Key Vault access for the v2 managed identity.

### Resource naming conflicts

**Risk: LOW.** If the target v2 instance is fresh, there are no conflicts. If the target has existing resources (e.g., from a prior partial migration), PUT semantics will overwrite, which is the desired behavior for idempotent migration.

---

## 7. Recommended Phasing

### Phase 1: Documentation + Validation (MVP) — Low effort, high value

**Deliverables:**
1. **Migration guide** in `/docs/guides/sku-migration.md` — step-by-step walkthrough using existing `extract` + `publish` commands, with checklist for manual items.
2. **Override template** — example `overrides.migration.yaml` showing common migration adjustments (backend URLs, logger resource IDs, named value Key Vault references).
3. **Enhanced `--dry-run` output** — if not already detailed enough, improve the dry-run report to show resource counts and potential conflicts for migration validation.

**Effort:** 1-2 days documentation, minimal code changes.  
**Value:** Unblocks users immediately with existing tooling.

### Phase 2: Pre-flight validation command — Medium effort

**Deliverables:**
1. **`apiops validate` command** — standalone pre-flight check that verifies source/target connectivity, checks for conflicts, and reports SKU compatibility warnings.
2. **Target emptiness check** — warn if target has existing resources.
3. **Resource count summary** — show what will be migrated (X APIs, Y products, Z policies).

**Effort:** 3-5 days.  
**Value:** Reduces migration failures by catching issues before they happen.

### Phase 3: Direct copy command — Higher effort, future

**Deliverables:**
1. **`apiops copy` command** — reads from source APIM, writes to target APIM without intermediate artifact files.
2. **Two-context `IApimClient` orchestration** — instantiate source client (read-only) and target client (read-write), stream resources in dependency order.
3. **Progress reporting** — real-time progress since no intermediate files to count.

**Effort:** 5-10 days.  
**Value:** Streamlines migration for users who don't need artifact review. Useful for automated migration pipelines.

### Phase 4: Subscription key migration — Contingent on Azure API support

**Deliverables:**
1. **Key export/import** — if Azure adds management API support for subscription key export.
2. **Key mapping report** — generate a mapping of old keys → new keys for consumer notification.

**Effort:** Unknown (depends on Azure API availability).  
**Value:** Eliminates the biggest pain point in migration.

---

## 8. Open Questions

1. **Do v2 SKUs support all 34 resource types in our `ResourceType` enum?** Need to verify that v2's management API surface is a superset of v1's. If any resource types are deprecated or renamed in v2, the publish step would fail.

2. **Should we support cross-subscription migration?** The current `ApimServiceContext` already has a `subscriptionId` field, so source and target can be in different subscriptions. But identity/credential implications differ.

3. **Should `apiops copy` bypass the artifact store entirely, or write artifacts as a side effect for audit purposes?** Writing artifacts during copy provides an audit trail but adds I/O overhead.

4. **Is there demand for selective migration?** e.g., "migrate only these 10 APIs and their dependencies." The existing `--filter` flag on `extract` already supports this, which is another argument for the extract+publish approach.

5. **What is Microsoft's timeline for v1 SKU deprecation?** This affects urgency.

---

## 9. Appendix: Architecture Compatibility Matrix

```
                    IApimClient                IArtifactStore
                   ┌──────────┐              ┌──────────────┐
  v1 APIM ───────►│ source   │──extract──►  │  artifacts/  │
  (extract)       │ context  │              │  (on disk)   │
                   └──────────┘              └──────┬───────┘
                                                    │
                                              review/modify
                                              apply overrides
                                                    │
                   ┌──────────┐              ┌──────┴───────┐
  v2 APIM ◄───────│ target   │◄──publish──  │  artifacts/  │
  (publish)       │ context  │              │  (on disk)   │
                   └──────────┘              └──────────────┘

Key insight: ApimServiceContext is already parameterized.
Source and target are just two different context instances.
No architectural changes needed for extract→publish migration.
```
