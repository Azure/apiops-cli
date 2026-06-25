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

Find the previous release tag, then walk every merged PR since:

```powershell
# Most recent tag (sorted by semver)
git tag --sort=-v:refname | Select-Object -First 1

# Commits since that tag
git log <previous-tag>..main --pretty=format:"%h %s" --no-merges

# PRs merged since that tag (more useful for changelog entries)
gh pr list --state merged --base main --limit 100 --json number,title,mergedAt,url `
  --jq '[.[] | select(.mergedAt > "<previous-tag-date>")] | .[] | "#\(.number) \(.title)"'
```

Group the entries into the sections used by `CHANGELOG.md`:

- **Features** — new user-visible capabilities
- **Bug Fixes** — corrections to existing behavior
- **Docs & Testing** — documentation, examples, test improvements
- **Breaking Changes** — anything that requires user action (add this section only if non-empty; call it out loudly)

Use the existing changelog as a style guide — short bolded headline, then plain-language explanation, then PR link(s):

```markdown
- **Token substitution in publish pipelines** — `{#[TOKEN_NAME]#}` placeholders are now resolved during publish, matching APIOps Toolkit behavior ([#127](https://github.com/Azure/apiops-cli/pull/127))
```

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

Verify the workflow validator will accept it:

```powershell
Select-String -Path CHANGELOG.md -Pattern "^## \[<NEW_VERSION>\]"
```

If `Select-String` returns nothing, the header is malformed — fix the brackets, spacing, or em-dash.

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
