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

### 2026-06-02: Named Value Token Canonicalization — Broadened Scope
**By:** ApimExpert  
**Status:** Implemented  

The initial fix for named value token canonicalization only applied to Logger resources. Backend resources also contain `{{namedValue}}` tokens in `credentials.header`, `credentials.query`, and `credentials.authorization.parameter`, and require the same casing-sensitive normalization.

**Decision:** Generalize the normalization logic to canonicalize ALL `{{token}}` references across ANY resource type's entire JSON payload.
- Renamed function: `normalizeLoggerCredentialNamedValueReferences` → `normalizeNamedValueReferences`
- Removed Logger-specific resource type check; now applies to all resources
- Recursive traversal handles unknown properties (Constitution §VII)
- Implementation: `src/services/resource-publisher.ts`
- Tests: Backend credential test added + all 910 tests pass

**Rationale:** Backend credentials are affected today, not hypothetical. Future-proof for any new APIM resource types that support named value tokens.

**Evidence:** Azure APIM REST API spec shows Backend credentials support `{{namedValue}}` references in authorization parameters, headers, and query strings. User report confirmed: "Named value pairs maybe used for other resources!"

---

### 2026-06-02: Extend Named Value Token Normalization to Backend Resources
**By:** TestEngineer  
**Status:** Audit Complete  

Audit identified that named value token normalization only covered Logger resources, leaving Backend credentials vulnerable to APIM validation failures when override casing differs from artifact naming.

**Findings:**
- Backend resources contain `{{namedValue}}` tokens in `credentials.header`, `credentials.query`, and `credentials.authorization.parameter`
- Example: override supplies `{{Bearer-Token}}` but artifact is named `bearer-token` → APIM rejects PUT
- Skipped test added: `should canonicalize backend credential named value references from overrides` (test code in resource-publisher.test.ts)

**Recommendation:** Extend normalization logic to Backend resources. Generalized approach (apply to all resource types) preferred over Backend-specific implementation.

**Priority:** P2 (Medium) — Valid production use case but workaround exists (manual casing in overrides).

---
