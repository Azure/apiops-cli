# Getting Started

**Estimated time:** 10 minutes

Extract your Azure API Management configuration, version it in git, and publish to a target environment — all from the command line.

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js** | v22 or later ([download](https://nodejs.org/)) |
| **Azure CLI** | Installed and authenticated (`az login`) |
| **Azure subscription** | With an existing APIM instance |
| **RBAC roles** | **API Management Service Contributor** + **Reader** on the APIM resource |

## Install

```bash
npm install -g @peterhauge/apiops-cli
```

Verify the installation:

```bash
apiops --version
```

---

## 1. Extract APIM Configuration

Pull your entire APIM configuration into local files:

```bash
apiops extract \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --resource-group my-rg \
  --service-name my-apim \
  --output ./apim-artifacts
```

> **Tip:** Set `AZURE_SUBSCRIPTION_ID` as an environment variable to omit `--subscription-id` from every command.

This creates a directory tree under `./apim-artifacts` with all your APIM resources as JSON and XML files.

## 2. Inspect the Extracted Files

```bash
ls ./apim-artifacts
```

You'll see directories for each resource type — `apis/`, `backends/`, `namedValues/`, `products/`, `policies/`, and more. Each resource is a separate file, ready for version control.

## 3. Filter Extraction to Specific APIs

Extract only the APIs you care about. Create a `filter.yaml`:

```yaml
apiNames:
  - pet-store-api
  - user-api
```

```bash
apiops extract \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --resource-group my-rg \
  --service-name my-apim \
  --output ./apim-artifacts \
  --filter filter.yaml
```

Referenced backends, named values, and policy fragments are included automatically (transitive dependencies). Use `--no-transitive` to disable this.

## 4. Publish to a Target Environment

Create `overrides.prod.yaml` for environment-specific values:

```yaml
namedValues:
  backend-url:
    value: "https://api.prod.example.com"
backends:
  my-backend:
    url: "https://api.prod.example.com"
```

Publish to your target APIM instance:

```bash
apiops publish \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --resource-group prod-rg \
  --service-name prod-apim \
  --source ./apim-artifacts \
  --overrides overrides.prod.yaml
```

## 5. Preview Changes with Dry-Run

See what would change without modifying the target instance:

```bash
apiops publish \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --resource-group prod-rg \
  --service-name prod-apim \
  --source ./apim-artifacts \
  --overrides overrides.prod.yaml \
  --dry-run
```

Dry-run output shows each resource that would be created, updated, or deleted — without making any changes.

## 6. Scaffold a CI/CD Pipeline

Generate pipeline files, sample configs, and directory structure for your repository:

```bash
apiops init --ci github-actions
```

Or for Azure DevOps:

```bash
apiops init --ci azure-devops
```

This creates:
- CI/CD pipeline definitions
- Sample `filter.yaml` and `overrides.{env}.yaml` files
- Artifact directory structure

See `apiops init --help` for additional options like `--environments`, `--artifact-dir`, and `--non-interactive`.

## 7. Incremental Publish in CI/CD

In your pipeline, the CLI automatically detects `COMMIT_ID` to publish only changed resources:

```yaml
# GitHub Actions example
- run: |
    apiops publish \
      --subscription-id ${{ vars.AZURE_SUBSCRIPTION_ID }} \
      --resource-group ${{ vars.APIM_RG }} \
      --service-name ${{ vars.APIM_NAME }} \
      --overrides overrides.${{ vars.ENV }}.yaml
  env:
    COMMIT_ID: ${{ github.sha }}
```

When `COMMIT_ID` is set, only resources changed since that commit are deployed — faster pipelines, smaller blast radius.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Success |
| `1`  | Partial failure — some resources failed, others succeeded |
| `2`  | Fatal error — command could not run |

---

## What's Next

| Topic | Link |
|-------|------|
| **Extract command reference** | [commands/extract.md](commands/extract.md) |
| **Publish command reference** | [commands/publish.md](commands/publish.md) |
| **Init command reference** | [commands/init.md](commands/init.md) |
| **Filtering guide** | [guides/filtering.md](guides/filtering.md) |
| **Environment overrides** | [guides/environment-overrides.md](guides/environment-overrides.md) |
| **Authentication methods** | [guides/authentication.md](guides/authentication.md) |
| **GitHub Actions setup** | [ci-cd/github-actions.md](ci-cd/github-actions.md) |
| **Azure DevOps setup** | [ci-cd/azure-devops.md](ci-cd/azure-devops.md) |
| **Troubleshooting** | [troubleshooting/common-errors.md](troubleshooting/common-errors.md) |

← Back to [Documentation Home](README.md)
