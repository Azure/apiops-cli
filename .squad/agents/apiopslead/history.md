# ApiOpsLead — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0) — supreme governance document
- **User:** Elizabeth Maher
- **Stack:** TypeScript 6.x, Node.js 22 LTS, Commander, `@azure/identity`, Vitest, ESLint
- **Key constraint:** No `@azure/arm-apimanagement` SDK for resource payloads — raw REST only

**Foundation Established (2025-04-09 through 2026-04-09):** Project initialized with ESM, strict TypeScript, Vitest, ESLint. Commit message convention formalized (`Closes #N` for auto-close). All 14 foundational infrastructure components implemented and tested (467 integration tests passing). Full agent charter enhancement program completed (CodeReviewer + 7 others) with codebase-specific patterns and severity annotations.

**Team Governance & Documentation Planning (2026-05-01 through 2026-05-13):**
- Rewrote CodeReviewer charter with 13 concrete steps, 11 flag categories, 8 tech-specific subsections, severity levels with examples, boundaries, collaboration protocol.
- Enhanced 7 remaining agent charters with codebase-specific patterns, file paths, and decisions.
- Provided comprehensive documentation scope guidance to DocWriter: D1 (user-facing only), D2 (both platforms), D3 (artifact flexibility), D4 (multiple auth methods).
- Scope decisions merged into decisions.md; feature readiness assessment identified Phase 3 (Extract) completion and Phase 8 feature deferrals.

**Architectural Decision Making (2026-05-14 through 2026-06-02):**
- **APIM v1 → v2 SKU Migration:** Validated that existing extract/publish architecture is migration-ready (parameterized ApimServiceContext, all 34 resource types supported). Phase 1: documentation + migration guide. Phase 2: optional `apiops copy` command.
- **Multi-Environment Architecture:** Recommended default is single artifact + trunk-based branching + override files + multi-stage pipeline. Fully supported via `--overrides` and `apiops init --environments`. Deliverable: documentation (`/docs/guides/multi-environment.md`).
- **Workspace Interaction Model:** Environments stay in override files/pipeline stages, NOT artifact paths. Workspaces = structural scoping (teams/products), not deployment lifecycle. No path rewriting (§VII passthrough).

## Learnings

<!-- Append new learnings below this line -->

### 2026-06-02: Multi-Environment Architecture Plan & Workspace Interaction Finalized

**What:** Collaborated with ApimExpert on multi-environment deployment decision. Produced architecture planning memo at `specs/multi-environment-plan.md` evaluating dev/qa/prod environment patterns with APIM.

**Decision Axes Evaluated:**
1. **Artifact Naming:** Single directory (recommended) vs. per-env directories (anti-pattern — causes drift)
2. **Branch Strategy:** Trunk-based + pipeline stages (recommended) vs. environment branches (escape hatch only)
3. **Workspace Usage:** Separate instances per env (recommended) vs. single instance + workspaces (future, needs `--workspace` flag)

**Recommendation:** Single artifact directory + trunk-based branching + override files per environment + multi-stage pipeline with approval gates.

**Anti-Patterns Explicitly Rejected:**
- Per-environment artifact directories with trunk-based branching
- Environment branches with single APIM instance without workspaces
- Committing secrets to override files (violates §VIII)
- Extracting from prod and publishing to dev (reverse flow)

**Minimum Increments:**
- Increment 0: Documentation only (can ship now — no code changes)
- Increment 1: Override validation warnings during `--dry-run`
- Increment 2: `--workspace` flag on publish (medium effort)
- Increment 3: Layered overrides (multiple `--overrides` files)

**Key Insight:** Existing architecture already supports multi-environment workflows via `--overrides` and `apiops init --environments`. Primary deliverable is documentation, not new features. Users need workflow guidance and topology examples.

### 2026-05-14: APIM v1 → v2 SKU Migration Decision Finalized with ApimExpert

**Outcome:** Joint research concluded; migration architecture decision merged into `.squad/decisions.md`.

**Decision:** Phase 1 MVP uses existing `extract` + `publish` with migration guide (no new command). Phase 2 adds `apiops copy` if demand warrants.

**Architecture Validation:**
- `ApimServiceContext` parameterization means source (v1) and target (v2) are just two different context instances
- All 34 resource types already supported for round-trip
- No code refactoring needed for Phase 1
- YAGNI principle: don't add `apiops copy` until demand warrants

**Key Insight:** Existing extract/publish architecture is migration-ready by design. The real migration pain is in Azure infrastructure layer (networking, identity, DNS), not APIM configuration layer that apiops-cli manages.

### 2026-05-18: Multi-Environment Spec Planning Orchestration Complete

**What:** Collaborated with ApimExpert and DocWriter on structured multi-environment decision process. Scribe orchestrated team outputs into unified project record with orchestration logs, session log, decision merge, and cross-agent history updates.

**Decisions Formalized:**
1. **Architecture Recommendation (Primary):** Single artifact directory + trunk-based branching + override files per environment + multi-stage pipeline with approval gates. Fully supported today via `--overrides` and `apiops init --environments`. Deliverable: documentation, not code.

2. **Workspace Interaction (Supporting):** Environment identity in override file names/pipeline stages, NOT artifact paths. Workspaces = structural scoping, not environments. No workspace name remapping (violates §VII passthrough). Future enhancements: workspace-scoped overrides, auto-discovery.

**Anti-Patterns Explicitly Documented:**
- Per-environment artifact directories
- Environment branches with single APIM instance
- Committing secrets to override files
- Extracting from prod, publishing to dev

**Team Artifacts Created:**
- Orchestration logs: DocWriter, ApiOpsLead, ApimExpert (ISO 8601 UTC)
- Session log: `.squad/log/2026-05-18T19-50-07Z-multi-environment-plan.md`
- Merged decisions into `.squad/decisions/decisions.md`
- Cross-agent history updates

**Integration Points for DocWriter:**
- New guide topic `/docs/guides/multi-environment.md` — explain recommended topology
- Override directory structure with per-env examples
- Comparison table: single vs. per-env artifacts
- Workspace isolation patterns for multi-team scenarios

**Key Validation:** Architecture review confirms YAGNI principle — existing tool capabilities already support multi-environment workflows. No new features needed for Phase 1. Documentation and examples provide maximum user value.
