# DocWriter — History

## Project Context

- **Project:** apiops-cli — A CLI tool for Azure API Management operations (APIOps)
- **Stack:** TypeScript 6.x, Node.js 22.x, Commander (CLI framework)
- **Docs location:** `/docs` folder, hosted on GitHub
- **Audience:** API developers working with Azure API Management
- **Team:** ApiOpsLead (Tech Lead), ApimExpert, ApicExpert, TypeScriptDev, NodeJsDev, TestEngineer, OpenSourceExpert, CodeReviewer, AzdoExpert, GitHubExpert

## Learnings

<!-- Append new learnings below this line -->

### 2026-05-17: Phase 2 Docs — Azure DevOps, Filtering, Artifact Format, Config Reference, Glossary

**Context:** Authored five Phase 2 documentation files completing CI/CD coverage, resource filtering guide, artifact format reference, configuration reference, and APIM glossary.

**Files Created:**
1. `docs/ci-cd/azure-devops.md` — Full Azure DevOps integration guide sourced from actual pipeline templates in `src/templates/azure-devops/`. Covers extract pipeline (manual trigger, AzureCLI@2, branch creation), publish pipeline (multi-stage with per-env variable groups and service connections), environment approval gates, and customization tips.
2. `docs/guides/filtering-resources.md` — All 16 filterable resource types from `FilterConfig`. Transitive dependency behavior with Mermaid diagram, `--no-transitive` flag, and common patterns.
3. `docs/reference/artifact-format.md` — Full directory layout from all 34 `ResourceType` entries. Three metadata tables, JSON info file structure, policy XML scopes, and naming conventions.
4. `docs/reference/configuration.md` — Priority chain with Mermaid diagram, all CLI flag tables, environment variables, YAML config references, and defaults.
5. `docs/reference/apim-glossary.md` — 16 APIM concepts with definitions, Microsoft Docs links, and artifact file locations.

**Learnings:**
- Azure DevOps templates are TypeScript string generators, not static YAML. Uses both `${{ parameters.X }}` template expressions and `$(VARIABLE)` macro syntax.
- Publish pipeline generates sequential stages via `dependsOn` chaining. Each env gets its own variable group (`apim-{env}`) and service connection (`AZURE_SERVICE_CONNECTION_{ENV}`).
- `RESOURCE_TYPE_METADATA` has 34 entries. Some have `infoFile: null` (ApiOperation, ProductTag). McpServer is a singleton per API for Model Context Protocol.
- `listOmitsFields` on ApiSchema/ApiRelease is internal detail — not user-facing but noted for accuracy.

### 2026-05-17: Phase 2 Guide Docs— Incremental Publish, Dry-Run, Code-First, Multi-Team, Migration

**Context:** Authored five guide documentation files for Phase 2.

**Files Created:**
1. `docs/guides/incremental-publish.md` — How `--commit-id` triggers git-diff-based publishing, Mermaid flow diagram, git status mapping table, CI/CD examples (GitHub Actions + Azure DevOps), fetch-depth gotcha, mutual exclusivity with `--delete-unmatched`.
2. `docs/guides/dry-run-workflow.md` — `--dry-run` mode behavior, text and JSON output formats, PR review workflow with GitHub Actions comment posting, combination matrix with other flags, best practices.
3. `docs/guides/code-first-workflow.md` — Day-in-the-life guide for IDE-first API development, artifact directory structure with hand-authored examples (apiInformation.json, OpenAPI spec, policy.xml, backend), override usage, CI/CD pipeline templates.
4. `docs/guides/multi-team-workflows.md` — Three patterns (selective extraction, monorepo, polyrepo) with CODEOWNERS integration, scoped pipelines, shared resource ownership table, anti-patterns, and pattern comparison matrix.
5. `docs/guides/migration-from-v1.md` — v1→v2 comparison table, 6-step migration process, pipeline migration examples (GitHub Actions + Azure DevOps), configuration file mapping, new features to adopt, troubleshooting table.

