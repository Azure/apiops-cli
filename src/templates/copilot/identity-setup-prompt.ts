// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * GitHub Copilot prompt template for automating identity setup.
 * Generates a .prompt.md file that guides Copilot through:
 *   1. Gathering Azure & GitHub info from the user
 *   2. Creating Azure AD app registration + federated credentials
 *   3. Assigning RBAC roles
 *   4. Setting GitHub repository secrets
 */

export interface IdentitySetupPromptConfig {
  environments: string[];
}

export function generateIdentitySetupPrompt(config: IdentitySetupPromptConfig): string {
  const envSecrets = config.environments.map((env) =>
    `- \`AZURE_SUBSCRIPTION_ID\` — Azure subscription ID for **${env}** environment
- \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\` — Resource group containing the **${env}** APIM instance
- \`APIM_SERVICE_NAME_${env.toUpperCase()}\` — APIM service name for **${env}**`
  ).join('\n');

  const envFedCreds = config.environments.map((env) =>
    `### ${env} environment

**On macOS/Linux (Bash):**
\`\`\`bash
az ad app federated-credential create \\
  --id "$APP_ID" \\
  --parameters '{
    "name": "github-env-${env}",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"\${GITHUB_ORG}"'/'"\${GITHUB_REPO}"':environment:${env}",
    "audiences": ["api://AzureADTokenExchange"]
  }'
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
az ad app federated-credential create \`
  --id $APP_ID \`
  --parameters '{\\"name\\":\\"github-env-${env}\\",\\"issuer\\":\\"https://token.actions.githubusercontent.com\\",\\"subject\\":\\"repo:'\${GITHUB_ORG}'/'\${GITHUB_REPO}':environment:${env}\\",\\"audiences\\":[\\"api://AzureADTokenExchange\\"]}'
\`\`\``
  ).join('\n\n');

  const ghSecretEnvCmds = config.environments.map((env) =>
    `# ${env} environment secrets
gh secret set AZURE_SUBSCRIPTION_ID --body "\${AZURE_SUBSCRIPTION_ID_${env.toUpperCase()}}" --env ${env}
gh secret set APIM_RESOURCE_GROUP_${env.toUpperCase()} --body "\${APIM_RG_${env.toUpperCase()}}" --env ${env}
gh secret set APIM_SERVICE_NAME_${env.toUpperCase()} --body "\${APIM_NAME_${env.toUpperCase()}}" --env ${env}`
  ).join('\n\n');

  return `# Setup GitHub Actions Identity for APIOps

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
\`\`\`bash
az version
az account show --query "{Subscription:name, Account:user.name, TenantId:tenantId}" -o json
\`\`\`

### Check GitHub CLI
\`\`\`bash
gh auth status
\`\`\`

### Present Status Table

Present the results to the user in this format:

\`\`\`
🔐 Tool Authentication Status:

| Tool | Status | Account/User | Subscription/Org | Tenant/Details |
|------|--------|--------------|------------------|----------------|
| Azure CLI | ✅ Logged in | user@example.com | my-subscription | abc-123-... |
| GitHub CLI | ✅ Logged in | username | github.com | — |
\`\`\`

**Status indicators:**
- ✅ Logged in — tool is authenticated and ready
- ❌ Not logged in — tool needs authentication
- ⚠️ Not installed — tool is missing entirely

### Fix Missing Authentication

**If Azure CLI is not logged in:**
> "Azure CLI is required for this setup. Run \`az login\` to authenticate, then I'll continue."

**If GitHub CLI is not logged in:**
> "GitHub CLI is required for configuring repository secrets. Run \`gh auth login\` to authenticate."

**If any required tool is not installed:**
- Azure CLI: Install from https://aka.ms/installazurecli
- GitHub CLI: Install from https://cli.github.com

Once both tools are authenticated, ask the user to confirm:
> "Does this authentication look correct? (yes / need to switch accounts)"

If the user needs to switch accounts, help them with:
- Azure CLI: \`az account set --subscription <id>\` or \`az login --tenant <tenant-id>\`
- GitHub CLI: \`gh auth logout\` then \`gh auth login\`

Once confirmed, proceed to Step 1.

---

## Step 1 — Gather Information

Copilot, please ask the user for the following values before proceeding. Store
each answer for use in later steps.

| Variable | Description | Example |
|----------|-------------|---------|
${config.environments.map((env) =>
    `| \`AZURE_SUBSCRIPTION_ID_${env.toUpperCase()}\` | Azure subscription ID for **${env}** environment | \`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\` |`
  ).join('\n')}
| \`AZURE_TENANT_ID\` | Azure AD tenant ID (same for all environments) | \`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\` |
| \`GITHUB_ORG\` | GitHub organization or user that owns the repo | \`my-org\` |
| \`GITHUB_REPO\` | GitHub repository name | \`apim-artifacts\` |
| \`APP_NAME\` | Display name for the Azure AD application | \`apiops-github-sp\` |
${config.environments.map((env) =>
    `| \`APIM_RG_${env.toUpperCase()}\` | Resource group for **${env}** APIM instance | \`rg-apim-${env}\` |
| \`APIM_NAME_${env.toUpperCase()}\` | APIM service name for **${env}** | \`apim-${env}\` |`
  ).join('\n')}

---

## Step 2 — Create Azure AD Application & Service Principal

