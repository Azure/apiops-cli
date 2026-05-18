# Squad Decisions

## Active Decisions

### 2026-04-29T14:30:00Z: apiops init Dual-Mode Package Consumption
**By:** NodeJsDev  
**Status:** Implemented  
**What:** Made `--cli-package` optional in `apiops init`. The command now supports two package consumption modes: (1) **Public npm mode** (default, when `--cli-package` NOT provided): generates package.json with `"@peterhauge/apiops-cli": "latest"`, no local tarball copy, no `.apiops/` directory created, standard consumption pattern after npm publish. (2) **Local tarball mode** (when `--cli-package <path>` provided): copies tarball to `.apiops/` directory, generates package.json with `"apiops": "file:.apiops/{tarball}"`, preserves existing behavior for local development/testing.
**Why:** After publishing to npm as `@peterhauge/apiops-cli`, requiring users to download the package and run `apiops init --cli-package ./tarball.tgz` added unnecessary friction. Most users want to reference the public package directly. The change is backward compatible — existing workflows with `--cli-package` continue to work unchanged. Improves user experience with simpler onboarding.

### 2026-04-21T19:35:00Z: SOAP/WADL spec extraction prefers link format with inline XML fallback
**By:** ApimExpert (via Squad session with enewman)
**Status:** Implemented
**What:** For soap-type APIs, `getApiSpecification` requests `format=wsdl-link` first. On HTTP 5xx, it falls back to the inline (non-link) `format=wsdl` export which returns raw WSDL XML in `properties.value`. WADL follows the same pattern (`wadl-link` → `format=wadl` fallback). The XML fallback content is saved as `specification.wsdl` / `specification.wadl` and is re-importable via PUT `?import=true&format=wsdl` (or `wadl-xml`).
**Why:** User requires full round-trip fidelity — SOAP APIs must be re-importable to a new APIM instance. APIM's `wsdl-link` emitter deterministically returns HTTP 500 on many real-world SOAP APIs (observed: 270 of 272 soap APIs in a production tenant). Azure/apiops reference tool skips XML specs on 500 with comment "non-link exports cannot be reimported" — this is inaccurate; the inline form IS re-importable. Converting SOAP → OpenAPI via `openapi-link` works but loses SOAP semantics on round-trip.

### 2026-04-21T19:34:00Z: Synthetic GraphQL APIs skip the graphql-link export call
**By:** ApimExpert (via Squad session with enewman)
**Status:** Implemented
**What:** Before calling `graphql-link` export, `api-extractor.ts` probes ApiSchema children via `hasGraphQLSchemaResource` and checks for `contentType` containing 'graphql'. If found (synthetic GraphQL — SDL stored as an ApiSchema resource), the export call is skipped. If not found (pass-through GraphQL), `graphql-link` is called normally.
**Why:** APIM returns HTTP 406 on `graphql-link` export for synthetic GraphQL APIs because there is nothing to export — the SDL is already held as an ApiSchema child resource and is captured by standard ApiSchema extraction. Skipping the redundant call avoids the error without losing fidelity.

### 2026-04-21T19:33:00Z: XML export fallback bypasses the default 5xx retry loop
**By:** ApimExpert (via Squad session with enewman)
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
