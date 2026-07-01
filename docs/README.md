# APIops CLI Documentation

**Manage Azure API Management as code — extract, version, and publish your APIM configuration with a single CLI.**

## Quick Links

| Guide | Description |
|-------|-------------|
| [Getting Started](getting-started.md) | Install and run your first extract → publish cycle in 10 minutes |
| [Command Reference](commands/) | Detailed docs for [extract](commands/extract.md), [publish](commands/publish.md), [init](commands/init.md) |
| [CI/CD Integration](ci-cd/) | Set up [GitHub Actions](ci-cd/github-actions.md) or [Azure DevOps](ci-cd/azure-devops.md) pipelines |
| [Walkthroughs](walkthrough/) | Step-by-step guides: [Air-gapped GitHub Actions](walkthrough/air-gapped-github-actions.md) (local registry or offline tarball), [Air-gapped Azure DevOps](walkthrough/air-gapped-azure-devops.md) (local registry or offline tarball) |

## How It Works

```mermaid
flowchart LR
    A[Azure APIM Instance] -->|apiops extract| B[Local Artifact Files]
    B -->|git commit| C[Version Control]
    C -->|Review & Merge| D[CI/CD Pipeline]
    D -->|apiops publish| E[Target APIM Instance]
```

1. **Extract** your APIM configuration into version-controlled files
2. **Review** changes through pull requests — diffs, approvals, audit trail
3. **Publish** to target environments with environment-specific overrides
4. **Automate** with CI/CD for continuous, incremental deployments

## Install

```bash
npm install -g @peterhauge/apiops-cli
```

Requires Node.js 22 or later.

## Key Features

- **Full APIM coverage** — APIs, products, backends, named values, policies, tags, subscriptions, gateways, and more
- **Filtered extraction** — Extract specific APIs with automatic transitive dependency resolution
- **Environment overrides** — Promote across dev/staging/prod with per-environment config
- **Incremental publish** — Deploy only changed resources via git diff
- **Dry-run mode** — Preview changes before applying them
- **CI/CD scaffolding** — `apiops init` generates GitHub Actions or Azure DevOps pipelines
- **Token substitution** — Replace `{#[TOKEN_NAME]#}` placeholders in config files with pipeline secrets before publish
- **Multiple auth methods** — Azure CLI, managed identity, workload identity (OIDC), service principal

## Documentation Structure

```
docs/
├── README.md                          ← You are here
├── getting-started.md                 — Quickstart guide
├── commands/
│   ├── extract.md                     — apiops extract reference
│   ├── publish.md                     — apiops publish reference
│   └── init.md                        — apiops init reference
├── guides/
│   ├── scenarios-and-workflows.md     — Portal-first vs code-first workflows
│   ├── authentication.md              — Auth methods for local dev and CI/CD
│   ├── filtering.md                   — Filter extraction to specific APIs
│   ├── environment-overrides.md       — Per-environment configuration
│   ├── incremental-publish.md         — Deploy only changed resources
│   ├── dry-run.md                     — Preview changes before publishing
│   ├── multi-environment.md           — Dev / staging / prod promotion
│   ├── multi-team-workflows.md        — Selective extraction, CODEOWNERS
│   ├── code-first-workflow.md         — IDE → git → CI/CD → APIM
│   ├── token-substitution.md          — Pipeline token/placeholder substitution
│   ├── prompt-files.md                — Copilot prompt files for APIOps tasks
│   └── migration-from-v1.md           — Migrate from Azure/apiops toolkit
├── ci-cd/
│   ├── github-actions.md              — GitHub Actions integration
│   ├── azure-devops.md                — Azure DevOps Pipelines integration
│   └── authentication-patterns.md     — CI/CD auth (OIDC, service principal)
├── reference/
│   ├── artifact-format.md             — Directory layout and file structure
│   ├── dependency-graph.md            — Transitive dependency resolution
│   ├── resource-types.md              — Supported APIM resource types
│   ├── configuration.md               — Config priority chain
│   ├── apim-glossary.md               — APIM terminology primer
│   └── exit-codes.md                  — CLI exit codes and meanings
├── architecture/
│   ├── overview.md                    — System design overview
│   └── design-principles.md           — Architecture principles
├── walkthrough/
│   ├── air-gapped-github-actions.md                    — Using `apiops` in air-gapped CI/CD (GitHub Actions)
│   ├── air-gapped-azure-devops.md                      — Using `apiops` in air-gapped CI/CD (Azure DevOps)
└── troubleshooting/
    ├── common-errors.md               — Error messages and solutions
    ├── debugging-guide.md             — Debugging with --log-level
    └── pipeline-recovery.md           — Recovering failed CI/CD runs
```

## Next Steps

New to APIops CLI? Start with the **[Getting Started](getting-started.md)** guide — you'll have a working extract → publish cycle in 10 minutes.
