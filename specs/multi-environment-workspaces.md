# Technical Memo: Multi-Environment Promotion & Workspace Interaction

**Author:** ApimExpert  
**Date:** 2026-05-14  
**Status:** Draft — for team discussion  
**Audience:** Project contributors and downstream consumers of apiops-cli

---

## 1. What the Project Already Supports

### 1.1 Environment Overrides (Implemented)

The tool has first-class environment override support today:

| Capability | Mechanism | Status |
|---|---|---|
| Per-environment property injection | `--overrides configuration.{env}.yaml` on `apiops publish` | ✅ Implemented |
| Override targets | `namedValues`, `backends`, `apis`, `diagnostics`, `loggers` | ✅ Implemented |
| Deep-merge semantics | Case-insensitive key match, wraps in `properties` envelope, merges into opaque JSON | ✅ Implemented |
| Pipeline scaffolding | `apiops init --environments dev,prod` generates `configuration.{env}.yaml` templates | ✅ Implemented |
| Multi-stage pipeline | Generated GitHub Actions / Azure DevOps YAML includes per-env stages | ✅ Implemented |
| Incremental publish | `COMMIT_ID` or `--commit-id` to only push changed files | ✅ Implemented |

**How it works today:**

```
repo/
├── apim-artifacts/         ← single set of canonical resource files
├── configuration.dev.yaml  ← dev overrides (backend URLs, secrets, loggers)
├── configuration.qa.yaml   ← qa overrides
└── configuration.prod.yaml ← prod overrides
```

The pipeline publishes the **same artifacts** to each APIM instance (or same instance) with a different `--overrides` file per stage. The environment name lives in the **override file name**, not in the artifact identity.

### 1.2 Workspaces (Implemented)

| Capability | Mechanism | Status |
|---|---|---|
| Workspace-scoped extraction | Filter `workspaceNames: [ws-1, ws-2]` in filter YAML | ✅ Implemented |
| Workspace-scoped publish | Reads `workspaces/{name}/` sub-tree, constructs ARM paths with workspace prefix | ✅ Implemented |
| Workspace artifact layout | `{output}/workspaces/{name}/{resource-type}/...` mirrors service-level structure | ✅ Implemented |
| Single handler, scope param | `ResourceDescriptor.workspace` field propagates to URI builder | ✅ Implemented |

---

## 2. Should Environment Names Appear in Artifact Paths?

**Recommendation: No. Keep environment identity external to artifact identity.**

### Arguments for keeping environment *outside* artifacts:

1. **Single source of truth.** One set of artifacts defines the API shape. Environments differ only in operational config (URLs, secrets, logger resource IDs). Duplicating the full artifact tree per env invites drift.

2. **Git-native promotion.** Merging branch → main triggers publish to all envs. No need to copy files between env-specific directories.

3. **Override system already handles divergence.** The `OverrideConfig` deep-merge is designed precisely to inject per-env values without changing the canonical files.

4. **Workspace names ARE part of artifact identity** (they represent structural scoping within APIM), while environment names represent deployment targets. Conflating them produces `workspaces/dev/apis/...` which is ambiguous — is "dev" a workspace or an environment?

### When you'd want env in the path:

- **Entirely different API surfaces per environment** (not just different URLs/secrets). This is rare and usually indicates a design problem in the API management layer.
- **Monorepo with multiple independent APIM instances.** Solved better by separate artifact roots (`infra/apim-dev/`, `infra/apim-prod/`) rather than env-in-artifact-path.

### Decision:

Environment stays in override file selection (`configuration.{env}.yaml`), CLI target flags (`--service-name`, `--resource-group`), and pipeline stages. Artifact files remain environment-neutral.

---

## 3. Workspace × Environment Interaction

### 3.1 What is an APIM Workspace?

An APIM **workspace** is a scoping boundary within a single APIM instance. It provides:

