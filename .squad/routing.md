# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture, design decisions, scope/priority | ApiOpsLead | High-level design, command structure, trade-off calls |
| APIM REST API, resource types, policies | ApimExpert | Extract/publish logic, dependency ordering, pagination, retry, workspace scoping |
| APIC REST API, API Center resources | ApicExpert | APIC sync, APIC resource model, APIM↔APIC integration |
| TypeScript types, interfaces, abstractions | TypeScriptDev | tsconfig, abstraction contracts, ESLint, build |
| CLI wiring, Commander, npm, init scaffolding | NodeJsDev | Flag definitions, help text, exit codes, `apiops init`, package.json |
| Tests, mocking, edge cases, coverage | TestEngineer | Vitest unit tests, mock implementations, spec edge cases |
| License compliance, OSS requirements, repo health | OpenSourceExpert | Dependency audits, LICENSE/SECURITY/CONTRIBUTING files, CLA |
| Code review, standards enforcement | CodeReviewer | Review PRs, enforce constitution compliance, check testability, modern TypeScript standards |
| Architecture review, scope decisions | ApiOpsLead | High-level design review, spec alignment, scope gatekeeping |
| Issue triage | ApiOpsLead | Read GitHub issues, assign `squad:{member}` labels |
| Session logging | Scribe | Automatic — never needs routing |
| Work queue monitoring | Ralph | Automatic — activated with "Ralph, go" |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | ApiOpsLead |
| `squad:apiopslead` | Pick up issue — architecture or scope decision | ApiOpsLead |
| `squad:apimexpert` | Pick up issue — APIM REST API work | ApimExpert |
| `squad:apicexpert` | Pick up issue — APIC REST API work | ApicExpert |
| `squad:typescriptdev` | Pick up issue — TypeScript types or build | TypeScriptDev |
| `squad:nodejsdev` | Pick up issue — CLI wiring, packaging, init | NodeJsDev |
| `squad:testengineer` | Pick up issue — tests or coverage | TestEngineer |
| `squad:opensourceexpert` | Pick up issue — license or OSS compliance | OpenSourceExpert |
| `squad:codereviewer` | Pick up issue — code review or standards enforcement | CodeReviewer |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
