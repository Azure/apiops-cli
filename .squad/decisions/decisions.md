# Technical Decisions

All architectural and implementation decisions for apiops-cli.

---

### 2026-04-29: CLI version uses package.json as single source of truth via ESM import attributes
**By:** NodeJsDev  
**Status:** Implemented  
**What:** The CLI version displayed by `apiops --version` is imported from `package.json` using ESM import attributes: `import packageJson from '../../package.json' with { type: 'json' }`. The Commander program uses `program.version(packageJson.version)` instead of a hardcoded string.  
**Why:** Eliminates version drift between package.json and CLI output. Previously, version was hardcoded in `src/cli/index.ts` (".version('0.1.0')") while package.json had "0.1.3-alpha.0". Now `npm version` automatically updates the CLI version with no manual synchronization required. This is the standard pattern for Node.js CLI tools and requires no runtime dependencies — uses native Node 22+ ESM features with TypeScript's `resolveJsonModule: true`.  
**Note:** Import syntax must use `with { type: 'json' }` not `assert { type: 'json' }` — TypeScript enforces the newer import attributes syntax (TS2880 error if using `assert`).

---

### 2026-05-15: Documentation Plan Update — 8 New Topics + Spec-to-Docs Migration
**By:** DocWriter  
**Status:** Proposed  
**What:** Updated docs/plan.md with 8 new documentation topics and a spec-to-docs migration strategy covering:
- **New Topics:** Scenarios and workflows, multi-team governance, configuration priority rules, pipeline recovery, code-first workflow, APIM glossary, migration guide, configuration reference
- **Migration Strategy:** Identifies which spec files should become user-facing docs (quickstart.md → getting-started.md, APIM-RestAPI-Coverage.md → reference, data-model.md → user reference)
- **Phase Distribution:** Phase 1 expanded to include scenarios guide; Phase 2 absorbs multi-team workflows, config reference, glossary, migration guide, code-first workflow, pipeline recovery  

**Why:** Gap analysis revealed existing apiops toolkit docs emphasize workflow orientation and team collaboration patterns not reflected in CLI-focused documentation plan. Spec content (quickstart, API coverage, data model) is already 90% user-ready and should be migrated rather than rewritten.  

**Impact:** Documentation structure expands from 22 → 28 planned docs. Resequences authoring priority (scenarios guide now Phase 1). Preserves internal docs (spec.md, tasks.md, research.md, contracts/).

**Open Questions:**
1. Should quickstart.md → getting-started.md migration happen in Phase 1 (validate examples first)?
2. APIM-RestAPI-Coverage.md restructuring worth automating with script?
3. Is Phase 1 expansion acceptable, or should scenarios guide move to Phase 2?

---

### 2026-05-19: Copyright Header Enforcement
**By:** OpenSourceExpert  
**Status:** Recommendation  
**What:** Added mandatory copyright header requirement to all contributor-facing documentation:
- CONTRIBUTING.md: Added "Source file copyright headers" section with examples
- .squad/identity/constitution.md: Added copyright header requirement under "Technology Constraints"
- .github/copilot-instructions.md: Added copyright header section under "Code Style"

All new `.ts` files in `src/` and `tests/` must include:
```typescript
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
```

**Why:** Microsoft open-source projects require copyright headers on all source files for legal clarity and license attribution. The project is preparing for public release and needs consistent licensing compliance across all contributors.

**Automated Enforcement Recommendation:**
- Install `eslint-plugin-header` for automatic enforcement during `npm run lint`
- Provides auto-fix capability with `npm run lint -- --fix`
- Catches missing headers pre-commit and in CI

**Trade-offs:**
- **Pros:** Pre-commit and CI enforcement, auto-fix reduces manual work, consistent across all contributors
- **Cons:** Adds dev dependency, requires one-time migration of existing files without headers

**Next Steps:**
1. All new files MUST include the header manually
2. (Optional) Install `eslint-plugin-header` for automated enforcement before public release
3. Audit existing `.ts` files before public release

