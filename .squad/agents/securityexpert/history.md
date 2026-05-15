# SecurityExpert — History

## Project Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management operations
- **Stack:** TypeScript 5.x, Node.js 22.x, Commander, @azure/identity, js-yaml, simple-git
- **User:** Elizabeth Maher
- **Repo:** Azure/apiops-cli (public, open source)
- **Security posture:** AI-first repo with strict human-in-the-loop policy

## Key Knowledge

- Branch maintenance plan exists at external path (cli-investigations/branch-maintenance-plan.adoc)
- Plan covers: threat model with 10 attack vectors, 5 mitigation layers, GitHub App auth (no GITHUB_TOKEN), advisory-only workflows
- Real CVEs referenced: CVE-2025-30066 (tj-actions), CVE-2026-33634 (Trivy), CVE-2025-30154 (reviewdog)
- All Actions must be pinned to full 40-char SHA
- Fork PRs touching `.github/workflows/` must auto-fail
- 2 maintainer approvals required for fork PRs
- `npm ci` (not `npm install`) in all CI pipelines
- CODEOWNERS must cover 14+ sensitive paths

## Learnings

### 2026-05-15 — Branch Maintenance Plan Security Review

**Context:** Reviewed 762-line branch-maintenance-plan.adoc for security gaps. Updated Squad protection section to enforce maintainer-only access to `.squad/` files.

**Security Review Findings:**

* 🟡 **Required:** `.squad/` CODEOWNERS coverage was incomplete — only covered specific subdirectories. Added wildcard `/.squad/` entry to cover ALL files.
* 🟡 **Required:** Missing explicit access control statement — added CAUTION block stating ONLY owners/maintainers can modify `.squad/` files (blocks internal collaborators with write access).
* 🟡 **Required:** No enforcement for `.squad/` changes requiring 2 maintainer approvals — added branch ruleset requirement.
* 🟢 **Suggestion:** Added insider threat row to attack vector table — non-maintainer collaborators modifying governance files.
* 🟢 **Suggestion:** Expanded Squad-specific attack vectors (5 new rows) — governance tampering, history rewriting, attribution spoofing, etc.

**Changes Made:**

1. Updated CODEOWNERS block (line 191-207) — added `/.squad/ @Azure/apiops-maintainers` wildcard entry
2. Rewrote "Protecting Squad History" section (lines 319-371):
   - Added CAUTION block: maintainer-only access policy
   - Expanded protected files list to explicitly state "ALL files under `.squad/`"
   - Added "Access Control" subsection with CODEOWNERS wildcard, branch ruleset enforcement, no-bypass requirement
   - Reorganized mechanisms into Access Control, CI Gates, Repository Configuration
   - Added attack vector table with 5 Squad-specific threats + mitigations
   - Included GitHub docs links for CODEOWNERS and rulesets

**Overall Plan Assessment:** Strong security posture. Plan defends against all documented CVEs (CVE-2025-30066, CVE-2026-33634). No blockers. The 3 "Required" findings above were gaps specific to Squad governance, now resolved.

**Decision:** Wrote team decision to `.squad/decisions/inbox/securityexpert-squad-protection.md` documenting maintainer-only access requirement for `.squad/` files.

### 2026-05-15 — Two-Tier Auto-Labeling Policy

**Context:** User requested update to branch-maintenance-plan.adoc to replace blanket "no auto-labeling" ban with a two-tier policy. SecurityExpert had previously recommended this approach.

**Decision:** Two-tier auto-labeling policy adopted:

* **Tier 1 (Informational labels):** `question`, `bug`, `feature-request`, `documentation`, `duplicate` — MAY be auto-applied by bot with strict guardrails
* **Tier 2 (Policy labels):** `squad:*`, `go:*`, `priority:*`, `override:*`, `needs-human-review`, `external-contribution` — MUST remain human-only always

**Tier-1 Guardrails (all required):**

1. Content-only triggers — pattern matching on issue title/body only
2. No workflow triggers — no workflow may use Tier-1 label application as event trigger
3. Dedicated bot — GitHub App `apiops-bot` with label-only permissions
4. Circuit breaker — if >3 labels applied per issue → stop and alert
5. Human override — human can remove; bot MUST NOT re-apply
6. Audit logging — bot posts comment explaining why label was applied

**Changes Made:**

1. Updated "Foundational Principles" — changed "No auto-labeling" bullet to reflect two-tier policy (line 20, 37)
2. Added new "Auto-Labeling Policy" subsection (lines 66-107) with tier table, guardrails, and Tier-2 exclusions
3. Updated "Decision Authority" table — Labels row now shows Tier-1 bot applies (advisory) vs Tier-2 human-only (line 302)
4. Updated "Human-Only Actions" list — changed to "Applying Tier-2 labels" instead of "all labels" (line 310)
5. Updated "Safety Gates" section — added Tier-1 auto-labeling to advisory list with guardrails note (line 481)
6. Updated "Human-Only (Never Automated)" in Safety Gates — changed "Label application" to "Tier-2 label application" (line 487)
7. Updated "Appendix C: What Changed" — updated Triage row to reflect Tier-1 auto-apply capability (line 753)

**Security Rationale:** Tier-1 labels are purely informational and cannot trigger workflows or affect routing/priority. Guardrails prevent abuse (circuit breaker, audit trail, no re-application). Tier-2 labels control governance and must remain under human authority to prevent privilege escalation or routing manipulation.