> ⚠️ **Error Handling:** If any command fails, stop immediately and show the user the full error output verbatim. Do NOT retry silently. Common issues include insufficient permissions (requires Application Administrator or Global Administrator role in Azure AD).

**On macOS/Linux (Bash):**
\`\`\`bash
# Create the Azure AD application
APP_ID=$(az ad app create \\
  --display-name "\${APP_NAME}" \\
  --query appId -o tsv)

# Create the service principal for the application
az ad sp create --id "$APP_ID"

echo "Application (client) ID: $APP_ID"
echo "Tenant ID: $(az account show --query tenantId -o tsv)"
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
# Create the Azure AD application
$APP_ID = az ad app create \`
  --display-name "\${APP_NAME}" \`
  --query appId -o tsv

# Create the service principal for the application
az ad sp create --id $APP_ID

Write-Host "Application (client) ID: $APP_ID"
Write-Host "Tenant ID: $(az account show --query tenantId -o tsv)"
\`\`\`

---

## Step 3 — Assign RBAC Roles

Grant the service principal the required permissions:
1. **Reader** role on each resource group (to read resource groups and resources)
2. **API Management Service Contributor** on each APIM instance (to manage APIM resources)

> **Note:** Each environment can be in a different Azure subscription. The service principal will be granted access to all environments.

### Grant Reader role on each resource group

${config.environments.map((env) =>
    `\`\`\`bash
# Reader role for ${env} resource group
az role assignment create \\
  --assignee "$APP_ID" \\
  --role "Reader" \\
  --scope "/subscriptions/\${AZURE_SUBSCRIPTION_ID_${env.toUpperCase()}}/resourceGroups/\${APIM_RG_${env.toUpperCase()}}"
\`\`\``
  ).join('\n\n')}

### Grant API Management Service Contributor on each APIM instance

${config.environments.map((env) =>
    `\`\`\`bash
# Assign role for ${env} environment
az role assignment create \\
  --assignee "$APP_ID" \\
  --role "API Management Service Contributor" \\
  --scope "/subscriptions/\${AZURE_SUBSCRIPTION_ID_${env.toUpperCase()}}/resourceGroups/\${APIM_RG_${env.toUpperCase()}}/providers/Microsoft.ApiManagement/service/\${APIM_NAME_${env.toUpperCase()}}"
\`\`\``
  ).join('\n\n')}

---

## Step 4 — Create Federated Credentials for GitHub OIDC

> ⚠️ **Platform Note:** The JSON parameters for federated credentials require different escaping on Windows PowerShell vs macOS/Linux Bash. Use the appropriate command block for your platform.

### Main branch (for push-triggered publish workflow)

**On macOS/Linux (Bash):**
\`\`\`bash
az ad app federated-credential create \\
  --id "$APP_ID" \\
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"\${GITHUB_ORG}"'/'"\${GITHUB_REPO}"':ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
az ad app federated-credential create \`
  --id $APP_ID \`
  --parameters '{\\"name\\":\\"github-main-branch\\",\\"issuer\\":\\"https://token.actions.githubusercontent.com\\",\\"subject\\":\\"repo:'\${GITHUB_ORG}'/'\${GITHUB_REPO}':ref:refs/heads/main\\",\\"audiences\\":[\\"api://AzureADTokenExchange\\"]}'
\`\`\`

${envFedCreds}

---

## Step 5 — Create GitHub Environments

\`\`\`bash
${config.environments.map((env) =>
    `# Create the ${env} environment (requires GitHub CLI)
gh api --method PUT "repos/\${GITHUB_ORG}/\${GITHUB_REPO}/environments/${env}"`
  ).join('\n\n')}
\`\`\`

---

## Step 6 — Set GitHub Repository Secrets

> ⚠️ **Platform Note:** GitHub CLI secret commands work identically on all platforms, but variable syntax differs between Bash and PowerShell.

**On macOS/Linux (Bash):**
\`\`\`bash
# Repository-level secrets (shared across all workflows)
gh secret set AZURE_CLIENT_ID --body "$APP_ID"
gh secret set AZURE_TENANT_ID --body "\${AZURE_TENANT_ID}"

${ghSecretEnvCmds}
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
# Repository-level secrets (shared across all workflows)
gh secret set AZURE_CLIENT_ID --body $APP_ID
gh secret set AZURE_TENANT_ID --body "\${AZURE_TENANT_ID}"

${ghSecretEnvCmds}
\`\`\`

---

## Step 7 — Verify

> ⚠️ **Important:** If any verification step fails, show the user the full error output and help troubleshoot before proceeding. Common issues include RBAC permissions not yet propagated (can take 5-10 minutes) or missing secrets.

1. Go to **Actions** → **Run APIM Extractor** → **Run workflow**
2. Fill in the resource group and service name for your dev environment
3. Confirm the workflow completes and a pull request is created

If the workflow fails with authentication errors:
- Check that all secrets are set correctly in GitHub: Settings → Secrets and variables → Actions
- Verify RBAC role assignments have propagated (wait 5-10 minutes and retry)
- Confirm the federated credentials were created: \`az ad app federated-credential list --id $APP_ID\`

---

## Secrets Reference

The generated workflows expect these secrets:

### Repository Secrets
- \`AZURE_CLIENT_ID\` — App registration client ID (shared across all environments)
- \`AZURE_TENANT_ID\` — Azure AD tenant ID (shared across all environments)

### Per-Environment Secrets
${envSecrets}
`;
}
