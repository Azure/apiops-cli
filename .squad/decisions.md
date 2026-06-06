# Squad Decisions

## Active Decisions

### 2026-07-15: PR #102 Metadata Correction
**By:** GitHubExpert  
**Status:** Applied (partial)  
**What:** PR #102 body updated to accurately reflect the branch's real work — aligning apiops-cli override configuration format with APIOps Toolkit (issue #96). Title update requires manual intervention due to API token scope limitations.  
**Why:** The PR was auto-created with metadata describing only the final merge-main action, not the feature work (override format alignment, docs updates, test hardening). Accurate PR metadata is critical for reviewer context and changelog generation.  
**Correct title:** `fix: align override configuration format with APIOps Toolkit`

---

### 2026-05-28T23:06:01Z: Team-Wide Evidence Standard
**By:** User directive (anonymized)  
**Status:** Active directive  
**What:** All team members should back decisions, notes, and factual assertions with a credible source URL whenever possible.
**Why:** Strengthens traceability and reviewability across public squad records.

### 2026-05-28T22:55:05Z: DocWriter Uses GitHub-Style Markdown
**By:** User directive (anonymized)  
**Status:** Active directive  
**What:** All documentation and guidance authored by DocWriter must use GitHub-style Markdown.
**Why:** Ensures consistent rendering, readability, and contribution standards across repository documentation.
**Source:** [Basic writing and formatting syntax - GitHub Docs](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)

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

### 2026-04-21T19:35:00Z: SOAP/WADL spec extraction prefers link format with inline XML fallback
**By:** ApimExpert (via Squad session with a user)
**Status:** Implemented
**What:** For soap-type APIs, `getApiSpecification` requests `format=wsdl-link` first. On HTTP 5xx, it falls back to the inline (non-link) `format=wsdl` export which returns raw WSDL XML in `properties.value`. WADL follows the same pattern (`wadl-link` → `format=wadl` fallback). The XML fallback content is saved as `specification.wsdl` / `specification.wadl` and is re-importable via PUT `?import=true&format=wsdl` (or `wadl-xml`).
**Why:** User requires full round-trip fidelity — SOAP APIs must be re-importable to a new APIM instance. APIM's `wsdl-link` emitter deterministically returns HTTP 500 on many real-world SOAP APIs. Azure/apiops reference tool skips XML specs on 500 with comment "non-link exports cannot be reimported" — this is inaccurate; the inline form IS re-importable. Converting SOAP → OpenAPI via `openapi-link` works but loses SOAP semantics on round-trip.

### 2026-04-21T19:34:00Z: Synthetic GraphQL APIs skip the graphql-link export call
**By:** ApimExpert (via Squad session with a user)
**Status:** Implemented
**What:** Before calling `graphql-link` export, `api-extractor.ts` probes ApiSchema children via `hasGraphQLSchemaResource` and checks for `contentType` containing 'graphql'. If found (synthetic GraphQL — SDL stored as an ApiSchema resource), the export call is skipped. If not found (pass-through GraphQL), `graphql-link` is called normally.
**Why:** APIM returns HTTP 406 on `graphql-link` export for synthetic GraphQL APIs because there is nothing to export — the SDL is already held as an ApiSchema child resource and is captured by standard ApiSchema extraction. Skipping the redundant call avoids the error without losing fidelity.

### 2026-04-21T19:33:00Z: XML export fallback bypasses the default 5xx retry loop
**By:** ApimExpert (via Squad session with user)
**Status:** Implemented
**What:** `getApiSpecification` passes `noRetryOn5xx=true` to `request()` when exporting `wsdl-link` or `wadl-link`. The fallback to inline format runs immediately on HTTP 5xx rather than after three retries.
**Why:** APIM's wsdl-link/wadl-link 500 errors are deterministic failures in APIM's XML emitter, not transient. Retrying wastes time and delays the fallback. The inline format path is fast and reliable.

### 2026-04-14T21:37:55Z: Resource Path Labels for Log Output
**By:** CodeReviewer  
**Status:** Approved  
**What:** Implemented `buildResourceLabel()` utility to generate human-readable hierarchical resource paths in logs. Format: serviceName/grandparent/parent/name (e.g., "apim-1/petstore/get-user" instead of just "get-user"). Applied across resource-extractor.ts, api-extractor.ts, and extract-service.ts.
**Why:** Improves observability by providing full context in log messages; aids debugging and tracing. Tested comprehensively (8 unit tests, all 467 integration tests passing). Compliant with Constitution §I-§VIII; no secret safety risks (only metadata logged).

### 2026-04-13T23:35:35Z: Replace --verbose with --log-level Option
**By:** TypeScriptDev  
**Status:** Implemented  
**What:** Replaced boolean `--verbose` flag with `--log-level <level>` supporting debug, info, warn, error (default: info). Logger updated with `LOG_LEVEL_PRIORITY` numeric filtering; all 432 tests pass.
**Why:** Granular log control (4 levels vs. binary), production-friendly (suppress INFO noise), industry standard alignment (kubectl, docker, terraform), explicit semantics. Breaking change; users update `--verbose` to `--log-level debug`.

### 2026-04-13T18:50:54Z: Comprehensive test coverage for API publisher and rate limiting
**By:** TestEngineer
**What:** Created `tests/unit/services/api-publisher.test.ts` (20 tests) covering all aspects of API publisher service, and enhanced `tests/unit/clients/apim-client.test.ts` with 4 rate-limiting tests for HTTP 429 handling.
**Why:** Critical gap: api-publisher.ts had no dedicated test file despite being central to T032 (revision handling). Additionally, HTTP 429 rate limiting (FR-015) was untested. Both pose production risks. Solution maintains Constitution §VI (unit tests only, no external deps), full mock coverage, and edge case testing.

### 2026-04-10T18:14:39Z: Text-first XML parsing in ApimClient.getResource
**By:** TypeScriptDev
**What:** Modified `getResource` to handle raw XML responses from APIM policy endpoints by reading response as text first, detecting XML via Content-Type header or body sniffing, then wrapping in ARM envelope.
**Why:** APIM policy endpoints (ServicePolicy, ApiPolicy, etc.) return raw XML instead of JSON-wrapped XML. Previous implementation crashed on `response.json()`. Text-first approach is defensive, maintains backward compatibility (no interface changes), and handles both explicit and implicit XML detection.

### 2025-04-09T05:34:00Z: Formalized commit message convention
**By:** ApiOpsLead
**What:** Codified the commit convention (include `Closes #N` or `Fixes #N` when resolving issues) into CONTRIBUTING.md and PR template. Previously this existed only in agent memory.
**Why:** Conventions that only live in agent memory are invisible to human contributors and new AI agents. Formalizing in repo files ensures all contributors follow the same process.

### 2025-05-18: GitHub Agentic Workflows (gh-aw) Adoption Strategy
**By:** GitHubExpert  
**Status:** Proposed  
**Scope:** Branch maintenance workflows

**Context:** Whether or not to use gh-aw or hand-rolled YAML implementations.

**Decision:**
- Use gh-aw LabelOps pattern, event pattern for advising.
- Use hand-rolled yaml for deterministic outcode, like CI gates.

**Impact:** Reduces maintenance burden for advisory workflows; eliminates keyword-matching brittleness in triage; no change to security posture.

---

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

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
