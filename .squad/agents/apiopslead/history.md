# ApiOpsLead — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0) — supreme governance document
- **User:** Elizabeth Maher
- **Stack:** TypeScript 6.x, Node.js 22 LTS, Commander, `@azure/identity`, Vitest, ESLint
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

### 2026-05-01: CodeReviewer Charter Enhancement

**What:** Rewrote the CodeReviewer charter (`.squad/agents/codereviewer/charter.md`) sections 3-8 to make reviews significantly more thorough and project-specific.

**Changes made:**
1. **How I Work** — Expanded from 7 generic steps to 13 concrete, ordered steps. Added holistic diff reading, team decisions check, TypeScript strictness verification, error handling review, missing test detection, and naming consistency checks.
2. **What I Flag** — Expanded from 6 categories to 11, adding: secret/credential leak specifics, TypeScript strictness, error handling, immutability violations, architecture patterns, naming/style.
3. **Tech-Specific Checks** — NEW section with 8 subsections: TypeScript & ESM, Singleton + Export Pattern, Error Handling, Secret Safety, APIM Client Patterns, Immutability, Test Patterns, Workspace Scoping. Each item has severity level annotations.
4. **Severity Levels** — Added concrete examples to each level, added escalation rule (3+ blockers → architectural discussion).
5. **Boundaries** — Added "What I never wave through" clause, strengthened rejection output requirements, added "uncertainty is not an excuse to skip" principle.
6. **Collaboration** — Added post-review protocol: severity-ordered findings, file/line references, concrete fix suggestions, assessment summary.
7. **Voice** — Added three paragraphs reinforcing thoroughness over brevity, guilty-until-proven-correct mindset, and checking for what's *missing* not just what's *wrong*.
8. **Constitution path** — Fixed all references from `.specify/memory/constitution.md` to `.squad/identity/constitution.md`.

**Why:** CodeReviewer was missing codebase-specific checks that external reviewers (Copilot) were catching. The charter now encodes this project's actual patterns (ESM `.js` extensions, `Record<string, unknown>` payloads, `HttpError` status branching, `SENSITIVE_KEY_PATTERNS`, singleton+class export, etc.) so the reviewer can't miss them.

**Key insight:** A generic "enforce TypeScript strict mode" instruction is useless if the reviewer doesn't know the specific patterns to look for. Project-specific checklists with severity annotations turn a reviewer from "looks fine to me" into a systematic quality gate.

### 2026-05-01: Charter Enhancement Priority Analysis

**What:** Analyzed all 8 non-CodeReviewer charters to identify inaccuracies, generic content, and missing codebase-specific patterns. Produced a prioritized recommendation table for charter improvements modeled on the CodeReviewer enhancement.

**Key findings:**
1. **TypeScriptDev** has an outright inaccuracy: claims `noUncheckedIndexedAccess` in tsconfig.json — it's not there. Also lists target as "ESNext" when actual target is ES2022.
2. **TestEngineer** is the most generic — could apply to any Vitest project. Missing all project-specific mocking patterns, test structure conventions, and coverage thresholds.
3. **NodeJsDev** lacks reference to actual exit code constants (`EXIT_SUCCESS/PARTIAL/FATAL`) and the real `init-service.ts` implementation patterns.
4. **ApimExpert** and **AzdoExpert/GitHubExpert** are moderately generic but less impactful since they're advisory roles that consult docs.
5. **OpenSourceExpert** and **ApicExpert** are lowest priority — advisory/forward-looking roles where generic guidance is acceptable.

**Key insight:** Charters for code-producing agents (TypeScriptDev, TestEngineer, NodeJsDev) benefit most from codebase-specific enhancement because inaccuracies or gaps directly affect code quality. Advisory agents (OpenSourceExpert, ApicExpert) can remain more generic without harm.

<!-- Append new learnings here after each session -->

### 2026-05-01: Enhanced 7 Agent Charters with Codebase-Specific Patterns

**What:** Applied the CodeReviewer charter enhancement pattern to all 7 remaining charters, making each codebase-aware with actual file paths, patterns, and team decisions.

**Charters enhanced:**
1. **TypeScriptDev** — Fixed inaccurate tsconfig claims (`noUncheckedIndexedAccess` removed, `ESNext` → `ES2022`), added correct strict flags, added "Tech-Specific Patterns" section with ESM, singleton+class export, error handling, interface-first design, opaque payloads, and key file paths table
2. **TestEngineer** — Added "Codebase-Specific Testing Patterns" section with Vitest conventions, `IApimClient`/`IArtifactStore` mock interfaces, exit code testing, CLI subprocess tests, filesystem cleanup, error testing patterns, and review checklist
3. **NodeJsDev** — Added "Codebase-Specific Patterns" section with exit code constants, ESM requirements, CLI entry point structure, dual-mode package consumption, generated template directories, and log-level decision
4. **ApimExpert** — Added "Codebase Patterns" section with key source files table, `HttpError` pattern, retry/failure patterns, token caching, SOAP/WADL extraction, synthetic GraphQL detection, ARM URI construction, and 4 key decisions
5. **AzdoExpert** — Added "Project-Specific Patterns" section with template source references, `apiops init` integration, and variable group conventions
6. **GitHubExpert** — Added "Project-Specific Patterns" section with workflow file table, OIDC federation pattern, generated template references, and repo configuration
7. **ApiOpsLead** — Added "What I Check" section with structural integrity, constitution alignment checklist, key decisions, and key file paths table; constitution path was already correct

**Also fixed across all charters:**
- Constitution path references updated to `.squad/identity/constitution.md` where stale
- Collaboration sections updated to reference both constitution and decisions.md

**Key insight:** The most impactful enhancements are on code-producing agents (TypeScriptDev, TestEngineer, NodeJsDev) where inaccurate or missing patterns directly cause code quality issues. The TypeScriptDev charter had two outright inaccuracies that would have led agents to write code targeting wrong settings.
