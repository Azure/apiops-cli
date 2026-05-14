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
