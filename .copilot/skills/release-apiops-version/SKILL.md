# Skill: Release apiops-cli Version

**Confidence:** high
**Scope:** Any agent (or human) cutting a new release of `@peterhauge/apiops-cli`

## What

End-to-end checklist for releasing a new version of apiops-cli. Walks through cleanliness checks, branch creation, changelog authoring, version bumping with `npm version`, and PR creation.

## Why

The release workflow (`.github/workflows/squad-release.yml`) **fails the build** if `package.json` `version` is not headed in `CHANGELOG.md` as `## [VERSION]`. Releases that skip the changelog never tag. This skill keeps version, changelog, and tag in lockstep so consumers can always answer "what changed since the version I have installed?" by reading one file.

## How

Follow these steps in order. Do not skip the cleanliness check — switching branches with a dirty tree loses work.

### 1. Confirm the working tree is clean

```powershell
git status --short
```

- If output is empty (or only contains `??` untracked files you've verified are safe to leave behind), you can proceed.
- If there are modified or staged tracked files, **STOP**. Tell the user:
  > "There are uncommitted changes in the working tree. Please commit, stash, or discard them before starting a release. Run `git status` to see what's pending."

Do not run `git stash`, `git reset`, or `git checkout -- .` on the user's behalf.

### 2. Switch to main and sync

```powershell
git checkout main
git pull --ff-only origin main
```

If the pull fails (non-fast-forward), STOP and ask the user how to reconcile.

### 3. Create the release branch

Use a predictable name so reviewers know it's a release PR:

```powershell
git checkout -b release/v<NEW_VERSION>
# e.g. git checkout -b release/v0.3.1-alpha.0
```

Don't commit the version bump yet — the changelog has to be written first (Step 6) so it lands in the same commit.

### 4. Compile the list of changes

**⚠️ Do NOT trust the previous version's git tag as the lower bound, and do NOT trust the new version's git tag (if it exists) as the upper bound.** Tags in this repo have historically been created out-of-order, prematurely, or left orphaned. The only reliable approach is to enumerate merged PRs by **merge date** on `main`.

#### Step 4a. Establish the date range

```powershell
# Find the previous release's tag and its commit date
git tag --sort=-v:refname | Select-Object -First 5
$prevTag = "v<PREV_VERSION>"   # e.g. v0.2.1-alpha.0 — confirm with the team if uncertain
$prevDate = git --no-pager log -1 --format="%cI" $prevTag
Write-Host "Previous release tag: $prevTag at $prevDate"
```

**Sanity check: is the tag stale?** If the tag's commit isn't on `main` HEAD or close to it, the tag may be premature/orphaned and shouldn't be used as an upper bound for the *next* release either:

```powershell
$commitsSinceTag = (git --no-pager log --oneline "$prevTag..main" | Measure-Object -Line).Lines
Write-Host "$commitsSinceTag commits on main since $prevTag"
# If this is suspiciously large (50+) and you weren't expecting that, investigate
# before assuming the tag represents the last *real* release.
```

If you find a tag that exists but has no matching `## [VERSION]` entry in `CHANGELOG.md` and no GitHub Release, treat it as **orphaned** — ignore it and use the most recent tag that *does* appear in `CHANGELOG.md` as your lower bound.

#### Step 4b. Enumerate all merged PRs in the date range

This is the authoritative list. **Do not** use `git log tag..tag` as a substitute — see "Why this matters" below.

```powershell
# Pull every PR merged on/after the previous release date.
# Strip the time portion to be inclusive of release-day PRs.
$sinceDate = ($prevDate -split "T")[0]
gh pr list --state merged --base main --search "merged:>=$sinceDate" --limit 100 `
  --json number,title,mergedAt,author `
  --jq '.[] | "\(.mergedAt) #\(.number) [\(.author.login)] \(.title)"' `
  | Sort-Object
```

Cross-check against the commit log (sanity, not source of truth — `gh pr list` is canonical):

```powershell
git --no-pager log --merges --pretty=format:"%ci %s" "$prevTag..main"
```

If the two lists disagree (e.g. a PR in `gh pr list` doesn't appear in `git log`), trust `gh pr list`. A PR can be missing from `git log tag..tag` because the tag was placed prematurely, the PR was rebased/squashed, or the PR landed on a branch that was later merged via another commit.

#### Step 4c. Categorize the PRs

Walk each PR and place it into one of these buckets. Use `gh pr view <N> --json title,body` to read details when the title alone isn't enough:

- **Features** — new user-visible capabilities
- **Bug Fixes** — corrections to existing behavior
- **Docs & Testing** — documentation, examples, test improvements
- **Breaking Changes** — anything that requires user action (add this section only if non-empty; call it out loudly even for pre-1.0)
- **Skip from changelog** — internal repo tooling (issue templates, agentic workflows, label sync, squad/agent upgrades, CI hardening that doesn't affect end users). These don't belong in a user-facing changelog. If you're unsure, **ask the user** rather than guessing.

#### Step 4d. Confirm the categorization with the user before writing the entry

Show the user the categorized list and confirm:

- Which PRs belong in the user-facing changelog vs. are internal-only
- Whether any PR title is misleading and needs a clearer headline
- Whether any change is breaking (especially CLI flag removals, schema changes, default-value changes)

Only after this confirmation, proceed to draft the entry using the existing changelog style (short bolded headline → plain-language explanation → PR link):

```markdown
- **Token substitution in publish pipelines** — `{#[TOKEN_NAME]#}` placeholders are now resolved during publish, matching APIOps Toolkit behavior ([#127](https://github.com/Azure/apiops-cli/pull/127))
```

#### Why this matters (don't repeat past mistakes)

A prior release attempt used `git log v<prev>..v<new>` to compile changes and found only 1 PR — when in reality **18 PRs** had merged in the range. Root cause: the `v<new>` tag had been placed on a commit 9 days before the actual release-bump PR merged, so `git log` only saw commits up to that stale tag. The user caught the mistake by eyeballing the GitHub PR list.

**Lesson:** tags are not a reliable boundary in this repo. Always enumerate by `gh pr list --search "merged:>=<date>"` and cross-check against the screen the user sees on github.com/Azure/apiops-cli/pulls?q=is%3Amerged.

### 5. Suggest a version and let the user pick

Based on the compiled changes, suggest the next version following SemVer with the project's `-alpha.N` pre-release convention. Show the user a small menu via `ask_user` — always include an "other" option for a custom version.

Decision rules (pre-1.0 era):

- **Breaking change** → bump MINOR (`0.3.0-alpha.0` → `0.4.0-alpha.0`)
- **New feature, no breaking change** → bump MINOR (`0.3.0-alpha.0` → `0.4.0-alpha.0`)
- **Bug fix / docs only** → bump PATCH (`0.3.0-alpha.0` → `0.3.1-alpha.0`)
- **Iterating on an unreleased pre-release** → bump the alpha number (`0.3.0-alpha.0` → `0.3.0-alpha.1`)

Always validate the chosen version is real semver before continuing:

```powershell
node -e "const v=process.argv[1]; const s=require('semver'); if(!s.valid(v)){process.exit(1)}; console.log(v)" <NEW_VERSION>
```

If it returns non-zero, STOP and ask the user for a different value.

### 6. Update CHANGELOG.md

Insert a new section directly under the `# Changelog` header (above the previous most-recent entry). Use ISO date, exactly match the version format used by the release workflow's grep (`## [VERSION] — YYYY-MM-DD`):

```markdown
## [0.3.1-alpha.0] — 2026-06-25

### Features

- ...

### Bug Fixes

- ...

### Docs & Testing

- ...
```

**Also add a compare-link footer at the bottom of the file.** CHANGELOG.md uses [Keep a Changelog](https://keepachangelog.com/) reference-style links so every `## [VERSION]` heading renders as a clickable link to the GitHub compare view between this and the previous release. The footer lives at the very bottom of the file and looks like:

```markdown
[0.3.1-alpha.0]: https://github.com/Azure/apiops-cli/compare/v0.3.0-alpha.0...v0.3.1-alpha.0
[0.3.0-alpha.0]: https://github.com/Azure/apiops-cli/compare/v0.2.1-alpha.0...v0.3.0-alpha.0
...
```

Add a new line for the new version at the **top** of the footer block (most recent first), comparing against the **immediately preceding** version's tag.

Verify both the workflow validator will accept the heading **and** the compare link is in place:

```powershell
Select-String -Path CHANGELOG.md -Pattern "^## \[<NEW_VERSION>\]"
Select-String -Path CHANGELOG.md -Pattern "^\[<NEW_VERSION>\]:"
```

Both `Select-String` calls must return a hit. If the first is empty the workflow will fail; if the second is empty the version heading won't render as a link in the published changelog (a pre-existing convention violation, not a workflow failure — but still wrong).

### 7. Bump the version with `npm version`

`npm version` updates `package.json` and `package-lock.json` atomically. By default it also creates a git tag and commit — **disable that** because the release workflow creates the tag for us once the PR merges.

```powershell
# Use --no-git-tag-version so we control the commit + tag separately
# Cheat sheet (run ONE of these, not all):

# Pre-release patch:  0.3.0-alpha.0 -> 0.3.0-alpha.1  (increments pre-release identifier)
npm version prerelease --preid=alpha --no-git-tag-version

# Patch:  0.3.0 -> 0.3.1  (only if you've dropped the pre-release suffix)
npm version patch --no-git-tag-version

# Minor (pre-release):  0.3.0-alpha.0 -> 0.4.0-alpha.0
npm version preminor --preid=alpha --no-git-tag-version

# Major (pre-release):  0.3.0-alpha.0 -> 1.0.0-alpha.0
npm version premajor --preid=alpha --no-git-tag-version

# Explicit (recommended when you already chose the version in Step 5):
npm version <NEW_VERSION> --no-git-tag-version
```

Verify the result:

```powershell
node -p "require('./package.json').version"
# Must equal <NEW_VERSION>
```

### 8. Commit and open the pull request

```powershell
git add package.json package-lock.json CHANGELOG.md

# Use -F with a temp file so newlines render correctly (see CONTRIBUTING.md)
$msg = @"
chore: release v<NEW_VERSION>

Updates package.json and CHANGELOG.md for the v<NEW_VERSION> release.
The squad-release workflow will create the git tag and GitHub Release
once this PR merges to main.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
"@
$msg | Out-File -Encoding utf8 commit-msg.txt
git commit -F commit-msg.txt
Remove-Item commit-msg.txt

git push -u origin HEAD
```

Then open the PR. Use the `create_pull_request` tool (preferred — renders a card in the UI) with:

- **Title:** `chore: release v<NEW_VERSION>`
- **Body:** Paste the new CHANGELOG section verbatim, plus a line: "Once merged, `.github/workflows/squad-release.yml` will tag `v<NEW_VERSION>` and create the GitHub Release."

### 9. After merge

The squad-release workflow (`.github/workflows/squad-release.yml`) will:

1. Validate the version is present in `CHANGELOG.md`
2. Create the `v<NEW_VERSION>` git tag
3. Create the matching GitHub Release

No manual `git tag` or `gh release create` is needed. If the workflow fails, read the logs — the most common cause is a typo in the `## [VERSION]` header that fails the grep validator.

## Pitfalls

- **Don't run `npm version` without `--no-git-tag-version`.** It will create an unsigned tag on your release branch that conflicts with the one the workflow makes.
- **Don't reformat unrelated changelog entries.** Limit the diff to the new section + the version bump.
- **Don't squash-merge the release commit into something else.** It needs to land on `main` as a recognizable `chore: release v...` commit so reviewers can find it.
- **Pre-1.0 breaking changes still deserve a callout.** Add a `### Breaking Changes` section even if SemVer technically allows the change in a MINOR bump.
