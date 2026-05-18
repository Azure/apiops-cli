# Decision: Multi-Environment Deployment Architecture

**By:** ApiOpsLead  
**Date:** 2026-06-02  
**Status:** Proposed  

## Decision

The recommended default for multi-environment (dev/qa/prod) deployment with apiops-cli is:

> **Single artifact directory + trunk-based branching + override files per environment + multi-stage pipeline with approval gates.**

This is fully supported today with existing capabilities (`--overrides`, `apiops init --environments`). The primary deliverable is documentation (`/docs/guides/multi-environment.md`), not new code.

## Anti-Patterns (Explicitly Rejected)

1. Per-environment artifact directories — causes drift
2. Environment branches with single APIM instance — no isolation
3. Committing secrets to override files — violates §VIII
4. Extracting from prod, publishing to dev — reverse flow

## Future Enhancements (Not Blockers)

- `--workspace` flag on publish (needs spec work)
- Override validation warnings in `--dry-run`
- Multiple `--overrides` file support for layered config

## Artifact

Full analysis: `specs/multi-environment-plan.md`
