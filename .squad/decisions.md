# Squad Decisions

## Active Decisions

### 2026-05-26T21:18:34Z: Compare JSON results include source or target instance metadata
**By:** TypeScriptDev
**Status:** Implemented
**What:** Added an optional `instance: 'source' | 'target'` field to `ComparisonDifference` so structured compare output explicitly identifies whether a non-matching resource exists only in the source or only in the target APIM instance.

**Implementation:**
- `missing` diffs now emit `instance: 'source'`
- `extra` diffs now emit `instance: 'target'`
- `property-diff` entries remain unchanged
- Focused unit coverage verifies both instance values and confirms property diffs are unaffected

**Why:** `diffType` alone was ambiguous in JSON mode because it did not say which APIM instance owned a resource that appeared only on one side. The compare service is the right seam to make the machine-readable contract self-describing without changing table or text output.

**Validation:**
- `npx vitest run tests/unit/services/compare-service.test.ts`

---

### 2026-05-22T08:08:23Z: apiops compare Command — Cloud-to-Cloud Comparison
**By:** ApimExpert  
**Status:** Completed (lint errors pending)  
**What:** Implemented `apiops compare` command for cloud-to-cloud APIM resource comparison, following the PowerShell Compare-ApimInstance.ps1 pattern.

**Implementation:**
- **Normalization module** (`src/lib/compare-normalizer.ts`) — strips instance-specific values (subscription IDs, resource groups, service names, timestamps, auto-generated IDs)
- **Diff engine** (`src/lib/compare-differ.ts`) — deep recursive comparison with structured output
- **Compare service** (`src/services/compare-service.ts`) — orchestrates all 34+ resource types with hierarchical comparison
- **CLI command** (`src/cli/compare-command.ts`) — accepts `--source-*` and `--target-*` flags, supports text/JSON/table output, exit codes 0 (identical) / 1 (differences)

**Key Features:**
- Handles auto-generated IDs via content-based stable keys
- Skips secret values and logger credentials per PowerShell logic
- Built-in exclusions (administrators group, starter/unlimited products, master subscription, echo-api)
- All 34+ resource types covered (APIs, products, backends, workspaces, gateways, policies, etc.)

