# TypeScriptDev — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.specify/memory/constitution.md` (v2.1.0)
- **User:** Elizabeth Maher
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