**Learnings:**
- The `git-diff-service.ts` uses the Git empty-tree SHA (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`) for first-commit diffs — documented as "treats all files as added" without exposing implementation detail.
- Dry-run reporter processes in topological order via `getTopologicalOrder()` — important for users to know that the preview mirrors real publish order.
- `hasMutuallyExclusivePublishOptions()` enforces the `--commit-id` / `--delete-unmatched` exclusion at CLI level with exit code 2 — documented prominently in both incremental-publish and multi-team guides.
- The v1 toolkit's filter YAML format (`apiNames`, `backendNames`) is structurally compatible with v2 — simplifies migration messaging (just rename the file).

### 2026-05-17: Phase 2-3 Architecture & Troubleshooting Docs

**Context:** Authored five documentation files for Phases 2-3 covering architecture and troubleshooting.

**Files Created:**
1. `docs/architecture/overview.md` — High-level system design with 3 Mermaid diagrams (component diagram, extract flow, publish flow), layer descriptions, CLI entry point details, authentication chain, and key behaviors for extract/publish.
2. `docs/architecture/design-principles.md` — All 8 constitution principles (§I-§VIII) with "What This Means" and "For Contributors" sections per principle, plus precedence rules.
3. `docs/troubleshooting/common-errors.md` — 14 searchable error entries organized by category (auth, config, publish, runtime) with Cause → Solution format and code examples.
4. `docs/troubleshooting/debugging-guide.md` — Diagnostic tools (`--log-level debug`, `--dry-run`, `--format json`, artifact inspection), 6-step diagnostic checklist, log level reference, sanitization details, and 4 common debugging scenarios.
5. `docs/troubleshooting/pipeline-recovery.md` — 5 CI/CD failure scenarios (partial publish, failed incremental, failed delete-unmatched, auth expiry, timeout) with recovery steps, prevention checklist, and 2 Mermaid decision/flow diagrams.

**Learnings:**
- Architecture docs serve dual audiences (contributors + advanced users). Used progressive disclosure: high-level diagram first, then layer table, then per-flow details with Mermaid.
- Design principles doc is contributor-focused — "For Contributors" sections translate abstract principles into actionable rules. Precedence section prevents principle conflicts.
- Troubleshooting docs are search-optimized — error messages as exact headings so GitHub search matches real error text users paste.
- Pipeline recovery is CI/CD-platform-aware — includes GitHub Actions and Azure DevOps specific instructions.
- Log output separation (stdout=data, stderr=logs) is critical for CI/CD users — documented explicitly with redirect examples.

### 2026-05-17: Phase 3 Reference & CI/CD Docs — Dependency Graph, Resource Types, Exit Codes, Auth Patterns

**Context:** Authored four Phase 3 documentation files covering technical reference material and CI/CD authentication.

**Files Created:**
1. `docs/reference/dependency-graph.md` — Full 4-tier dependency graph with all 31 edges, comprehensive Mermaid diagram using color-coded tiers (blue/green/yellow/red), solid vs. dashed arrows for required vs. optional deps, edge table, and practical implications for publish ordering and failure cascading.
2. `docs/reference/resource-types.md` — All 34 supported resource types organized by category (Service-Level, Product, API, Gateway). Each entry includes ARM path, artifact directory pattern, info file name, and user-facing description. Includes notes on LIST API limitations (listOmitsFields) and example directory tree.
3. `docs/reference/exit-codes.md` — Exit codes 0/1/2 with aggregation logic, bash/PowerShell usage examples, GitHub Actions and Azure DevOps CI/CD integration patterns for handling partial failures, and troubleshooting table.
4. `docs/ci-cd/authentication-patterns.md` — Five auth patterns (OIDC, Azure DevOps service connection, service principal, managed identity, sovereign clouds) with comparison table, Mermaid sequence diagram, Azure setup commands, pipeline YAML examples, RBAC requirements, and troubleshooting table for common Entra ID errors.

**Learnings:**
- The dependency graph has 31 edges (not 30) — ApiDiagnostic→Logger is an optional edge easily missed. Always cross-reference the source DEPENDENCY_EDGES array against the tier assignments.
- Resource types documentation benefits greatly from the example directory tree — abstract path patterns like `apis/{0}/operations/{1}` become concrete when users see a real tree. Progressive disclosure: tables first, example tree at the end.
- Authentication troubleshooting table is high-value — users hitting AADSTS errors in CI/CD pipelines need the error code → fix mapping immediately. Structured as error/cause/fix columns for scannability.
- Sovereign cloud documentation is thin but critical — users in government/China clouds need the `--cloud` flag reference or they get silent auth failures against the wrong ARM endpoint.

### 2026-05-16: Phase 1 Guide Docs — Scenarios, Authentication, Overrides, GitHub Actions

**Context:** Authored four guide/integration documentation files for Phase 1.

**Files Created:**
1. `docs/guides/scenarios-and-workflows.md` — Portal-first vs. code-first workflow comparison with Mermaid diagrams, comparison table, hybrid scenarios, and common artifact format explanation.
2. `docs/guides/authentication.md` — Full DefaultAzureCredential chain, CLI auth flags reference, per-context sections (local dev, service principal, GitHub OIDC, Azure DevOps, managed identity, sovereign clouds), RBAC roles, and troubleshooting table.
3. `docs/guides/environment-overrides.md` — All 5 override resource types (namedValues, backends, apis, diagnostics, loggers) with per-property tables, Key Vault integration, multi-environment directory layout, override rules (names vs. properties), and common gotchas.
4. `docs/ci-cd/github-actions.md` — Extract and publish workflow walkthroughs sourced from actual template code, OIDC federated credential setup, environment/secrets configuration, customization tips, and troubleshooting.

**Learnings:**
- The publish workflow template generates per-environment jobs dynamically from the `environments` array in `PublishWorkflowConfig`. Documented the pattern concretely (dev/prod) rather than showing template internals.
- CLI auth flags (`--client-id`, `--client-secret`, `--tenant-id`) set env vars via the `preAction` hook — important for users to understand credential precedence.
- Override rules "names must be consistent, properties can differ" is a critical gotcha from the gap analysis that needs prominent placement — put it in its own section with ✅/❌ examples.

### 2026-05-16: Phase 1 Command Reference Docs — extract, publish, init

**Context:** Created three command reference docs in `/docs/commands/`: `extract.md`, `publish.md`, and `init.md`.

**Key Decisions:**
1. **Structure consistency:** All three docs follow the same pattern — Synopsis → Examples → Flags tables → Behavior details → Exit codes → Related docs. This makes the command reference predictable and scannable.
2. **Examples first:** Each doc leads with 4–6 practical examples before diving into flag tables, matching our examples-first writing principle.
3. **Global flags shown but not over-explained:** Global flags (auth, log-level, format, cloud) are listed in each command doc for completeness but authentication details link to the auth guide rather than duplicating content.
4. **Mutual exclusivity called out:** `publish.md` prominently notes that `--commit-id` and `--delete-unmatched` are mutually exclusive, since this is a common gotcha.
5. **Mermaid diagram:** Included the init command flow diagram showing TTY detection → conflict handling → file generation, as specified in the plan.
6. **Cross-references:** All three docs link to each other and to guides/ and ci-cd/ docs (auth, filtering, overrides, GitHub Actions, Azure DevOps). Links use relative paths per our convention.
7. **Package consumption modes:** Documented both public npm and local tarball modes in init.md per the dual-mode decision (2026-04-29).

**Source material used:** Task prompt with full flag definitions, filter/override YAML schemas, behavior specs, and exit codes. Cross-referenced with decisions.md for accuracy (dual-mode package consumption, --log-level replacing --verbose).

**Next Steps:** Continue Phase 1 authoring — getting-started guide, authentication guide, and CI/CD integration docs.

### 2026-05-16: Phase 1 Docs Authored — Landing Page and Getting Started Guide

**Context:** Created the two Phase 1 documentation files: `/docs/README.md` (landing page) and `/docs/getting-started.md` (quickstart guide).

**What was created:**

1. **`/docs/README.md`** — Documentation landing page with:
   - One-sentence value proposition hero
   - Quick links table (Getting Started, Command Reference, CI/CD)
   - Mermaid flowchart showing extract → version control → publish flow
   - Key features list (7 items covering APIM coverage, filtering, overrides, incremental publish, dry-run, init, auth)
   - Full documentation directory tree showing all planned files
   - Next steps link to getting-started.md

2. **`/docs/getting-started.md`** — Quickstart guide adapted from `specs/quickstart.md` with:
   - Prerequisites table (Node.js 22+, Azure CLI, RBAC roles)
   - Install section with correct `@peterhauge/apiops-cli` package name
   - 7-step walkthrough: extract → inspect → filter → publish → dry-run → init → incremental CI/CD
   - `--subscription-id` added to all examples (required unless env var set)
   - Exit codes table
   - What's Next section with links to commands/, guides/, ci-cd/

**Key decisions applied:**
- Package name: `@peterhauge/apiops-cli` (not `@apiops/cli` from old spec)
- All examples include `--subscription-id` (per CLI requirements)
- Relative links for all cross-references (per decisions.md D5)
- Mermaid diagram over static image (per decisions.md D8)
- Examples-first writing style (per decisions.md D7)

**Adaptations from specs/quickstart.md:**
- Fixed package name throughout
- Added prerequisites section with RBAC roles
- Added "Inspect the Extracted Files" step for orientation
- Added `--subscription-id` to every command example
- Added environment variable tip for AZURE_SUBSCRIPTION_ID
- Added exit codes reference table
- Added comprehensive What's Next navigation table
- Restructured as numbered steps for progressive disclosure

### 2026-05-15: Documentation Plan Update — Gap Analysis Integration and Spec-to-Docs Migration

**Context:** Updated `/docs/plan.md` to incorporate 8 new documentation topics identified through gap analysis, plus added a comprehensive spec-to-docs migration strategy.

**New Topics Integrated (Prioritized by Phase):**

**Phase 1 additions:**
1. **guides/scenarios-and-workflows.md** — Portal-first vs Code-first workflows with Mermaid diagrams. Critical for user orientation (added as item #3 in authoring order).
2. **Override rules section** — Folded into existing `guides/environment-overrides.md`. Documents that resource NAMES must be consistent across environments but PROPERTIES can be overridden (added to item #9 description).

**Phase 2 additions:**
3. **guides/multi-team-workflows.md** — Selective extraction per team, monorepo vs polyrepo patterns, CODEOWNERS integration (#20 in authoring order).
4. **reference/configuration.md** — Config priority chain (CLI flags → env vars → YAML files) (#14 in authoring order).
5. **troubleshooting/pipeline-recovery.md** — Failed CI/CD run recovery scenarios (#24 in authoring order).
6. **guides/code-first-workflow.md** — Day-in-the-life: IDE → git → CI/CD → APIM (#19 in authoring order).
7. **reference/apim-glossary.md** — APIM terminology primer for developers new to APIM (#13 in authoring order).
8. **guides/migration-from-v1.md** — Migration guide from Azure/apiops toolkit to apiops-cli (#21 in authoring order).

**Structural Changes:**
- Updated directory tree with all 8 new files in appropriate locations
- Added 10 rows to Content Inventory tables (8 new files + 2 new Mermaid diagrams)
- Resequenced authoring order from 22 → 28 items, maintaining phase groupings
- Resolved Open Question #3: YES, migration guide is needed despite backward compatibility
- Added two new Mermaid diagram specs for scenarios guide (portal-first and code-first flows)

**Spec-to-Docs Migration Strategy:**

Added new section documenting which spec files should become user-facing docs:

**High-priority migrations:**
- `specs/quickstart.md` → `docs/getting-started.md` (90% ready, needs light tone adjustment)

**Medium-priority adaptations:**
- `specs/APIM-RestAPI-Coverage.md` → `docs/reference/resource-types.md` (major editing: remove internal v1/v2 comparison columns, add user-friendly descriptions)
- `specs/data-model.md` ResourceType table → `docs/reference/artifact-format.md` (extract directory layout, add prose and examples)

**Low-priority extractions:**
- `specs/data-model.md` DependencyGraph → `docs/reference/dependency-graph.md` (visualize as Mermaid, remove algorithm internals)

**Files staying in specs/ (not user-facing):**
- spec.md, tasks.md, research.md, v1-research-report.md, checklists/, contracts/

**Content Transformation Guidelines:** Documented 5 principles for adapting spec content to user docs (remove internal rationale, add user-friendly descriptions, link to Microsoft Docs, show examples, reorganize for scannability).

**Key Insight:** The existing toolkit documentation (azure.github.io/apiops) is scenario-heavy but pipeline-centric. Our docs should be CLI-centric with richer command references, but we were missing critical workflow guidance (portal-first vs code-first, multi-team governance, migration path). These 8 additions close the gap.

**Next Steps:**
- Await team review of updated plan structure
- Begin Phase 1 authoring with scenarios guide as item #3 (after getting-started)
- Prioritize quickstart.md → getting-started.md migration (nearly ready to publish)

### 2026-05-14: Research — Existing APIOps Toolkit Documentation Audit

**Context:** Analyzed the existing Azure/apiops toolkit documentation (https://github.com/Azure/apiops and https://azure.github.io/apiops/) to identify topics we should consider adding to our apiops-cli documentation plan.

**Existing Toolkit Documentation Structure:**

The existing toolkit has two documentation sources:
1. **GitHub Pages Guide** (azure.github.io/apiops/) — Scenario-based, hands-on lab format with 8 main sections
2. **GitHub Wiki** — Resource-focused deep dives on specific configurations

**Documentation sections in existing toolkit:**
- **0-labPrerequisites:** Basic APIM concepts, prerequisites
- **1-supportedScenarios:** Portal-first vs Code-first workflows, resource type coverage table
- **2-apimCreation:** APIM instance provisioning
- **3-apimTools:** Extractor and Publisher tool deep dives, installation, parameters, GitLab examples
- **4-extractApimArtifacts:** Running extractor pipelines (Azure DevOps and GitHub Actions)
- **5-publishApimArtifacts:** Running publisher pipelines with configuration overrides
- **6-supportingIndependentAPITeams:** Multi-team workflows, selective extraction, CODEOWNERS, .gitignore patterns
- **7-additionalTopics:** Repo contents reference, failed build recovery, supported resources list
- **8-contributing:** Contribution guides

**Key Topics They Cover That We Don't:**

1. **Portal-First vs Code-First Workflows** — Two distinct user personas (portal users vs IDE users) with different adoption patterns
2. **Multi-Team / Decentralized APIM** — How different teams manage different APIs within a single APIM instance using selective extraction, separate repos, or CODEOWNERS
3. **Failed Build Recovery** — How to recover from failed publisher runs (with vs without deleted artifacts), manual re-runs, commit ID handling
4. **Versioning and Binary Distribution** — How updates are delivered (v3.0.0+ hosts binaries on GitHub releases vs self-hosting)
5. **Sample Artifacts Reference** — A sample artifact directory structure as a working example
6. **APIM Basic Concepts Primer** — Brief overview of APIM terminology (APIs, Products, Backends, Named Values, etc.) for users new to APIM
7. **Repo Contents Reference** — What each folder/file in the repo does (pipelines, scripts, config files)
8. **GitLab Support Examples** — Community-contributed GitLab pipeline examples
9. **Supporting Tools Reference** — Link to APIM Dev Portal migration tool (out of scope for APIOps but documented for completeness)
10. **Video Walkthroughs** — Embedded YouTube videos (360° overview, step-by-step multi-environment setup)

**Documentation Style Observations:**
- Heavy use of screenshots (pipeline configuration, Azure portal, PR flows)
- Scenario-driven narrative: "You are setting up dev/qa/prod..."
- Explicit version guidance (< v3.0.0 vs >= v3.0.0)
- Clear gotchas and warnings highlighted throughout
- Resource type coverage table (Operation Group, Description, Implemented in APIOps?)

**What We Already Cover Well:**
- Getting started guide ✅
- Command references (extract, publish, init) ✅
- Authentication patterns ✅
- CI/CD integration (GitHub Actions, Azure DevOps) ✅
- Environment overrides ✅
- Filtering resources ✅
- Incremental publish ✅
- Artifact format reference ✅
- Troubleshooting / debugging ✅

**Comparison Notes:**
- Our plan is more **CLI-centric** (command references, flags, examples) whereas existing toolkit is **pipeline-centric** (YAML pipelines, manual triggers, service connections)
- Our architecture is **simpler** (single CLI binary) vs existing toolkit (separate extractor/publisher binaries + pipelines)
- We document **init command** for scaffolding, which existing toolkit doesn't have
- Existing toolkit has **richer scenario guidance** (portal-first, code-first, multi-team) which we could adapt

### 2026-05-13: Documentation Planning — Scope Advisory and Structure Decisions

**Context:** Collaborated with ApiOpsLead on documentation scope and roadmap. Created comprehensive `/docs/plan.md` with 22-page structure covering 6 directories, 4 Mermaid diagrams, and 3-phase authoring strategy.

**Key Accomplishments:**

1. **Documentation Plan Structure:** Organized user-facing docs into logical directories:
   - `commands/` — One file per CLI command (extract, publish, init)
   - `guides/` — Task-oriented how-to content (filtering, overrides, authentication)
   - `ci-cd/` — Platform-specific integration (GitHub Actions, Azure DevOps)
   - `reference/` — Technical deep material (artifact format, resource types, exit codes)
   - `architecture/` — System design and Constitution principles
   - `troubleshooting/` — Problem-solution guides with searchable error patterns

2. **Landing Page Strategy:** `/docs/README.md` serves as GitHub-native navigation hub with Mermaid extract→publish→version control flow diagram. GitHub displays README.md automatically when browsing `/docs` folder, making it the front door for documentation.

3. **Scope Alignment:** Documented what's ready NOW (extract, publish, init, CI/CD integration) vs. what to defer (Phase 8 features like `--otel` and `--spec-format`). Base decision on code existence and task completion status, not wishlist features.

4. **Authoring Roadmap:** Prioritized by user value:
   - Phase 1: Getting Started Guide (init → extract → publish → CI/CD) — removes adoption friction
   - Phase 2: Extract + Publish references + Configuration docs — enables core workflows
   - Phase 3: Advanced guides, reference material, architecture docs — fills knowledge gaps

5. **Writing Style Guidelines:**
   - Examples-first: show working commands, then explain
   - Assume competence: readers know HTTP, REST, JSON, YAML, git, CI/CD
   - Relative links only: works on GitHub and locally cloned repos
   - Mermaid diagrams over static images: version-controlled, GitHub-native

6. **Key Architectural Decisions:**
   - One command = one doc file (mirrors CLI structure)
   - User-facing only (no internal architecture documentation)
   - Document BOTH GitHub Actions AND Azure DevOps equally
   - Emphasize artifact directory flexibility (user chooses path, default only as fallback)
   - Multiple authentication methods with context-specific guidance

**ApiOpsLead Scope Input:**
- Analyzed feature completion from `specs/spec.md` and `specs/tasks.md`
- Identified Phase 3 (Extract) tasks as stale in tasks.md but code exists
- Confirmed Phase 4 (Publish), Phase 5 (CI/CD), Phase 6 (Init) all marked complete
- Flagged Phase 7-8 (Extensibility, Polish) as not implemented — don't document yet

**Output Artifacts:**
- `/docs/plan.md` — 22-page comprehensive documentation structure and strategy
- `.squad/decisions/inbox/apiopslead-docs-scope.md` → merged to decisions.md
- `.squad/decisions/inbox/docwriter-docs-plan.md` → merged to decisions.md

**Key Insight:** Documentation quality depends on scope discipline. Document only what's implemented and stable. Avoid speculative docs for unimplemented features — they create confusion and require rework. Phase 8 features (OTel, spec-format) are spec'd but not coded; documenting them now would be a documentation debt burden later.

**Next Steps:**
- Await team review approval (ApiOpsLead, ApimExpert, OpenSourceExpert, GitHubExpert)
- Upon approval, begin Phase 1 authoring: landing page, getting started, authentication guide
- Set up link validation to catch broken cross-references
- Solicit early team feedback on writing style and example clarity



### 2026-04-30: Initial Documentation Plan

**Context:** Created comprehensive documentation plan for apiops-cli in `/docs/plan.md`.

**Key Decisions:**

1. **Directory Structure:** Organized docs into logical segments:
   - `commands/` — One file per CLI command (extract, publish, init)
   - `guides/` — Task-oriented how-to guides (filtering, overrides, authentication)
   - `ci-cd/` — Platform-specific integration guides (GitHub Actions, Azure DevOps)
   - `reference/` — Deep technical material (artifact format, resource types, exit codes)
   - `architecture/` — System design and Constitution principles
   - `troubleshooting/` — Problem-solution guides

2. **Landing Page Strategy:** `/docs/README.md` serves as navigation hub with Mermaid architecture diagram showing extract → version control → publish flow. GitHub displays README.md by default when browsing `/docs`.

3. **Authoring Priority:** Phase 1 (MVP) focuses on getting-started, command references, authentication, and GitHub Actions integration — the critical path for new users.

4. **Mermaid Diagrams:** Prefer Mermaid over static images for version control and GitHub native rendering. Planned diagrams:
   - Extract/publish flow (landing page)
   - Resource dependency graph (reference docs)
   - Authentication flow (CI/CD guides)
   - Init command decision tree

5. **Writing Style:** Examples-first approach — show working code, then explain. Assume API developer competence (no over-explaining HTTP, REST, YAML basics). Active voice, imperative mood, scannable structure.

**Key File Paths:**
- Main plan: `/docs/plan.md`
- Landing page: `/docs/README.md` (to be created)
- Core spec: `/specs/spec.md` (26KB, read in sections)
- Data model: `/specs/data-model.md` (comprehensive resource type definitions)

**Product Architecture Insights:**
- Three core commands: `apiops extract` (APIM → files), `apiops publish` (files → APIM), `apiops init` (scaffold repo/pipelines)
- Supports all APIM resource types: APIs, products, backends, named values, policies, loggers, diagnostics, tags, policy fragments, version sets, gateways, groups, subscriptions, schemas, GraphQL resolvers
- Filtering with transitive dependency resolution (backends/named values auto-included when APIs reference them)
- Environment overrides for dev/staging/prod deployment patterns
- Incremental publish via git diff (only changed resources deployed)
- Dry-run mode for change preview
- DefaultAzureCredential authentication chain (managed identity, workload identity, service principal, Azure CLI)
- Backward compatibility with v1 APIOps artifact layout (success criteria SC-006)

**Open Questions for Team:**
- Auto-generate reference/resource-types.md from data-model.md? (maintenance vs. build complexity)
- Migration guide needed if backward compatibility is guaranteed?
- Versioned docs strategy for future breaking changes?
