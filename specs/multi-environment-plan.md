# Multi-Environment Architecture Plan

**Author:** ApiOpsLead  
**Date:** 2025-06-02  
**Status:** Draft — Awaiting team review  
**Traces to:** Spec US-3 (CI/CD Integration), FR-004 (Override Config), US-4 (Init scaffolding)

---

## Problem Statement

Organizations operating multiple environments (dev / qa / staging / prod) that target the **same** Azure APIM instance (or separate instances per env) need clear guidance on how to:

1. Maintain a single source-of-truth artifact set while deploying environment-specific values.
2. Structure their git workflow so that changes flow through environments safely.
3. Avoid anti-patterns that lead to configuration drift or secret leakage.

This document evaluates decision axes, recommends defaults, and identifies feature gaps.

---

## Part 1: User-Facing Documentation (What We'd Ship to Users)

### Recommended Workflow: Single Artifact Set + Override Files

```
repo/
├── apim-artifacts/          # Extracted once from "golden" env (e.g., dev)
│   ├── apis/
│   ├── backends/
│   ├── named-values/
│   └── ...
├── configuration.extract.yaml       # Filter for extract
├── configuration.dev.yaml           # Override: dev environment
├── configuration.qa.yaml            # Override: qa environment
├── configuration.prod.yaml          # Override: prod environment
└── .github/workflows/
    └── publish.yml                  # Multi-stage: dev → qa → prod
```

**Key principles:**

1. **One set of artifacts.** Extract from your "source of truth" environment. Commit the artifacts to version control.
2. **Override files differentiate environments.** Backend URLs, named-value secrets, logger resource IDs, and diagnostic references vary per environment — override files express this.
3. **Pipeline stages gate promotion.** Each environment is a deployment stage with its own approval gate and `--overrides` file.

### Example: GitHub Actions Multi-Environment Publish

```yaml
# .github/workflows/publish.yml
name: Publish APIM Configuration
on:
  push:
    branches: [main]
    paths: ['apim-artifacts/**', 'configuration.*.yaml']

jobs:
  publish-dev:
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: |
          npx apiops publish \
            --subscription-id ${{ vars.AZURE_SUBSCRIPTION_ID }} \
            --resource-group ${{ vars.APIM_RESOURCE_GROUP }} \
            --service-name ${{ vars.APIM_SERVICE_NAME }} \
            --source ./apim-artifacts \
            --overrides ./configuration.dev.yaml

  publish-qa:
    needs: publish-dev
    runs-on: ubuntu-latest
    environment: qa  # requires approval
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: |
          npx apiops publish \
            --subscription-id ${{ vars.AZURE_SUBSCRIPTION_ID }} \
            --resource-group ${{ vars.APIM_RESOURCE_GROUP }} \
            --service-name ${{ vars.APIM_SERVICE_NAME }} \
            --source ./apim-artifacts \
            --overrides ./configuration.qa.yaml

  publish-prod:
    needs: publish-qa
    runs-on: ubuntu-latest
    environment: prod  # requires approval
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: |
          npx apiops publish \
            --subscription-id ${{ vars.AZURE_SUBSCRIPTION_ID }} \
            --resource-group ${{ vars.APIM_RESOURCE_GROUP }} \
            --service-name ${{ vars.APIM_SERVICE_NAME }} \
            --source ./apim-artifacts \
            --overrides ./configuration.prod.yaml
```

### Same Instance vs. Separate Instances

| Topology | Approach | Override Differences |
|----------|----------|-------------------|
| **Separate APIM instances** (one per env) | Different `--service-name` / `--resource-group` per stage | Backend URLs, loggers, Key Vault refs, subscription IDs |
| **Single APIM instance** (workspaces per env) | Same instance, different `--workspace` per stage | Workspace name is the differentiator; override files still customize values within the workspace |
| **Single instance, no workspaces** | ⚠️ Anti-pattern for multi-env | All envs share the same APIM resources — override files can't prevent collisions |

### Override File Authoring Guide

```yaml
# configuration.prod.yaml
namedValues:
  api-key:
    keyVault:
      secretIdentifier: "https://prod-kv.vault.azure.net/secrets/api-key"
  connection-string:
    keyVault:
      secretIdentifier: "https://prod-kv.vault.azure.net/secrets/conn-str"

backends:
  orders-backend:
    url: "https://orders.prod.contoso.com"
  payments-backend:
    url: "https://payments.prod.contoso.com"

loggers:
  appinsights:
    resourceId: "/subscriptions/.../providers/microsoft.insights/components/prod-ai"
```

