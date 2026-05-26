# TestEngineer — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md` — acceptance criteria are the primary source for test cases
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0)
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

### 2026-04-29: User-Agent Header Testing (Issue #16)

**Context:** Added test coverage for User-Agent header implementation across both lib and client layers.

**Tests Created:**
- `tests/unit/lib/user-agent.test.ts` - 3 tests
  - ✅ USER_AGENT constant exports as string
  - ✅ USER_AGENT matches format `apiops-cli/{version}`
  - ✅ Version in USER_AGENT matches package.json version

- `tests/unit/clients/apim-client.test.ts` - 2 new tests added to "User-Agent" describe block
  - ✅ User-Agent header set on authenticated requests (Bearer token path)
  - ✅ User-Agent header set on unauthenticated requests (skipAuth blob path)

**Testing Approach:**
- Verified header presence in both auth paths using standard mock setup
- Both tests confirm header is set after auth logic via `headers.set()`
- Used existing test patterns: mock fetch with Response objects, inspect headers in captured context

**Code Review Feedback:**
- One finding: duplicate test replaced with skipAuth blob path test to avoid redundancy
- Ensures both auth flows are covered without test duplication

**Pattern:** When testing client-wide headers:
- Add lib unit test for constant/value verification
- Add client integration tests for both supported request patterns
- Verify header appears in expected request headers captured by mocks

**Result:** 5 new User-Agent tests, all passing. Code review approved.

### 2026-04-29: Test Fixes for Optional --cli-package Flag

**Context:** NodeJsDev made `--cli-package` optional in `apiops init` command, introducing a discriminated union for package consumption modes (local tarball vs public npm). Test suite had 3 files with failures due to outdated interface usage.

**Problem:**
- `PackageJsonConfig` changed from `{ tarballRelPath: string }` to discriminated union:
  - `{ mode: 'local'; tarballRelPath: string }` - local tarball mode
  - `{ mode: 'npm' }` - public npm registry mode
- Tests expected old interface format
- `init-command.test.ts` expected `--cli-package` to be required (now optional)

**Changes:**
1. **init-command.test.ts**:
   - Fixed line 56: Changed from checking `required` to checking `mandatory` (Commander uses `mandatory` for options with `<value>` arguments)
   - Updated test name to reflect optional status
   - Updated test description for "all expected options" (not "all required options")

2. **package-json.test.ts**:
   - Restructured all tests into two describe blocks: "local mode" and "npm mode"
   - Updated local mode tests to use `{ mode: 'local', tarballRelPath: '...' }`
   - Added 6 new tests for npm mode covering:
     - Valid JSON generation
     - `@peterhauge/apiops-cli` dependency with `latest` version
     - No `apiops` dependency (should be undefined)
     - Standard package.json properties (private, name, version)
     - Newline termination

3. **init-service.test.ts**:
   - Renamed existing test to clarify "local mode"
   - Added 2 new tests for npm mode (when `cliPackage` undefined):
     - Package.json contains npm dependency, not file: dependency
     - No tarball copy, no `.apiops` directory created

**Commander Option Properties:**
- Options with required arguments (`<value>`) use `mandatory` property (e.g., `--ci <provider>`, `--cli-package <path>`)
- Boolean flags (no arguments) use `required` property (e.g., `--non-interactive`, `--force`)

**Pattern:** When interface changes to discriminated union:
- Organize tests into describe blocks by union variant (mode: 'local', mode: 'npm')
- Test each mode's unique behaviors separately
- Ensure all union variants have equivalent coverage (valid JSON, expected properties, edge cases)
- Update existing tests to use new interface structure (add discriminant property)

**Result:** 850 tests passing (43 in modified files). All failures resolved. Coverage added for both package consumption modes.

**Orchestration artifacts:**
- `.squad/orchestration-log/2026-04-29T150000Z-testengineer.md` — test work completion log
- `.squad/log/2026-04-29T150000Z-test-fixes-cli-package.md` — session summary
- History updated with dual-mode package consumption patterns

### 2026-05-22: Test Coverage for Dry-Run Comparison, Auto-Generated IDs, Overrides, and Subscription-ID Flag

**Task:** Add or update tests for compare cloud/local output, auto-generated id handling, overrides application, and the subscription-id/help command changes.

**Context:**
- User requested test coverage for four distinct areas related to publish and dry-run functionality
- Baseline: 885 tests passing, lint clean (pre-existing lint issues in compare-command.ts and compare-service.ts unrelated to this work)

**Tests Added:**

