# Skill: Task Tracking

**Confidence:** high
**Scope:** All agents completing implementation work

## What

Keep `specs/*/tasks.md` checkboxes in sync with actual project progress. When a task is completed (code merged, issue closed), its checkbox must be updated from `- [ ]` to `- [x]`.

## Why

The tasks.md file is the single source of truth for project progress at the task level. Without checkbox updates, the file becomes stale and misleading — making it impossible to see at a glance what's done vs. pending.

## How

### During Normal Work

1. **Before committing**: Check if your work completes any task listed in `specs/*/tasks.md`
2. **Identify the task**: Match via task ID (e.g., `T006`), file path, or issue number
3. **Update the checkbox**: Change `- [ ] T0xx` to `- [x] T0xx` within the same PR that closes the issue

### Catch-Up Audit

If tasks.md has fallen behind, run this process:

1. **List closed issues**: `gh issue list --state closed` or check GitHub
2. **Cross-reference**: Match closed issues to task IDs in tasks.md (issues titled `[T0xx]`)
3. **Verify source files exist**: Confirm the implementation files referenced in the task are present
4. **Batch update**: Check off all verified-complete tasks in a single commit

### Task-to-Issue Mapping

Tasks in `specs/001-apiops-cli/tasks.md` map to GitHub issues by title pattern:
- Task `T001` → Issue titled `[T001] ...`
- Task `T019` → Issue titled `[T019] ...`

### Automation Points

- **PR template**: Includes checkbox reminder: "I have updated `specs/*/tasks.md` checkboxes for any completed tasks"
- **Copilot instructions**: `.github/copilot-instructions.md` documents the convention
- **Ceremony**: "Task Tracking" ceremony in `.squad/ceremonies.md` auto-triggers after issue completion

## Examples

```markdown
# Before
- [ ] T006 Define ResourceType enum with all 33 resource types...

# After (issue #12 closed, code merged)
- [x] T006 Define ResourceType enum with all 33 resource types...
```

## Anti-Patterns

- ❌ Checking off a task before the code is merged
- ❌ Leaving tasks.md untouched across multiple PRs
- ❌ Checking off tasks without verifying the implementation exists
- ❌ Creating a separate "update tasks.md" PR weeks after the fact (do it inline)
