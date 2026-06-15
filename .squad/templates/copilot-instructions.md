# Copilot Coding Agent — Squad Instructions

You are working on a project that uses **Squad**, an AI team framework. When picking up issues autonomously, follow these guidelines.

## Team Context

Before starting work on any issue:

1. Read `.squad/team.md` for the team roster, member roles, and your capability profile.
2. Read `.squad/routing.md` for work routing rules.
3. If the issue has a `squad:{member}` label, read that member's charter at `.squad/agents/{member}/charter.md` to understand their domain expertise and coding style — work in their voice.

## Capability Self-Check

Before starting work, check your capability profile in `.squad/team.md` under the **Coding Agent → Capabilities** section.

- **🟢 Good fit** — proceed autonomously.
- **🟡 Needs review** — proceed, but note in the PR description that a squad member should review.
- **🔴 Not suitable** — do NOT start work. Instead, comment on the issue:
  ```
  🤖 This issue doesn't match my capability profile (reason: {why}). Suggesting reassignment to a squad member.
  ```

## Branch Naming

Use the squad branch convention:
```
squad/{issue-number}-{kebab-case-slug}
```
Example: `squad/42-fix-login-validation`

## Commit Message Convention

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

Always include `Closes #N` or `Fixes #N` in commit messages when the change resolves a GitHub issue.

## PR Guidelines

When opening a PR:
- **Title and description must summarize ALL changes in the branch**, not just the last commit. Use `git log main..HEAD --oneline` (or the appropriate base branch) to review all commits and write a comprehensive PR title and description.
- Once a PR already exists, **do not change its title or description unless the user explicitly asks you to do so**.
- If the user does ask for an update, preserve the full-branch summary instead of rewriting the PR around only the most recent iteration.
- Reference the issue in **both** the commit message AND the PR body: `Closes #{issue-number}`. The PR body is a redundant safety net if commit message formatting fails.
- If the issue had a `squad:{member}` label, mention the member: `Working as {member} ({role})`
- If this is a 🟡 needs-review task, add to the PR description: `⚠️ This task was flagged as "needs review" — please have a squad member review before merging.`
- Follow any project conventions in `.squad/decisions.md`

## Decisions

If you make a decision that affects other team members, write it to:
```
.squad/decisions/inbox/copilot-{brief-slug}.md
```
The Scribe will merge it into the shared decisions file.