1. **Auto-generated ID handling in publish-service.test.ts (3 new tests):**
   - `should skip auto-generated NamedValues (24-char hex IDs)` — verifies that NamedValues with 24-char lowercase hex IDs (e.g., `69f15c3c10a45d29d855583a`) are filtered out during publish, as APIM recreates these when loggers are published
   - `should log debug message when skipping auto-generated NamedValues` — ensures observability via debug logs
   - `should publish NamedValues with human-readable names` — confirms non-auto-generated NamedValues (e.g., `src-nv-plain`, `my-api-key`) are published normally
   - **Pattern:** Auto-generated resources are identified by `isAutoGeneratedId()` utility; publish flow skips them with debug logging for transparency

2. **Override application in publish flow in publish-service.test.ts (3 new tests):**
   - `should apply overrides when config has override section` — verifies that overrides from `PublishConfig.overrides` are applied to resources during publish (tested with Backend URL override)
   - `should not modify resources when no overrides match` — confirms resources are unchanged when override config doesn't have a matching entry
   - `should apply overrides case-insensitively` — validates override name matching uses case-insensitive comparison (e.g., override key `myapi` matches resource name `MyApi`)
   - **Pattern:** Override application is integrated into the publish flow; tests verify integration with override-merger service via putResource call inspection

3. **Cloud/local comparison in dry-run in dry-run-reporter.test.ts (6 new tests):**
   - `should detect differences between cloud and local: update scenario` — verifies dry-run correctly identifies resources that exist in cloud and would be updated (PUT without "(new)" log marker)
   - `should detect differences between cloud and local: create scenario` — verifies dry-run correctly identifies resources that don't exist in cloud and would be created (PUT with "(new)" log marker)
   - `should detect deletions when cloud has resources not in local artifacts` — validates DELETE operations are reported for incremental deletes
   - `should skip deletions when resource already absent from cloud` — ensures SKIP operation when delete target doesn't exist (with "(already absent)" log marker)
   - `should compare multiple resources with mixed states` — integration test with mix of creates, updates, verifying summary counts and log markers
   - **Pattern:** Dry-run comparison uses `client.getResource()` to check cloud state; return value determines PUT vs DELETE vs SKIP operation; log markers distinguish new vs update scenarios

4. **Subscription-ID flag visibility in index.test.ts (3 new tests):**
   - `should show --subscription-id in extract subcommand help` — confirms `--subscription-id` appears in `apiops extract --help` output
   - `should show --subscription-id in publish subcommand help` — confirms `--subscription-id` appears in `apiops publish --help` output
   - `should show --subscription-id in init subcommand help` — confirms `--subscription-id` appears in `apiops init --help` output
   - **Key finding:** `--subscription-id` is NOT a global option in index.ts; it's command-specific (extract and publish have `requiredOption`, init has `option`). Test initially assumed it was global; corrected to test subcommand help outputs only.

**Result:** 899 tests passing (14 new tests added: 6 in dry-run-reporter.test.ts, 6 in publish-service.test.ts, 3 in index.test.ts, minus 1 removed duplicate). All modified files pass lint. Pre-existing lint failures in compare-command.ts and compare-service.ts are out of scope (not touched by this work).

**Testing Approach:**
- Used existing test patterns: vi.mock for dependencies, descriptor-based mocking, mock call inspection
- Followed existing test structure: describe blocks by feature area, descriptive test names with "should" pattern
- Edge cases covered: auto-generated vs manual IDs, override match vs no-match, case-insensitive matching, create vs update vs skip scenarios
- Used spies for logger assertions to verify debug/info output

**Pattern:** When testing integration between services (e.g., override-merger + publish-service):
- Mock the dependencies (apim-client, artifact-store)
- Configure store.readResource to return test payloads
- Configure PublishConfig with override values
- Verify integration via putResource call inspection (check that payload has overridden values)

**Pattern:** When testing dry-run comparison:
- Mock client.getResource to simulate cloud state (return value indicates existence)
- Use Map to configure which resources exist in cloud
- Verify operation type (PUT/DELETE/SKIP) and log markers (new/already absent)
- Test mixed scenarios to ensure summary counts are accurate

**Orchestration artifacts:**
- History updated with testing patterns for auto-generated ID handling, override integration, dry-run comparison, and CLI help output verification

### 2026-05-22: Team Update — apiops compare Spawned; Active Testing Phase

**Team context:**
- ApimExpert completed cloud-to-cloud compare implementation (all 34+ resource types covered)
- NodeJsDev completed --subscription-id scope refactor (moved from global to command-specific)
- TestEngineer now running comprehensive compare testing (current active task)
- TypescriptDev-compare-finish spawned for lint fixes + unit tests + local compare stub

**Test coverage expected:**
- Unit tests for normalization module (instance value stripping)
- Unit tests for differ module (deep comparison logic)
- Integration tests comparing two real APIM instances
- Edge cases: auto-generated ID matching, circular dependencies, large resource counts

**Status:** Awaiting test results before TypescriptDev takes over finishing work.

