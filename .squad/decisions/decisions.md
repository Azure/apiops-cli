# Technical Decisions

All architectural and implementation decisions for apiops-cli.

---

### 2026-05-15: Two-Tier Auto-Labeling Policy
**Decided by:** Elizabeth Maher (maintainer)  
**Proposed by:** SecurityExpert  
**Status:** Approved  
**Scope:** Branch maintenance plan, workflow automation policy

**Summary:** Replace blanket "no auto-labeling" ban with two-tier auto-labeling policy:

**Tier 1 (Informational labels) — MAY be auto-applied:**
- `question`, `bug`, `feature-request`, `documentation`, `duplicate`

**Tier 2 (Policy labels) — MUST remain human-only:**
- `squad:*` (agent routing), `go:*` (action states), `priority:*` (severity/urgency), `override:*` (governance overrides), `needs-human-review` (escalation), `external-contribution` (provenance tracking)

**Why:** Tier-1 labels are purely informational, content-based only, cannot trigger workflows. Tier-2 labels control routing, priority, and governance — require strict human control. Required guardrails for Tier-1: content-only triggers, no workflow triggers, dedicated bot permissions, circuit breaker, human override, audit logging.

**Implementation:** Updated `cli-investigations/branch-maintenance-plan.adoc` (6 sections: auto-labeling policy, guardrails, decision authority table split, human-only actions list, safety gates, appendix C).

---

### 2026-05-15: Maintainer-Only Access to `.squad/` Files
**Proposed by:** SecurityExpert  
**Status:** Approved  
**Scope:** Squad governance protection

**Summary:** ONLY repository owners and maintainers may modify ANY files under `.squad/`. Applies to external contributors, internal collaborators, bots, and AI agents.

**Why:** `.squad/` directory contains sensitive configuration controlling agent routing, team structure, constitution, decisions, and ceremonies. Compromise could allow rerouting security-sensitive work, weakening code review, deleting decision history, or modifying agent charters. Defense against insider threats — common attack vector in open source.

**Implementation:**
- Add `/.squad/  @Azure/apiops-maintainers` to CODEOWNERS
- Require 2 maintainer approvals for ANY `.squad/` change in branch ruleset
- No bypass allowed (even for admins)

---

### 2026-04-29: CLI version uses package.json as single source of truth via ESM import attributes
**By:** NodeJsDev  
**Status:** Implemented  
**What:** The CLI version displayed by `apiops --version` is imported from `package.json` using ESM import attributes: `import packageJson from '../../package.json' with { type: 'json' }`. The Commander program uses `program.version(packageJson.version)` instead of a hardcoded string.  
**Why:** Eliminates version drift between package.json and CLI output. Previously, version was hardcoded in `src/cli/index.ts` (".version('0.1.0')") while package.json had "0.1.3-alpha.0". Now `npm version` automatically updates the CLI version with no manual synchronization required. This is the standard pattern for Node.js CLI tools and requires no runtime dependencies — uses native Node 22+ ESM features with TypeScript's `resolveJsonModule: true`.  
**Note:** Import syntax must use `with { type: 'json' }` not `assert { type: 'json' }` — TypeScript enforces the newer import attributes syntax (TS2880 error if using `assert`).

---
