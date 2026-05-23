# TypeScriptDev — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0)
- **Stack:** TypeScript 5.x strict mode, Node.js 22 LTS, ESLint with @typescript-eslint
- **Key principle (Constitution §VI):** Core operations MUST depend on abstractions, not concrete HTTP/file-system implementations.
- **Key principle (Constitution §VII):** Resource bodies are `Record<string, unknown>` — opaque passthrough, no typed DTOs.
- **Build:** `tsc` with strict mode. `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess` all enabled.

## Learnings

### 2025-04-09: Phase 2 Type System Implementation (T006-T013)

**What was accomplished:**
- Implemented all 8 Phase 2 tasks: ResourceType enum, core interfaces, config interfaces, IApimClient, IArtifactStore, dependency graph, resource URI mapping, and artifact path mapping
- Created type-safe abstractions for all 33 APIM resource types with complete metadata (ARM paths, artifact directories, info files)
- Built static dependency graph with 4-tier topological ordering and cycle detection
- All code passes strict TypeScript compilation and ESLint checks
- Zero `any` types used; all resource bodies typed as `Record<string, unknown>` per Constitution §VII

**Type safety insights:**
- ResourceDescriptor is the universal key across the system — all operations identify resources by type + name + optional parent/grandparent/workspace
- Metadata-driven approach eliminates hardcoded path logic — RESOURCE_TYPE_METADATA table drives both ARM URI construction and artifact path resolution
- Dependency graph assertion (`assertAcyclic()`) runs at module load time, catching configuration errors immediately
- ESM import paths require `.js` extension even for `.ts` source files due to Node.js ESM resolution rules

**Abstraction boundaries:**
- IApimClient returns `Record<string, unknown>` for all API responses — no attempt to parse APIM-specific properties
- IArtifactStore takes/returns opaque JSON — no knowledge of resource schemas
- Both interfaces use `ResourceDescriptor` as the parameter type, never file paths or URLs directly
- This enables complete mocking: tests can provide in-memory implementations without HTTP or I/O

**Technical decisions:**
- @types/node was missing from devDependencies, needed to be added for Node.js type definitions
- parseArmUri/parseArtifactPath implementations are simplified — full implementation would need comprehensive pattern matching for all 33 resource types
- Association files (apis.json, groups.json) handled separately from resource info files in artifact store interface

### 2026-04-10: XML Response Handling in ApimClient.getResource

**What was accomplished:**
- Fixed critical bug where `getResource` crashed on raw XML responses from APIM policy endpoints
- Modified `ApimClient.getResource` to read response as text first, then detect XML via Content-Type header or body sniffing
- Wrap raw XML responses in expected ARM envelope: `{ properties: { value: xmlContent, format: 'rawxml' } }`
- Added 4 comprehensive tests: JSON passthrough, XML via header, XML via body sniffing, 404 handling
- All 256 tests pass, zero lint errors

**Root cause:**
- Azure APIM policy endpoints (ServicePolicy, ApiPolicy, etc.) can return raw XML instead of JSON-wrapped XML
- Previous implementation always called `response.json()`, causing parse errors: `Unexpected token '<'`
- Affected all 5 policy resource types: ServicePolicy, ApiPolicy, ApiOperationPolicy, ProductPolicy, GraphQLResolverPolicy

**Type safety approach:**
- Kept return type as `Record<string, unknown> | undefined` — no interface changes needed
- Detection logic: `contentType.includes('xml') || body.trimStart().startsWith('<')`
- Defensive: handles both explicit XML Content-Type and implicit XML detection
- Callers already expected `properties.value` to contain policy content, so wrapping maintains backward compatibility

**Testing strategy:**
- Followed existing test patterns: mock `fetch` with `Response` objects, stub `getToken`
- Used same test structure as `listResources` suite: `beforeEach`/`afterEach` with `vi.stubGlobal`
- Tested both detection paths (header and body sniffing) to ensure robustness
- Verified JSON responses pass through unchanged

**Commits:**
- e585123: fix: handle raw XML responses in getResource for APIM policy endpoints
- 878d6bd: docs: document XML response handling fix

### 2026-04-13: Log Level Paradigm Shift — Replace --verbose with --log-level

**What was accomplished:**
- Replaced binary `--verbose` boolean flag with proper `--log-level <level>` option (values: debug, info, warn, error; default: info)
- Updated all layers: spec.md, logger, models, CLI commands (index, extract, publish), and comprehensive test coverage
- Added level-based filtering with numeric priority map: DEBUG(0) < INFO(1) < WARN(2) < ERROR(3)
- Refactored logger to filter in `log()` method based on configured level, removed special case for `debug()`
- All 432 tests pass, zero lint errors, clean TypeScript build

**Implementation approach:**
- Added `LOG_LEVEL_PRIORITY: Record<LogLevel, number>` to enable numerical comparison
- Changed `Logger.configure()` to accept `level?: LogLevel` instead of `verbose?: boolean`
- Moved filtering logic into private `log()` method: `if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) return;`
- Commander option: `--log-level <level>` with default `'info'`, parsed with `.toUpperCase() as LogLevel`
- Config interfaces: `logLevel: LogLevel` replaced `verbose: boolean` in both `ExtractConfig` and `PublishConfig`