**Known Issues:**
- 37 lint errors (Commander's untyped options + IApimClient) — non-blocking, fixed via type assertions
- Local compare mode deferred (requires artifact loader + override merger)

**Handoff:** TypescriptDev-compare-finish spawned to fix lint errors and add unit tests.

---

### 2026-05-22T08:08:23Z: Move --subscription-id from Global to Command-Specific Scope
**By:** NodeJsDev  
**Status:** Completed  
**What:** Refactored `--subscription-id` from global options to command-specific options for `extract`, `publish`, and `init` commands.

**Changes:**
1. Removed `--subscription-id` from global options (`src/cli/index.ts`)
2. Added `--subscription-id` as required option to `extract-command.ts`
3. Added `--subscription-id` as required option to `publish-command.ts`
4. Added `--subscription-id` as optional option to `init-command.ts`
5. Updated test expectations in `tests/unit/cli/index.test.ts`

**Rationale:**
- **Precision:** Not all commands need subscription ID (e.g., `apiops --help`)
- **Clarity:** Makes it explicit which commands require Azure context
- **CLI alignment:** Avoids overlapping edits with compare command work

**Impact:**
- **Breaking change:** Users must now use `apiops extract --subscription-id <id>` instead of `apiops --subscription-id <id> extract`
- **Environment variable:** `AZURE_SUBSCRIPTION_ID` still works as fallback
- **Help output:** Global help no longer shows `--subscription-id`

**Validation:**
- ✅ All 885 tests pass
- ✅ Lint passes
- ✅ Build passes

---

### 2026-05-14T05:20:00Z: APIM v1 → v2 SKU Migration via apiops-cli
**By:** ApimExpert + ApiOpsLead (joint research and decision)  
**Status:** Proposed for team governance review  
**What:** Comprehensive technical analysis of APIM v1→v2 migration feasibility, with phase-gated implementation approach.

**Decision:** Phase 1 MVP uses existing `extract` + `publish` commands with migration guide. No new command needed yet.

**Key Findings:**
- **Coverage:** Existing extract→publish supports ~80–85% of migration. All 34 resource types supported; REST API paths identical for classic and v2 instances.
- **Gaps:** (1) Subscription keys redacted on extract (need `listSecrets` flow for preservation), (2) Self-hosted gateways unsupported on v2, (3) Service Fabric backends unsupported on v2, (4) Buffered payload limit 500MiB→2MiB, (5) No multi-region, static IP, or backup/restore on v2.
- **Architecture readiness:** `ApimServiceContext` parameterized — source and target are already just two different context instances. No code refactoring needed.
- **Infrastructure out of scope:** VNet, DNS, managed identity, RBAC, TLS certificates handled via Bicep/Terraform, not apiops-cli.

**Rationale:**
1. Constitution §V (YAGNI): Build what's needed when it's needed.
2. Overpromise avoided: A dedicated `apiops migrate` command would imply the tool handles networking/DNS/identity, which are outside APIM configuration scope.
3. Existing architecture validates well — demonstrates robustness of parameterized design.

**Phase Breakdown:**
- **Phase 1 (MVP):** Migration guide doc + override template examples (no code changes). Covers ~85% of typical migration via existing commands.
- **Phase 2 (if demand):** Add `apiops copy` for direct source→target streaming, optional subscription key preservation via `listSecrets` API, pre-flight v2 compatibility validation.
- **Phase 3+:** Enhanced migration-specific features based on user feedback.

**Artifacts:**
- `specs/sku-upgrade.md` — Full 94-line proposal with phased roadmap
- `.squad/decisions/inbox/apimexpert-sku-upgrade-research.md` — Comprehensive 306-line technical analysis (all 34 resource types, feature gaps, networking model differences, identity considerations)
- `.squad/decisions/inbox/apiopslead-sku-upgrade-proposal.md` — Decision summary (merged into this entry)

**Next Steps:**
1. Team governance review
2. If approved: author migration guide in `/docs/guides/sku-migration.md`
3. Create override template showing v2-specific adjustments (backend URLs, logger resource IDs, Key Vault refs)
4. Gather Phase 2 demand signals from users

---

### 2026-05-12T19:25:50Z: Documentation Structure and Scope Decisions
**By:** DocWriter (with scope input from ApiOpsLead)  
**Status:** Proposed  
**What:** Comprehensive documentation plan for apiops-cli `/docs` folder with structured layout and 3-phase authoring strategy.

**Architectural Decisions:**
1. **Directory structure:** Organize docs into logical segments — commands/ (one file per CLI command), guides/ (task-oriented how-to), ci-cd/ (platform-specific integration), reference/ (technical deep dives), architecture/ (system design), troubleshooting/ (problem-solution).
2. **Landing page strategy:** `/docs/README.md` serves as GitHub-native navigation hub with Mermaid extract→publish→version control flow diagram. GitHub displays README.md by default when browsing /docs.
3. **One command = one doc file** in commands/ directory (extract.md, publish.md, init.md). Mirrors CLI structure for clarity.
4. **Audience assumption:** Readers know HTTP, REST, JSON, YAML, git, CI/CD. Focus on apiops-specific patterns, not over-explaining basics.
5. **Cross-references use relative links** — Works when browsing GitHub or cloning locally. No hardcoded URLs.
6. **Troubleshooting docs are searchable** — Error messages and solutions in structured format for GitHub search discoverability.
7. **Writing style:** Examples-first approach — show working code, then explain. Active voice, imperative mood, scannable structure.
8. **Mermaid diagrams over static images** — Version-controlled, editable, GitHub-native rendering. Planned: extract/publish flow, resource dependency graph, authentication flow, init command decision tree.

**Scope Decisions (from ApiOpsLead advisory):**
- **D1: User-Facing Only** — Keep `/docs` purely user-facing. Do NOT document internal architecture. Users care about "how do I extract" not "how does the dependency graph work".
- **D2: Both GitHub Actions AND Azure DevOps** — Document both platforms with equal weight. Spec explicitly targets both; apiops init generates templates for both.
- **D3: Artifact Directory Flexibility** — Do NOT document `./apim-artifacts` as "the" directory. Emphasize users choose path via --output/--source. Default behavior mentioned only as fallback.
- **D4: Authentication Guidance — Multiple Methods** — Document all auth methods (Azure CLI, federated credentials/OIDC, service principal, managed identity) with clear context-specific guidance (local dev vs. CI/CD vs. production).

**Ready to Document NOW (Green Light):**
- `apiops extract` command (code exists, core feature entry point)
- `apiops publish` command (tasks complete, completes round-trip)
- `apiops init` command (tasks complete, high adoption value)
- CI/CD integration (both GitHub Actions and Azure DevOps)

**Defer Documentation (Red Light):**
- `--otel` OpenTelemetry flag (Phase 8, not implemented)
- `--spec-format` option (Phase 8, not implemented)
- Internal architecture (not user-facing)

**Authoring Priority (highest value first):**
1. Getting Started Guide (init → extract → publish → CI/CD) — removes adoption barrier, SC-009 target
2. Extract reference — core feature, users extract before anything else
3. Publish reference — completes extract-publish workflow
4. CI/CD integration guide — critical for production adoption
5. Configuration reference (filter.yaml, overrides.{env}.yaml)
6. Troubleshooting guide — reduces support burden

**Output:** `/docs/plan.md` (22-page structure and strategy document)

**Key Insight:** Documentation scope must align with implementation status. Document what's complete and stable; defer what's spec'd but not coded. Phase 8 features like `--otel` and `--spec-format` are spec'd but not implemented — documenting them now would create user confusion.

**Awaiting Team Review:** ApiOpsLead, ApimExpert, OpenSourceExpert, GitHubExpert approval needed before Phase 1 authoring begins.

---

### 2026-04-29T14:30:00Z: apiops init Dual-Mode Package Consumption
**By:** NodeJsDev  
**Status:** Implemented  
**What:** Made `--cli-package` optional in `apiops init`. The command now supports two package consumption modes: (1) **Public npm mode** (default, when `--cli-package` NOT provided): generates package.json with `"@peterhauge/apiops-cli": "latest"`, no local tarball copy, no `.apiops/` directory created, standard consumption pattern after npm publish. (2) **Local tarball mode** (when `--cli-package <path>` provided): copies tarball to `.apiops/` directory, generates package.json with `"apiops": "file:.apiops/{tarball}"`, preserves existing behavior for local development/testing.
**Why:** After publishing to npm as `@peterhauge/apiops-cli`, requiring users to download the package and run `apiops init --cli-package ./tarball.tgz` added unnecessary friction. Most users want to reference the public package directly. The change is backward compatible — existing workflows with `--cli-package` continue to work unchanged. Improves user experience with simpler onboarding.

### 2026-06-11: GitHub Agentic Workflows (gh-aw) Security Assessment
**By:** SecurityExpert  
**Status:** Proposed

**Decision — CONDITIONAL ADOPT:** gh-aw provides stronger security posture than current GitHub App + `actions/github-script` model for Tier-1 labeling and triage workflows. However, adoption requires specific guardrails and certain workflows MUST remain as traditional YAML.

**Safe-Outputs vs. GitHub App:** gh-aw's safe-outputs model (read-only agent + declarative constraints) is architecturally superior to current model (App token + arbitrary JavaScript) for least-privilege enforcement.

**Prompt Injection Defense:** Introduces new attack surface (LLM processes user content), but safe-outputs framework bounds blast radius. Key mitigation: do NOT enable `close-issue` or `dispatch-workflow` outputs for triage.

**New Attack Vectors Identified:**
- Agent jailbreaking (mitigated by safe-output constraints)
- Safe-output constraint bypass via Unicode confusables (requires validation testing)
- label_command auto-removal governance gap (NEVER use auto-assigned labels as triggers)
- Compiled output tampering (must be in CODEOWNERS)
- Framework supply chain (low probability, monitor GitHub advisories)

**Label Security:** `blocked: ["squad:*", "go:*", "priority:*"]` provides equivalent or stronger protection than current policy. Gaps: re-application prevention (add to agent instructions), glob pattern completeness (use both `allowed` and `blocked`).

**New Guardrails Required (MANDATORY for adoption):**
1. Comment provenance banner — All gh-aw-generated comments must include visible "🤖 Generated by gh-aw workflow: {name}" header
2. No re-application rule — Agent instructions check label history before applying
3. Label segregation — No action-triggering label in `allowed` list or as `label_command:` trigger
4. Compiled output protection — gh-aw artifacts in `.github/` must be in CODEOWNERS with 2-maintainer approval
5. Cross-invocation limits — Track total labels per issue across invocations
6. Unicode/case testing — Validate `blocked` patterns against confusable inputs
7. Fallback plan — Ability to revert to traditional YAML within 1 PR

**Workflows Safe to Convert:** Info-only auto-labeling, issue triage routing, stale issue detection

**Workflows that MUST Stay as YAML:** Label sync, @copilot assignment, any with `dispatch-workflow` or `close-issue` outputs, branch protection changes

**Security Controls (MANDATORY regardless of approach):**
1. All Actions pinned to full SHA
2. Fork PRs touching `.github/` auto-fail
3. 2-maintainer approval for `.github/` and `.squad/` changes
4. CODEOWNERS coverage for sensitive paths
5. No Tier-2 label auto-application
6. Audit trail for all automated actions
7. Human override always wins

**Net Assessment:** gh-aw improves least-privilege, blast radius, auditability, and separation of concerns vs. current model. Weakens determinism and introduces prompt injection surface (mitigated by constraints). Net security improvement for advisory workflows when guardrails are in place.

Archived entries older than 30 days are stored in `.squad/decisions-archive.md`.

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
