# Decision: Multi-Environment Promotion & Workspace Interaction

**By:** ApimExpert  
**Date:** 2026-05-14  
**Status:** Proposed  

## Decision

1. Environment identity stays in override file names and pipeline stages — NOT in artifact paths on disk.
2. Workspaces represent structural scoping (teams/products/domains), not environments.
3. The tool should NOT implement workspace name remapping (rewriting `workspaces/X/` → `workspaces/Y/` during publish).
4. Future enhancement: workspace-scoped overrides in the override YAML schema.
5. Future enhancement: workspace auto-discovery via `GET .../workspaces`.

## Rationale

- Single source of truth: duplicating artifacts per environment invites configuration drift.
- Constitution §VII (Forward Compatibility / Passthrough): Path rewriting mutates opaque data, creating a new class of breakage.
- APIM workspaces lack deployment-gate semantics — promotion is a CI/CD concern, not an APIM workspace concern.
- The existing override system already handles all environment-specific divergence (URLs, secrets, logger resource IDs).

## Artifacts

- `specs/multi-environment-workspaces.md` — full technical memo with topology matrix, combination assessment, and recommended user guidance.

## Next Steps

- Team review of the memo
- If approved: incorporate guidance into user-facing docs (`/docs/guides/multi-environment.md`)
- If workspace-scoped overrides are desired: spec the `OverrideConfig` extension
