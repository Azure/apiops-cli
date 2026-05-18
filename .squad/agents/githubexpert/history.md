# GitHubExpert — History

## Learnings

### 2025-01-XX — gh-aw (GitHub Agentic Workflows) Feasibility Analysis

**Context:** Evaluated [gh-aw](https://github.com/github/gh-aw) as a possible replacement for hand-rolled YAML workflows in the branch maintenance plan.

**Sources reviewed:**

- gh-aw repo: <https://github.com/github/gh-aw>
- Overview & guardrails: <https://github.github.com/gh-aw/>
- Safe Outputs reference: <https://github.github.com/gh-aw/reference/safe-outputs/>
- Triggers reference: <https://github.github.com/gh-aw/reference/triggers/>
- Security architecture: <https://github.github.com/gh-aw/introduction/architecture/>

**Evidence-backed findings:**

1. **gh-aw is built around AI agents producing structured outputs that a separate gated job applies.** The platform's documented model: agent runs read-only, emits an artifact, a separate job with scoped write permissions applies allowed actions ([Guardrails — Safe outputs](https://github.github.com/gh-aw/#safe-outputs-with-strong-guardrails); [Safe Outputs reference](https://github.github.com/gh-aw/reference/safe-outputs/)). `add-comment` and `add-labels` are first-class safe-output types ([Labels, Assignments & Reviews](https://github.github.com/gh-aw/reference/safe-outputs/#labels-assignments--reviews)), so advisory workflows (`squad-triage-advisor`, `external-pr-advisor`, `squad-clarify-advisor`) are mechanically a fit. Whether AI reasoning produces *better* triage than keyword matching for our specific advisors is **not established** by the docs — a pilot would be needed to measure.

2. **For deterministic pass/fail CI gates, gh-aw introduces AI latency and non-determinism that traditional YAML avoids.** gh-aw positions itself as *augmenting* deterministic CI/CD rather than replacing it ([overview, "augment" link to FAQ on determinism](https://github.github.com/gh-aw/reference/faq/#determinism)). For workflows like `block-workflow-changes` and `squad-history-protection`, the requirement is deterministic pass/fail — no evidence indicates gh-aw would meet that better than a plain Actions job. Recommendation: keep these as traditional YAML unless a concrete need to change emerges.

3. **`add-labels` supports `allowed` and `blocked` glob lists with documented precedence**, which maps cleanly to Two-Tier labeling ([Add Labels — Blocked Label Patterns](https://github.github.com/gh-aw/reference/safe-outputs/#blocked-label-patterns)): `blocked` is evaluated first as a security boundary, then `allowed`. The `max` field acts as a per-run circuit breaker (default 3 for labels; same section).

4. **`label_command:` is a documented one-shot label trigger that auto-removes the label after activation**, making it re-triggerable without manual cleanup ([Label Command Trigger](https://github.github.com/gh-aw/reference/triggers/#label-command-trigger-label_command)). Auto-removal is controlled by `remove_label` (default `true`). This is a direct functional analog to gating on `github.event.label.name == 'X'`.

5. **Correction — gh-aw *does* support custom GitHub Apps for writes.** A prior note here claimed gh-aw "can't use custom GitHub Apps for writes." The docs contradict that: `safe-outputs.github-app` accepts `client-id`/`private-key` for the write-side job ([Safe Outputs — Global Configuration Options](https://github.github.com/gh-aw/reference/safe-outputs/#global-configuration-options)), and `on.github-app` does the same for activation and skip-if jobs ([Activation Token](https://github.github.com/gh-aw/reference/triggers/#activation-token-ongithub-token-ongithub-app)). Most safe-output types also accept a custom `github-token:`. The `apiops-bot` GitHub App pattern is therefore compatible with gh-aw and is **not** a blocker for adoption.

6. **Phased adoption is a general engineering principle, not a gh-aw–specific finding.** The gh-aw homepage carries an explicit caution: *"GitHub Agentic Workflows is in early development and may change significantly… Use it with caution, and at your own risk."* ([homepage note](https://github.github.com/gh-aw/)). Combined with the platform's emphasis on human supervision, this supports starting with low-risk advisory workflows before adopting anything gating.

**Open questions (no supporting evidence yet — do not treat as conclusions):**

- Whether AI-driven triage produces materially better labels than keyword matching for our repo's issue volume.
- Cost and latency profile of gh-aw runs at our expected trigger frequency.
- Whether the threat-detection job ([Threat Detection](https://github.github.com/gh-aw/reference/threat-detection/)) introduces false positives that would block legitimate advisor output.

### 2025-07-14 — Repository Maintenance Plan: Issue Lifecycle, Labels & Workflows, Change Detection, Documentation, Coverage

**Contribution:** Wrote 5 sections for `docs/repo-maintenance-plan.adoc`:

1. **Issue Lifecycle Management** — Complete workflow from issue creation through closure: template taxonomy (bug/feature/investigation/chore), automated triage routing (squad assignment, priority labeling), stale detection (auto-warn after 60 days, close after 90), and voting mechanisms (👍/👎 emoji aggregation with team consensus thresholds).

2. **Labels & Workflow Automation** — Two-tier label system with 47-label taxonomy: Tier-1 (informational: squad, type, priority, status) auto-applied by agents, Tier-2 (gating: override, go, approved, reserved) human-only to prevent tampering. LabelOps automation for recurring checks (coverage-check runs on every PR to verify min 80% thresholds).

3. **APIM Change Detection** — Schema for incremental API drift detection: publish command uses simple-git to diff extracted artifacts against HEAD, surfacing breaking changes (removed endpoints, parameter changes, security scheme modifications) before release.

4. **Documentation Freshness** — Automated staleness detection: scheduled workflow runs every Monday, checks all `.md` files in docs/ for `<!-- last-reviewed: YYYY-MM-DD -->` comments, surfaces files older than 90 days, sends team notification.

5. **Test Coverage Verification** — Enforced minimum coverage gates: `npm test` emits JSON coverage report, CI blocks merge if line coverage drops below baseline (initial 70%, rising to 85% in Phase 4), includes coverage trend dashboard.

All sections integrated with threat model, automation guardrails, and security controls defined by SecurityExpert.
