# DocWriter — History

## Project Context

- **Project:** apiops-cli — A CLI tool for Azure API Management operations (APIOps)
- **Stack:** TypeScript 6.x, Node.js 22.x, Commander (CLI framework)
- **Docs location:** `/docs` folder, hosted on GitHub
- **Audience:** API developers working with Azure API Management
- **Team:** ApiOpsLead (Tech Lead), ApimExpert, ApicExpert, TypeScriptDev, NodeJsDev, TestEngineer, OpenSourceExpert, CodeReviewer, AzdoExpert, GitHubExpert

## Core Context

Documentation authoring (2026-04-30 to 2026-05-17): 3-phase plan with 28 user-facing docs. Gap analysis of existing toolkit identified 8 critical topics. Phase 1: 10 docs. Phase 2-3: 18 docs. Key patterns: examples-first, Mermaid workflows, relative links, search-optimized errors. Spec-to-docs: quickstart→getting-started, APIM-RestAPI-Coverage→resource-types, data-model→artifact-format/dependency-graph.

## Learnings

<!-- Append new learnings below this line -->

### 2026-06-11: Air-Gapped Walkthroughs — GitHub Actions and Azure DevOps

**Context:** Authored two walkthrough documents for using apiops-cli in air-gapped (network-restricted) environments.

**Files Created:**
1. `docs/walkthrough/air-gapped-github-actions.md` — 8-step guide covering tarball preparation, `apiops init --cli-package`, lock file generation, npm cache transfer, self-hosted runner setup, workflow modifications for `npm ci --offline`, and upgrade procedures.
2. `docs/walkthrough/air-gapped-azure-devops.md` — 9-step guide with same core pattern plus Azure Artifacts feed as alternative to manual cache transfer, `npmAuthenticate@0` task usage, agent pool configuration, and AzureCLI@2 service connection authentication.

**Files Updated:**
- `docs/README.md` — Added walkthrough section to Quick Links table and directory tree.

**Learnings:**
- Air-gapped setups rely on `--cli-package` flag for local tarball mode, which generates `package.json` with `"file:.apiops/{tarball}"` dependency. The lock file is critical — without it, `npm ci` fails.
- Azure DevOps has a natural advantage for air-gapped setups via Azure Artifacts feeds with upstream sources (controlled sync windows). GitHub Actions environments must rely on pre-populated npm cache or vendored node_modules.
- Authentication differs: GitHub Actions in air-gapped may lose OIDC (can't reach token.actions.githubusercontent.com), requiring fallback to service principal secrets. Azure DevOps service connections work regardless since the agent-to-DevOps connectivity handles token exchange.

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

### 2026-05-17: Phase 2–3 Docs — 18 Files

**Batch4:** Azure DevOps, filtering, artifact format, config, glossary
**Batch5:** Incremental, dry-run, code-first, multi-team, migration
**Batch6:** Architecture, design, errors, debugging, recovery
**Batch7:** Dependency graph, types, exit codes, auth

**Key:** Dependency graph 31 edges (ApiDiag→Logger optional). Dry-run topological. Auth troubleshooting critical for CI/CD.

### 2026-05-16: Phase 1 Docs — 10 Files

**Files:** README, getting-started, extract, publish, init, scenarios, auth, overrides, github-actions, azure-devops

**Patterns:** Examples-first, Mermaid workflows, relative links, search-optimized errors, progressive disclosure

**Gotchas:** Auth flags set env vars (credential precedence). Overrides: names consistent, properties differ. `--commit-id`/`--delete-unmatched` exclusive.