**References:**
- [eslint-plugin-header](https://www.npmjs.com/package/eslint-plugin-header)
- [Microsoft Open Source Program](https://opensource.microsoft.com/program)

---

### 2026-07-16: Issue #114 Architectural Review — Filter & Override Toolkit Alignment
**By:** ApiOpsLead  
**Status:** Approved (Follow-up required)  
**What:** Architecture review of issue #114 models, config loader, filter service, override merger, workspace extractor, transitive resolver.

**Key Findings:**

- **OverrideEntry recursive model:** Sound design, well-bounded recursion (max depth 3), no cycle risk.
- **Toolkit parity:** All 14 override sections and 16 filter fields implemented. `Workspace` filter added correctly.
- **Forward compatibility (§VII):** Clean extension points; 1–3 LOC cost per new section/relationship.
- **Override merger traversal:** 🟡 ApiOperationPolicy double-nesting gap — YAML is 3-level (`apis → operations → policies`), but `applyNestedOverride` does 2-level traversal only. Practical impact low (rare use, operation properties typically empty).
- **Filter service sub-filtering:** ✅ Correct semantics (case-insensitive matching, proper empty array handling).
- **Workspace sub-filter consumption:** ✅ Parsed correctly, consumption path can follow in separate PR.

**Verdict:** Approve. Architecture maps cleanly to Toolkit format with sound design and good extension points. ApiOperationPolicy gap is non-blocking — **file follow-up issue.**

**Constitution compliance:** §II (APIM Native), §V (YAGNI), §VI (Testability), §VII (Forward Compatibility)

---

### 2026-07-16: Issue #114 Code Review — Standards & Testability
**By:** CodeReviewer  
**Status:** Request Changes (5 required items)  
**What:** Standards review of 6 source files, 3 test files, 4 doc/template files for issue #114.

**Required Changes (🟡):**

| ID | Issue | File(s) | Principle |
|----|-------|---------|-----------|
| R1 | ApiOperationPolicy nested override lookup broken | override-merger.ts | §IV Idempotent Operations |
| R2 | Filter name case sensitivity doc/code mismatch | filtering-resources.md | §III Configuration as Code |
| R3 | Duplicate override names silently overwritten | config-loader.ts | §I CLI-First Design |
| R4 | Workspace sub-filters parsed but never consumed | config.ts, config-loader.ts, workspace-extractor.ts | §V Simplicity/YAGNI |
| R5 | Zero test coverage for nested override functionality | override-merger.test.ts, config-loader.test.ts | §VI Testability by Design |

**Details:**
- **R1:** Remove `ApiOperationPolicy` from `CHILD_OVERRIDE_MAP` or implement multi-level traversal for 3-deep nesting.
- **R2:** `matchesFilter()` uses `.toLowerCase()` (case-insensitive); update docs from "case-sensitive" to "case-insensitive."
- **R3:** Emit warning when duplicate `name` in override array; currently silently overwrites.
- **R4:** Either remove workspace sub-filter parsing/model or implement consumption in filter-service/workspace-extractor.
- **R5:** Add tests: ApiDiagnostic nested override, ApiOperation nested override, ProductPolicy nested override, config loader nested override parsing, config loader API sub-filter parsing, config loader workspace sub-filter parsing (if kept).

**Positive Observations:** All 9 files have correct copyright headers. Zero `any` types. All imports use `.js` extensions. Forward compatibility preserved (§VII). Immutability maintained. Secret safety compliant (§VIII). Error handling is actionable. Idempotent design verified (§IV). Legacy alias support with deprecation warnings. Template quality high.

**Verdict:** Well-structured implementation with good constitution compliance. R1–R5 must be resolved before merge. No blockers.

**Constitution compliance:** §I, §III, §IV, §V, §VI, §VII, §VIII

---

### 2026-06-19: Spec dialect (Swagger 2.0 vs OpenAPI 3.0) is orthogonal to APIM `apiType`
**By:** CodeReviewer  
**Status:** Approved  
**Context:** Round-trip extract→publish produced diffs on a natively Swagger 2.0 REST API.  
**Learned:**
- APIM's `properties.type` (`http`/`soap`/`graphql`/…) does **not** encode spec dialect — both Swagger 2.0 and OpenAPI 3.0 REST APIs are `type=http`. Dialect is a separate axis and must be detected, not inferred from type.
- Detect dialect from the auto-generated schema's content type: `application/vnd.ms-azure-apim.swagger.definitions+json` ⇒ Swagger 2.0, `application/vnd.oai.openapi.components+json` ⇒ OpenAPI 3.0. (Spec body itself: top-level `"swagger":"2.0"`.)
- APIM's `openapi-link` export **silently converts** Swagger 2.0 → OpenAPI 3.0, dropping parameter-level metadata (e.g. `format: int64`) and rewriting schema content types — a §VII silent-data-loss trap. Fidelity requires exporting via `swagger-link` and importing via `swagger-json` (JSON only; there is no inline Swagger YAML import format).
- Do **not** overload `apiType` with a synthetic value like `'Swagger2'`: `apiType` is a real APIM property echoed back on PUT and validated, so it must stay within the type enum. Carry dialect as its own parameter/type instead.
- Swagger 2.0 path parameters use the inline shape `{ name, in, required, type }`; OpenAPI 3.x wraps it as `{ ..., schema: { type } }`. Any injected/sanitized params must match the document's dialect.
**Decision:** Introduced `ApiSpecDialect = 'openapi3' | 'swagger2'` as a first-class, detected axis threaded through export and import; preferred an explicit dialect type over a boolean or an overloaded `apiType`.  
**Constitution compliance:** §II (APIM-native formats), §VII (no silent round-trip loss)

---
