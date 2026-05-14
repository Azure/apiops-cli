# ApiOpsLead — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0) — supreme governance document
- **User:** Elizabeth Maher
- **Stack:** TypeScript 6.x, Node.js 22 LTS, Commander, `@azure/identity`, Vitest, ESLint
- **Key constraint:** No `@azure/arm-apimanagement` SDK for resource payloads — raw REST only

### Foundational Work Completed (2025-2026-04)

**Phase 1 Setup (2025-04-09, Issues #7, #8):**
- Initialized Node.js ESM project with TypeScript 5.x strict mode, Vitest, ESLint configuration
- Package.json configured with `type: "module"`, `engines.node: ">=22.0.0"`, bin entry for CLI
- Full directory structure created (src/, tests/ hierarchy with 8 .gitkeep files)
- Key decisions: Package name `apiops` (simpler invocation), ESM for modern Node.js alignment, strict TypeScript for early error detection

**Commit Message Convention (2025-04-09):**
- Formalized convention in CONTRIBUTING.md, PR template, and copilot-instructions.md
- Requirement: `Closes #N` or `Fixes #N` in commits to auto-close issues
- Multi-line commits use `git commit -F <tmpfile>` not `-m` flag (literal \n breaks auto-close)

**Phase 2 Verification (2026-04-09, Issues #12-#25, T006-T019):**
- Verified all 14 foundational infrastructure components fully implemented and tested
- Components: ResourceType enum, core interfaces, config structures, APIM client, artifact store, dependency graph, logging, Azure REST client, filesystem store, parallel runner, CLI entry point
- All 467 integration tests passing; build and lint clean
- Tagged with `Closes` for milestone auto-closure

**Charter Enhancement (2026-05-01):**
- Enhanced CodeReviewer charter with 13 concrete ordered steps, 11+ flag categories, 8 tech-specific check subsections, severity annotations
- Applied enhancement pattern to 7 remaining charters (TypeScriptDev, TestEngineer, NodeJsDev, ApimExpert, AzdoExpert, GitHubExpert, ApiOpsLead)
- Corrected inaccuracies (e.g., TypeScriptDev tsconfig claims) and encoded codebase-specific patterns
- Key insight: Project-specific checklists with severity annotations transform reviews from "looks fine" to systematic quality gates

## Learnings

### 2026-05-01: CodeReviewer Charter Enhancement

**What:** Rewrote the CodeReviewer charter (`.squad/agents/codereviewer/charter.md`) sections 3-8 to make reviews significantly more thorough and project-specific.

**Changes made:**
1. **How I Work** — Expanded from 7 generic steps to 13 concrete, ordered steps. Added holistic diff reading, team decisions check, TypeScript strictness verification, error handling review, missing test detection, and naming consistency checks.
2. **What I Flag** — Expanded from 6 categories to 11, adding: secret/credential leak specifics, TypeScript strictness, error handling, immutability violations, architecture patterns, naming/style.
3. **Tech-Specific Checks** — NEW section with 8 subsections: TypeScript & ESM, Singleton + Export Pattern, Error Handling, Secret Safety, APIM Client Patterns, Immutability, Test Patterns, Workspace Scoping. Each item has severity level annotations.
4. **Severity Levels** — Added concrete examples to each level, added escalation rule (3+ blockers → architectural discussion).
5. **Boundaries** — Added "What I never wave through" clause, strengthened rejection output requirements, added "uncertainty is not an excuse to skip" principle.
6. **Collaboration** — Added post-review protocol: severity-ordered findings, file/line references, concrete fix suggestions, assessment summary.
7. **Voice** — Added three paragraphs reinforcing thoroughness over brevity, guilty-until-proven-correct mindset, and checking for what's *missing* not just what's *wrong*.
8. **Constitution path** — Fixed all references from `.specify/memory/constitution.md` to `.squad/identity/constitution.md`.

**Why:** CodeReviewer was missing codebase-specific checks that external reviewers (Copilot) were catching. The charter now encodes this project's actual patterns (ESM `.js` extensions, `Record<string, unknown>` payloads, `HttpError` status branching, `SENSITIVE_KEY_PATTERNS`, singleton+class export, etc.) so the reviewer can't miss them.

**Key insight:** A generic "enforce TypeScript strict mode" instruction is useless if the reviewer doesn't know the specific patterns to look for. Project-specific checklists with severity annotations turn a reviewer from "looks fine to me" into a systematic quality gate.

### 2026-05-01: Documentation Scope Advisory for DocWriter

**What:** Provided scope guidance to DocWriter for planning user-facing documentation in `/docs`. Analyzed current project state from `specs/spec.md` and `specs/tasks.md`, assessed feature completion status, and wrote advisory to `.squad/decisions/inbox/apiopslead-docs-scope.md`.

**Key findings:**
1. **Ready to document NOW:** `apiops extract` (code exists), `apiops publish` (tasks complete), `apiops init` (tasks complete), CI/CD integration (both GitHub Actions and Azure DevOps).
2. **Defer to later:** `--otel` flag (Phase 8, not implemented), `--spec-format` option (Phase 8, not implemented), internal architecture (not user-facing).
3. **Tasks.md inconsistency:** Phase 3 (Extract) tasks unchecked in tasks.md, but source files exist. Extraction likely complete but tasks.md is stale.

**Decisions made:**
- **D1:** User-facing only — no internal architecture in `/docs`
- **D2:** Document BOTH GitHub Actions AND Azure DevOps pipelines with equal weight
- **D3:** Emphasize artifact directory flexibility — users choose the path, not a hardcoded default
- **D4:** Document all authentication methods (Azure CLI, federated credentials, service principal, managed identity) with context-specific guidance

**Priority ordering:**
1. Getting Started Guide (init → extract → publish → CI/CD) — highest user value
2. Extract reference
3. Publish reference
4. CI/CD guide
5. Configuration reference
6. Troubleshooting

**Key paths referenced:**
- `specs/spec.md` — Feature specification with user stories and functional requirements
- `specs/tasks.md` — Task breakdown with completion status
- `src/cli/extract-command.ts`, `publish-command.ts`, `init-command.ts` — Verified implementation files
- `src/services/extract-service.ts`, `publish-service.ts`, `init-service.ts` — Core service implementations
- `.squad/decisions/inbox/apiopslead-docs-scope.md` — Output advisory for DocWriter

**Key insight:** Documentation scope must be tightly coupled to implementation status. Document what's complete and stable, defer what's planned but not implemented. Phase 8 (Polish) features like `--otel` and `--spec-format` are spec'd but not coded — documenting them now would be inaccurate and create user confusion.

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

<!-- Append new learnings here after each session -->### 2026-05-13: Documentation Scope Advisory and Decision Merge

**What:** Provided scope guidance to DocWriter for planning user-facing documentation. Analyzed feature completion status, documented scope decisions, and merged both ApiOpsLead and DocWriter outputs into unified decisions.md entry.

**Feature Readiness Assessment:**

**GREEN LIGHT (ready to document now):**
- `apiops extract` — Code exists, core feature, extraction is entry point for all workflows
- `apiops publish` — All tasks marked complete, completes extract-publish round-trip
- `apiops init` — All tasks marked complete, high adoption value for onboarding
- CI/CD integration — Both GitHub Actions and Azure DevOps tasks complete

**RED LIGHT (defer to later documentation):**
- `--otel` OpenTelemetry flag — Phase 8, not implemented, spec defines but no code exists
- `--spec-format` option — Phase 8, not implemented, spec defines but no code exists
- Internal architecture — Not user-facing, belong in /specs and code comments not /docs

**Stale Data Identified:**
- Phase 3 (Extract) tasks unchecked in tasks.md, but source files exist (`extract-service.ts`, `resource-extractor.ts`, `api-extractor.ts`, `product-extractor.ts`, `extract-command.ts`, etc.)
- Likely extraction is complete but tasks.md tracking is stale
- Need verification before closing Phase 3 tasks

**Documentation Scope Decisions:**
- **D1: User-Facing Only** — `/docs` is for users, not internal architecture. Users need "how do I extract" not "how the dependency graph works".
- **D2: Both Platform Pipelines** — Document GitHub Actions and Azure DevOps equally. Spec targets both; apiops init generates both templates; Azure customer base uses both.
- **D3: Artifact Path Flexibility** — Emphasize users choose path via --output/--source. Do NOT promote `./apim-artifacts` as "the" directory. Spec FR-019 says path is user-specified.
- **D4: Multiple Auth Methods** — Document Azure CLI (local dev), federated credentials/OIDC (GitHub CI/CD), service principal (generic), managed identity (Azure-hosted). Context-specific guidance critical.

**Priority Ordering for Maximum User Value:**
1. Getting Started (init → extract → publish → CI/CD) — Removes adoption barrier, addresses SC-009
2. Extract reference — Core feature, users extract before anything else
3. Publish reference — Completes round-trip workflow
4. CI/CD guide — Critical for production adoption
5. Configuration reference — Required for advanced users
6. Troubleshooting — Reduces support burden

**Key Insight:** Documentation scope must be tightly coupled to implementation status. Spec ambitions don't equal shipped features. Phase 8 features are on the roadmap but not implemented — documenting them creates technical debt and user confusion. Better to ship accurate Phase 1-6 docs and expand after Phase 7-8 ship.

**Outputs:**
- `.squad/decisions/inbox/apiopslead-docs-scope.md` — 259-line scope advisory
- Merged into decisions.md as comprehensive decision entry dated 2026-05-12T19:25:50Z



### 2026-05-01: Enhanced 7 Agent Charters with Codebase-Specific Patterns

**What:** Applied the CodeReviewer charter enhancement pattern to all 7 remaining charters, making each codebase-aware with actual file paths, patterns, and team decisions.

**Charters enhanced:**
1. **TypeScriptDev** — Fixed inaccurate tsconfig claims (`noUncheckedIndexedAccess` removed, `ESNext` → `ES2022`), added correct strict flags, added "Tech-Specific Patterns" section with ESM, singleton+class export, error handling, interface-first design, opaque payloads, and key file paths table
2. **TestEngineer** — Added "Codebase-Specific Testing Patterns" section with Vitest conventions, `IApimClient`/`IArtifactStore` mock interfaces, exit code testing, CLI subprocess tests, filesystem cleanup, error testing patterns, and review checklist
3. **NodeJsDev** — Added "Codebase-Specific Patterns" section with exit code constants, ESM requirements, CLI entry point structure, dual-mode package consumption, generated template directories, and log-level decision
4. **ApimExpert** — Added "Codebase Patterns" section with key source files table, `HttpError` pattern, retry/failure patterns, token caching, SOAP/WADL extraction, synthetic GraphQL detection, ARM URI construction, and 4 key decisions
5. **AzdoExpert** — Added "Project-Specific Patterns" section with template source references, `apiops init` integration, and variable group conventions
6. **GitHubExpert** — Added "Project-Specific Patterns" section with workflow file table, OIDC federation pattern, generated template references, and repo configuration
7. **ApiOpsLead** — Added "What I Check" section with structural integrity, constitution alignment checklist, key decisions, and key file paths table; constitution path was already correct

**Also fixed across all charters:**
- Constitution path references updated to `.squad/identity/constitution.md` where stale
- Collaboration sections updated to reference both constitution and decisions.md

**Key insight:** The most impactful enhancements are on code-producing agents (TypeScriptDev, TestEngineer, NodeJsDev) where inaccurate or missing patterns directly cause code quality issues. The TypeScriptDev charter had two outright inaccuracies that would have led agents to write code targeting wrong settings.

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
