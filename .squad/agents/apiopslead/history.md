# ApiOpsLead — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0) — supreme governance document
- **User:** Elizabeth Maher
- **Stack:** TypeScript 6.x, Node.js 22 LTS, Commander, `@azure/identity`, Vitest, ESLint
- **Key constraint:** No `@azure/arm-apimanagement` SDK for resource payloads — raw REST only

**Foundation Established (2025-04-09 through 2026-04-09):** Project initialized with ESM, strict TypeScript, Vitest, ESLint. Commit message convention formalized (`Closes #N` for auto-close). All 14 foundational infrastructure components implemented and tested (467 integration tests passing). Full agent charter enhancement program completed (CodeReviewer + 7 others) with codebase-specific patterns and severity annotations.

**May 2026 Governance Phase:** CodeReviewer charter rewritten with 13 concrete review steps, 11 flagging categories, and 8 tech-specific subsections. All 7 remaining agent charters enhanced with codebase-aware patterns, key file paths, and team decisions. Documentation scope advisory completed (4 key decisions, 6-item priority ordering).

## Learnings

### 2026-05-14: APIM v1 → v2 SKU Migration Decision Finalized

**Outcome:** Joint research with ApimExpert concluded; migration architecture decision merged into `.squad/decisions.md`.

**Decision:** Phase 1 MVP uses existing `extract` + `publish` with migration guide (no new command). Phase 2 adds `apiops copy` if demand warrants.

**Evidence that existing architecture supports migration:**
- `ApimServiceContext` parameterization means source (v1) and target (v2) are just two different context instances
- All 34 resource types already supported
- No code refactoring needed for Phase 1
- Architecture validation: Design held up well to this migration scenario use case

**Coverage breakdown:**
- ✅ ~80–85% covered today (APIs, products, policies, backends, named values, workspaces)
- ⚠️ Gaps requiring Phase 2 work: subscription key preservation, self-hosted gateway validation, Service Fabric detection, gRPC detection, pre-flight v2 compatibility check
- ❌ Out of scope: VNet, DNS, identity/RBAC, TLS certs (Bicep/Terraform territory)

**Next steps:** Team governance review; if approved, write migration guide for `/docs/guides/sku-migration.md` and create override template examples.

**Key insight:** YAGNI + parameterization design = migration-ready without extra code. This validates the existing architecture's flexibility.

### 2026-06-02: APIM v1 → v2 SKU Migration Proposal

**What:** Wrote `specs/sku-upgrade.md` — a comprehensive proposal for enabling APIM v1-to-v2 SKU migration via apiops-cli. Requested by Peter Hauge.

**Decision:** Phase 1 MVP uses existing `extract` + `publish` commands with migration documentation — no new command needed. The `ApimServiceContext` is already parameterized, so source (v1) and target (v2) are just two different context instances. Phase 2 would add `apiops copy` for direct source→target streaming if demand warrants.

**Key findings:**
1. All 34 `ResourceType` enum values are supported for round-trip extract/publish — covers APIs, products, policies, backends, named values, gateways, workspaces, GraphQL resolvers, etc.
2. Subscription keys are the biggest gap — APIM management API does not expose key values on GET. Users must regenerate keys on v2.
3. Developer portal content, VNet/networking, managed identity, RBAC, DNS, and TLS certificates are all manual steps outside apiops-cli's scope.
4. `--overrides` is critical for migration — users need to adjust backend URLs, logger resource IDs, and Key Vault references for the v2 environment.
5. `--dry-run` provides pre-migration validation. An `apiops validate` command could enhance this in Phase 2.
6. Constitution §V (YAGNI) argues against a premature `apiops migrate` command that would overpromise on scope.

**Outputs:**
- `specs/sku-upgrade.md` — full 9-section proposal with architecture analysis, risk assessment, and phased implementation plan
- `.squad/decisions/inbox/apiopslead-sku-upgrade-proposal.md` — decision summary for team review

**Key insight:** The existing extract/publish architecture is already migration-ready by design. `ApimServiceContext` parameterization means no code changes are needed — just documentation and optionally richer pre-flight validation. The real migration pain is in the Azure infrastructure layer (networking, identity, DNS), not the APIM configuration layer that apiops-cli manages.

### 2026-06-02: APIM v1 → v2 SKU Migration Proposal

**What:** Wrote `specs/sku-upgrade.md` — a comprehensive proposal for enabling APIM v1-to-v2 SKU migration via apiops-cli. Requested by Peter Hauge.

**Decision:** Phase 1 MVP uses existing `extract` + `publish` commands with migration documentation — no new command needed. The `ApimServiceContext` is already parameterized, so source (v1) and target (v2) are just two different context instances. Phase 2 would add `apiops copy` for direct source→target streaming if demand warrants.

**Key findings:**
1. All 34 `ResourceType` enum values are supported for round-trip extract/publish — covers APIs, products, policies, backends, named values, gateways, workspaces, GraphQL resolvers, etc.
2. Subscription keys are the biggest gap — APIM management API does not expose key values on GET. Users must regenerate keys on v2.
3. Developer portal content, VNet/networking, managed identity, RBAC, DNS, and TLS certificates are all manual steps outside apiops-cli's scope.
4. `--overrides` is critical for migration — users need to adjust backend URLs, logger resource IDs, and Key Vault references for the v2 environment.
5. `--dry-run` provides pre-migration validation. An `apiops validate` command could enhance this in Phase 2.
6. Constitution §V (YAGNI) argues against a premature `apiops migrate` command that would overpromise on scope.

**Outputs:**
- `specs/sku-upgrade.md` — full 9-section proposal with architecture analysis, risk assessment, and phased implementation plan
- `.squad/decisions/inbox/apiopslead-sku-upgrade-proposal.md` — decision summary for team review

**Key insight:** The existing extract/publish architecture is already migration-ready by design. `ApimServiceContext` parameterization means no code changes are needed — just documentation and optionally richer pre-flight validation. The real migration pain is in the Azure infrastructure layer (networking, identity, DNS), not the APIM configuration layer that apiops-cli manages.
