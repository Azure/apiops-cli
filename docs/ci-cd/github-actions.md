# GitHub Actions Integration

apiops-cli generates ready-to-use GitHub Actions workflows for extracting and publishing APIM configuration. This guide walks through setup, configuration, and customization.

## Prerequisites

- An Azure API Management instance (dev and optionally prod)
- A GitHub repository for your APIM configuration
- An App Registration in Microsoft Entra ID with [federated credentials](#oidc--federated-credentials) for your repo
- Node.js 22.x (used in workflows)

---

## Quick Setup

The fastest way to get started is with `apiops init`:

```bash
apiops init --ci github-actions
```

This generates:

```
.github/
└── workflows/
    ├── run-extractor.yaml    # Manual extract workflow
    └── run-publisher.yaml    # Publish on push to main
```

> If you also want Azure DevOps pipelines, omit the `--ci` flag and select interactively, or use `--ci azure-devops`.

---

## Extract Workflow

**File:** `.github/workflows/run-extractor.yaml`  
**Trigger:** Manual (`workflow_dispatch`)

The extract workflow pulls configuration from your APIM instance and creates a PR with the changes.

### Inputs

| Input | Description | Options |
|-------|-------------|---------|
| `ENVIRONMENT` | Which APIM instance to extract from | `dev`, `prod` |
| `CONFIGURATION_YAML_PATH` | Extract all APIs or use a filter file | `Extract All APIs`, `configuration.extractor.yaml` |

### What It Does

1. **Validates secrets** — checks that required secrets are configured for the selected environment.
2. **Checks out the repository** and installs Node.js 22 + npm dependencies.
3. **Authenticates with Azure** using `azure/login@v2` with OIDC federated credentials.
4. **Runs `apiops extract`** — either extracting all APIs or using a filter configuration file.
5. **Uploads artifacts** — stores extracted files as a GitHub Actions artifact (30-day retention).
6. **Creates a pull request** — opens a PR with the extracted changes on a new branch (`apim-extract-<run-id>`).

### Permissions Required

```yaml
permissions:
  id-token: write          # OIDC token for Azure login
  contents: write          # Push extracted files
  pull-requests: write     # Create PR with changes
```

### Running the Workflow

1. Go to **Actions** → **Run APIM Extractor** → **Run workflow**.
2. Select the environment (`dev` or `prod`).
3. Choose whether to extract all APIs or use a filter file.
4. Click **Run workflow**.
5. When complete, review and merge the auto-created PR.

---

## Publish Workflow

**File:** `.github/workflows/run-publisher.yaml`  
**Trigger:** Push to `main` (when artifact or config files change) + manual `workflow_dispatch`

The publish workflow deploys APIM configuration to your target environment.

### Automatic Trigger

The workflow runs automatically when changes are pushed to `main` in these paths:

- `<artifact-dir>/**` — any change to extracted artifacts
- `configuration.*.yaml` — any change to configuration files

### Manual Trigger Inputs

| Input | Description | Options |
|-------|-------------|---------|
| `COMMIT_ID_CHOICE` | Incremental (last commit) or full publish | `publish-artifacts-in-last-commit`, `publish-all-artifacts-in-repo` |
| `ENVIRONMENT` | Which APIM instance to publish to | Per your configured environments (e.g., `dev`, `prod`) |

### What It Does

1. **Resolves the commit ID** — captures `GITHUB_SHA` for incremental publish.
2. **Checks out the repository** with `fetch-depth: 2` (needed for git diff).
3. **Authenticates with Azure** using OIDC federated credentials.
4. **Substitutes tokens** — replaces `{#[TOKEN_NAME]#}` placeholders in `configuration.<env>.yaml` with pipeline secret values.
5. **Runs `apiops publish`** in one of two modes:
   - **Incremental** (default): uses `--commit-id` to publish only changed files.
   - **Full**: publishes all artifacts in the repository (useful for recovery or initial setup).

### Permissions Required

```yaml
permissions:
  id-token: write      # OIDC token for Azure login
  contents: read       # Read artifact files
```

### Incremental vs. Full Publish

| Mode | When to use | Command |
|------|------------|---------|
| **Incremental** (default) | Normal deployments — only deploys what changed in the last commit | `apiops publish --commit-id <sha>` |
| **Full** | Recovery after failed publish, initial setup, or force-sync | `apiops publish` (no `--commit-id`) |

> **Tip:** If a publish fails partway through, re-run the workflow manually with `publish-all-artifacts-in-repo` to ensure full consistency.

---

## Environment and Secrets Configuration

### GitHub Environments

Create a GitHub environment for each target APIM instance:

1. Go to **Settings** → **Environments** → **New environment**.
2. Create environments matching your workflow (e.g., `dev`, `prod`).
3. Optionally add protection rules (required reviewers, wait timer) for production.

### Required Secrets

Configure these secrets in each GitHub environment:

| Secret | Description | Example |
|--------|-------------|---------|
| `AZURE_CLIENT_ID` | App Registration client ID | `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` |
| `AZURE_TENANT_ID` | Microsoft Entra ID tenant ID | `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID | `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` |
| `APIM_RESOURCE_GROUP_DEV` | Resource group for dev APIM | `rg-apim-dev` |
| `APIM_SERVICE_NAME_DEV` | Dev APIM service name | `apim-contoso-dev` |
| `APIM_RESOURCE_GROUP_PROD` | Resource group for prod APIM | `rg-apim-prod` |
| `APIM_SERVICE_NAME_PROD` | Prod APIM service name | `apim-contoso-prod` |

> **Note:** `APIM_RESOURCE_GROUP_*` and `APIM_SERVICE_NAME_*` secrets are suffixed with the environment name in uppercase (e.g., `_DEV`, `_PROD`). The extract workflow selects the right secret based on the `ENVIRONMENT` input.

---

## OIDC / Federated Credentials

OIDC (OpenID Connect) lets GitHub Actions authenticate to Azure without storing secrets. Instead, GitHub's OIDC provider issues a short-lived token that Azure trusts.

### Setup Steps

1. **Create an App Registration** in Microsoft Entra ID:
   ```bash
   az ad app create --display-name "apiops-github-actions"
   ```

2. **Create a service principal:**
   ```bash
   az ad sp create --id <app-id>
   ```

3. **Add federated credentials** for your GitHub repository:
   ```bash
   # For the "dev" environment
   az ad app federated-credential create --id <app-id> --parameters '{
     "name": "github-dev",
     "issuer": "https://token.actions.githubusercontent.com",
     "subject": "repo:<owner>/<repo>:environment:dev",
     "audiences": ["api://AzureADTokenExchange"]
   }'

   # For the "prod" environment
   az ad app federated-credential create --id <app-id> --parameters '{
     "name": "github-prod",
     "issuer": "https://token.actions.githubusercontent.com",
     "subject": "repo:<owner>/<repo>:environment:prod",
     "audiences": ["api://AzureADTokenExchange"]
   }'
   ```

4. **Assign RBAC roles** on your APIM instances:
   ```bash
   az role assignment create \
     --assignee <app-id> \
     --role "API Management Service Contributor" \
     --scope /subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<apim-name>
   ```

5. **Add secrets** to your GitHub environments (see [Required Secrets](#required-secrets)).

For more on authentication methods, see the [Authentication Guide](../guides/authentication.md).

---

## Customization Tips

### Adding Approval Gates

Use GitHub environment protection rules for production deployments:

1. Go to **Settings** → **Environments** → **prod**.
2. Check **Required reviewers** and add team members.
3. Optionally add a **Wait timer** (e.g., 5 minutes).

The publish workflow will pause and wait for approval before deploying to prod.

### Using Token Substitution

To replace `{#[TOKEN_NAME]#}` placeholders in your configuration YAML with pipeline secrets, add the secret mappings to the `env:` block of the generated substitution step:

```yaml
- name: Substitute tokens in configuration.prod.yaml
  uses: cschleiden/replace-tokens@v1.3
  with:
    tokenPrefix: '{#['
    tokenSuffix: ']#}'
    files: '["configuration.prod.yaml"]'
  env:
    MY_SECRET: ${{ secrets.MY_SECRET }}
    BACKEND_URL: ${{ secrets.BACKEND_URL }}
```

See the [Token Substitution Guide](../guides/token-substitution.md) for full details, including migration from APIOps Toolkit.

### Adding Environment Overrides

To use [environment-specific overrides](../guides/environment-overrides.md), add the `--overrides` flag to the publish step in the workflow:

```yaml
- name: Publish to prod
  run: |
    npx apiops publish \
      --subscription-id ${{ secrets.AZURE_SUBSCRIPTION_ID }} \
      --resource-group ${{ secrets.APIM_RESOURCE_GROUP_PROD }} \
      --service-name ${{ secrets.APIM_SERVICE_NAME_PROD }} \
      --source apim-artifacts \
      --overrides overrides.prod.yaml
```

### Chaining Environments

To deploy to staging first, then prod (with approval), modify the publish workflow to add dependencies between environment jobs:

```yaml
publish-prod:
  needs: [get-commit, publish-staging]
  environment: prod
  # ... same steps as other env jobs
```

### Dry Run Before Deploy

Add a dry-run step before the actual publish to preview changes:

```yaml
- name: Dry run
  run: |
    npx apiops publish --dry-run \
      --subscription-id ${{ secrets.AZURE_SUBSCRIPTION_ID }} \
      --resource-group ${{ secrets.APIM_RESOURCE_GROUP_PROD }} \
      --service-name ${{ secrets.APIM_SERVICE_NAME_PROD }} \
      --source apim-artifacts
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `AADSTS70025` or `AADSTS700213` | Federated credential subject doesn't match | Verify the subject uses `repo:<owner>/<repo>:environment:<env>` format |
| `AuthorizationFailed` | Missing RBAC role | Assign **API Management Service Contributor** to the App Registration |
| `APIM_RESOURCE_GROUP secret is not set` | Secret not configured for the environment | Add `APIM_RESOURCE_GROUP_DEV` / `APIM_RESOURCE_GROUP_PROD` to the correct GitHub environment |
| Extract succeeds but PR is empty | No changes detected | Artifacts match what's already in the repo — no new changes to commit |
| Publish runs on every push | Path filter too broad | Ensure the `paths` filter in the workflow matches only your artifact directory |
| `id-token: write` permission error | Workflow missing OIDC permission | Add `permissions: id-token: write` to the workflow or job |

For authentication issues, see the [Authentication Guide](../guides/authentication.md#troubleshooting).

## Related

- [Authentication Guide](../guides/authentication.md) — all auth methods and RBAC roles
- [Environment Overrides](../guides/environment-overrides.md) — per-environment configuration
- [Token Substitution](../guides/token-substitution.md) — pipeline placeholder substitution with `{#[TOKEN_NAME]#}`
- [Scenarios and Workflows](../guides/scenarios-and-workflows.md) — portal-first vs. code-first patterns