**Type safety:**
- CLI receives lowercase strings ('debug', 'info', etc.) from Commander, converts to LogLevel enum via `.toUpperCase()`
- Test files import `LogLevel` enum and use `LogLevel.INFO` instead of `verbose: false`
- No `any` types used; all conversions are explicit casts after normalization

**Testing strategy:**
- Updated existing logger tests: "verbose mode" → "debug level", "disable verbose" → "restore info level"
- Added 4 new level filtering tests: WARN filters INFO, WARN passes WARN, ERROR filters WARN, DEBUG passes all
- Replaced `verbose: false` with `logLevel: LogLevel.INFO` in 22 test occurrences across 6 service test files
- CLI tests: replaced `--verbose` with `--log-level debug` in help output assertions

**Spec updates:**
- FR-023: Documented `--log-level <level>` with all four values and default
- Clarifications: Updated references from `--verbose` to `--log-level debug`
- Edge cases: Updated diagnostic guidance to use `--log-level debug`

**Commit:**
- b2c6b6b: feat: replace --verbose flag with --log-level option

<!-- Append new learnings here after each session -->

## Learnings

### 2026-04-14: Resource Path Labels in Log Output

**Context:** Implemented human-readable hierarchical resource path labels for log messages to improve debugging and observability.

**Key Decisions:**
- Added `buildResourceLabel()` utility function to `src/lib/resource-uri.ts` alongside existing ARM URI functions
- Function builds slash-separated paths from descriptor hierarchy: `serviceName/grandparent/parent/name`
- Updated all resource-identifying log statements across three service files
- Preserved structural log messages (e.g., "Starting extraction...") without modification

**Pattern:** When adding new utility functions for resource identification:
- Place in `src/lib/resource-uri.ts` with related functions (`buildArmUri`, `parseArmUri`)
- Accept both `ResourceDescriptor` and optional `serviceName` from `ApimServiceContext`
- Build path by conditionally adding segments only if they exist (avoids empty segments)
- Import and use consistently across all service layers

**Files Modified:**
- `src/lib/resource-uri.ts` - Added buildResourceLabel()
- `src/services/resource-extractor.ts` - Updated 4 log statements
- `src/services/api-extractor.ts` - Updated 7 log statements
- `src/services/extract-service.ts` - Updated 2 log statements

**Testing:** All 454 unit tests pass without modification, demonstrating backward compatibility of change.

### 2026-04-21: Windows path resolution in test mocks

**Context:** `init-service.test.ts` was failing on Windows with errors like `CLI package not found: C:\packages\apiops-0.1.0.tgz` even though the mock was set up for `/packages/apiops-0.1.0.tgz`.

**Root cause:** On Windows, `path.resolve('/packages/apiops-0.1.0.tgz')` returns `C:\packages\apiops-0.1.0.tgz` (drive letter prepended). The service under test calls `path.resolve(cliPackagePath)` before passing to `fs.access`, so the mock sees the Windows-absolute form, not the input literal.

**Pattern:** When mocking `fs.access`, `fs.copyFile`, or any `fs/promises` function that receives a path argument the SUT has normalized, compare against `path.resolve()`-normalized values — not the raw input string. Works on Linux (no-op) and Windows (adds drive letter).

```ts
// WRONG — fails on Windows
const TEST_CLI_PACKAGE = '/packages/apiops-0.1.0.tgz';
vi.mocked(fs.access).mockImplementation(async (p) => {
  if (p.toString() === TEST_CLI_PACKAGE) return; // never matches on Windows
  throw new Error('ENOENT');
});

// RIGHT — platform-agnostic
const TEST_CLI_PACKAGE = '/packages/apiops-0.1.0.tgz';
const TEST_CLI_PACKAGE_RESOLVED = path.resolve(TEST_CLI_PACKAGE);
vi.mocked(fs.access).mockImplementation(async (p) => {
  if (p.toString() === TEST_CLI_PACKAGE_RESOLVED) return;
  throw new Error('ENOENT');
});
```

Same rule applies to `expect(fs.copyFile).toHaveBeenCalledWith(...)` assertions — use the resolved form.

**Files:** `tests/unit/services/init-service.test.ts`.

### 2026-04-29: User-Agent Header Implementation (Issue #16)

**Context:** Implemented User-Agent header for all APIM REST API calls to identify the apiops-cli client.

**Key Decisions:**
- Created `src/lib/user-agent.ts` with `USER_AGENT` constant using module pattern: `createRequire` loads package.json at module initialization
- Format: `apiops-cli/{version}` (e.g., `apiops-cli/0.1.0`)
- Header set in `ApimClient.request()` at line 108, after auth logic but before retry loop
- Applied universally to all request types: authenticated (Bearer token) and unauthenticated (SAS blob skipAuth paths)

