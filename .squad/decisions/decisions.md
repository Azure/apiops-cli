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
