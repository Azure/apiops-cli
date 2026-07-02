# Squad Team

> apiops-cli

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| ApiOpsLead | 🏗️ Tech Lead | [charter](.squad/agents/apiopslead/charter.md) | ✅ Active |
| ApimExpert | 🔵 APIM Expert | [charter](.squad/agents/apimexpert/charter.md) | ✅ Active |
| ApicExpert | 🟣 APIC Expert | [charter](.squad/agents/apicexpert/charter.md) | ✅ Active |
| TypeScriptDev | 🔷 TypeScript Developer | [charter](.squad/agents/typescriptdev/charter.md) | ✅ Active |
| NodeJsDev | 🟢 Node.js Developer | [charter](.squad/agents/nodejsdev/charter.md) | ✅ Active |
| TestEngineer | 🧪 Test Engineer | [charter](.squad/agents/testengineer/charter.md) | ✅ Active |
| OpenSourceExpert | ⚖️ Open Source Expert | [charter](.squad/agents/opensourceexpert/charter.md) | ✅ Active |
| CodeReviewer | 🔍 Code Reviewer & Standards Enforcer | [charter](.squad/agents/codereviewer/charter.md) | ✅ Active |
| AzdoExpert | 🔶 Azure DevOps Expert | [charter](.squad/agents/azdoexpert/charter.md) | ✅ Active |
| GitHubExpert | ⚫ GitHub Expert | [charter](.squad/agents/githubexpert/charter.md) | ✅ Active |
| DocWriter | 📝 Technical Writer | [charter](.squad/agents/docwriter/charter.md) | ✅ Active |
| SecurityExpert | 🔒 Security Expert | [charter](.squad/agents/securityexpert/charter.md) | ✅ Active |
| Ralph | 🔄 Work Monitor | — | ✅ Active |

## Coding Agent

<!-- copilot-auto-assign: true -->

GitHub's Copilot coding agent (`@copilot`) autonomously implements issues labeled
`squad:copilot`. Ralph (`squad-heartbeat.yml`) assigns `copilot-swe-agent[bot]` to
every open `squad:copilot` issue that does not already have the agent assigned —
in addition to the human maintainer who owns it — which is what actually starts an
agent session (the label alone does not).

| Name | Role | Auto-assign | Notes |
|------|------|-------------|-------|
| Copilot | 🤖 Coding Agent | ✅ Enabled | Requires the `COPILOT_ASSIGN_TOKEN` repo secret (a PAT that can assign the coding agent). Without it the assign step is a no-op. |

## Issue Source

- **Repository:** Azure/apiops-cli
- **Connected:** 2026-04-09
- **Workflow:** Tasks from `/specs/001-apiops-cli/tasks.md` tracked as GitHub issues

## Team Labels

| Member | Label | Color |
|--------|-------|-------|
| ApiOpsLead | `squad:apiopslead` | 🟠 #D97706 |
| ApimExpert | `squad:apimexpert` | 🔵 #0078D4 |
| ApicExpert | `squad:apicexpert` | 🟣 #7C3AED |
| TypeScriptDev | `squad:typescriptdev` | 🔷 #3178C6 |
| NodeJsDev | `squad:nodejsdev` | 🟢 #339933 |
| TestEngineer | `squad:testengineer` | 💜 #A855F7 |
| OpenSourceExpert | `squad:opensourceexpert` | ⚪ #6B7280 |
| AzdoExpert | `squad:azdoexpert` | 🔶 #F97316 |
| GitHubExpert | `squad:githubexpert` | ⚫ #24292F |
| DocWriter | `squad:docwriter` | 📝 #0EA5E9 |
| SecurityExpert | `squad:securityexpert` | 🔒 #DC2626 |

## Milestones

| Milestone | Tasks | Description |
|-----------|-------|-------------|
| Phase 1: Setup | T001-T005 | Project initialization |
| Phase 2: Foundational | T006-T019 | Core infrastructure (BLOCKS all user stories) |
| Phase 3: US1 Extract | T020-T029 | Extract APIM Configuration (MVP) |
| Phase 4: US2 Publish | T030-T038 | Publish Configuration to APIM |
| Phase 5: US3 CI/CD | T039-T041 | CI/CD Pipeline Integration |
| Phase 6: US4 Init | T042-T051 | Guided Repository & Pipeline Setup |
| Phase 7: US5 Extensibility | T052-T054 | Extensible Command Architecture |
| Phase 8: Polish | T055-T059 | Cross-Cutting Concerns |

## Project Context

- **Project:** apiops-cli
- **Created:** 2026-04-07
