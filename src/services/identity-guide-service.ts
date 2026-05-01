/**
 * T048: Identity setup guide generator
 * Step-by-step instructions for service principal, RBAC, federated credentials,
 * pipeline secrets/service connections. Optional az CLI automation per FR-021.
 */

import { getCloudConfig, getOfficialCloudName } from '../lib/cloud-config.js';

export interface IdentityGuideService {
  generateGitHubActionsGuide(
    subscriptionId: string,
    resourceGroup: string,
    environments: string[]
  ): string;
  
  generateAzureDevOpsGuide(
    subscriptionId: string,
    resourceGroup: string,
    environments: string[],
    cloud?: string
  ): string;
}

class IdentityGuideServiceImpl implements IdentityGuideService {
  generateGitHubActionsGuide(
    subscriptionId: string,
    resourceGroup: string,
    environments: string[]
  ): string {
    return `# GitHub Actions Identity Setup Guide

## Prerequisites
- Azure subscription: ${subscriptionId}
- Resource group: ${resourceGroup}
- GitHub repository with OIDC enabled

## Step 1: Create Service Principal

Run the following Azure CLI commands to create a service principal with federated credentials:

\`\`\`bash
# Set variables
SUBSCRIPTION_ID="${subscriptionId}"
RESOURCE_GROUP="${resourceGroup}"
APP_NAME="apiops-github-sp"
GITHUB_ORG="<your-github-org>"
GITHUB_REPO="<your-github-repo>"

# Create Azure AD Application
APP_ID=$(az ad app create \\
  --display-name "$APP_NAME" \\
  --query appId -o tsv)

# Create Service Principal
az ad sp create --id "$APP_ID"

# Get Service Principal Object ID
SP_OBJECT_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

echo "Application (client) ID: $APP_ID"
echo "Service Principal Object ID: $SP_OBJECT_ID"
\`\`\`

## Step 2: Assign RBAC Roles

Grant the service principal "API Management Service Contributor" role on your APIM instance:

\`\`\`bash
# Get APIM resource ID
APIM_RESOURCE_ID=$(az apim show \\
  --resource-group "$RESOURCE_GROUP" \\
  --name "<your-apim-service-name>" \\
  --query id -o tsv)

# Assign role
az role assignment create \\
  --assignee "$APP_ID" \\
  --role "API Management Service Contributor" \\
  --scope "$APIM_RESOURCE_ID"
\`\`\`

## Step 3: Configure Federated Credentials

Set up OIDC federation for GitHub Actions:

\`\`\`bash
# For main branch deployments
az ad app federated-credential create \\
  --id "$APP_ID" \\
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"$GITHUB_ORG"'/'"$GITHUB_REPO"':ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# For environment deployments (repeat for each environment)
${environments.map((env) => `az ad app federated-credential create \\
  --id "$APP_ID" \\
  --parameters '{
    "name": "github-env-${env}",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"$GITHUB_ORG"'/'"$GITHUB_REPO"':environment:${env}",
    "audiences": ["api://AzureADTokenExchange"]
  }'`).join('\n\n')}
\`\`\`

## Step 4: Configure GitHub Secrets

Add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions):

### Repository Secrets:
- \`AZURE_CLIENT_ID\`: $APP_ID (from Step 1)
- \`AZURE_TENANT_ID\`: Run \`az account show --query tenantId -o tsv\`
- \`AZURE_SUBSCRIPTION_ID\`: ${subscriptionId}

### Environment-Specific Secrets:
${environments.map((env) => `
**For ${env} environment:**
- \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\`: Resource group for ${env}
- \`APIM_SERVICE_NAME_${env.toUpperCase()}\`: APIM service name for ${env}
`).join('\n')}

