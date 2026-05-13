# DocWriter — History

## Project Context

- **Project:** apiops-cli — A CLI tool for Azure API Management operations (APIOps)
- **Stack:** TypeScript 6.x, Node.js 22.x, Commander (CLI framework)
- **Docs location:** `/docs` folder, hosted on GitHub
- **Audience:** API developers working with Azure API Management
- **Team:** ApiOpsLead (Tech Lead), ApimExpert, ApicExpert, TypeScriptDev, NodeJsDev, TestEngineer, OpenSourceExpert, CodeReviewer, AzdoExpert, GitHubExpert

## Learnings

<!-- Append new learnings below this line -->

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
