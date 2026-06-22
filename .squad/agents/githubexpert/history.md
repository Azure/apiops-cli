# GitHubExpert — History

## Learnings

### 2026-06-22 — Prefer github-script@v8 in workflows

**Context:** `stale-issues.yml` emitted a warning that Node.js 20 is deprecated because `actions/github-script@v7` targets Node 20 and is forced to run on Node 24.

**Key pattern:** For GitHub workflow scripting steps, use `actions/github-script@v8` by default and avoid `@v7` to prevent deprecation warnings and keep runtime compatibility aligned with current runners.

### 2026-07-15 — Merge main into feature branch (shallow clone handling)

**Context:** Branch `copilot/fix-github-issue-96` was a shallow clone (grafted). Merging main required `git fetch --unshallow` first, then `git fetch origin main:refs/remotes/origin/main` to create the remote tracking ref. PR #93 (`Fix unit test failure in workspace tests`) fixed the failing workspace-extractor test. After merge, all 910 tests pass.

**Key patterns:**
- Always check `git rev-parse --is-shallow-repository` before merge/rebase operations.
- Shallow clones won't have `origin/main` — need explicit fetch to create tracking ref.
- Run tests before AND after merge to confirm the fix vs pre-existing failures.

### 2025-05-18 — gh-aw (GitHub Agentic Workflows) Feasibility Analysis

**Context:** Evaluated [gh-aw](https://github.com/github/gh-aw) as a possible replacement for hand-rolled YAML workflows in the branch maintenance plan.

**Sources reviewed:**

- gh-aw repo: <https://github.com/github/gh-aw>
- Overview & guardrails: <https://github.github.com/gh-aw/>
- Safe Outputs reference: <https://github.github.com/gh-aw/reference/safe-outputs/>
- Triggers reference: <https://github.github.com/gh-aw/reference/triggers/>
- Security architecture: <https://github.github.com/gh-aw/introduction/architecture/>

**Evidence-backed findings:**

1. **gh-aw is built around AI agents producing structured outputs that a separate gated job applies.** The platform's documented model: agent runs read-only, emits an artifact, a separate job with scoped write permissions applies allowed actions ([Guardrails — Safe outputs](https://github.github.com/gh-aw/#safe-outputs-with-strong-guardrails); [Safe Outputs reference](https://github.github.com/gh-aw/reference/safe-outputs/)). `add-comment` and `add-labels` are first-class safe-output types ([Labels, Assignments & Reviews](https://github.github.com/gh-aw/reference/safe-outputs/#labels-assignments--reviews)), so advisory/comment workflows are mechanically a fit.

2. **For deterministic pass/fail CI gates, gh-aw introduces AI latency and non-determinism that traditional YAML avoids.** gh-aw positions itself as *augmenting* deterministic CI/CD rather than replacing it ([overview, "augment" link to FAQ on determinism](https://github.github.com/gh-aw/reference/faq/#determinism)). Recommendation: keep traditional YAML unless when deterministic outcome required.

3. **`add-labels` supports `allowed` and `blocked` glob lists with documented precedence**, which maps cleanly to Two-Tier labeling ([Add Labels — Blocked Label Patterns](https://github.github.com/gh-aw/reference/safe-outputs/#blocked-label-patterns)): `blocked` is evaluated first as a security boundary, then `allowed`. The `max` field acts as a per-run circuit breaker (default 3 for labels; same section).

4. **`label_command:` is a documented one-shot label trigger that auto-removes the label after activation**, making it re-triggerable without manual cleanup ([Label Command Trigger](https://github.github.com/gh-aw/reference/triggers/#label-command-trigger-label_command)). Auto-removal is controlled by `remove_label` (default `true`). This is a direct functional analog to gating on `github.event.label.name == 'X'`.

5. **gh-aw *does* support custom GitHub Apps for writes.**  `safe-outputs.github-app` accepts `client-id`/`private-key` for the write-side job ([Safe Outputs — Global Configuration Options](https://github.github.com/gh-aw/reference/safe-outputs/#global-configuration-options)), and `on.github-app` does the same for activation and skip-if jobs ([Activation Token](https://github.github.com/gh-aw/reference/triggers/#activation-token-ongithub-token-ongithub-app)). Most safe-output types also accept a custom `github-token:`. A custom GitHub App pattern is therefore compatible with gh-aw and is **not** a blocker for adoption.

6. **Phased adoption is a general engineering principle, not a gh-aw–specific finding.** The gh-aw homepage carries an explicit caution: *"GitHub Agentic Workflows is in early development and may change significantly… Use it with caution, and at your own risk."* ([homepage note](https://github.github.com/gh-aw/)). Combined with the platform's emphasis on human supervision, this supports starting with low-risk advisory workflows before adopting anything gating.

### 2026-07-15 — PR #102 metadata correction

**Context:** PR #102 was auto-created with title/body describing only the last action (merge main) instead of the branch's actual work (override format alignment for issue #96). Updated PR body via `engine-tools-report_progress`. Title update blocked by `gh` CLI 403 — the Copilot agent token lacks GraphQL mutation scope for `updatePullRequest`.

**Key patterns:**
- `engine-tools-report_progress` updates PR body but NOT title.
- `runtime-tools-create_pull_request` detects existing PRs but does not update them.
- `gh pr edit` requires a token with full `repo` scope; the Copilot agent token (`ghu_*`) does not have it.
- Always review auto-generated PR metadata before sharing — branch name `copilot/fix-github-issue-96` correctly hints at the real work, but the auto-title did not.

### 2026-06-01 — Orchestration: merge main into branch

**Context:** Scribe executed merge-main manifest for branch `copilot/fix-github-issue-96`. Merge validation: tests run before/after to confirm stability.

**Pattern:** Standard merge orchestration with validation gates.