- Isolated API, product, backend, policy, and schema authoring
- Separate RBAC (workspace contributors can't see other workspaces)
- Separate gateways (workspace gateways route only workspace APIs)
- Its own subscription keys

Workspaces are **structural** — they organize resources within an instance. They are NOT environments.

### 3.2 Common Deployment Topologies

| Topology | Instances | Workspaces | How apiops-cli serves it |
|---|---|---|---|
| **A. One instance per env** | dev-apim, qa-apim, prod-apim | None or identical per instance | Publish same artifacts to each instance with different `--overrides`. Simplest. |
| **B. One instance, env per workspace** | 1 shared instance | `dev`, `qa`, `prod` workspaces | ⚠️ Awkward — see §3.3 below |
| **C. One instance per env, workspaces for teams** | dev-apim, prod-apim each with `team-a`, `team-b` workspaces | Workspace = team boundary | Publish workspace-scoped artifacts per team. Override file handles env delta. Clean. |
| **D. One instance, workspaces for teams, no env separation** | 1 shared instance | `team-a`, `team-b` | Override file keyed to the single target. No env promotion — direct publish. |
| **E. Workspace per API product + separate env instances** | dev-apim, prod-apim each with `payments`, `catalog` workspaces | Workspace = product boundary | Same as C but workspace = product instead of team. Clean. |

### 3.3 Why "Environment as Workspace" (Topology B) Is Awkward

Using workspace names to represent environments creates these problems:

1. **Artifact identity collision.** If you extract from `prod` workspace, artifacts land in `workspaces/prod/apis/...`. To promote to `dev` workspace, you'd need to *rewrite paths on disk* from `workspaces/prod/` → `workspaces/dev/`. The tool doesn't do this, and it shouldn't — path rewriting violates the passthrough principle.

2. **RBAC inversion.** Workspaces exist to give teams isolation. If your "dev" workspace and "prod" workspace contain the same APIs, you've created a single blast radius (same instance) without isolation benefit.

3. **No deployment-gate semantics.** APIM workspaces have no concept of promotion, approval gates, or deployment rings. That's a CI/CD concern. Mapping envs to workspaces conflates infrastructure scoping with deployment lifecycle.

4. **Named value secrets span instance.** Secrets in one workspace don't inherit from another. You'd duplicate named values across workspace boundaries *and* still need override files to inject per-workspace values — doubling the complexity with no gain.

5. **Gateway routing complexity.** Each workspace can have its own workspace gateway. If `dev` and `prod` are workspaces on the same instance, you now need to manage separate gateway routing for what should be isolated environments.

**Bottom line:** Workspaces are for *organizational scoping* (teams, products, domains). Environments are for *deployment lifecycle* (dev→qa→prod). Don't mix the axes.

---

## 4. Combination Assessment Matrix

| Combination | Sound? | Notes |
|---|---|---|
| Separate APIM instances per env, no workspaces | ✅ Sound | Simplest model. Override file handles env delta. |
| Separate instances per env, same workspaces in each | ✅ Sound | Workspaces = team/product boundary. Promote via override + target instance switch. |
| Single instance, workspaces = environments | ❌ Unsafe | Path rewriting required, no isolation benefit, RBAC doesn't map correctly. |
| Single instance, workspaces = teams, no env promotion | ⚠️ Limited | Fine for single-env scenarios (e.g., internal-only). No promotion story. |
| Single instance, workspace = team, override = "env" | ⚠️ Awkward | Override can vary values but you're deploying to the same instance — no true env isolation. "Environments" become config variations, not deployment boundaries. |

---

## 5. Capabilities Needed for First-Class Complex Combinations

If the project wanted to support the more complex topologies (B, or multi-instance + cross-workspace promotion), the following would need to exist:

### 5.1 Workspace Name Remapping (Not Recommended)

**What:** Rewrite `workspaces/{source}/` → `workspaces/{target}/` during publish.  
**Why needed:** Topology B requires it. Extract from `prod` workspace, publish to `dev` workspace.  
**Why problematic:** Violates passthrough principle (Constitution §VII). Creates a new class of errors (what about cross-workspace references in policies?). Breaks `--dry-run` predictability.  
**Alternative:** Don't. Use separate instances.

### 5.2 Multi-Target Publish (Enhancement — Worth Considering)

**What:** `apiops publish --targets targets.yaml` where targets.yaml defines multiple (instance, overrides) pairs.  
**Why needed:** Today each `apiops publish` targets one instance. Multi-env CI pipelines call it N times. A multi-target mode could parallelize this.  
**Complexity:** Low — it's syntactic sugar over N sequential publishes. No new APIM REST API surface needed.  
**Status:** Not specified, not implemented. Nice-to-have for CI efficiency.

### 5.3 Override Scoping to Workspace (Enhancement — Useful)

**What:** Override file supports workspace-scoped overrides:
```yaml
workspaces:
  team-a:
    backends:
      orders-backend:
        url: "https://prod-orders.internal"
  team-b:
    backends:
      catalog-backend:
        url: "https://prod-catalog.internal"
```
**Why needed:** Topology C/E — same override file, but different workspace resources need different values.  
**Complexity:** Medium. Requires extending `OverrideConfig` interface and `applyOverrides` to check `descriptor.workspace` before matching.  
**Status:** Not specified, not implemented.

### 5.4 Workspace Discovery (Enhancement — Useful)

**What:** Auto-list workspaces from the APIM instance instead of requiring explicit `workspaceNames` in filter.  
**Why needed:** Today workspace names must be manually enumerated in filter YAML. For instances with many workspaces, this is tedious.  
**Complexity:** Low. Add `GET .../workspaces?api-version=2024-05-01` to the client.  
**Status:** Not implemented (IApimClient doesn't list workspaces natively).

### 5.5 Cross-Instance Copy with Workspace Mapping (Not Recommended)

**What:** `apiops copy --source-instance A --target-instance B --workspace-map team-a:team-b`  
**Why needed:** Only if workspace names differ between instances (unusual).  
**Why problematic:** Workspace name mapping cascades into policy references, product associations, gateway bindings. The blast radius of a rename is unbounded.  
**Alternative:** Keep workspace names consistent across instances.

---

## 6. Recommended Approach for Documentation

Tell users:

1. **Use separate APIM instances for environment isolation.** This is Microsoft's recommendation and gives you true blast-radius separation.
2. **Use workspaces for team/product/domain isolation within an instance.** Keep the same workspace names across your dev/qa/prod instances.
3. **Promote via override files.** Same artifacts → same workspace structure → different operational values per environment.
4. **Don't use workspaces as environments.** If you find yourself wanting `workspaces/dev/` and `workspaces/prod/` on the same instance, you probably want separate instances instead.

### Decision flow for users:

```
Q: Do you have multiple teams managing APIs independently?
  → Yes: Use workspaces (one per team/product/domain)
  → No: Don't use workspaces

Q: Do you have multiple environments (dev/qa/prod)?
  → Yes: Use separate APIM instances + override files
  → No: Single publish, no override needed

Q: Can you afford separate instances?
  → Yes: One instance per env (recommended)
  → No: Single instance, accept shared blast radius,
         use override files to vary config but understand
         there's no true isolation
```

---

## 7. Summary of Recommendations

| # | Recommendation | Rationale |
|---|---|---|
| 1 | Environment identity stays in override file names and pipeline stages, not in artifact paths | Single source of truth, git-native promotion |
| 2 | Document "workspaces ≠ environments" explicitly in user docs | Prevent the most common architectural mistake |
| 3 | Consider workspace-scoped overrides (§5.3) as a future enhancement | Enables clean Topology C/E support |
| 4 | Consider workspace auto-discovery (§5.4) | Reduces manual config burden |
| 5 | Do NOT implement workspace name remapping (§5.1) | Violates passthrough principle, creates cascading breakage |
| 6 | Do NOT implement cross-instance workspace mapping (§5.5) | Unbounded blast radius from name changes |

---

*End of memo.*