**Rules:**
- Override keys are case-insensitive resource names matching the artifact directory.
- Values deep-merge into the resource JSON at publish time.
- Unknown keys produce a warning (not an error) — allows forward-declaration.
- **Never commit secret values to override files.** Use Key Vault references or inject at pipeline runtime.

### Branch Strategy Recommendations

| Strategy | When to Use | How |
|----------|-------------|-----|
| **Trunk-based (recommended)** | Teams that deploy the same API surface to all envs | Single `main` branch; pipeline stages handle env promotion with approvals |
| **Environment branches** | Teams with env-specific API surfaces (rare) | `main` → `env/qa` → `env/prod` via merge; each branch triggers its stage |
| **Feature branches + PR** | Standard dev workflow | Feature branch → PR → merge to `main` → pipeline deploys to dev → promote |

**Anti-pattern:** One branch per environment with *different* artifact sets. This causes drift and makes it impossible to know which environment has which API version.

---

## Part 2: Feature Assessment — What Exists vs. What We Need

### ✅ Capabilities That Exist Today (Document Now)

| Capability | Implementation | Spec Reference |
|------------|---------------|----------------|
| `--overrides <path>` flag on publish | `src/cli/publish-command.ts`, `src/services/override-merger.ts` | FR-004 |
| Override file deep-merge semantics | `applyOverrides()` in `override-merger.ts` | FR-004 |
| `apiops init --environments dev,prod` | `src/services/init-service.ts` generates `configuration.{env}.yaml` per env | US-4 |
| Generated multi-stage pipeline templates | `src/templates/` — GitHub Actions & Azure DevOps | US-3, US-4 |
| Incremental publish via `--commit-id` | `src/services/git-diff-service.ts` | FR-005 |
| `--dry-run` for publish preview | `src/cli/publish-command.ts` | FR-006 |
| Workspace-scoped extraction | `src/services/workspace-extractor.ts` | US-1 scenario 2 |
| Non-interactive mode (`--non-interactive`) | `src/cli/init-command.ts` | US-4 scenario 6 |

**Verdict:** The core multi-environment publish workflow (single artifact set + override files + multi-stage pipeline) is **fully functional today**. This can be documented immediately.

### 🟡 Features Needing Enhancement (Small Increments)

| Feature | Gap | Effort | Priority |
|---------|-----|--------|----------|
| **Workspace-scoped publish** | `--workspace <name>` flag on publish to target a specific workspace | S (flag plumbing + scope prefix on resource URIs) | P2 — needed only for "single instance, workspace-per-env" topology |
| **Override file validation** | `apiops publish --dry-run` doesn't report unresolved override keys (e.g., typo in resource name) | S (add warning pass before apply) | P2 — improves confidence |
| **Multi-override file support** | Allow `--overrides a.yaml --overrides b.yaml` for layered overrides (base + env-specific) | S (accept array, merge in order) | P3 — nice-to-have for large orgs |
| **Init: workspace topology option** | `apiops init` asks "separate instances or single instance with workspaces?" and adjusts templates | M (conditional template logic) | P3 — documentation can cover without code |

### 🔴 Features That Would Require New Spec Work

| Feature | Description | Why New Spec Needed |
|---------|-------------|-------------------|
| **`--workspace` flag on publish** | Target a specific APIM workspace during publish | Changes resource URI construction; needs architectural review of `ApimServiceContext` |
| **Environment promotion command** | `apiops promote --from dev --to qa` — copies artifacts + transforms overrides | New command; YAGNI §V applies — existing `publish --overrides` achieves the same goal |
| **Override secret injection from pipeline** | `${env.SECRET_NAME}` variable expansion in override YAML at publish time | Template engine inside override parser; security review needed (§VIII) |
| **Multi-instance extract diff** | Compare extracted artifacts across two APIM instances | New command scope; not in current spec |

---

## Decision Axes Evaluation

