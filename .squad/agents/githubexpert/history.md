# GitHubExpert — History

## Learnings

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
