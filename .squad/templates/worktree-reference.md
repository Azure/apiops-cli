# Worktree Reference

> On-demand reference for Squad Coordinator. Read when working with git worktrees.

## Two Strategies for Resolving the Team Root

| Strategy | Team root | State scope | When to use |
|----------|-----------|-------------|-------------|
| **worktree-local** | Current worktree root | Branch-local — each worktree has its own `.squad/` state | Feature branches that need isolated decisions and history |
| **main-checkout** | Main working tree root | Shared — all worktrees read/write the main checkout's `.squad/` | Single source of truth for memories, decisions, and logs across all branches |

## How the Coordinator Resolves the Team Root

1. Run `git rev-parse --show-toplevel` to get the current worktree root.
2. Check if `.squad/` exists at that root (fall back to `.ai-team/` for repos that haven't migrated yet).
   - **Yes** → use **worktree-local** strategy. Team root = current worktree root.
   - **No** → use **main-checkout** strategy. Discover the main working tree:
     ```
     git worktree list --porcelain
     ```
     The first `worktree` line is the main working tree. Team root = that path.
3. The user may override the strategy at any time.

## Passing the Team Root to Agents

- The Coordinator includes `TEAM_ROOT: {resolved_path}` in every spawn prompt.
- Agents resolve ALL `.squad/` paths from the provided team root.
- Agents never discover the team root themselves. They trust the value from the Coordinator.

## Cross-Worktree Considerations (worktree-local — recommended for concurrent work)

- `.squad/` files are **branch-local**. Each worktree works independently — no locking, no shared-state races.
- When branches merge into main, `.squad/` state merges with them. The **append-only** pattern ensures both sides only added content, making merges clean.
- A `merge=union` driver in `.gitattributes` (see Init Mode) auto-resolves append-only files by keeping all lines from both sides — no manual conflict resolution needed.
- The Scribe commits `.squad/` changes to the worktree's branch. State flows to other branches through normal git merge / PR workflow.

## Cross-Worktree Considerations (main-checkout strategy)

- All worktrees share the same `.squad/` state on disk via the main checkout — changes are immediately visible without merging.
- **Not safe for concurrent sessions.** If two worktrees run sessions simultaneously, Scribe merge-and-commit steps will race on `decisions.md` and git index. Use only when a single session is active at a time.
- Best suited for solo use when you want a single source of truth without waiting for branch merges.

## Worktree Lifecycle Management

When worktree mode is enabled, the coordinator creates dedicated worktrees for issue-based work.

**Worktree mode activation:**
- Explicit: `worktrees: true` in project config (squad.config.ts or package.json `squad` section)
- Environment: `SQUAD_WORKTREES=1` set in environment variables
- Default: `false` (backward compatibility — agents work in the main repo)

**Creating worktrees:**
- One worktree per issue number
- Multiple agents on the same issue share a worktree
- Path convention: `{repo-parent}/{repo-name}-{issue-number}`
  - Example: Working on issue #42 in `C:\src\squad` → worktree at `C:\src\squad-42`
- Branch: `squad/{issue-number}-{kebab-case-slug}` (created from base branch, typically `main`)

**Dependency management:**
- After creating a worktree, link `node_modules` from the main repo to avoid reinstalling
- Windows: `cmd /c "mklink /J {worktree}\node_modules {main-repo}\node_modules"`
- Unix: `ln -s {main-repo}/node_modules {worktree}/node_modules`
- If linking fails (permissions, cross-device), fall back to `npm install` in the worktree

**Reusing worktrees:**
- Before creating a new worktree, check if one exists for the same issue
- `git worktree list` shows all active worktrees
- If found, reuse it (cd to the path, verify branch is correct, `git pull` to sync)
- Multiple agents can work in the same worktree concurrently if they modify different files

**Cleanup:**
- After a PR is merged, the worktree should be removed
- `git worktree remove {path}` + `git branch -d {branch}`
- Ralph heartbeat can trigger cleanup checks for merged branches

## Pre-Spawn: Worktree Setup

When spawning an agent for issue-based work:

**1. Check worktree mode:**
- Is `SQUAD_WORKTREES=1` set in the environment?
- Or does the project config have `worktrees: true`?
- If neither: skip worktree setup → agent works in the main repo (existing behavior)

**2. If worktrees enabled:**

a. **Determine the worktree path:**
   - Parse issue number from context (e.g., `#42`, `issue 42`, GitHub issue assignment)
   - Calculate path: `{repo-parent}/{repo-name}-{issue-number}`

b. **Check if worktree already exists:**
   - Run `git worktree list` to see all active worktrees
   - If found → **reuse it**: verify branch (`squad/{issue-number}-*`), `cd` to path, `git pull` to sync, skip to step (e)

c. **Create the worktree:**
   - Branch: `squad/{issue-number}-{kebab-case-slug}` (derive slug from issue title if available)
   - Base branch (typically `main`): `git worktree add {path} -b {branch} {baseBranch}`
   - Example: `git worktree add C:\src\squad-42 -b squad/42-fix-login main`

d. **Set up dependencies:**
   - Link `node_modules` from main repo:
     - Windows: `cmd /c "mklink /J {worktree}\node_modules {main-repo}\node_modules"`
     - Unix: `ln -s {main-repo}/node_modules {worktree}/node_modules`
   - If linking fails: `cd {worktree} && npm install`

e. **Include worktree context in spawn:**
   - Set `WORKTREE_PATH` to the resolved worktree path
   - Set `WORKTREE_MODE` to `true`
   - Add worktree instructions to the spawn prompt

**3. If worktrees disabled:**
- Set `WORKTREE_PATH` to `"n/a"`, `WORKTREE_MODE` to `false`
- Use existing `git checkout -b` flow (no changes to current behavior)
