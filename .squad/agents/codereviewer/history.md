# CodeReviewer — History

## Project Context

- **Project:** apiops-cli — A CLI tool for Azure API Management operations (extract, publish, init)
- **Tech Stack:** TypeScript 6.x, Node.js 22+, Commander (CLI), Vitest (testing), ESLint (linting), ESM modules
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0) — 8 principles governing all development
- **Speckit Flow:** spec → plan → tasks → implement
- **Build:** `npm run build` (tsc), `npm run lint` (eslint), `npm test` (vitest)

## Learnings

### 2026-04-06: Phase 2 Foundational Code Review

**Context:** First comprehensive review of Phase 2 implementation (T006-T019). 14 files covering models, interfaces, libraries, and CLI entry point.

**Key Findings:**

1. **Secret Safety is Critical (§VIII)**  
   - Logging arbitrary objects to stderr can expose tokens, keys, and credentials  
   - Any logger implementation MUST sanitize sensitive fields before output  
   - Constitution §VIII is absolute: "Credentials MUST NOT appear in stdout, stderr, or diagnostic logs"  
   - Pattern: Sanitize `token`, `secret`, `key`, `password`, `credential`, `authorization` fields recursively

2. **Incomplete Implementations are Tech Debt**  
   - Found a "simplified implementation" comment in `resource-path.ts` that only handles "common patterns"  
   - This violates §V Simplicity if not documented as intentional scope limitation  
   - ALL incomplete logic MUST be either: (a) completed, (b) have explicit error handling, or (c) documented in plan.md as known technical debt  
   - Future: Flag any comment containing "TODO", "FIXME", "simplified", or "for now" in production code

3. **YAGNI Requires Written Justification**  
   - Found a 77-line custom `ParallelRunner` implementation  
   - Constitution §V: "Complexity MUST be justified in writing (plan.md or PR description)"  
   - If complexity is necessary (e.g., Azure rate limiting), add JSDoc explaining WHY  
   - Pattern: Any custom implementation of a feature that has a standard library alternative needs justification

4. **Type Assertions Without Validation are Unsafe**  
   - `yaml.load(content) as Record<string, unknown>` doesn't validate structure  
   - Type assertions bypass TypeScript safety but don't prevent runtime errors  
   - Pattern: After any type assertion from external input (YAML, JSON, API), add runtime validation  
   - Consider: Recommend Zod or similar schema validation library for configs

5. **Testability Requires Injectable Dependencies**  
   - Singleton exports (like `export const logger = new Logger()`) are hard to mock  
   - §VI Testability: "Sealed or static dependencies MUST be wrapped behind interfaces"  
   - Pattern: Export both the class AND a default instance; allow DI via factory or setter

6. **Strong TypeScript Discipline Observed**  
   - Zero `any` types found across all files  
   - Proper use of `never` for exhaustive switch checks  
   - Consistent `.js` extensions in imports (ESM compliance)  
   - `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` all enabled  
   - This is the standard to maintain

7. **Forward Compatibility Done Right**  
   - All APIM payloads use `Record<string, unknown>` instead of typed DTOs  
   - Satisfies §VII: "Resource bodies MUST be treated as opaque JSON trees"  
   - ResourceDescriptor separates identity (type, name, parent) from payload (json)  
   - This pattern should be enforced in all future APIM interactions

**Review Process Notes:**

- Build + lint FIRST to catch obvious issues before deep review  
- Constitution compliance is non-negotiable; code quality suggestions are negotiable  
- "Blocker" severity for constitution violations (especially §VIII security)  
- "Required" severity for correctness/completeness issues  
- "Suggestion" severity for quality/maintainability improvements  
- Always provide concrete code examples in fixes, not just prose

**Useful Commands:**
- `npm run build` — TypeScript compilation (catches type errors)
- `npm run lint` — ESLint (catches style violations)
- `npm test` — Vitest (when tests exist)

### 2026-04-09: Phase 2 Test Suite Review

**Context:** Review of 154 unit tests across 10 files under `tests/unit/`. Triggered after ceremonies.md was updated to include `tests/` in Code Review scope.

**Verdict:** ✅ APPROVED with suggestions

**Key Findings:**

1. **Constitution §VIII testing is excellent** — 14 sanitization tests in `logger.test.ts` cover all sensitive key patterns, compound key exclusions, Bearer token redaction, nested/recursive sanitization, and passthrough confirmation. This is the gold standard for security-related testing.

2. **Zero `any` types in test code** — strict TypeScript discipline maintained throughout the test suite.

3. **Proper test isolation patterns** — `os.tmpdir()` temp directories with cleanup for filesystem tests, `vi.spyOn` mocking for logger stderr, pure-promise patterns for parallel runner.

4. **CLI tests are subprocess-based** — 🟢 Suggestion: Consider adding unit-level tests importing `createProgram()` directly to reduce the ~3.2s subprocess overhead (94% of total test time).

5. **`setup.test.ts` placeholder** — 🟢 Suggestion: Remove the `expect(true).toBe(true)` placeholder now that 153 real tests exist.