### Extract Workflow Secrets:
- \`APIM_RESOURCE_GROUP\`: Default resource group for extract
- \`APIM_SERVICE_NAME\`: Default APIM service name for extract

## Step 5: Verify Setup

Test the authentication by running a workflow manually or pushing to main branch.

## Security Notes
- Use GitHub Environments for production deployments with required reviewers
- Review federated credential subjects periodically (no secrets to rotate — OIDC authentication has no stored credentials)
- Review RBAC role assignments regularly and remove any no longer needed
- Use least-privilege RBAC assignments
`;
  }

  generateAzureDevOpsGuide(
    subscriptionId: string,
    resourceGroup: string,
    environments: string[],
    cloud = 'public'
  ): string {
    const cloudConfig = getCloudConfig(cloud);
    const armBaseUrl = `${cloudConfig.armBaseUrl}/`;
    const officialCloudName = getOfficialCloudName(cloud);
    const environmentsArrayPowerShell = environments.map((e) => `"${e}"`).join(', ');
    const environmentsArrayBash = environments.map((e) => `"${e}"`).join(' ');

    return `# Azure DevOps Identity Setup Guide

## Prerequisites
- Azure subscription: ${subscriptionId}
- Resource group: ${resourceGroup}
- Azure DevOps organization and project
- Azure CLI installed and authenticated (\`az login\`)

> **Note:** All commands use only built-in tools—no additional installations required. Commands are shown for both **PowerShell** and **Git Bash** where syntax differs.

---

## Step 1: Set Variables

**PowerShell:**
\`\`\`powershell
$SUBSCRIPTION_ID = "${subscriptionId}"
$RESOURCE_GROUP = "${resourceGroup}"
$MI_NAME = "apiops-azdo-mi"  # Name of the user-assigned managed identity
$MI_RESOURCE_GROUP = "<your-mi-resource-group>"
$ENVIRONMENTS = @(${environmentsArrayPowerShell})
\`\`\`

**Git Bash:**
\`\`\`bash
SUBSCRIPTION_ID="${subscriptionId}"
RESOURCE_GROUP="${resourceGroup}"
MI_NAME="apiops-azdo-mi"  # Name of the user-assigned managed identity
MI_RESOURCE_GROUP="<your-mi-resource-group>"
ENVIRONMENTS=(${environmentsArrayBash})
\`\`\`

---

## Step 2: Create Managed Identity

**PowerShell:**
\`\`\`powershell
# Create user-assigned managed identity (no password)
az identity create --name $MI_NAME --resource-group $MI_RESOURCE_GROUP
$MI_CLIENT_ID = az identity show --name $MI_NAME --resource-group $MI_RESOURCE_GROUP --query clientId -o tsv
$MI_PRINCIPAL_ID = az identity show --name $MI_NAME --resource-group $MI_RESOURCE_GROUP --query principalId -o tsv
$TENANT_ID = az account show --query tenantId -o tsv
Write-Host "Managed Identity Client ID: $MI_CLIENT_ID"
Write-Host "Managed Identity Principal ID: $MI_PRINCIPAL_ID"

# Assign API Management Service Contributor role
az role assignment create --assignee-object-id $MI_PRINCIPAL_ID --assignee-principal-type ServicePrincipal --role "API Management Service Contributor" --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
\`\`\`

**Git Bash:**
\`\`\`bash
# Create user-assigned managed identity (no password)
az identity create --name "$MI_NAME" --resource-group "$MI_RESOURCE_GROUP"
MI_CLIENT_ID=$(az identity show --name "$MI_NAME" --resource-group "$MI_RESOURCE_GROUP" --query clientId -o tsv)
MI_PRINCIPAL_ID=$(az identity show --name "$MI_NAME" --resource-group "$MI_RESOURCE_GROUP" --query principalId -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "Managed Identity Client ID: $MI_CLIENT_ID"
echo "Managed Identity Principal ID: $MI_PRINCIPAL_ID"

# Assign API Management Service Contributor role
az role assignment create --assignee-object-id "$MI_PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role "API Management Service Contributor" --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
\`\`\`

---

## Step 3: Configure Azure DevOps CLI

Install the extension (works in both shells):
\`\`\`bash
az extension add --name azure-devops
\`\`\`

Set organization defaults:

**PowerShell:**
\`\`\`powershell
# For self-hosted Azure DevOps Server, use: https://<server>/<collection>
$AZDO_ORG = "https://dev.azure.com/<your-org>"
$ORG_NAME = "<your-org>"  # Used for Build Service identity
$AZDO_PROJECT = "<your-project>"
az devops configure --defaults organization=$AZDO_ORG project=$AZDO_PROJECT
$SUBSCRIPTION_NAME = az account show --subscription $SUBSCRIPTION_ID --query name -o tsv
\`\`\`

**Git Bash:**
\`\`\`bash
# For self-hosted Azure DevOps Server, use: https://<server>/<collection>
AZDO_ORG="https://dev.azure.com/<your-org>"
ORG_NAME="<your-org>"  # Used for Build Service identity
AZDO_PROJECT="<your-project>"
az devops configure --defaults organization="$AZDO_ORG" project="$AZDO_PROJECT"
SUBSCRIPTION_NAME=$(az account show --subscription "$SUBSCRIPTION_ID" --query name -o tsv)
\`\`\`

---

## Step 4: Create Azure Service Connections

Create service connections using workload identity federation:

**PowerShell:**
\`\`\`powershell
$SUBSCRIPTION_NAME = az account show --subscription $SUBSCRIPTION_ID --query name -o tsv

function New-WifServiceConnection {
    param($SC_NAME)
    $body = @{
        name = $SC_NAME; type = "azurerm"; url = "${armBaseUrl}"
        authorization = @{ scheme = "WorkloadIdentityFederation"; parameters = @{ servicePrincipalId = $MI_CLIENT_ID; tenantid = $TENANT_ID } }
        data = @{ subscriptionId = $SUBSCRIPTION_ID; subscriptionName = $SUBSCRIPTION_NAME; environment = "${officialCloudName}"; scopeLevel = "Subscription"; creationMode = "Manual" }
    } | ConvertTo-Json -Depth 10 -Compress
    $body | Out-File -Encoding utf8 sc-body.json
    $ep = az devops invoke --area serviceEndpoint --resource endpoints --route-parameters project=$AZDO_PROJECT --http-method POST --api-version "7.1" --in-file sc-body.json | ConvertFrom-Json
    Remove-Item sc-body.json -ErrorAction SilentlyContinue
    $issuer = $ep.authorization.parameters.workloadIdentityFederationIssuer
    $subject = $ep.authorization.parameters.workloadIdentityFederationSubject
    $credName = $SC_NAME.ToLower().Replace("_", "-")
    az identity federated-credential create --name "azdo-$credName" --identity-name $MI_NAME --resource-group $MI_RESOURCE_GROUP --issuer $issuer --subject $subject --audiences "api://AzureADTokenExchange"
    Write-Host "Created service connection: $SC_NAME"
}

New-WifServiceConnection "AZURE_SERVICE_CONNECTION"
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    New-WifServiceConnection "AZURE_SERVICE_CONNECTION_$envUpper"
}
\`\`\`

**Git Bash:**
\`\`\`bash
SUBSCRIPTION_NAME=$(az account show --subscription "$SUBSCRIPTION_ID" --query name -o tsv)

create_wif_service_connection() {
    local SC_NAME="$1"
    # Create the service connection; use --query and -o tsv to extract the endpoint ID directly
    ENDPOINT_ID=$(az devops invoke \\
        --area serviceEndpoint --resource endpoints \\
        --route-parameters project="$AZDO_PROJECT" \\
        --http-method POST --api-version "7.1" \\
        --query "id" -o tsv \\
        --in-file - << ENDJSON
{"name":"$SC_NAME","type":"azurerm","url":"${armBaseUrl}","authorization":{"scheme":"WorkloadIdentityFederation","parameters":{"servicePrincipalId":"$MI_CLIENT_ID","tenantid":"$TENANT_ID"}},"data":{"subscriptionId":"$SUBSCRIPTION_ID","subscriptionName":"$SUBSCRIPTION_NAME","environment":"${officialCloudName}","scopeLevel":"Subscription","creationMode":"Manual"}}
ENDJSON
    )
    # Retrieve the WIF issuer and subject from the created endpoint
    ISSUER=$(az devops service-endpoint show --id "$ENDPOINT_ID" --query "authorization.parameters.workloadIdentityFederationIssuer" -o tsv)
    SUBJECT=$(az devops service-endpoint show --id "$ENDPOINT_ID" --query "authorization.parameters.workloadIdentityFederationSubject" -o tsv)
    CRED_NAME=$(echo "$SC_NAME" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
    az identity federated-credential create \\
        --name "azdo-$CRED_NAME" --identity-name "$MI_NAME" --resource-group "$MI_RESOURCE_GROUP" \\
        --issuer "$ISSUER" --subject "$SUBJECT" \\
        --audiences "api://AzureADTokenExchange"
    echo "Created service connection: $SC_NAME"
}

create_wif_service_connection "AZURE_SERVICE_CONNECTION"
for env in "\${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    create_wif_service_connection "AZURE_SERVICE_CONNECTION_$env_upper"
done
\`\`\`

Verify (works in both shells):
\`\`\`bash
az devops service-endpoint list --query "[].name" -o table
\`\`\`

---

## Step 5: Create Variable Groups

Set target environment variables:

**PowerShell:**
\`\`\`powershell
$TARGET_SUBSCRIPTION_ID = "${subscriptionId}"
$TARGET_APIM_BASE_NAME = "<your-apim-base-name>"
$TARGET_RESOURCE_GROUP_BASE_NAME = "${resourceGroup}"
\`\`\`

**Git Bash:**
\`\`\`bash
TARGET_SUBSCRIPTION_ID="${subscriptionId}"
TARGET_APIM_BASE_NAME="<your-apim-base-name>"
TARGET_RESOURCE_GROUP_BASE_NAME="${resourceGroup}"
\`\`\`

Create the common variable group:

**PowerShell:**
\`\`\`powershell
az pipelines variable-group create --name "apim-common" --variables AZURE_SUBSCRIPTION_ID=$TARGET_SUBSCRIPTION_ID APIM_RESOURCE_GROUP=$TARGET_RESOURCE_GROUP_BASE_NAME APIM_SERVICE_NAME=$TARGET_APIM_BASE_NAME AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION"
\`\`\`

**Git Bash:**
\`\`\`bash
az pipelines variable-group create --name "apim-common" --variables AZURE_SUBSCRIPTION_ID="$TARGET_SUBSCRIPTION_ID" APIM_RESOURCE_GROUP="$TARGET_RESOURCE_GROUP_BASE_NAME" APIM_SERVICE_NAME="$TARGET_APIM_BASE_NAME" AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION"
\`\`\`

Create environment-specific variable groups:

**PowerShell:**
\`\`\`powershell
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    az pipelines variable-group create --name "apim-$env" --variables "APIM_RESOURCE_GROUP_$envUpper=\${TARGET_RESOURCE_GROUP_BASE_NAME}-$env" "APIM_SERVICE_NAME_$envUpper=\${TARGET_APIM_BASE_NAME}-$env" "AZURE_SERVICE_CONNECTION_$envUpper=AZURE_SERVICE_CONNECTION_$envUpper"
}
\`\`\`

**Git Bash:**
\`\`\`bash
for env in "\${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    az pipelines variable-group create --name "apim-$env" --variables "APIM_RESOURCE_GROUP_$env_upper=\${TARGET_RESOURCE_GROUP_BASE_NAME}-$env" "APIM_SERVICE_NAME_$env_upper=\${TARGET_APIM_BASE_NAME}-$env" "AZURE_SERVICE_CONNECTION_$env_upper=AZURE_SERVICE_CONNECTION_$env_upper"
done
\`\`\`

Verify variable groups were created:
\`\`\`bash
az pipelines variable-group list --query "[].name" -o table
\`\`\`

---

## Step 6: Configure Pipeline Permissions

Authorize all pipelines to use the variable groups:

**PowerShell:**
\`\`\`powershell
$groupIds = az pipelines variable-group list --query "[].id" -o tsv
foreach ($id in $groupIds) {
    az pipelines variable-group update --group-id $id --authorize true
}
\`\`\`

**Git Bash:**
\`\`\`bash
for id in $(az pipelines variable-group list --query "[].id" -o tsv); do
    az pipelines variable-group update --group-id "$id" --authorize true
done
\`\`\`

---

## Step 7: Create Environments

Create deployment environments:

**PowerShell:**
\`\`\`powershell
foreach ($env in $ENVIRONMENTS) {
    $body = @{ name = $env } | ConvertTo-Json -Compress
    $body | Out-File -Encoding utf8 -FilePath env-body.json
    az devops invoke --area environments --resource environments --route-parameters project=$AZDO_PROJECT --http-method POST --api-version 7.1 --in-file env-body.json
}
Remove-Item env-body.json -ErrorAction SilentlyContinue
\`\`\`

**Git Bash:**
\`\`\`bash
for env in "\${ENVIRONMENTS[@]}"; do
    echo "{\\"name\\": \\"$env\\"}" > env-body.json
    az devops invoke --area environments --resource environments --route-parameters project="$AZDO_PROJECT" --http-method POST --api-version 7.1 --in-file env-body.json
done
rm -f env-body.json
\`\`\`

**Note:** Environment approvals and checks must be configured via the Azure DevOps UI (Project Settings > Environments).

---

## Step 8: Enable Pipeline Contributions

Grant the Build Service permission to contribute to the repository. This allows pipelines to push commits (e.g., extracted API artifacts).

First, get the project and repository IDs:

**PowerShell:**
\`\`\`powershell
$PROJECT_ID = az devops project show --project $AZDO_PROJECT --query id -o tsv
$REPO_NAME = $AZDO_PROJECT  # Change if your repo name differs from project name
$REPO_ID = az repos show --repository $REPO_NAME --query id -o tsv
\`\`\`

**Git Bash:**
\`\`\`bash
PROJECT_ID=$(az devops project show --project "$AZDO_PROJECT" --query id -o tsv)
REPO_NAME="$AZDO_PROJECT"  # Change if your repo name differs from project name
REPO_ID=$(az repos show --repository "$REPO_NAME" --query id -o tsv)
\`\`\`

Next, find the Build Service identity descriptor:

**PowerShell:**
\`\`\`powershell
$GRAPH_USERS = az devops invoke --area graph --resource users --query-parameters 'api-version=7.1-preview.1' --http-method GET -o json | ConvertFrom-Json
$BUILD_SERVICE_NAME = "$AZDO_PROJECT Build Service ($ORG_NAME)"
$BUILD_SERVICE_DESCRIPTOR = ($GRAPH_USERS.value | Where-Object { $_.displayName -eq $BUILD_SERVICE_NAME }).descriptor
\`\`\`

**Git Bash:**
\`\`\`bash
BUILD_SERVICE_NAME="$AZDO_PROJECT Build Service ($ORG_NAME)"
BUILD_SERVICE_DESCRIPTOR=$(az devops invoke --area graph --resource users --query-parameters 'api-version=7.1-preview.1' --http-method GET -o json | grep -B5 "\\"displayName\\": \\"$BUILD_SERVICE_NAME\\"" | grep '"descriptor"' | head -1 | cut -d'"' -f4)
\`\`\`

Finally, grant the Contribute permission (bit 4) on the repository:

**PowerShell:**
\`\`\`powershell
$GIT_REPOS_NAMESPACE = az devops security permission namespace list --query "[?name=='Git Repositories'].namespaceId" -o tsv
$TOKEN = "repoV2/$PROJECT_ID/$REPO_ID"
az devops security permission update --namespace-id $GIT_REPOS_NAMESPACE --subject $BUILD_SERVICE_DESCRIPTOR --token $TOKEN --allow-bit 4
\`\`\`

**Git Bash:**
\`\`\`bash
GIT_REPOS_NAMESPACE=$(az devops security permission namespace list --query "[?name=='Git Repositories'].namespaceId" -o tsv)
TOKEN="repoV2/$PROJECT_ID/$REPO_ID"
az devops security permission update --namespace-id "$GIT_REPOS_NAMESPACE" --subject "$BUILD_SERVICE_DESCRIPTOR" --token "$TOKEN" --allow-bit 4
\`\`\`

Verify the permission was set:

**PowerShell:**
\`\`\`powershell
az devops security permission show --namespace-id $GIT_REPOS_NAMESPACE --subject $BUILD_SERVICE_DESCRIPTOR --token $TOKEN --query "[].acesDictionary.*.resolvedPermissions" -o json
\`\`\`

**Git Bash:**
\`\`\`bash
az devops security permission show --namespace-id "$GIT_REPOS_NAMESPACE" --subject "$BUILD_SERVICE_DESCRIPTOR" --token "$TOKEN" --query "[].acesDictionary.*.resolvedPermissions" -o json
\`\`\`

---

## Step 9: Verify Setup

Verify all resources were created correctly:

**Service Connections:**
\`\`\`bash
az devops service-endpoint list --query "[].name" -o table
\`\`\`

**Variable Groups:**
\`\`\`bash
az pipelines variable-group list --query "[].name" -o table
\`\`\`

**Environments:**

**PowerShell:**
\`\`\`powershell
(az devops invoke --area environments --resource environments --route-parameters project=$AZDO_PROJECT --http-method GET --api-version 7.1 -o json | ConvertFrom-Json).value | Select-Object name
\`\`\`

**Git Bash:**
\`\`\`bash
az devops invoke --area environments --resource environments --route-parameters project="$AZDO_PROJECT" --http-method GET --api-version 7.1 -o json | grep -o '"name": *"[^"]*"' | cut -d'"' -f4
\`\`\`

**Service Principal Role Assignment:**

**PowerShell:**
\`\`\`powershell
az role assignment list --assignee $MI_CLIENT_ID --query "[].{Role:roleDefinitionName, Scope:scope}" -o table
\`\`\`

**Git Bash:**
\`\`\`bash
az role assignment list --assignee "$MI_CLIENT_ID" --query "[].{Role:roleDefinitionName, Scope:scope}" -o table
\`\`\`

**Final Test:** Run the extract pipeline manually to verify end-to-end authentication and permissions.

---

## Step 10: Create Pipelines

Create Azure Pipelines from the YAML files in your repository.

**Prerequisites:** Ensure your pipeline YAML files are committed to the repository (e.g., \`azure-pipelines-extract.yml\`, \`azure-pipelines-publish.yml\`).

**Create Extract Pipeline:**

**PowerShell:**
\`\`\`powershell
az pipelines create --name "apiops-extract" --repository $REPO_NAME --branch main --yml-path "azure-pipelines-extract.yml" --repository-type tfsgit --skip-first-run true
\`\`\`

**Git Bash:**
\`\`\`bash
az pipelines create --name "apiops-extract" --repository "$REPO_NAME" --branch main --yml-path "azure-pipelines-extract.yml" --repository-type tfsgit --skip-first-run true
\`\`\`

**Create Publish Pipeline:**

**PowerShell:**
\`\`\`powershell
az pipelines create --name "apiops-publish" --repository $REPO_NAME --branch main --yml-path "azure-pipelines-publish.yml" --repository-type tfsgit --skip-first-run true
\`\`\`

**Git Bash:**
\`\`\`bash
az pipelines create --name "apiops-publish" --repository "$REPO_NAME" --branch main --yml-path "azure-pipelines-publish.yml" --repository-type tfsgit --skip-first-run true
\`\`\`

**Verify pipelines were created:**
\`\`\`bash
az pipelines list --query "[].name" -o table
\`\`\`

**Run the extract pipeline:**

**PowerShell:**
\`\`\`powershell
az pipelines run --name "apiops-extract"
\`\`\`

**Git Bash:**
\`\`\`bash
az pipelines run --name "apiops-extract"
\`\`\`

---

## Security Notes
- Use separate service connections for production environments
- Enable environment approvals for production deployments
- User-assigned managed identities have no passwords or secrets to rotate — credentials-free
- Federated credentials are tied to specific Azure DevOps service connections — review and rotate if service connections are recreated
- Review RBAC assignments regularly
`;
  }
}

export const identityGuideService: IdentityGuideService = new IdentityGuideServiceImpl();
