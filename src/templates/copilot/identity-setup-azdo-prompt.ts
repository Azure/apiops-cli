/**
 * GitHub Copilot prompt template for automating Azure DevOps identity setup.
 * Generates a .prompt.md file that guides Copilot through:
 *   1. Gathering Azure & Azure DevOps info from the user
 *   2. Creating user-assigned managed identity
 *   3. Configuring Azure DevOps CLI
 *   4. Creating service connections
 *   5. Creating variable groups
 *   6. Creating deployment environments
 *   7. Enabling pipeline contributions
 *   8. Creating pipelines
 */

import { getCloudConfig, getOfficialCloudName } from '../../lib/cloud-config.js';

export interface IdentitySetupAzdoPromptConfig {
  environments: string[];
  cloud?: string;
}

export function generateIdentitySetupAzdoPrompt(config: IdentitySetupAzdoPromptConfig): string {
  const cloud = config.cloud ?? 'public';
  const cloudConfig = getCloudConfig(cloud);
  const armBaseUrl = `${cloudConfig.armBaseUrl}/`;
  const officialCloudName = getOfficialCloudName(cloud);
  const azureGovNote = cloud === 'usgovernment' ? '' : `> **Note:** For Azure Government, use \`AZURE_MANAGEMENT_URL=https://management.usgovcloudapi.net/\``;

  const envServiceConnections = config.environments.map((env) =>
    `create_wif_service_connection "AZURE_SERVICE_CONNECTION_${env.toUpperCase()}"`
  ).join('\n');

  const envVarGroupRef = config.environments.map((env) =>
    `### apim-${env}
- \`APIM_RESOURCE_GROUP\` — Resource group for **${env}** APIM instance
- \`APIM_SERVICE_NAME\` — APIM service name for **${env}**
- \`AZURE_SUBSCRIPTION_ID\` — Azure subscription ID
- \`AZURE_SERVICE_CONNECTION\` — Service connection name for **${env}** (\`AZURE_SERVICE_CONNECTION_${env.toUpperCase()}\`)`
  ).join('\n\n');

  return `# Setup Azure DevOps Identity for APIOps

> **How to use:** Open this file in VS Code with GitHub Copilot and ask
> Copilot to help you run through the steps. Copilot will prompt you for
> the required values and generate the exact CLI commands for your environment.

## Goal

Configure a user-assigned managed identity and Azure DevOps service connections, variable
groups, and environments so the APIOps extract and publish pipelines can
authenticate to Azure using workload identity federation — no stored secrets or passwords.

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
az extension show --name azure-devops --query "{Name:name, Version:version}" -o json
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
- ✅ Logged in / Installed — tool is authenticated and ready
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

Copilot: Ask the user for these values. Infer values from context when possible:
- Extract from Azure portal URLs (subscription ID, resource group, APIM name from resource IDs)
- Extract Azure DevOps org and project from the project URL
- Use sensible defaults for optional values

Only ask for values that cannot be inferred. Present inferred values for confirmation.

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| \`MI_NAME\` | Display name for the managed identity | \`apiops-azdo-mi\` | Optional |
| \`MI_RESOURCE_GROUP\` | Resource group where the managed identity will be created | \`azdo-mi-rg\` | Optional |
| \`AZDO_PROJECT_URL\` | Full Azure DevOps project URL | — | **Required** |
| \`ENVIRONMENTS\` | Comma-separated list of environments to configure | \`${config.environments.join(',')}\` | Optional |
| \`AZURE_MANAGEMENT_URL\` | Azure Resource Manager endpoint URL | \`${armBaseUrl}\` | Optional |

${azureGovNote}

### Verify managed identity resource group exists

After gathering variables, check if the managed identity resource group exists. If not, ask the user if they want to create it:

**On Windows (PowerShell):**
\`\`\`powershell
# Check if resource group exists
$rgExists = az group exists --name $MI_RESOURCE_GROUP
if ($rgExists -eq "false") {
    Write-Host "Resource group '$MI_RESOURCE_GROUP' does not exist."
    # Copilot: Ask user if they want to create it
}
\`\`\`

**On macOS/Linux (Bash):**
\`\`\`bash
# Check if resource group exists
if [ "$(az group exists --name "$MI_RESOURCE_GROUP")" = "false" ]; then
    echo "Resource group '$MI_RESOURCE_GROUP' does not exist."
    # Copilot: Ask user if they want to create it
fi
\`\`\`

**Copilot:** If the resource group does not exist, ask the user:
> "Resource group \`{MI_RESOURCE_GROUP}\` doesn't exist. Would you like me to create it? (yes / no / use different name)"

If yes, ask for the location and create it:

**On Windows (PowerShell):**
\`\`\`powershell
az group create --name $MI_RESOURCE_GROUP --location $LOCATION
\`\`\`

**On macOS/Linux (Bash):**
\`\`\`bash
az group create --name "$MI_RESOURCE_GROUP" --location "$LOCATION"
\`\`\`

### Derive Azure DevOps values from project URL

After gathering \`AZDO_PROJECT_URL\`, extract the organization and project:

**On Windows (PowerShell):**
\`\`\`powershell
# Parse Azure DevOps project URL to extract org and project
# Example: https://dev.azure.com/my-org/my-project
$urlParts = $AZDO_PROJECT_URL -replace 'https://dev.azure.com/', '' -split '/'
$ORG_NAME = $urlParts[0]
$AZDO_PROJECT = $urlParts[1]
$AZDO_ORG = "https://dev.azure.com/$ORG_NAME"

Write-Host "Organization: $ORG_NAME"
Write-Host "Project: $AZDO_PROJECT"
Write-Host "Org URL: $AZDO_ORG"
\`\`\`

**On macOS/Linux (Bash):**
\`\`\`bash
# Parse Azure DevOps project URL to extract org and project
# Example: https://dev.azure.com/my-org/my-project
ORG_NAME=$(echo "$AZDO_PROJECT_URL" | sed 's|https://dev.azure.com/||' | cut -d'/' -f1)
AZDO_PROJECT=$(echo "$AZDO_PROJECT_URL" | sed 's|https://dev.azure.com/||' | cut -d'/' -f2)
AZDO_ORG="https://dev.azure.com/\${ORG_NAME}"

echo "Organization: $ORG_NAME"
echo "Project: $AZDO_PROJECT"
echo "Org URL: $AZDO_ORG"
\`\`\`

### Per-Environment APIM Instance IDs

After gathering the \`ENVIRONMENTS\` list, ask for the **full resource ID** of the APIM instance for each environment:

| Variable | Description | Example |
|----------|-------------|---------|
| \`APIM_INSTANCE_{ENV}\` | Full resource ID for APIM instance in \`{ENV}\` environment | \`/subscriptions/.../resourceGroups/rg-apim-dev/providers/Microsoft.ApiManagement/service/apim-dev\` |

For example, if \`ENVIRONMENTS=${config.environments.join(',')}\`, ask for:
${config.environments.map(env => `- \`APIM_INSTANCE_${env.toUpperCase()}\` — Full resource ID for **${env}** APIM instance`).join('\n')}