6. **Ceremony gap closed** — Updated `.squad/ceremonies.md` to trigger Code Review on `tests/` changes, not just `src/`. This review is the first to exercise the new trigger.

### 2026-04-13: TestEngineer Gap Analysis Review

**Context:** Review of 24 new tests created to resolve critical coverage gaps: `tests/unit/services/api-publisher.test.ts` (20 tests) and enhancements to `tests/unit/clients/apim-client.test.ts` (4 tests).

**Verdict:** ✅ APPROVED — Tests meet all quality standards

**Key Findings:**

1. **Excellent test design for api-publisher.ts** — All 20 tests follow the mocking pattern, cover the critical execution path (revisions published in numeric order), and verify both success and error scenarios.

2. **Mock pattern consistency** — `vi.mock()` for all external dependencies, descriptor-based store mocking, mock call inspection to verify execution order. All aligned with established test patterns.

3. **429 rate-limiting tests cover spec FR-015** — Tests for Retry-After header, exponential backoff, max retries, and PUT operations. Comprehensive edge case coverage.

4. **No Constitution violations** — All tests follow §VI (isolated unit tests, no live Azure, full mock coverage). Zero `any` types. Strong TypeScript discipline maintained.

5. **Orchestration artifacts created** — TestEngineer and CodeReviewer orchestration logs, session summary, decision merged to `.squad/decisions.md`.

### 2026-04-14: Resource Path Label Implementation Review

**Context:** Review of commit d4ecb7e2d64 adding `buildResourceLabel()` utility for human-readable hierarchical paths in log messages.

**Verdict:** ✅ APPROVED — No changes required

**Key Findings:**

1. **Excellent simplicity (§V)** — 13-line function with straightforward conditional array building + join. No over-engineering, no premature abstraction.

2. **Comprehensive test coverage (§VI)** — 8 unit tests covering all combinations: top-level/child/grandchild resources with/without serviceName, edge cases for workspace omission and empty serviceName. All 467 project tests pass.

3. **Secret safety verified (§VIII)** — Resource descriptors contain only APIM metadata identifiers (API names, product names, operation names), not secret values. Named value secrets are already redacted by `secret-redactor.ts` before reaching this code path. Low risk confirmed.

4. **TypeScript strict compliance** — No `any` types, explicit `string | undefined` optional parameter, proper null checks, return type declared. Build passes with zero errors.

5. **Consistent usage pattern** — Applied uniformly across resource-extractor.ts, api-extractor.ts, and extract-service.ts. Improves log readability from "get-user" to "apim-1/petstore/get-user".

6. **Conventional Commits compliance** — Proper `feat:` type, detailed body with example, Co-authored-by trailers present.

**Pattern to remember:** For logging enhancements, verify the logged data contains no secrets (§VIII), test all code paths (§VI), and keep implementation simple (§V). Resource identifiers are safe to log; resource payloads may contain secrets.

### 2026-05-12: CodeReviewer Charter Enhancement

**Context:** ApiOpsLead completed comprehensive enhancement to CodeReviewer charter with tech-specific checks and thoroughness improvements.

**Charter Enhancements:**

1. **New "Tech-Specific Checks" section** (lines 58–111) with 8 subsections:
   - TypeScript & ESM standards (import extensions, `Record<string, unknown>`, exhaustive switches, `unknown` in catch blocks)
   - Singleton + export pattern (enables both convenience use and test mocking)
   - Error handling (custom `HttpError`, `aggregateExitCode()`, no bare throws)
   - Secret safety exhaustive (logger calls, SENSITIVE_KEY_PATTERNS, Bearer token redaction, SAS URL stripping, KeyVault preservation)
   - APIM client patterns (retry logic, Retry-After header, `noRetryOn5xx`, `allowedNonOkStatuses`, token caching)
   - Immutability (clone inputs, no shared mutable state)
   - Test patterns (Vitest, no live Azure, subprocess-based CLI tests, test file mirrors)
   - Workspace scoping (ResourceDescriptor, ARM URI builders, pipeline propagation)

2. **Enhanced review protocol (lines 24–40)**
   - Holistic understanding before line-by-line critique
   - Explicit testability patterns (injection via constructor/parameter)
   - YAGNI verification with written justification
   - Reordered critical checks (testability, YAGNI, secrets first)

3. **Updated "What I Flag" table (lines 42–56)**
   - Expanded examples with tech-specific patterns
   - New categories for architecture, naming/style, CI/CD hygiene

4. **Model preference (lines 146–151)**
   - claude-opus-4.6 as preferred for premium reasoning

5. **Voice reinforced (lines 170–179)**
   - Assumption of guilt until proven correct
   - Focus on missing code (untested branches, unhandled errors, secret leaks)
   - Brevity is not a virtue; thoroughness is the entire point

**Verdict:** ✅ Charter now serves as authoritative reference for code review standards across all project phases. Tech-specific checks operationalize historical review findings (2026-04-06 through 2026-04-14) into explicit, repeatable criteria.

**Pattern to remember:** The charter evolves as patterns emerge from actual reviews. When CodeReviewer flags something in a review that isn't yet in the charter, ApiOpsLead may enhance the charter to make the pattern explicit for future reviews.
