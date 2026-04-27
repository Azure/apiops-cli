# TestEngineer — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md` — acceptance criteria are the primary source for test cases
- **Constitution:** `.specify/memory/constitution.md` (v2.1.0)
- **User:** Elizabeth Maher
- **Stack:** Vitest (native ESM + TypeScript), Node.js 22 LTS
- **Key rule (Constitution §VI):** All business logic MUST be testable in isolation without requiring live Azure resources.
- **Test strategy:** Unit tests (no network, no disk I/O) are mandatory. Integration tests (real Azure) are complementary.
- **Edge cases to cover:** pagination (nextLink), 429 retry, circular dependencies, partial publish failure, API revision ordering, paths with spaces/special chars.

## Learnings

### 2026-04-13: Test Coverage Analysis and Critical Gap Resolution

**Task:** Analyze test coverage and add missing tests, especially for `api-publisher.ts` (identified as a critical gap with no dedicated test file).

**Findings:**
- **Critical gap identified:** `src/services/api-publisher.ts` had NO test file at all, despite being a critical publish-path component (T032: API revision ordering, child resource publishing).
- **Existing coverage:** 27 test files, 404 tests passing. api-extractor.ts and product-extractor.ts already covered via `api-product-extractor.test.ts`.
- **Edge cases needing coverage:** HTTP 429 rate limiting (spec FR-015) was implemented but not tested in apim-client.test.ts.

**Actions taken:**
1. Created `tests/unit/services/api-publisher.test.ts` with 20 comprehensive tests covering:
   - Root API creation before revisions (spec FR-024)
   - Revision sorting in numeric order (critical for APIM to avoid auto-assignment conflicts)
   - All 9 API child resource types (ApiPolicy, ApiTag, ApiDiagnostic, ApiOperation, ApiSchema, ApiRelease, ApiTagDescription, ApiWiki, GraphQLResolver)
   - Grandchild resources (ApiOperationPolicy, GraphQLResolverPolicy) with correct parent/grandparent filtering
   - Error handling (root API failure prevents child publishing)
   - Edge cases: numeric revision sorting (rev=2, rev=10, rev=100), workspace-scoped APIs, empty APIs
   - Override application to root API
   - Concurrency limit enforcement (5 parallel tasks)

2. Added 4 new tests to `tests/unit/clients/apim-client.test.ts` for HTTP 429 rate limiting:
   - Retry with Retry-After header
   - Retry without Retry-After (exponential backoff)
   - Max retries exhaustion
   - 429 handling on PUT operations

**Patterns reinforced:**
- Mock all external dependencies (apim-client, artifact-store, resource-publisher, override-merger, parallel-runner) via vi.mock()
- Use descriptor-based mocking to simulate store.listResources() returning different resource types
- Verify call sequence for ordered operations (revisions must publish in numeric order)
- Verify parallel execution via mockRunParallel call inspection
- Mock delay/sleep functions to keep tests fast (no real waits)

**Result:** 428 total tests passing (24 new). All critical gaps resolved. Spec-required behaviors (FR-015, FR-024) now fully tested.

**Orchestration artifacts:**
- `.squad/orchestration-log/2026-04-13T18:50:54Z-testengineer.md` — test work completion log
- `.squad/log/2026-04-13T18:50:54Z-test-gap-analysis.md` — session summary
- Decision merged to `.squad/decisions.md`

### 2026-04-14: Test Coverage for buildResourceLabel Utility

**Task:** Add comprehensive unit tests for the new `buildResourceLabel` utility function in `src/lib/resource-uri.ts`.

**Function purpose:** Builds human-readable resource path labels for log output in format `{serviceName}/{grandparent}/{parent}/{name}` (omitting undefined segments).

**Tests added to `tests/unit/lib/resource-uri.test.ts`:**
- 13 new test cases covering all label formatting scenarios
- Top-level resources (with/without serviceName)
- Child resources with parent (with/without serviceName)
- Grandchild resources with grandparent + parent (with/without serviceName)
- Workspace omission (workspace property should NOT appear in label)
- Empty serviceName handling (treated as undefined, no empty prefix)
- Special characters preservation (hyphens, underscores pass through)
- Case preservation
- Edge cases: only grandparent set, only parent set

**Patterns used:**
- Followed existing test structure in resource-uri.test.ts
- Added tests to existing file (preferred over new file for related functionality)
- Imported `buildResourceLabel` alongside existing imports
- Descriptive test names following "should {action} {scenario}" pattern
- Edge case enumeration per charter (empty strings, special chars, missing hierarchy levels)

**Result:** 42 total tests in resource-uri.test.ts (32 existing + 13 new for buildResourceLabel, minus 3 restructured). All tests pass. Function behavior validated for all documented use cases.

<!-- Append new learnings here after each session -->