> **Tip:** Users can copy the resource ID from the Azure portal URL or from the **Properties** blade of the APIM instance.

### Extract derived values from instance IDs

After gathering instance IDs, extract subscription ID, resource group, and service name:

**On macOS/Linux (Bash):**
\`\`\`bash
# Extract values from each environment's instance ID
for ENV in $(echo "$ENVIRONMENTS" | tr ',' ' '); do
    ENV_UPPER=$(echo "$ENV" | tr '[:lower:]' '[:upper:]')
    INSTANCE_VAR="APIM_INSTANCE_\${ENV_UPPER}"
    INSTANCE_ID="\${!INSTANCE_VAR}"
    
    # Parse resource ID: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{name}
    SUBSCRIPTION_ID=$(echo "$INSTANCE_ID" | cut -d'/' -f3)
    APIM_RG=$(echo "$INSTANCE_ID" | cut -d'/' -f5)
    APIM_NAME=$(echo "$INSTANCE_ID" | cut -d'/' -f9)
    
    declare "APIM_RG_\${ENV_UPPER}=$APIM_RG"
    declare "APIM_NAME_\${ENV_UPPER}=$APIM_NAME"
    
    echo "$ENV: RG=$APIM_RG, APIM=$APIM_NAME"
done
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
# Extract values from each environment's instance ID
foreach ($env in $ENVIRONMENTS -split ',') {
    $envUpper = $env.ToUpper()
    $instanceId = Get-Variable -Name "APIM_INSTANCE_$envUpper" -ValueOnly
    $parts = $instanceId -split '/'
    
    # Parse resource ID: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{name}
    $SUBSCRIPTION_ID = $parts[2]
    Set-Variable -Name "APIM_RG_$envUpper" -Value $parts[4]
    Set-Variable -Name "APIM_NAME_$envUpper" -Value $parts[8]
    
    Write-Host "$env: RG=$($parts[4]), APIM=$($parts[8])"
}
\`\`\`

---

## Step 2 — Create Managed Identity

> ⚠️ **Error Handling:** If any command fails, stop immediately and show the user the full error output verbatim. Do NOT retry silently. Common issues include insufficient permissions (requires Contributor role on the resource group).

### Create the managed identity

**On macOS/Linux (Bash):**
\`\`\`bash
# Create user-assigned managed identity (no password — credentials-free)
az identity create \\
    --name "\${MI_NAME}" \\
    --resource-group "\${MI_RESOURCE_GROUP}"

# Retrieve managed identity properties
MI_CLIENT_ID=$(az identity show --name "\${MI_NAME}" --resource-group "\${MI_RESOURCE_GROUP}" --query clientId -o tsv)
MI_PRINCIPAL_ID=$(az identity show --name "\${MI_NAME}" --resource-group "\${MI_RESOURCE_GROUP}" --query principalId -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

echo "Managed Identity Client ID: $MI_CLIENT_ID"
echo "Managed Identity Principal ID: $MI_PRINCIPAL_ID"
echo "Tenant ID: $TENANT_ID"
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
# Create user-assigned managed identity (no password — credentials-free)
az identity create \`
    --name $MI_NAME \`
    --resource-group $MI_RESOURCE_GROUP

# Retrieve managed identity properties
$MI_CLIENT_ID = az identity show --name $MI_NAME --resource-group $MI_RESOURCE_GROUP --query clientId -o tsv
$MI_PRINCIPAL_ID = az identity show --name $MI_NAME --resource-group $MI_RESOURCE_GROUP --query principalId -o tsv
$TENANT_ID = az account show --query tenantId -o tsv

Write-Host "Managed Identity Client ID: $MI_CLIENT_ID"
Write-Host "Managed Identity Principal ID: $MI_PRINCIPAL_ID"
Write-Host "Tenant ID: $TENANT_ID"
\`\`\`

### Assign RBAC roles

Grant the managed identity **API Management Service Contributor** role on each environment's resource group:

**On macOS/Linux (Bash):**
\`\`\`bash
# Loop through each environment and assign role
for ENV in $(echo "$ENVIRONMENTS" | tr ',' ' '); do
    ENV_UPPER=$(echo "$ENV" | tr '[:lower:]' '[:upper:]')
    APIM_RG_VAR="APIM_RG_\${ENV_UPPER}"
    APIM_RG="\${!APIM_RG_VAR}"
    
    az role assignment create \\
        --assignee-object-id "$MI_PRINCIPAL_ID" \\
        --assignee-principal-type ServicePrincipal \\
        --role "API Management Service Contributor" \\
        --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$APIM_RG"
    
    echo "Assigned role for $ENV (RG: $APIM_RG)"
done
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
# Loop through each environment and assign role
foreach ($env in $ENVIRONMENTS -split ',') {
    $envUpper = $env.ToUpper()
    $apimRg = Get-Variable -Name "APIM_RG_$envUpper" -ValueOnly
    
    az role assignment create \`
        --assignee-object-id $MI_PRINCIPAL_ID \`
        --assignee-principal-type ServicePrincipal \`
        --role "API Management Service Contributor" \`
        --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$apimRg"
    
    Write-Host "Assigned role for $env (RG: $apimRg)"
}
\`\`\`

> **Note:** User-assigned managed identities have no passwords or secrets. The RBAC role is assigned using the managed identity's principal ID, not a client ID.

---

## Step 3 — Configure Azure DevOps CLI

**On macOS/Linux (Bash):**
\`\`\`bash
# Ensure Azure DevOps extension is installed
az extension add --name azure-devops

# Set default organization and project
az devops configure --defaults organization="\${AZDO_ORG}" project="\${AZDO_PROJECT}"

# Get subscription name for service connection creation
SUBSCRIPTION_NAME=$(az account show --subscription "\${SUBSCRIPTION_ID}" --query name -o tsv)

# Get project ID (required for service connection creation)
PROJECT_ID=$(az devops project show --project "\${AZDO_PROJECT}" --organization "\${AZDO_ORG}" --query id -o tsv)
echo "Project ID: $PROJECT_ID"

# Get repository name (required for pipeline creation)
REPO_NAME=$(az repos list --project "\${AZDO_PROJECT}" --organization "\${AZDO_ORG}" --query "[0].name" -o tsv)
echo "Repository: $REPO_NAME"
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
# Ensure Azure DevOps extension is installed
az extension add --name azure-devops

# Set default organization and project
az devops configure --defaults organization=$AZDO_ORG project=$AZDO_PROJECT

# Get subscription name for service connection creation
$SUBSCRIPTION_NAME = az account show --subscription $SUBSCRIPTION_ID --query name -o tsv

# Get project ID (required for service connection creation)
$PROJECT_ID = az devops project show --project $AZDO_PROJECT --organization $AZDO_ORG --query id -o tsv
Write-Host "Project ID: $PROJECT_ID"

# Get repository name (required for pipeline creation)
$REPO_NAME = az repos list --project $AZDO_PROJECT --organization $AZDO_ORG --query "[0].name" -o tsv
Write-Host "Repository: $REPO_NAME"
\`\`\`

---

## Step 4 — Create Service Connections

> ⚠️ **Note:** Workload identity federation means Azure DevOps exchanges its own OIDC token for an Azure token at runtime — no stored secrets. Creating a WIF service connection is a two-step process: create the connection (which generates an issuer/subject), then create a federated credential on the managed identity.

The function below handles both steps. Call it once for each service connection:

**On macOS/Linux (Bash):**
\`\`\`bash
# Helper function: create a WIF service connection and link it to the managed identity
create_wif_service_connection() {
    local SC_NAME="$1"

    # Step A: Create the service connection with serviceEndpointProjectReferences
    ENDPOINT_RESPONSE=$(az devops invoke \\
        --area serviceEndpoint \\
        --resource endpoints \\
        --route-parameters project="\${AZDO_PROJECT}" \\
        --http-method POST \\
        --api-version "7.1" \\
        --in-file - << ENDJSON
{
  "name": "\${SC_NAME}",
  "type": "azurerm",
  "url": "${armBaseUrl}",
  "authorization": {
    "scheme": "WorkloadIdentityFederation",
    "parameters": {
      "servicePrincipalId": "\${MI_CLIENT_ID}",
      "tenantid": "\${TENANT_ID}"
    }
  },
  "data": {
    "subscriptionId": "\${SUBSCRIPTION_ID}",
    "subscriptionName": "\${SUBSCRIPTION_NAME}",
    "environment": "${officialCloudName}",
    "scopeLevel": "Subscription",
    "creationMode": "Manual"
  },
  "serviceEndpointProjectReferences": [
    {
      "projectReference": {
        "id": "\${PROJECT_ID}",
        "name": "\${AZDO_PROJECT}"
      },
      "name": "\${SC_NAME}"
    }
  ]
}
ENDJSON
    )

    # Step B: Extract endpoint ID and retrieve issuer/subject
    ENDPOINT_ID=$(echo "$ENDPOINT_RESPONSE" | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4)
    ISSUER=$(az devops service-endpoint show --id "\${ENDPOINT_ID}" --query "authorization.parameters.workloadIdentityFederationIssuer" -o tsv)
    SUBJECT=$(az devops service-endpoint show --id "\${ENDPOINT_ID}" --query "authorization.parameters.workloadIdentityFederationSubject" -o tsv)

    # Step C: Create federated credential on the managed identity
    CRED_NAME=$(echo "\${SC_NAME}" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
    az identity federated-credential create \\
        --name "azdo-\${CRED_NAME}" \\
        --identity-name "\${MI_NAME}" \\
        --resource-group "\${MI_RESOURCE_GROUP}" \\
        --issuer "\${ISSUER}" \\
        --subject "\${SUBJECT}" \\
        --audiences "api://AzureADTokenExchange"

    echo "Created service connection: \${SC_NAME} (ID: \${ENDPOINT_ID})"
}

# Create base service connection
create_wif_service_connection "AZURE_SERVICE_CONNECTION"

# Create per-environment service connections
${envServiceConnections}

# Verify service connections were created
az devops service-endpoint list --query "[].name" -o table
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
function New-WifServiceConnection {
    param($SC_NAME)
    
    $body = @{
        name = $SC_NAME
        type = "azurerm"
        url = "${armBaseUrl}"
        authorization = @{
            scheme = "WorkloadIdentityFederation"
            parameters = @{
                servicePrincipalId = $MI_CLIENT_ID
                tenantid = $TENANT_ID
            }
        }
        data = @{
            subscriptionId = $SUBSCRIPTION_ID
            subscriptionName = $SUBSCRIPTION_NAME
            environment = "${officialCloudName}"
            scopeLevel = "Subscription"
            creationMode = "Manual"
        }
        serviceEndpointProjectReferences = @(
            @{
                projectReference = @{
                    id = $PROJECT_ID
                    name = $AZDO_PROJECT
                }
                name = $SC_NAME
            }
        )
    } | ConvertTo-Json -Depth 10 -Compress
    
    $tempFile = [System.IO.Path]::GetTempFileName()
    $body | Out-File -Encoding utf8 $tempFile
    
    $ep = az devops invoke --area serviceEndpoint --resource endpoints --route-parameters project=$AZDO_PROJECT --http-method POST --api-version "7.1" --in-file $tempFile | ConvertFrom-Json
    Remove-Item $tempFile -ErrorAction SilentlyContinue
    
    $endpointId = $ep.id
    $issuer = $ep.authorization.parameters.workloadIdentityFederationIssuer
    $subject = $ep.authorization.parameters.workloadIdentityFederationSubject
    
    $credName = $SC_NAME.ToLower().Replace("_", "-")
    az identity federated-credential create --name "azdo-$credName" --identity-name $MI_NAME --resource-group $MI_RESOURCE_GROUP --issuer $issuer --subject $subject --audiences "api://AzureADTokenExchange"
    
    Write-Host "Created service connection: $SC_NAME (ID: $endpointId)"
}

New-WifServiceConnection "AZURE_SERVICE_CONNECTION"
foreach ($env in $ENVIRONMENTS -split ',') {
    $envUpper = $env.ToUpper()
    New-WifServiceConnection "AZURE_SERVICE_CONNECTION_$envUpper"
}

# Verify service connections were created
az devops service-endpoint list --query "[].name" -o table
\`\`\`

---

## Step 5 — Create Variable Groups

Create the common variable group and environment-specific variable groups:

**On macOS/Linux (Bash):**
\`\`\`bash
# Create common variable group
az pipelines variable-group create \\
    --name "apim-common" \\
    --project "$AZDO_PROJECT" \\
    --organization "$AZDO_ORG" \\
    --variables AZURE_SUBSCRIPTION_ID="$SUBSCRIPTION_ID" AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION"

# Create environment-specific variable groups
for ENV in $(echo "$ENVIRONMENTS" | tr ',' ' '); do
    ENV_UPPER=$(echo "$ENV" | tr '[:lower:]' '[:upper:]')
    APIM_RG_VAR="APIM_RG_\${ENV_UPPER}"
    APIM_NAME_VAR="APIM_NAME_\${ENV_UPPER}"
    APIM_RG="\${!APIM_RG_VAR}"
    APIM_NAME="\${!APIM_NAME_VAR}"
    
    az pipelines variable-group create \\
        --name "apim-$ENV" \\
        --project "$AZDO_PROJECT" \\
        --organization "$AZDO_ORG" \\
        --variables APIM_RESOURCE_GROUP="$APIM_RG" APIM_SERVICE_NAME="$APIM_NAME" AZURE_SUBSCRIPTION_ID="$SUBSCRIPTION_ID" AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION_$ENV_UPPER"
done

# Authorize all variable groups for use in pipelines
for id in $(az pipelines variable-group list --project "$AZDO_PROJECT" --organization "$AZDO_ORG" --query "[].id" -o tsv); do
    az pipelines variable-group update --group-id "$id" --authorize true --project "$AZDO_PROJECT" --organization "$AZDO_ORG"
done

# Verify variable groups were created
az pipelines variable-group list --project "$AZDO_PROJECT" --organization "$AZDO_ORG" --query "[].name" -o table
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
# Create common variable group
az pipelines variable-group create \`
    --name "apim-common" \`
    --project $AZDO_PROJECT \`
    --organization $AZDO_ORG \`
    --variables AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION"

# Create environment-specific variable groups
foreach ($env in $ENVIRONMENTS -split ',') {
    $envUpper = $env.ToUpper()
    $apimRg = Get-Variable -Name "APIM_RG_$envUpper" -ValueOnly
    $apimName = Get-Variable -Name "APIM_NAME_$envUpper" -ValueOnly
    
    az pipelines variable-group create \`
        --name "apim-$env" \`
        --project $AZDO_PROJECT \`
        --organization $AZDO_ORG \`
        --variables APIM_RESOURCE_GROUP=$apimRg APIM_SERVICE_NAME=$apimName AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION_$envUpper"
}

# Authorize all variable groups for use in pipelines
$groupIds = az pipelines variable-group list --project $AZDO_PROJECT --organization $AZDO_ORG --query "[].id" -o tsv
foreach ($id in $groupIds) {
    az pipelines variable-group update --group-id $id --authorize true --project $AZDO_PROJECT --organization $AZDO_ORG
}

# Verify variable groups were created
az pipelines variable-group list --project $AZDO_PROJECT --organization $AZDO_ORG --query "[].name" -o table
\`\`\`

---

## Step 6 — Create Environments

> **Note:** Azure DevOps environments are created via the REST API. The Azure DevOps CLI doesn't have a direct command for environment creation, so we use \`az devops invoke\`.

**On macOS/Linux (Bash):**
\`\`\`bash
for ENV in $(echo "$ENVIRONMENTS" | tr ',' ' '); do
    echo "Creating environment: $ENV"
    cat << EOF | az devops invoke --area distributedtask --resource environments --route-parameters project="$AZDO_PROJECT" --http-method POST --api-version 7.1 --in-file -
{"name": "$ENV", "description": "Deployment environment for $ENV"}
EOF
done
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
foreach ($env in $ENVIRONMENTS -split ',') {
    Write-Host "Creating environment: $env"
    $body = @{
        name = $env
        description = "Deployment environment for $env"
    } | ConvertTo-Json -Compress
    
    $tempFile = [System.IO.Path]::GetTempFileName()
    $body | Out-File -Encoding utf8 $tempFile
    
    az devops invoke --area distributedtask --resource environments --route-parameters project=$AZDO_PROJECT --http-method POST --api-version 7.1 --in-file $tempFile
    
    Remove-Item $tempFile
}
\`\`\`

> **Note:** Environment approvals and checks must be configured via the Azure DevOps UI (Project Settings > Environments).

---

## Step 7 — Enable Pipeline Contributions

Grant the Build Service identity permission to contribute to the repository (required for automated PR creation from extract pipeline).

**On macOS/Linux (Bash):**
\`\`\`bash
# Get the Build Service identity descriptor
BUILD_SERVICE_NAME="$AZDO_PROJECT Build Service ($ORG_NAME)"
BUILD_SERVICE_DESCRIPTOR=$(az devops invoke --area graph --resource users --query-parameters 'api-version=7.1-preview.1' --http-method GET -o json | grep -B5 "\\"displayName\\": \\"$BUILD_SERVICE_NAME\\"" | grep '"descriptor"' | head -1 | cut -d'"' -f4)

# Get the Git Repositories namespace ID
GIT_REPOS_NAMESPACE=$(az devops security permission namespace list --query "[?name=='Git Repositories'].namespaceId" -o tsv)

# Get the repository ID
REPO_ID=$(az repos list --project "$AZDO_PROJECT" --organization "$AZDO_ORG" --query "[0].id" -o tsv)

# Grant Contribute permission (bit 4) to the Build Service on the repository
TOKEN="repoV2/$PROJECT_ID/$REPO_ID"
az devops security permission update --namespace-id "$GIT_REPOS_NAMESPACE" --subject "$BUILD_SERVICE_DESCRIPTOR" --token "$TOKEN" --allow-bit 4
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
# Get the Build Service identity descriptor
$GRAPH_USERS = az devops invoke --area graph --resource users --query-parameters 'api-version=7.1-preview.1' --http-method GET -o json | ConvertFrom-Json
$BUILD_SERVICE_NAME = "$AZDO_PROJECT Build Service ($ORG_NAME)"
$BUILD_SERVICE_DESCRIPTOR = ($GRAPH_USERS.value | Where-Object { $_.displayName -eq $BUILD_SERVICE_NAME }).descriptor

# Get the Git Repositories namespace ID
$GIT_REPOS_NAMESPACE = az devops security permission namespace list --query "[?name=='Git Repositories'].namespaceId" -o tsv

# Get the repository ID
$REPO_ID = az repos list --project $AZDO_PROJECT --organization $AZDO_ORG --query "[0].id" -o tsv

# Grant Contribute permission (bit 4) to the Build Service on the repository
$TOKEN = "repoV2/$PROJECT_ID/$REPO_ID"
az devops security permission update --namespace-id $GIT_REPOS_NAMESPACE --subject $BUILD_SERVICE_DESCRIPTOR --token $TOKEN --allow-bit 4
\`\`\`

> ⚠️ **Error Handling:** If the Build Service identity is not found, verify the \`ORG_NAME\` matches your Azure DevOps organization name exactly.

---

## Step 8 — Create Pipelines

\`\`\`bash
# Create extract pipeline
az pipelines create \\
    --name "APIM Extractor" \\
    --description "Extract APIM configuration and create PR" \\
    --repository "$REPO_NAME" \\
    --repository-type tfsgit \\
    --branch main \\
    --yml-path ".azdo/pipelines/run-apim-extractor.yml" \\
    --skip-first-run true

# Create publish pipeline
az pipelines create \\
    --name "APIM Publisher" \\
    --description "Publish APIM configuration to environments" \\
    --repository "$REPO_NAME" \\
    --repository-type tfsgit \\
    --branch main \\
    --yml-path ".azdo/pipelines/run-apim-publisher.yml" \\
    --skip-first-run true
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
- \`AZURE_SERVICE_CONNECTION\` — Base service connection name (\`AZURE_SERVICE_CONNECTION\`)

${envVarGroupRef}
`;
}
