/**
 * GitHub Copilot prompt template for automating Azure DevOps identity setup.
 * Generates a .prompt.md file that guides Copilot through:
 *   1. Gathering Azure & Azure DevOps info from the user
 *   2. Creating Azure AD service principal
 *   3. Configuring Azure DevOps CLI
 *   4. Creating service connections
 *   5. Creating variable groups
 *   6. Creating deployment environments
 *   7. Enabling pipeline contributions
 *   8. Creating pipelines
 */

export interface IdentitySetupAzdoPromptConfig {
  environments: string[];
}

export function generateIdentitySetupAzdoPrompt(config: IdentitySetupAzdoPromptConfig): string {
  const envGatherTable = config.environments.map((env) =>
    `| \`APIM_RG_${env.toUpperCase()}\` | Resource group for **${env}** APIM instance | \`rg-apim-${env}\` |
| \`APIM_NAME_${env.toUpperCase()}\` | APIM service name for **${env}** | \`apim-${env}\` |`
  ).join('\n');

  const envServiceConnections = config.environments.map((env) =>
    `# Create service connection for ${env} environment
env_upper=$(echo "${env}" | tr '[:lower:]' '[:upper:]')
az devops service-endpoint azurerm create \\
  --name "AZURE_SERVICE_CONNECTION_\${env_upper}" \\
  --azure-rm-service-principal-id "$APP_ID" \\
  --azure-rm-subscription-id "$SUBSCRIPTION_ID" \\
  --azure-rm-subscription-name "$SUBSCRIPTION_NAME" \\
  --azure-rm-tenant-id "$TENANT_ID"`
  ).join('\n\n');

  const envVariableGroups = config.environments.map((env) =>
    `# Create variable group for ${env} environment
env_upper="${env.toUpperCase()}"
az pipelines variable-group create \\
  --name "apim-${env}" \\
  --variables APIM_RESOURCE_GROUP="\${APIM_RG_${env.toUpperCase()}}" \\
              APIM_SERVICE_NAME="\${APIM_NAME_${env.toUpperCase()}}" \\
              AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION_\${env_upper}"`
  ).join('\n\n');

  const envEnvironments = config.environments.map((env) =>
    `# Create ${env} environment
az devops invoke \\
  --area distributedtask \\
  --resource environments \\
  --route-parameters project="$AZDO_PROJECT" \\
  --http-method POST \\
  --in-file /dev/stdin <<EOF
{
  "name": "${env}",
  "description": "Deployment environment for ${env}"
}
EOF`
  ).join('\n\n');

  const envVarGroupRef = config.environments.map((env) =>
    `### apim-${env}
- \`APIM_RESOURCE_GROUP\` — Resource group for **${env}** APIM instance
- \`APIM_SERVICE_NAME\` — APIM service name for **${env}**
- \`AZURE_SERVICE_CONNECTION\` — Service connection name for **${env}** (\`AZURE_SERVICE_CONNECTION_${env.toUpperCase()}\`)`
  ).join('\n\n');

  return `# Setup Azure DevOps Identity for APIOps

> **How to use:** Open this file in VS Code with GitHub Copilot and ask
> Copilot to help you run through the steps. Copilot will prompt you for
> the required values and generate the exact CLI commands for your environment.

## Goal

Configure Azure service principal and Azure DevOps service connections, variable
groups, and environments so the APIOps extract and publish pipelines can
authenticate to Azure and deploy to each environment.

---

## Step 0 — Tool Authentication Check

**Copilot: Before proceeding, verify that all required tools are installed and authenticated.**

Run these checks and present results in a table:

### Check Azure CLI
\`\`\`bash
az version
az account show --query "{Subscription:name, Account:user.name, TenantId:tenantId}" -o json
\`\`\`

### Check Azure DevOps Extension
\`\`\`bash
az extension show --name azure-devops --query "{Name:name, Version:version}" -o json 2>/dev/null || echo "Not installed"
\`\`\`

### Present Status Table

Present the results to the user in this format:

\`\`\`
🔐 Tool Authentication Status:

| Tool | Status | Account/User | Subscription/Org | Tenant/Details |
|------|--------|--------------|------------------|----------------|
| Azure CLI | ✅ Logged in | user@example.com | my-subscription | abc-123-... |
| Azure DevOps Extension | ✅ Installed | — | v0.26.0 | — |
\`\`\`

**Status indicators:**
- ✅ Logged in / Installed — tool is authenticated/installed and ready
- ❌ Not logged in — tool needs authentication
- ⚠️ Not installed — tool is missing entirely

### Fix Missing Authentication or Extensions

**If Azure CLI is not logged in:**
> "Azure CLI is required for this setup. Run \`az login\` to authenticate, then I'll continue."

**If Azure DevOps extension is not installed:**
> "Azure DevOps extension is required. Installing now..."
\`\`\`bash
az extension add --name azure-devops
\`\`\`

**If Azure CLI is not installed:**
- Azure CLI: Install from https://aka.ms/installazurecli

Once all tools are authenticated and installed, ask the user to confirm:
> "Does this authentication look correct? (yes / need to switch accounts)"

If the user needs to switch accounts, help them with:
- Azure CLI: \`az account set --subscription <id>\` or \`az login --tenant <tenant-id>\`

Once confirmed, proceed to Step 1.

---

## Step 1 — Gather Information

Copilot, please ask the user for the following values before proceeding. Store
each answer for use in later steps.

| Variable | Description | Example |
|----------|-------------|---------|
| \`SUBSCRIPTION_ID\` | Azure subscription ID (used for all environments) | \`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\` |
| \`RESOURCE_GROUP\` | Resource group prefix or base name | \`rg-apim\` |
| \`APP_NAME\` | Display name for the service principal | \`apiops-azdo-sp\` |
| \`AZDO_ORG\` | Azure DevOps organization URL | \`https://dev.azure.com/my-org\` |
| \`ORG_NAME\` | Short organization name (for Build Service) | \`my-org\` |
| \`AZDO_PROJECT\` | Azure DevOps project name | \`apim-project\` |
${envGatherTable}

---

## Step 2 — Create Service Principal

> ⚠️ **Error Handling:** If any command fails, stop immediately and show the user the full error output verbatim. Do NOT retry silently. Common issues include insufficient permissions (requires Contributor role on the subscription or resource group).

\`\`\`bash
# Create service principal with API Management Service Contributor role
SP_OUTPUT=$(az ad sp create-for-rbac \\
  --name "\${APP_NAME}" \\
  --role "API Management Service Contributor" \\
  --scopes "/subscriptions/\${SUBSCRIPTION_ID}/resourceGroups/\${RESOURCE_GROUP}")

# Extract credentials from JSON output
APP_ID=$(echo "$SP_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['appId'])")
PASSWORD=$(echo "$SP_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])")
TENANT_ID=$(echo "$SP_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant'])")

echo "APP_ID=$APP_ID  TENANT_ID=$TENANT_ID"
echo "⚠️ PASSWORD is shown once only. Store it securely (used in next step)."
\`\`\`

> **Note:** The password (client secret) is displayed only once. You'll use it in the next step to create service connections, then it will be securely stored in Azure DevOps.

---

## Step 3 — Configure Azure DevOps CLI

\`\`\`bash
# Ensure Azure DevOps extension is installed
az extension add --name azure-devops

# Set default organization and project
az devops configure --defaults organization="\${AZDO_ORG}" project="\${AZDO_PROJECT}"

# Get subscription name for service connection creation
SUBSCRIPTION_NAME=$(az account show --subscription "\${SUBSCRIPTION_ID}" --query name -o tsv)
\`\`\`

---

## Step 4 — Create Service Connections

> ⚠️ **Security Note:** The service principal password is set via environment variable and cleared immediately after creating service connections.

\`\`\`bash
# Set the service principal password as environment variable
export AZURE_DEVOPS_EXT_AZURE_RM_SERVICE_PRINCIPAL_KEY="$PASSWORD"

# Create base service connection
az devops service-endpoint azurerm create \\
  --name "AZURE_SERVICE_CONNECTION" \\
  --azure-rm-service-principal-id "$APP_ID" \\
  --azure-rm-subscription-id "$SUBSCRIPTION_ID" \\
  --azure-rm-subscription-name "$SUBSCRIPTION_NAME" \\
  --azure-rm-tenant-id "$TENANT_ID"

${envServiceConnections}

# Clear the password from environment
unset AZURE_DEVOPS_EXT_AZURE_RM_SERVICE_PRINCIPAL_KEY

# Verify service connections were created
az devops service-endpoint list --query "[].name" -o table
\`\`\`

---

## Step 5 — Create Variable Groups

\`\`\`bash
# Create common variable group
az pipelines variable-group create \\
  --name "apim-common" \\
  --variables AZURE_SUBSCRIPTION_ID="\${SUBSCRIPTION_ID}" \\
              APIM_RESOURCE_GROUP="\${RESOURCE_GROUP}" \\
              APIM_SERVICE_NAME="<your-apim-base-name>" \\
              AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION"

${envVariableGroups}

# Authorize all variable groups for use in pipelines
for id in $(az pipelines variable-group list --query "[].id" -o tsv); do
  az pipelines variable-group update --group-id "$id" --authorize true
done

# Verify variable groups were created
az pipelines variable-group list --query "[].name" -o table
\`\`\`

---

## Step 6 — Create Environments

> **Note:** Azure DevOps environments are created via the REST API. The Azure DevOps CLI doesn't have a direct command for environment creation, so we use \`az devops invoke\`.

\`\`\`bash
${envEnvironments}
\`\`\`

> **Note:** Environment approvals and checks must be configured via the Azure DevOps UI:
> Go to Pipelines → Environments → [environment name] → Approvals and checks

---

## Step 7 — Enable Pipeline Contributions

Grant the Build Service identity permission to contribute to the repository (required for automated PR creation from extract pipeline).

\`\`\`bash
# Get the Build Service identity descriptor
BUILD_SERVICE_NAME="\${AZDO_PROJECT} Build Service (\${ORG_NAME})"
BUILD_SERVICE_DESCRIPTOR=$(az devops user show \\
  --user "$BUILD_SERVICE_NAME" \\
  --query "descriptor" -o tsv)

# Get the repository ID
REPO_ID=$(az repos list --query "[0].id" -o tsv)

# Grant Contribute permission (bit 4) to the Build Service on the repository
az devops security permission update \\
  --id "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87" \\
  --subject "$BUILD_SERVICE_DESCRIPTOR" \\
  --token "repoV2/\${AZDO_PROJECT}/\${REPO_ID}" \\
  --allow-bit 4
\`\`\`

> ⚠️ **Error Handling:** If the Build Service identity is not found, verify the \`ORG_NAME\` matches your Azure DevOps organization name exactly.

---

## Step 8 — Create Pipelines

\`\`\`bash
# Create extract pipeline
az pipelines create \\
  --name "APIM Extractor" \\
  --description "Extract APIM configuration and create PR" \\
  --repository-type tfsgit \\
  --branch main \\
  --yml-path ".azdo/pipelines/run-apim-extractor.yml"

# Create publish pipeline
az pipelines create \\
  --name "APIM Publisher" \\
  --description "Publish APIM configuration to environments" \\
  --repository-type tfsgit \\
  --branch main \\
  --yml-path ".azdo/pipelines/run-apim-publisher.yml"
\`\`\`

---

## Step 9 — Verify Setup

> ⚠️ **Important:** If any verification step fails, show the user the full error output and help troubleshoot before proceeding.

Run these commands to verify everything is configured correctly:

\`\`\`bash
# Verify service connections
echo "Service Connections:"
az devops service-endpoint list --query "[].name" -o table

# Verify variable groups
echo -e "\\nVariable Groups:"
az pipelines variable-group list --query "[].name" -o table

# Verify pipelines
echo -e "\\nPipelines:"
az pipelines list --query "[].name" -o table
\`\`\`

Expected output:
- Service connections: \`AZURE_SERVICE_CONNECTION\`, \`AZURE_SERVICE_CONNECTION_${config.environments.map(e => e.toUpperCase()).join('`, `AZURE_SERVICE_CONNECTION_')}\`
- Variable groups: \`apim-common\`, \`apim-${config.environments.join('`, `apim-')}\`
- Pipelines: \`APIM Extractor\`, \`APIM Publisher\`

To test the extract pipeline:
1. Go to Azure DevOps → Pipelines → **APIM Extractor**
2. Click **Run pipeline**
3. Fill in the required parameters (resource group, APIM service name)
4. Verify the pipeline runs successfully and creates a pull request

---

## Variable Groups Reference

The generated pipelines expect these variable groups:

### apim-common
- \`AZURE_SUBSCRIPTION_ID\` — Azure subscription ID (shared)
- \`APIM_RESOURCE_GROUP\` — Base resource group name
- \`APIM_SERVICE_NAME\` — Base APIM service name
- \`AZURE_SERVICE_CONNECTION\` — Base service connection name (\`AZURE_SERVICE_CONNECTION\`)

${envVarGroupRef}
`;
}
