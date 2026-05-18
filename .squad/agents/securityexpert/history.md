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

### 2025-07-14 — Repository Maintenance Plan: Security Section with Threat Model and Mitigation Strategy

**Contribution:** Wrote Security section for `docs/repo-maintenance-plan.adoc` covering:

1. **Threat Model Overview** — Comprehensive table of 15 attack vectors organized by threat actor (external attacker, fork PR submitter, internal collaborator) and impact:
   - V1: Workflow injection via fork PR (CVE-2025-30066 class) — mitigated by pin-to-SHA
   - V2: Secret exfiltration via Actions — mitigated by no `GITHUB_TOKEN` in workflows
   - V3-V5: Dependency hijacking (npm, GitHub Actions, container) — mitigated by audit, pinning, SBOMs
   - V6: CODEOWNERS bypass — mitigated by branch protection with 2-maintainer approval
   - V7-V10: Automated workflow exploitation — mitigated by safe-outputs constraints
   - V11-V15: gh-aw specific risks (jailbreaking, constraint bypass, label governance) — mitigated by guardrails documented above

2. **Mitigation Layers** — Five defensive rings:
   - Layer 1: Access Control (CODEOWNERS, branch protection, 2-maintainer approval)
   - Layer 2: CI Gates (automatic workflow validation, SCA scanning, signature verification)
   - Layer 3: Dependency Management (npm audit, Trivy, SBOM generation, pinned versions)
   - Layer 4: Squad Governance (history protection, decision audit trail, maintainer-only modifications)
   - Layer 5: Incident Response (audit logging, rollback procedures, security advisory process)

3. **gh-aw Adoption Guardrails** — Seven mandatory controls for conditional adoption:
   - Comment provenance banners
   - Re-application prevention
   - Tier-2 label segregation
   - Compiled output protection
   - Cross-invocation limits
   - Unicode/case pattern validation
   - Fallback plan for revert

4. **Supply Chain Security Controls** — npm audit automation, Trivy for vulnerability scanning, SBOM tracking, Action pinning (full SHA), and 14-day SLA for critical patches.

All findings integrated with gh-aw security assessment and executable guardrails for team implementation.


### 2026-05-15 — Two-Tier Auto-Labeling Policy

**Context:** User requested update to branch-maintenance-plan.adoc to replace blanket "no auto-labeling" ban with a two-tier policy. SecurityExpert had previously recommended this approach.

### 2026-06-11 — GitHub Agentic Workflows (gh-aw) Security Assessment

**Context:** Evaluated gh-aw safe-outputs security model vs. current GitHub App + `actions/github-script` model for branch maintenance workflows. Requested by Elizabeth Maher.

**Key Findings:**

* ✅ Safe-outputs provide stronger least-privilege enforcement than current "App token + arbitrary JS" model
* ✅ Declarative constraints (`allowed`/`blocked`/`max`) are more auditable than inline JavaScript permission logic
* ✅ Read-only agent + separate write job is architecturally superior separation of concerns
* ⚠️ NEW attack surface: Prompt injection (V11) — mitigated by safe-output constraints bounding blast radius
* ⚠️ NEW attack surface: Glob pattern bypass via Unicode confusables (V12) — requires pre-deployment testing
* 🔴 CRITICAL: Tier-2 labels MUST NEVER be used as `label_command:` triggers — auto-removal destroys governance audit trail (V13)
* 🔴 CRITICAL: `close-issue` and `dispatch-workflow` outputs must NEVER be enabled for triage workflows
* ⚠️ Comment content is the weakest safe-output — `max: 1` prevents spam but agent controls content (social engineering vector)
* ⚠️ Framework supply chain (V15) — low probability but catastrophic; maintain fallback traditional workflows

**Verdict:** CONDITIONAL ADOPT — gh-aw is net security improvement for Tier-1 labeling/triage workflows. Must NOT be used for label sync, @copilot assignment, or governance-affecting workflows.

**New Threat Vectors Added:** V11 (Agent Jailbreaking), V12 (Constraint Bypass), V13 (label_command Governance Gap), V14 (Lock.yml Tampering), V15 (Framework Supply Chain)

**Decision:** Wrote team decision to `.squad/decisions/inbox/securityexpert-ghaw-security.md`

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