**Pattern:** When exporting client identifiers:
- Use ES module pattern with `createRequire(import.meta.url)` to load package.json at import time
- No runtime file system calls or dynamic version reads
- Export as constant string from dedicated lib module
- Consumed by clients that need the value

**Files Modified:**
- `src/lib/user-agent.ts` - New file
- `src/clients/apim-client.ts` - Added header set at line 108

**Implementation Details:**
- `headers.set('User-Agent', USER_AGENT)` executes after skipping auth headers but maintaining compatibility
- Tested on both auth paths: standard Bearer token and skipAuth (SAS blob)
- Issue #16 closed

**Tests:** Created `tests/unit/lib/user-agent.test.ts` (3 tests) and added to `apim-client.test.ts` (2 tests)

### 2026-05-22: Team Update — apiops compare Spawned; Lint Fixes + Testing Pending

**Team context:**
- ApimExpert completed cloud-to-cloud compare implementation (34+ resource types, normalization, diff engine)
- NodeJsDev completed --subscription-id scope refactor (global → command-specific)
- TestEngineer actively testing compare module (running)
- TypescriptDev-compare-finish (this agent) spawned to finish compare work

**Handed-off artifacts:**
- compare-normalizer.ts: 37 lint errors (@typescript-eslint/no-unsafe-*) due to Commander untyped options
- compare-differ.ts: deep comparison logic, well-tested in ApimExpert's unit testing
- compare-service.ts: orchestrates 34+ resource types with hierarchical comparison
- compare-command.ts: CLI interface with text/JSON/table output

**Tasks for this agent:**
1. Fix 37 lint errors via explicit type assertions in Commander options handling
2. Add unit tests for normalizer and differ modules
3. Implement local compare mode stub (artifact + overrides loader)
4. Add integration tests for cloud compare

**Known issues:**
- All 885 existing tests pass; lint errors are non-blocking but should be resolved
- Local compare deferred due to scope; will be implemented as stub only


### 2026-06-14: Compare Command Type Safety Fixes (Issue #22)

**Context:** Completed type-safety cleanup for the compare command implementation left by ApimExpert and NodeJsDev, reducing lint errors from 37 to 0.

**Key Issues Fixed:**
1. Missing `CompareConfig` interface definition in `src/models/config.ts` — Added interface with properly typed `sourceClient` and `targetClient` properties of type `IApimClient`
2. Missing `armResourceType` property in `ResourceTypeMetadata` interface — Added to all 39 metadata entries using Python script
3. Unsafe type assignments when iterating over `ResourceType` enum arrays — Fixed by explicitly typing arrays as `readonly ResourceType[]` instead of using `as const`
4. Incorrect resource type references:
   - `ResourceType.ApiVersionSet` → `ResourceType.VersionSet` (correct enum name)
   - `ResourceType.ApiResolver` → `ResourceType.GraphQLResolver` (correct enum name)
5. Undefined Workspace types — Workspace resource types not yet in `ResourceType` enum, so disabled workspace comparison code with clear comments

**Type Safety Patterns:**
- When iterating over arrays containing enum values, explicitly type as `readonly ResourceType[]` to preserve type information through iteration
- Import `IApimClient` as `type` import to avoid unused import warnings when only used for type annotations
- For Record<EnumType, T> indexed access, TypeScript doesn't guarantee key existence — either assert key exists or handle undefined case
- Resource ID extraction from `Record<string, unknown>` requires runtime type checking: `const id = resource.id; if (typeof id !== 'string') continue;`

**Implementation Details:**
- `buildArmBaseUrl()` expects `cloudName` string ('public', 'china', etc.), not `cloudConfig.armEndpoint`
- Python script automated adding `armResourceType` to 39 metadata entries by extracting first path segment from `armPathSuffix`
- Workspace comparison code commented out (not deleted) pending future Workspace type definitions

**Testing:**
- All 899 existing tests pass
- Zero lint errors (down from 37)
- No test changes needed — demonstrates backward compatibility of type-safety improvements

**Files Modified:**
- `src/models/config.ts` — Added `CompareConfig` interface
- `src/models/resource-types.ts` — Added `armResourceType` to `ResourceTypeMetadata` and all 39 metadata entries
- `src/cli/compare-command.ts` — Fixed `buildArmBaseUrl` usage (cloudName instead of armEndpoint)
- `src/services/compare-service.ts` — Fixed all type-safety issues, disabled Workspace comparison

**Commit:** (pending)

### 2026-05-23: Build failure due to incomplete dependency install (`tsc` not found)

**Context:** `npm run build` failed immediately with `sh: 1: tsc: not found` even though `typescript` is declared in `devDependencies`.

**Root cause:** The workspace had a partial `node_modules` install that did not include full dev tooling and was missing `node_modules/.bin/tsc`.

**Resolution:** Ran `npm ci` from repository root to restore lockfile-consistent dependencies, then re-ran `npm run build` successfully.

**Pattern:** If TypeScript is declared but `tsc` is missing at runtime, verify dependency install integrity before changing code or build scripts. For this repo, use `npm ci` as the first recovery step.

