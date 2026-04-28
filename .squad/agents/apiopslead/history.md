# ApiOpsLead — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.specify/memory/constitution.md` (v2.1.0) — supreme governance document
- **User:** Elizabeth Maher
- **Stack:** TypeScript 5.x, Node.js 22 LTS, Commander, `@azure/identity`, Vitest, ESLint
- **Key constraint:** No `@azure/arm-apimanagement` SDK for resource payloads — raw REST only

## Learnings

### 2025-04-09: Phase 1 Setup — Project Initialization (Issues #7, #8)

**Completed:** Issues #7 (T001) and #8 (T002) from Phase 1: Setup milestone

**What was done:**
1. Initialized Node.js project with `npm init -y` and configured `package.json`:
   - Set name to `apiops` (not apiops-cli)
   - Set version to `0.1.0` (pre-release)
   - Set `type: "module"` for ESM support
   - Set `engines.node: ">=22.0.0"` (LTS constraint)
   - Set `private: true` (not ready for npm publish)
   - Added build, test, and lint scripts (tsc, vitest, eslint)
   - Added bin entry for CLI: `./dist/cli/index.js`

2. Created `tsconfig.json` with TypeScript 5.x configuration:
   - Target: ES2022, Module: NodeNext (ESM)
   - Strict mode enabled with all recommended flags
   - Output: ./dist, Source: ./src
   - Declaration files enabled for library consumers

3. Created `.eslintrc.json` with TypeScript ESLint:
   - Extended recommended + type-aware rules
   - Configured for Node.js + ES2022
   - Set unused vars to error (with _ prefix exception)
   - Ignored dist, node_modules, config files

4. Created `vitest.config.ts`:
   - Native ESM + TypeScript support
   - Test pattern: `tests/**/*.test.ts`
   - Coverage with v8 provider (text, json, html reporters)

5. Created complete directory structure with .gitkeep files:
   - src/cli/, src/models/, src/services/, src/clients/, src/lib/
   - tests/unit/, tests/integration/, tests/contract/

**Key decisions:**
- **Package name:** `apiops` (not apiops-cli) — simpler CLI invocation
- **Module system:** ESM (`type: "module"`) — modern Node.js standard, aligns with Vitest
- **Strict TypeScript:** All strict checks enabled — catch errors early
- **No dependencies installed yet:** NodeJsDev owns dependency installation (issues #9, #10)
- **ESLint classic config:** Used .eslintrc.json (not flat config) for broader compatibility

**Files created:**
- `/package.json` (846 bytes)
- `/tsconfig.json` (663 bytes)
- `/.eslintrc.json` (792 bytes)
- `/vitest.config.ts` (393 bytes)
- Directory structure: 8 .gitkeep files in src/ and tests/ hierarchy

**Validation:** All JSON files validated with Node.js JSON.parse — zero syntax errors.

### 2025-04-09: Formalized Commit Message Convention

**What:** Codified the commit convention (include `Closes #N` or `Fixes #N` when resolving issues) into repository documentation.

**Files created:**
- `/CONTRIBUTING.md` — Comprehensive contributing guide with commit convention, dev setup, PR process, and code style
- `/.github/pull_request_template.md` — PR template with issue linking checklist
- `/.squad/decisions.md` — Decision recorded under Active Decisions

**Files updated:**
- `/.github/copilot-instructions.md` — Added commit convention note in manual additions section

**Why:** Conventions that only lived in agent memory were invisible to human contributors and new AI agents. Formalizing in repository files ensures consistency and discoverability.

**Key insight:** Repository documentation beats agent memory for long-term knowledge retention and team alignment. Conventions must be visible where contributors look for them (CONTRIBUTING.md, PR templates).

### 2026-04-09: Phase 2 Review — All Foundational Issues Verified Complete

**What:** Performed comprehensive review of all 14 Phase 2 issues (T006-T019, GitHub #12-#25) to confirm every requirement was fully implemented.

**Issues verified (all COMPLETE):**
- **#12 (T006):** ResourceType enum — 33 resource types with ARM paths, artifact dirs, info files ✅
- **#13 (T007):** Core interfaces — ResourceDescriptor, ResourcePayload, ApimServiceContext, DependencyEdge, PublishAction ✅
- **#14 (T008):** Config interfaces — ExtractConfig, FilterConfig, PublishConfig, OverrideConfig, InitConfig ✅
- **#15 (T009):** IApimClient interface — 6 methods per contract ✅
- **#16 (T010):** IArtifactStore interface — 8 methods per contract ✅
- **#17 (T011):** Dependency graph — 4 tiers, topological sort, cycle detection ✅
- **#18 (T012):** ARM URI mapping — buildArmUri/parseArmUri with workspace support ✅
- **#19 (T013):** Artifact path mapping — all 33 resource type patterns ✅
- **#20 (T014):** Structured logger — stderr, timestamps, log levels, verbose, secret sanitization ✅
- **#21 (T015):** YAML config loader — filter/override/OTel parsing with runtime validation ✅
- **#22 (T016):** Azure REST client — DefaultAzureCredential, pagination, 429 handling, retry, polling ✅
- **#23 (T017):** Filesystem artifact store — read/write JSON/XML/spec/associations/wiki, UTF-8 ✅
- **#24 (T018):** Parallel runner — bounded concurrency, Promise.allSettled, no external deps ✅
- **#25 (T019):** Commander entry point — global options, preAction hook, error handling ✅

**Also completed in this session:**
- Merged latest from main (CONTRIBUTING.md, PR template with commit convention docs)
- Verified build/lint/tests pass after merge
- Tagged commit with `Closes` for all 14 Phase 2 issues

**Key insight:** Phase 2 is the foundational layer that blocks ALL user stories. Having all 14 infrastructure components verified and tagged for auto-close ensures clean milestone tracking.

<!-- Append new learnings here after each session -->
