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
    const azureManagementUrl = armBaseUrl;
    const azureGovNote = cloud === 'usgovernment' ? '' : `  # Use https://management.usgovcloudapi.net/ for Azure Government`;

    return `# Azure DevOps Identity Setup Guide

## Prerequisites
- Azure CLI installed and Azure DevOps extension installed
- Azure CLI authenticated (\`az login\`)
- Azure DevOps project URL (e.g., \`https://dev.azure.com/your-org/your-project\`)
- APIM instance resource IDs for each environment (copy from Azure portal > APIM > Properties)


---

## Step 1: Set Variables

Set these required variables:

**PowerShell:**
\`\`\`powershell
# Required: Your Azure DevOps project URL
$AZDO_PROJECT_URL = "https://dev.azure.com/<your-org>/<your-project>"

# Required: List of environments to configure
$ENVIRONMENTS = @(${environmentsArrayPowerShell})  # Add/remove as needed: @("dev", "stage", "prod")

# Required: APIM instance resource IDs for EACH environment in the list above
# Copy the resource ID from Azure portal > APIM > Properties
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    $resourceId = Read-Host "Enter the full resource ID for APIM instance in $env environment"
    Set-Variable -Name "APIM_INSTANCE_$envUpper" -Value $resourceId
}

# Optional: Defaults provided
$MI_NAME = "apiops-azdo-mi"
$MI_RESOURCE_GROUP = "azdo-mi-rg"  # Will be created if it doesn't exist
$AZURE_MANAGEMENT_URL = "${azureManagementUrl}"${azureGovNote}
\`\`\`

**Git Bash:**
\`\`\`bash
# Required: Your Azure DevOps project URL
AZDO_PROJECT_URL="https://dev.azure.com/<your-org>/<your-project>"

# Required: List of environments to configure
ENVIRONMENTS=(${environmentsArrayBash})  # Add/remove as needed: ("dev" "stage" "prod")

# Required: APIM instance resource IDs for EACH environment in the list above
# Copy the resource ID from Azure portal > APIM > Properties
for env in "\${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    read -p "Enter the full resource ID for APIM instance in $env environment: " resource_id
    declare "APIM_INSTANCE_\${env_upper}=$resource_id"
done

# Optional: Defaults provided
MI_NAME="apiops-azdo-mi"
MI_RESOURCE_GROUP="azdo-mi-rg"  # Will be created if it doesn't exist
AZURE_MANAGEMENT_URL="${azureManagementUrl}"${azureGovNote}
\`\`\`

> **Tip:** APIM resource IDs look like: \`/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<apim-name>\`

### Parse Azure DevOps URL and extract derived values

**PowerShell:**
\`\`\`powershell
# Parse Azure DevOps project URL
$urlParts = $AZDO_PROJECT_URL -replace 'https://dev.azure.com/', '' -split '/'
$ORG_NAME = $urlParts[0]
$AZDO_PROJECT = $urlParts[1]
$AZDO_ORG = "https://dev.azure.com/$ORG_NAME"

Write-Host "Organization: $ORG_NAME"
Write-Host "Project: $AZDO_PROJECT"
Write-Host "Org URL: $AZDO_ORG"

# Extract subscription ID from first environment's APIM instance
$firstEnv = $ENVIRONMENTS[0].ToUpper()
$firstInstanceId = Get-Variable -Name "APIM_INSTANCE_$firstEnv" -ValueOnly
$SUBSCRIPTION_ID = ($firstInstanceId -split '/')[2]

# Extract environment-specific values from each APIM instance ID
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    $instanceId = Get-Variable -Name "APIM_INSTANCE_$envUpper" -ValueOnly
    $parts = $instanceId -split '/'
    Set-Variable -Name "APIM_RG_$envUpper" -Value $parts[4]
    Set-Variable -Name "APIM_NAME_$envUpper" -Value $parts[8]
    Write-Host "$env: RG=$($parts[4]), APIM=$($parts[8])"
}
\`\`\`

**Git Bash:**
\`\`\`bash
# Parse Azure DevOps project URL
ORG_NAME=$(echo "$AZDO_PROJECT_URL" | sed 's|https://dev.azure.com/||' | cut -d'/' -f1)
AZDO_PROJECT=$(echo "$AZDO_PROJECT_URL" | sed 's|https://dev.azure.com/||' | cut -d'/' -f2)
AZDO_ORG="https://dev.azure.com/\${ORG_NAME}"

echo "Organization: $ORG_NAME"
echo "Project: $AZDO_PROJECT"
echo "Org URL: $AZDO_ORG"

# Extract subscription ID from first environment's APIM instance
first_env=$(echo "\${ENVIRONMENTS[0]}" | tr '[:lower:]' '[:upper:]')
first_instance_var="APIM_INSTANCE_\${first_env}"
first_instance_id="\${!first_instance_var}"
SUBSCRIPTION_ID=$(echo "$first_instance_id" | cut -d'/' -f3)

# Extract environment-specific values from each APIM instance ID
for env in "\${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    instance_var="APIM_INSTANCE_\${env_upper}"
    instance_id="\${!instance_var}"
    
    # Parse resource ID: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{name}
    apim_rg=$(echo "$instance_id" | cut -d'/' -f5)
    apim_name=$(echo "$instance_id" | cut -d'/' -f9)
    
    declare "APIM_RG_\${env_upper}=$apim_rg"
    declare "APIM_NAME_\${env_upper}=$apim_name"
    
    echo "$env: RG=$apim_rg, APIM=$apim_name"
done
\`\`\`

### Verify managed identity resource group exists

**PowerShell:**
\`\`\`powershell
$rgExists = az group exists --name $MI_RESOURCE_GROUP
if ($rgExists -eq "false") {
    Write-Host "Creating resource group '$MI_RESOURCE_GROUP'..."
    az group create --name $MI_RESOURCE_GROUP --location "<your-location>"
}
\`\`\`

**Git Bash:**
\`\`\`bash
if [ "$(az group exists --name "$MI_RESOURCE_GROUP")" = "false" ]; then
    echo "Creating resource group '$MI_RESOURCE_GROUP'..."
    az group create --name "$MI_RESOURCE_GROUP" --location "<your-location>"
fi
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
Write-Host "Tenant ID: $TENANT_ID"

# Assign API Management Service Contributor role for each environment's resource group
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    $apimRg = Get-Variable -Name "APIM_RG_$envUpper" -ValueOnly
    az role assignment create --assignee-object-id $MI_PRINCIPAL_ID --assignee-principal-type ServicePrincipal --role "API Management Service Contributor" --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$apimRg"
}
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
echo "Tenant ID: $TENANT_ID"

# Assign API Management Service Contributor role for each environment's resource group
for env in "\${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    apim_rg_var="APIM_RG_\${env_upper}"
    apim_rg="\${!apim_rg_var}"
    az role assignment create --assignee-object-id "$MI_PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role "API Management Service Contributor" --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$apim_rg"
done
\`\`\`

---

## Step 3: Configure Azure DevOps CLI

Install the extension (works in both shells):
\`\`\`bash
az extension add --name azure-devops
\`\`\`

Set organization defaults and retrieve required IDs:

**PowerShell:**
\`\`\`powershell
az devops configure --defaults organization=$AZDO_ORG project=$AZDO_PROJECT
$SUBSCRIPTION_NAME = az account show --subscription $SUBSCRIPTION_ID --query name -o tsv

# Get project ID (required for service connection creation)
$PROJECT_ID = az devops project show --project $AZDO_PROJECT --organization $AZDO_ORG --query id -o tsv
Write-Host "Project ID: $PROJECT_ID"

# Get repository name (required for pipeline creation)
$REPO_NAME = az repos list --project $AZDO_PROJECT --organization $AZDO_ORG --query "[0].name" -o tsv
Write-Host "Repository: $REPO_NAME"
\`\`\`

**Git Bash:**
\`\`\`bash
az devops configure --defaults organization="$AZDO_ORG" project="$AZDO_PROJECT"
SUBSCRIPTION_NAME=$(az account show --subscription "$SUBSCRIPTION_ID" --query name -o tsv)

# Get project ID (required for service connection creation)
PROJECT_ID=$(az devops project show --project "$AZDO_PROJECT" --organization "$AZDO_ORG" --query id -o tsv)
echo "Project ID: $PROJECT_ID"

# Get repository name (required for pipeline creation)
REPO_NAME=$(az repos list --project "$AZDO_PROJECT" --organization "$AZDO_ORG" --query "[0].name" -o tsv)
echo "Repository: $REPO_NAME"
\`\`\`

---

## Step 4: Create Azure Service Connections

Create service connections using workload identity federation.

> **Important:** The API requires \`serviceEndpointProjectReferences\` with the project ID and name.

**PowerShell:**
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
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    New-WifServiceConnection "AZURE_SERVICE_CONNECTION_$envUpper"
}
\`\`\`

**Git Bash:**
\`\`\`bash
create_wif_service_connection() {
    local SC_NAME="$1"
    
    ENDPOINT_RESPONSE=$(az devops invoke \\
        --area serviceEndpoint \\
        --resource endpoints \\
        --route-parameters project="$AZDO_PROJECT" \\
        --http-method POST \\
        --api-version "7.1" \\
        --in-file - << ENDJSON
{
  "name": "$SC_NAME",
  "type": "azurerm",
  "url": "${armBaseUrl}",
  "authorization": {
    "scheme": "WorkloadIdentityFederation",
    "parameters": {
      "servicePrincipalId": "$MI_CLIENT_ID",
      "tenantid": "$TENANT_ID"
    }
  },
  "data": {
    "subscriptionId": "$SUBSCRIPTION_ID",
    "subscriptionName": "$SUBSCRIPTION_NAME",
    "environment": "${officialCloudName}",
    "scopeLevel": "Subscription",
    "creationMode": "Manual"
  },
  "serviceEndpointProjectReferences": [
    {
      "projectReference": {
        "id": "$PROJECT_ID",
        "name": "$AZDO_PROJECT"
      },
      "name": "$SC_NAME"
    }
  ]
}
ENDJSON
    )
    
    ENDPOINT_ID=$(echo "$ENDPOINT_RESPONSE" | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4)
    ISSUER=$(az devops service-endpoint show --id "$ENDPOINT_ID" --query "authorization.parameters.workloadIdentityFederationIssuer" -o tsv)
    SUBJECT=$(az devops service-endpoint show --id "$ENDPOINT_ID" --query "authorization.parameters.workloadIdentityFederationSubject" -o tsv)
    
    CRED_NAME=$(echo "$SC_NAME" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
    az identity federated-credential create \\
        --name "azdo-$CRED_NAME" \\
        --identity-name "$MI_NAME" \\
        --resource-group "$MI_RESOURCE_GROUP" \\
        --issuer "$ISSUER" \\
        --subject "$SUBJECT" \\
        --audiences "api://AzureADTokenExchange"
    
    echo "Created service connection: $SC_NAME (ID: $ENDPOINT_ID)"
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

Create the common variable group:

**PowerShell:**
\`\`\`powershell
az pipelines variable-group create \`
    --name "apim-common" \`
    --project $AZDO_PROJECT \`
    --organization $AZDO_ORG \`
    --variables AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION"
\`\`\`

**Git Bash:**
\`\`\`bash
az pipelines variable-group create \\
    --name "apim-common" \\
    --project "$AZDO_PROJECT" \\
    --organization "$AZDO_ORG" \\
    --variables AZURE_SUBSCRIPTION_ID="$SUBSCRIPTION_ID" AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION"
\`\`\`

Create environment-specific variable groups using values extracted from APIM instance IDs:

**PowerShell:**
\`\`\`powershell
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    $apimRg = Get-Variable -Name "APIM_RG_$envUpper" -ValueOnly
    $apimName = Get-Variable -Name "APIM_NAME_$envUpper" -ValueOnly
    
    az pipelines variable-group create \`
        --name "apim-$env" \`
        --project $AZDO_PROJECT \`
        --organization $AZDO_ORG \`
        --variables APIM_RESOURCE_GROUP=$apimRg APIM_SERVICE_NAME=$apimName AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION_$envUpper"
}
\`\`\`

**Git Bash:**
\`\`\`bash
for env in "\${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    apim_rg_var="APIM_RG_\${env_upper}"
    apim_name_var="APIM_NAME_\${env_upper}"
    apim_rg="\${!apim_rg_var}"
    apim_name="\${!apim_name_var}"
    
    az pipelines variable-group create \\
        --name "apim-$env" \\
        --project "$AZDO_PROJECT" \\
        --organization "$AZDO_ORG" \\
        --variables APIM_RESOURCE_GROUP="$apim_rg" APIM_SERVICE_NAME="$apim_name" AZURE_SUBSCRIPTION_ID="$SUBSCRIPTION_ID" AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION_$env_upper"
done
\`\`\`

Authorize all variable groups for use in pipelines:

**PowerShell:**
\`\`\`powershell
$groupIds = az pipelines variable-group list --project $AZDO_PROJECT --organization $AZDO_ORG --query "[].id" -o tsv
foreach ($id in $groupIds) {
    az pipelines variable-group update --group-id $id --authorize true --project $AZDO_PROJECT --organization $AZDO_ORG
}
\`\`\`

**Git Bash:**
\`\`\`bash
for id in $(az pipelines variable-group list --project "$AZDO_PROJECT" --organization "$AZDO_ORG" --query "[].id" -o tsv); do
    az pipelines variable-group update --group-id "$id" --authorize true --project "$AZDO_PROJECT" --organization "$AZDO_ORG"
done
\`\`\`

Verify variable groups were created:
\`\`\`bash
az pipelines variable-group list --project "$AZDO_PROJECT" --organization "$AZDO_ORG" --query "[].name" -o table
\`\`\`

---

## Step 6: Create Environments

Create deployment environments:

**PowerShell:**
\`\`\`powershell
foreach ($env in $ENVIRONMENTS) {
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

**Git Bash:**
\`\`\`bash
for env in "\${ENVIRONMENTS[@]}"; do
    echo "Creating environment: $env"
    cat << EOF | az devops invoke --area distributedtask --resource environments --route-parameters project="$AZDO_PROJECT" --http-method POST --api-version 7.1 --in-file -
{"name": "$env", "description": "Deployment environment for $env"}
EOF
done
\`\`\`

> **Note:** Environment approvals and checks must be configured via the Azure DevOps UI (Project Settings > Environments).

### Authorize environments for all pipelines

Allow all pipelines to deploy to these environments without manual permission prompts:

**PowerShell:**
\`\`\`powershell
foreach ($env in $ENVIRONMENTS) {
    # Get environment ID
    $envList = az devops invoke --area distributedtask --resource environments --route-parameters project=$AZDO_PROJECT --http-method GET --api-version 7.1 -o json | ConvertFrom-Json
    $envId = ($envList.value | Where-Object { $_.name -eq $env }).id
    
    if ($envId) {
        # Authorize all pipelines for this environment
        $body = @{
            resource = @{
                id = $envId
                type = "environment"
            }
            allPipelines = @{
                authorized = $true
            }
        } | ConvertTo-Json -Compress
        
        $tempFile = [System.IO.Path]::GetTempFileName()
        $body | Out-File -Encoding utf8 $tempFile
        
        az devops invoke --area pipelinePermissions --resource pipelinePermissions --route-parameters project=$AZDO_PROJECT resourceType=environment resourceId=$envId --http-method PATCH --api-version 7.1-preview.1 --in-file $tempFile
        
        Remove-Item $tempFile
        Write-Host "Authorized all pipelines for environment: $env"
    }
}
\`\`\`

**Git Bash:**
\`\`\`bash
for env in "\${ENVIRONMENTS[@]}"; do
    # Get environment ID
    ENV_ID=$(az devops invoke --area distributedtask --resource environments --route-parameters project="$AZDO_PROJECT" --http-method GET --api-version 7.1 -o json | grep -B5 "\\"name\\": *\\"$env\\"" | grep '"id":' | head -1 | grep -o '[0-9]*')
    
    if [ -n "$ENV_ID" ]; then
        # Authorize all pipelines for this environment
        cat << EOF | az devops invoke --area pipelinePermissions --resource pipelinePermissions --route-parameters project="$AZDO_PROJECT" resourceType=environment resourceId=$ENV_ID --http-method PATCH --api-version 7.1-preview.1 --in-file -
{"resource":{"id":$ENV_ID,"type":"environment"},"allPipelines":{"authorized":true}}
EOF
        echo "Authorized all pipelines for environment: $env"
    fi
done
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