### Axis 1: Artifact Naming on Disk

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Single directory** (e.g., `apim-artifacts/`) | Simple; one source of truth; overrides provide differentiation | Requires discipline — don't commit env-specific values into artifacts | ✅ **Recommended default** |
| **Per-environment directories** (`artifacts-dev/`, `artifacts-prod/`) | Isolation; each env has its own state | Drift; duplication; harder to review diffs; no round-trip fidelity | ❌ Anti-pattern |
| **Per-workspace directories** (auto-generated on extract from multi-workspace instance) | Already supported; `workspaces/{name}/` nested inside artifact dir | Only applicable when using APIM workspaces | ✅ Supported, orthogonal to env strategy |

### Axis 2: Branch Strategy

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Trunk-based + pipeline stages** | Single truth; PR-driven changes; approvals at deployment gates | All envs see same API definition (by design) | ✅ **Recommended default** |
| **Environment branches** | Can hold env-specific APIs | Merge conflicts; drift; audit difficulty | ⚠️ Document as escape hatch only |
| **Branch-per-APIM-instance** | Fully independent instances | No promotion path; defeats purpose of API lifecycle | ❌ Anti-pattern |

### Axis 3: APIM Workspace Usage

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Separate instances per env** | Full isolation; easiest mental model | Higher Azure cost; more RBAC to manage | ✅ **Recommended for most orgs** |
| **Single instance + workspaces per env** | Cost-efficient; centralized governance | Requires workspace-scoped publish (🟡 not yet implemented); shared gateway | ⚠️ Document as alternative once `--workspace` ships |
| **Single instance, no workspaces** | Minimal Azure cost | No isolation; all envs share namespace; ❌ cannot differentiate resources | ❌ Anti-pattern for multi-env |

### Anti-Pattern Combinations (Explicitly Called Out)

1. **Per-env artifact directories + trunk-based branching** — Confusing: which directory is authoritative? Overrides exist to solve this.
2. **Environment branches + single APIM instance without workspaces** — Branch divergence creates publish conflicts; no isolation on target.
3. **Committing secrets to override files** — Violates Constitution §VIII. Always use Key Vault references or inject at runtime.
4. **Extracting from prod, publishing to dev** — Reverse flow. Extract from the "lowest" env (dev) as source of truth; promote forward.

---

## Minimum Feature Increments

To support the recommended user experience, **in priority order**:

### Increment 0: Documentation Only (No Code Changes)
- Multi-environment guide in `/docs/guides/multi-environment.md`
- Override file authoring reference
- Pipeline template examples for 3-stage deployment
- Branch strategy recommendations
- **Can ship immediately** — all required capabilities exist

### Increment 1: Override Validation (Small)
- Warn on unresolved override keys during `--dry-run`
- Report which overrides were applied vs. unused
- Improves confidence for multi-env deployments

### Increment 2: Workspace-Scoped Publish (Medium)
- `--workspace <name>` flag on `apiops publish`
- Adjusts resource URI prefix to target workspace scope
- Enables "single instance + workspace per env" topology
- Requires spec addition (new flag on existing command)

### Increment 3: Layered Overrides (Small)
- Allow multiple `--overrides` files, merged in order
- Enables `base.yaml` + `env.yaml` pattern for DRY configuration
- Low risk; additive to existing behavior

---

## Requirement Gaps for Future Spec

These should be added to a future spec revision or new feature spec:

1. **`--workspace` flag on publish** — Not in current spec. Needs: flag definition, interaction with `--delete-unmatched`, scope prefix logic, test scenarios.
2. **Override variable expansion** — Template syntax (`${ENV_VAR}`) in override files for runtime secret injection. Needs: security review, escaping rules, error handling for missing vars.
3. **Override validation reporting** — Structured output of which overrides were applied, which were unused, which had type mismatches.
4. **`apiops diff` between environments** — Compare what's deployed on two instances/workspaces. Entirely new command; would need its own spec.
5. **Init topology awareness** — `apiops init` could ask about multi-env topology and generate documentation/override structure accordingly. Enhancement to US-4.

---

## Summary

The **recommended default** for multi-environment deployment is:

> **Single artifact directory + trunk-based branching + override files per environment + multi-stage pipeline with approval gates.**

This is **fully supported today** with existing `--overrides` and `apiops init --environments` capabilities. The primary deliverable is **documentation**, not new features. Enhancement increments (override validation, workspace-scoped publish, layered overrides) improve the experience but are not blockers for the recommended workflow.
