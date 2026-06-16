# Ceremonies

> Team meetings that happen before or after work. Each squad configures their own.

## Design Review

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | before |
| **Condition** | multi-agent task involving 2+ agents modifying shared systems |
| **Facilitator** | lead |
| **Participants** | all-relevant |
| **Time budget** | focused |
| **Enabled** | ✅ yes |

**Agenda:**
1. Review the task and requirements
2. Agree on interfaces and contracts between components
3. Identify risks and edge cases
4. Assign action items

---

## Code Review

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | after |
| **Condition** | any agent creates or modifies files under src/ or tests/ |
| **Facilitator** | CodeReviewer |
| **Participants** | CodeReviewer, original-author(s) |
| **Time budget** | focused |
| **Enabled** | ✅ yes |

**Agenda:**
1. Read constitution (`.squad/identity/constitution.md`) and team decisions (`.squad/decisions.md`)
2. Review all modified/created source files for constitution compliance (§I-§VIII)
3. Check TypeScript strict mode compliance — no `any`, proper null handling
4. Verify testability — abstractions over concretes, injectable dependencies (§VI)
5. Verify forward compatibility — `Record<string, unknown>` for resource bodies (§VII)
6. Inspect secret safety — no credentials in output, logs, or artifacts (§VIII)
7. Confirm YAGNI — complexity justified in writing (§V)
8. Report findings with severity levels: 🔴 Blocker / 🟡 Required / 🟢 Suggestion
9. Write findings to `.squad/decisions/inbox/codereviewer-{slug}.md`

**Protocol:**
- Blockers MUST be resolved before merge
- On rejection, original author is locked out — a different agent must fix
- CodeReviewer writes to decisions inbox; Scribe merges

---

## Task Tracking

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | after |
| **Condition** | any agent closes a GitHub issue or completes work referencing a task ID (T0xx) |
| **Facilitator** | lead |
| **Participants** | original-author(s) |
| **Time budget** | minimal |
| **Enabled** | ✅ yes |

**Agenda:**
1. Identify which task IDs (T0xx) were completed in this work
2. Map task IDs to their checkbox lines in `specs/*/tasks.md`
3. Update checkboxes from `- [ ]` to `- [x]` for each completed task
4. Commit the tasks.md update alongside the work (same PR) or as an immediate follow-up

**Protocol:**
- This is a lightweight post-work check — takes seconds, not minutes
- If tasks.md is already up to date, no action needed
- If multiple tasks completed, batch all checkbox updates in one edit

---

## Retrospective

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | after |
| **Condition** | build failure, test failure, or reviewer rejection |
| **Facilitator** | lead |
| **Participants** | all-involved |
| **Time budget** | focused |
| **Enabled** | ✅ yes |

**Agenda:**
1. What happened? (facts only)
2. Root cause analysis
3. What should change?
4. Action items for next iteration


---

## Retrospective with Enforcement

| Field | Value |
|-------|-------|
| **Trigger** | auto |
| **When** | weekly |
| **Condition** | No *retrospective* log in .squad/log/ within the last 7 days |
| **Facilitator** | lead |
| **Participants** | all |
| **Time budget** | focused |
| **Enabled** | yes |
| **Enforcement skill** | retro-enforcement |

**Agenda:**
1. What shipped this week? (closed issues, merged PRs)
2. What did not ship? (open issues, blockers)
3. Root cause on any failures
4. Action items -- each MUST become a GitHub Issue labeled retro-action

**Coordinator integration:**
At round start, call Test-RetroOverdue (see skill retro-enforcement). If overdue, run this ceremony before the work queue.

**Why GitHub Issues, not markdown:**
Production data: 0% completion across 6 retros using markdown checklists, 100% after switching to GitHub Issues.
