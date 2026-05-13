# Squad Decisions

## Active Decisions

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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
