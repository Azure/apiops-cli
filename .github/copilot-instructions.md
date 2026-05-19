# apiops-cli Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-06

## Active Technologies

- TypeScript 5.x (Node.js Active LTS, currently 22.x) + Commander (CLI), `@azure/identity` (auth), `js-yaml` (YAML parsing), `simple-git` (git diff for incremental publish) (001-apiops-cli)

## Project Structure

```text
src/
tests/
```

## Commands

npm test; npm run lint

## Code Style

TypeScript 5.x (Node.js Active LTS, currently 22.x): Follow standard conventions

### Copyright Headers

**MANDATORY:** All source files MUST include the following copyright header at the very top of the file:

```typescript
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
```

This applies to all files in `src/` and `tests/` directories. The header must appear before any other code, imports, or comments.

## Recent Changes

- 001-apiops-cli: Added TypeScript 5.x (Node.js Active LTS, currently 22.x) + Commander (CLI), `@azure/identity` (auth), `js-yaml` (YAML parsing), `simple-git` (git diff for incremental publish)

<!-- MANUAL ADDITIONS START -->

## Commit Message Convention

Always include `Closes #N` or `Fixes #N` in commit messages when the change resolves a GitHub issue. This auto-closes issues on PR merge. See CONTRIBUTING.md for details.

### Multi-line Commit Messages

When creating commits with multi-line messages, **always use `git commit -F <tmpfile>`** instead of `git commit -m "..."` with embedded `\n`. The `-m` flag treats `\n` as literal text, not newlines, which breaks GitHub's auto-close keyword detection.

```bash
# CORRECT — write message to a temp file, then commit
echo "feat: add policy extraction" > /tmp/commit-msg.txt
echo "" >> /tmp/commit-msg.txt
echo "Closes #42" >> /tmp/commit-msg.txt
git commit -F /tmp/commit-msg.txt
rm /tmp/commit-msg.txt

# WRONG — literal \n in -m flag
git commit -m "feat: add policy extraction\n\nCloses #42"
```

### Issue References in PRs

Always include `Closes #N` in **both** the commit message AND the PR body's "Related Issue(s)" section. The PR body serves as a redundant safety net if commit message formatting fails.

## Pull Request Title and Description

**⚠️ CRITICAL:** When creating a pull request, the title and description must summarize **ALL changes in the branch**, not just the last commit.

### Before Creating Any PR

1. Run `git log main..HEAD --oneline` to see ALL commits in the branch
2. Review what the branch accomplishes as a whole (the feature, fix, or phase of work)
3. Write a title that describes the complete body of work (e.g., "feat: implement apiops init command" not "fix: resolve test failures")
4. Write a description that covers:
   - What the branch delivers overall
   - All significant commits/changes
   - Related issues/tasks
   - New files added
   - Modified functionality

### Common Mistake

❌ **Wrong:** PR titled after the most recent commit ("fix: resolve Windows test failures")  
✅ **Right:** PR titled after the branch's purpose ("feat: implement apiops init command with CI/CD scaffolding")

The PR represents the **integration of the entire branch into main**, so describe what's being integrated.

## Code Review Requirement

**After any changes to files under `src/` or `tests/`**, a code review MUST be performed before the work is considered complete. This is a mandatory ceremony defined in `.squad/ceremonies.md`.

- The CodeReviewer agent reviews against the constitution at `.squad/identity/constitution.md` (§I-§VIII)
- Review checks: TypeScript strict compliance, testability (§VI), forward compatibility (§VII), secret safety (§VIII), YAGNI (§V)
- Severity levels: 🔴 Blocker (must fix), 🟡 Required (must fix), 🟢 Suggestion (author's discretion)
- Blockers MUST be resolved before merge

If you are working through the Squad coordinator, this happens automatically. If you are working directly (e.g., as a Copilot coding agent), you must still ensure code review happens by noting it in your PR description or requesting it explicitly.

## Task Tracking in tasks.md

When completing work that resolves a task listed in `specs/*/tasks.md`, **always update the corresponding checkbox** from `- [ ]` to `- [x]`. This keeps the tasks file in sync with actual project progress.

### Rules

1. **On issue close**: If your commit includes `Closes #N` and that issue maps to a task (e.g., `[T006]` → issue #12), mark the task as done in tasks.md within the same PR.
2. **On PR merge**: Before finalizing a PR, verify that all tasks completed in the PR are checked off in tasks.md.
3. **Mapping**: Task IDs (T001, T002, etc.) correspond to GitHub issues. Check closed issues to determine which tasks are complete.
4. **Batch updates**: If multiple tasks were completed across prior PRs without updating tasks.md, check them all off in a single catch-up commit.

<!-- MANUAL ADDITIONS END -->
