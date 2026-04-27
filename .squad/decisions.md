# Squad Decisions

## Active Decisions

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
