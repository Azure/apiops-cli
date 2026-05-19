# DocWriter — History

## Project Context

- **Project:** apiops-cli — A CLI tool for Azure API Management operations (APIOps)
- **Stack:** TypeScript 6.x, Node.js 22.x, Commander (CLI framework)
- **Docs location:** `/docs` folder, hosted on GitHub
- **Audience:** API developers working with Azure API Management
- **Team:** ApiOpsLead (Tech Lead), ApimExpert, ApicExpert, TypeScriptDev, NodeJsDev, TestEngineer, OpenSourceExpert, CodeReviewer, AzdoExpert, GitHubExpert

## Core Context

Documentation authoring (2026-04-30 to 2026-05-17): 3-phase plan with 28 user-facing docs. Gap analysis of existing toolkit identified 8 critical topics. Phase 1: 10 docs. Phase 2-3: 18 docs. Key patterns: examples-first, Mermaid workflows, relative links, search-optimized errors. Spec-to-docs: quickstart→getting-started, APIM-RestAPI-Coverage→resource-types, data-model→artifact-format/dependency-graph.

**Phase 1 (10 docs):** README, getting-started, extract, publish, init, scenarios-and-workflows, authentication, environment-overrides, github-actions ci/cd guide, azure-devops ci/cd guide.

**Phase 2-3 (18 docs):** Azure DevOps integration, filtering-resources, artifact-format, configuration reference, apim-glossary, incremental-publish, dry-run-workflow, code-first-workflow, multi-team-workflows, migration-from-v1, architecture/overview, design-principles, troubleshooting/common-errors, debugging-guide, pipeline-recovery, dependency-graph reference, resource-types reference, exit-codes reference, authentication-patterns ci/cd.

**Critical Patterns:**
- Auth flags set env vars (credential precedence) — documented in authentication guide
- Overrides: names must be consistent, properties can differ — documented with ✅/❌ examples
- `--commit-id` / `--delete-unmatched` mutually exclusive — enforced at CLI level (exit code 2)
- Dependency graph has 31 edges (includes optional ApiDiagnostic→Logger) — documented in full Mermaid diagram
- Dry-run uses topological ordering via `getTopologicalOrder()`
- Error messages searchable — used as exact headings for GitHub search
- Architecture docs use progressive disclosure (diagram → table → details)

## Learnings

<!-- Append new learnings below this line -->

### 2026-05-17: Phase 2-3 Docs — 18 Files Summary

Completed all Phase 2-3 documentation: Azure DevOps, filtering, artifact format, config, glossary, incremental, dry-run, code-first, multi-team, migration, architecture, design, errors, debugging, recovery, dependency graph, types, exit codes, auth. Dependency graph has 31 edges (ApiDiagnostic→Logger is optional). Dry-run uses topological ordering. Auth troubleshooting critical for CI/CD. [See Core Context for complete phase breakdown.]

### 2026-05-16: Phase 1 Docs — 10 Files Summary

Completed Phase 1 documentation: README, getting-started, extract, publish, init, scenarios, authentication, overrides, github-actions, azure-devops. Patterns: examples-first, Mermaid workflows, relative links, search-optimized errors. Key gotchas documented: auth flags set env vars (credential precedence), overrides rule (names consistent, properties differ), `--commit-id`/`--delete-unmatched` mutual exclusivity. [See Core Context for complete breakdown.]
