# Setup GitHub Actions Identity for APIOps

> **How to use:** Open this file in VS Code with GitHub Copilot and ask
> Copilot to help you run through the steps. Copilot will prompt you for
> the required values and generate the exact CLI commands for your environment.

## Goal

Configure Azure AD federated credentials and GitHub repository secrets so the
APIOps extract and publish workflows can authenticate to Azure using OIDC
(no stored client secrets needed).

---

## Step 0 — Tool Authentication Check

**Copilot: Before proceeding, verify that all required tools are installed and authenticated.**

Run these checks and present results in a table:

### Check Azure CLI
```bash
az version
az account show --query "{Subscription:name, Account:user.name, TenantId:tenantId}" -o json
```

### Check GitHub CLI
```bash
gh auth status
```

### Present Status Table

Present the results to the user in this format:

```
🔐 Tool Authentication Status:

| Tool | Status | Account/User | Subscription/Org | Tenant/Details |
|------|--------|--------------|------------------|----------------|
| Azure CLI | ✅ Logged in | user@example.com | my-subscription | abc-123-... |
| GitHub CLI | ✅ Logged in | username | github.com | — |
```

**Status indicators:**
- ✅ Logged in — tool is authenticated and ready
- ❌ Not logged in — tool needs authentication
- ⚠️ Not installed — tool is missing entirely

### Fix Missing Authentication

**If Azure CLI is not logged in:**
> "Azure CLI is required for this setup. Run `az login` to authenticate, then I'll continue."

**If GitHub CLI is not logged in:**
> "GitHub CLI is required for configuring repository secrets. Run `gh auth login` to authenticate."

**If any required tool is not installed:**
- Azure CLI: Install from https://aka.ms/installazurecli
- GitHub CLI: Install from https://cli.github.com

Once both tools are authenticated, ask the user to confirm:
> "Does this authentication look correct? (yes / need to switch accounts)"

If the user needs to switch accounts, help them with:
- Azure CLI: `az account set --subscription <id>` or `az login --tenant <tenant-id>`
- GitHub CLI: `gh auth logout` then `gh auth login`

Once confirmed, proceed to Step 1.

---

## Step 1 — Gather Information

Copilot, please ask the user for the following values before proceeding. Store
each answer for use in later steps.

| Variable | Description | Example |
|----------|-------------|---------|
{{ENV_SUBSCRIPTION_TABLE_ROWS}}
| `AZURE_TENANT_ID` | Azure AD tenant ID (same for all environments) | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `GITHUB_ORG` | GitHub organization or user that owns the repo | `my-org` |
| `GITHUB_REPO` | GitHub repository name | `apim-artifacts` |
| `APP_NAME` | Display name for the Azure AD application | `apiops-github-sp` |
{{ENV_APIM_TABLE_ROWS}}

---

## Step 2 — Create Azure AD Application & Service Principal

> ⚠️ **Error Handling:** If any command fails, stop immediately and show the user the full error output verbatim. Do NOT retry silently. Common issues include insufficient permissions (requires Application Administrator or Global Administrator role in Azure AD).

**On macOS/Linux (Bash):**
```bash
# Create the Azure AD application
APP_ID=$(az ad app create \
  --display-name "${APP_NAME}" \
  --query appId -o tsv)

# Create the service principal for the application
az ad sp create --id "$APP_ID"

echo "Application (client) ID: $APP_ID"
echo "Tenant ID: $(az account show --query tenantId -o tsv)"
```

**On Windows (PowerShell):**
```powershell
# Create the Azure AD application
$APP_ID = az ad app create `
  --display-name "${APP_NAME}" `
  --query appId -o tsv

# Create the service principal for the application
az ad sp create --id $APP_ID

Write-Host "Application (client) ID: $APP_ID"
Write-Host "Tenant ID: $(az account show --query tenantId -o tsv)"
```

---

## Step 3 — Assign RBAC Roles

Grant the service principal the required permissions:
1. **Reader** role on each resource group (to read resource groups and resources)
2. **API Management Service Contributor** on each APIM instance (to manage APIM resources)

> **Note:** Each environment can be in a different Azure subscription. The service principal will be granted access to all environments.

### Grant Reader role on each resource group

{{ENV_READER_ROLE_SNIPPETS}}

### Grant API Management Service Contributor on each APIM instance

{{ENV_APIM_ROLE_SNIPPETS}}

---

## Step 4 — Create Federated Credentials for GitHub OIDC

> ⚠️ **Platform Note:** The JSON parameters for federated credentials require different escaping on Windows PowerShell vs macOS/Linux Bash. Use the appropriate command block for your platform.

### Main branch (for push-triggered publish workflow)

**On macOS/Linux (Bash):**
```bash
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"${GITHUB_ORG}"'/'"${GITHUB_REPO}"':ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

**On Windows (PowerShell):**
```powershell
az ad app federated-credential create `
  --id $APP_ID `
  --parameters '{\"name\":\"github-main-branch\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"repo:'${GITHUB_ORG}'/'${GITHUB_REPO}':ref:refs/heads/main\",\"audiences\":[\"api://AzureADTokenExchange\"]}'
```

{{ENV_FEDERATED_CREDENTIALS}}

---

## Step 5 — Create GitHub Environments

```bash
{{ENVIRONMENT_CREATION_COMMANDS}}
```

---

## Step 6 — Set GitHub Repository Secrets

> ⚠️ **Platform Note:** GitHub CLI secret commands work identically on all platforms, but variable syntax differs between Bash and PowerShell.

**On macOS/Linux (Bash):**
```bash
# Repository-level secrets (shared across all workflows)
gh secret set AZURE_CLIENT_ID --body "$APP_ID"
gh secret set AZURE_TENANT_ID --body "${AZURE_TENANT_ID}"

{{GH_SECRET_ENV_COMMANDS}}
```

**On Windows (PowerShell):**
```powershell
# Repository-level secrets (shared across all workflows)
gh secret set AZURE_CLIENT_ID --body $APP_ID
gh secret set AZURE_TENANT_ID --body "${AZURE_TENANT_ID}"

{{GH_SECRET_ENV_COMMANDS}}
```

---

## Step 7 — Verify

> ⚠️ **Important:** If any verification step fails, show the user the full error output and help troubleshoot before proceeding. Common issues include RBAC permissions not yet propagated (can take 5-10 minutes) or missing secrets.

1. Go to **Actions** → **Run APIM Extractor** → **Run workflow**
2. Fill in the resource group and service name for your dev environment
3. Confirm the workflow completes and a pull request is created

If the workflow fails with authentication errors:
- Check that all secrets are set correctly in GitHub: Settings → Secrets and variables → Actions
- Verify RBAC role assignments have propagated (wait 5-10 minutes and retry)
- Confirm the federated credentials were created: `az ad app federated-credential list --id $APP_ID`

---

## Secrets Reference

The generated workflows expect these secrets:

### Repository Secrets
- `AZURE_CLIENT_ID` — App registration client ID (shared across all environments)
- `AZURE_TENANT_ID` — Azure AD tenant ID (shared across all environments)

### Per-Environment Secrets
{{ENV_SECRETS_REFERENCE}}
