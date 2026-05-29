# Azure DevOps Identity Setup Guide

## Prerequisites
- Azure subscription: {{SUBSCRIPTION_ID}}
- Resource group: {{RESOURCE_GROUP}}
- Azure DevOps organization and project
- Azure CLI installed and authenticated (`az login`)

> **Note:** All commands use only built-in tools—no additional installations required. Commands are shown for both **PowerShell** and **Git Bash** where syntax differs.

---

## Step 1: Set Variables

**PowerShell:**
```powershell
$SUBSCRIPTION_ID = "{{SUBSCRIPTION_ID}}"
$RESOURCE_GROUP = "{{RESOURCE_GROUP}}"
$APP_NAME = "apiops-azdo-sp"
$ENVIRONMENTS = @({{ENVIRONMENTS_ARRAY_POWERSHELL}})
```

**Git Bash:**
```bash
SUBSCRIPTION_ID="{{SUBSCRIPTION_ID}}"
RESOURCE_GROUP="{{RESOURCE_GROUP}}"
APP_NAME="apiops-azdo-sp"
ENVIRONMENTS=({{ENVIRONMENTS_ARRAY_BASH}})
```

---

## Step 2: Create Service Principal

**PowerShell:**
```powershell
$SP_OUTPUT = az ad sp create-for-rbac --name $APP_NAME --role "API Management Service Contributor" --scopes "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"
$spObj = $SP_OUTPUT | ConvertFrom-Json
$APP_ID = $spObj.appId
$PASSWORD = $spObj.password
$TENANT_ID = $spObj.tenant
```

**Git Bash:** (use `MSYS_NO_PATHCONV=1` to prevent path conversion on Windows)
```bash
SP_OUTPUT=$(MSYS_NO_PATHCONV=1 az ad sp create-for-rbac --name "$APP_NAME" --role "API Management Service Contributor" --scopes "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP")
APP_ID=$(echo "$SP_OUTPUT" | grep -o '"appId": *"[^"]*"' | cut -d'"' -f4)
PASSWORD=$(echo "$SP_OUTPUT" | grep -o '"password": *"[^"]*"' | cut -d'"' -f4)
TENANT_ID=$(echo "$SP_OUTPUT" | grep -o '"tenant": *"[^"]*"' | cut -d'"' -f4)
```

**Important:** The password is only shown once during creation. Save it securely now!

---

## Step 3: Configure Azure DevOps CLI

Install the extension (works in both shells):
```bash
az extension add --name azure-devops
```

Set organization defaults:

**PowerShell:**
```powershell
# For self-hosted Azure DevOps Server, use: https://<server>/<collection>
$AZDO_ORG = "https://dev.azure.com/<your-org>"
$ORG_NAME = "<your-org>"  # Used for Build Service identity
$AZDO_PROJECT = "<your-project>"
az devops configure --defaults organization=$AZDO_ORG project=$AZDO_PROJECT
$SUBSCRIPTION_NAME = az account show --subscription $SUBSCRIPTION_ID --query name -o tsv
```

**Git Bash:**
```bash
# For self-hosted Azure DevOps Server, use: https://<server>/<collection>
AZDO_ORG="https://dev.azure.com/<your-org>"
ORG_NAME="<your-org>"  # Used for Build Service identity
AZDO_PROJECT="<your-project>"
az devops configure --defaults organization="$AZDO_ORG" project="$AZDO_PROJECT"
SUBSCRIPTION_NAME=$(az account show --subscription "$SUBSCRIPTION_ID" --query name -o tsv)
```

---

## Step 4: Create Azure Service Connections

Set the service principal key for non-interactive creation:

**PowerShell:**
```powershell
$env:AZURE_DEVOPS_EXT_AZURE_RM_SERVICE_PRINCIPAL_KEY = $PASSWORD
```

**Git Bash:**
```bash
export AZURE_DEVOPS_EXT_AZURE_RM_SERVICE_PRINCIPAL_KEY="$PASSWORD"
```

Create the base service connection and one per environment:

**PowerShell:**
```powershell
az devops service-endpoint azurerm create --name "AZURE_SERVICE_CONNECTION" --azure-rm-service-principal-id $APP_ID --azure-rm-subscription-id $SUBSCRIPTION_ID --azure-rm-subscription-name $SUBSCRIPTION_NAME --azure-rm-tenant-id $TENANT_ID

foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    az devops service-endpoint azurerm create --name "AZURE_SERVICE_CONNECTION_$envUpper" --azure-rm-service-principal-id $APP_ID --azure-rm-subscription-id $SUBSCRIPTION_ID --azure-rm-subscription-name $SUBSCRIPTION_NAME --azure-rm-tenant-id $TENANT_ID
}
```

**Git Bash:**
```bash
az devops service-endpoint azurerm create --name "AZURE_SERVICE_CONNECTION" --azure-rm-service-principal-id "$APP_ID" --azure-rm-subscription-id "$SUBSCRIPTION_ID" --azure-rm-subscription-name "$SUBSCRIPTION_NAME" --azure-rm-tenant-id "$TENANT_ID"

for env in "${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    az devops service-endpoint azurerm create --name "AZURE_SERVICE_CONNECTION_$env_upper" --azure-rm-service-principal-id "$APP_ID" --azure-rm-subscription-id "$SUBSCRIPTION_ID" --azure-rm-subscription-name "$SUBSCRIPTION_NAME" --azure-rm-tenant-id "$TENANT_ID"
done
```

Clean up the environment variable:

**PowerShell:**
```powershell
Remove-Item Env:AZURE_DEVOPS_EXT_AZURE_RM_SERVICE_PRINCIPAL_KEY
```

**Git Bash:**
```bash
unset AZURE_DEVOPS_EXT_AZURE_RM_SERVICE_PRINCIPAL_KEY
```

Verify (works in both shells):
```bash
az devops service-endpoint list --query "[].name" -o table
```

---

## Step 5: Create Variable Groups

Set target environment variables:

**PowerShell:**
```powershell
$TARGET_SUBSCRIPTION_ID = "{{SUBSCRIPTION_ID}}"
$TARGET_APIM_BASE_NAME = "<your-apim-base-name>"
$TARGET_RESOURCE_GROUP_BASE_NAME = "{{RESOURCE_GROUP}}"
```

**Git Bash:**
```bash
TARGET_SUBSCRIPTION_ID="{{SUBSCRIPTION_ID}}"
TARGET_APIM_BASE_NAME="<your-apim-base-name>"
TARGET_RESOURCE_GROUP_BASE_NAME="{{RESOURCE_GROUP}}"
```

Create the common variable group:

**PowerShell:**
```powershell
az pipelines variable-group create --name "apim-common" --variables AZURE_SUBSCRIPTION_ID=$TARGET_SUBSCRIPTION_ID APIM_RESOURCE_GROUP=$TARGET_RESOURCE_GROUP_BASE_NAME APIM_SERVICE_NAME=$TARGET_APIM_BASE_NAME AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION"
```

**Git Bash:**
```bash
az pipelines variable-group create --name "apim-common" --variables AZURE_SUBSCRIPTION_ID="$TARGET_SUBSCRIPTION_ID" APIM_RESOURCE_GROUP="$TARGET_RESOURCE_GROUP_BASE_NAME" APIM_SERVICE_NAME="$TARGET_APIM_BASE_NAME" AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION"
```

Create environment-specific variable groups:

**PowerShell:**
```powershell
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    az pipelines variable-group create --name "apim-$env" --variables "APIM_RESOURCE_GROUP_$envUpper=${TARGET_RESOURCE_GROUP_BASE_NAME}-$env" "APIM_SERVICE_NAME_$envUpper=${TARGET_APIM_BASE_NAME}-$env" "AZURE_SERVICE_CONNECTION_$envUpper=AZURE_SERVICE_CONNECTION_$envUpper"
}
```

**Git Bash:**
```bash
for env in "${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    az pipelines variable-group create --name "apim-$env" --variables "APIM_RESOURCE_GROUP_$env_upper=${TARGET_RESOURCE_GROUP_BASE_NAME}-$env" "APIM_SERVICE_NAME_$env_upper=${TARGET_APIM_BASE_NAME}-$env" "AZURE_SERVICE_CONNECTION_$env_upper=AZURE_SERVICE_CONNECTION_$env_upper"
done
```

Verify variable groups were created:
```bash
az pipelines variable-group list --query "[].name" -o table
```

---

## Step 6: Configure Pipeline Permissions

Authorize all pipelines to use the variable groups:

**PowerShell:**
```powershell
$groupIds = az pipelines variable-group list --query "[].id" -o tsv
foreach ($id in $groupIds) {
    az pipelines variable-group update --group-id $id --authorize true
}
```

**Git Bash:**
```bash
for id in $(az pipelines variable-group list --query "[].id" -o tsv); do
    az pipelines variable-group update --group-id "$id" --authorize true
done
```

---

## Step 7: Create Environments

Create deployment environments:

**PowerShell:**
```powershell
foreach ($env in $ENVIRONMENTS) {
    $body = @{ name = $env } | ConvertTo-Json -Compress
    $body | Out-File -Encoding utf8 -FilePath env-body.json
    az devops invoke --area environments --resource environments --route-parameters project=$AZDO_PROJECT --http-method POST --api-version 7.1 --in-file env-body.json
}
Remove-Item env-body.json -ErrorAction SilentlyContinue
```

**Git Bash:**
```bash
for env in "${ENVIRONMENTS[@]}"; do
    echo "{\"name\": \"$env\"}" > env-body.json
    az devops invoke --area environments --resource environments --route-parameters project="$AZDO_PROJECT" --http-method POST --api-version 7.1 --in-file env-body.json
done
rm -f env-body.json
```

**Note:** Environment approvals and checks must be configured via the Azure DevOps UI (Project Settings > Environments).

---

## Step 8: Enable Pipeline Contributions

Grant the Build Service permission to contribute to the repository. This allows pipelines to push commits (e.g., extracted API artifacts).

First, get the project and repository IDs:

**PowerShell:**
```powershell
$PROJECT_ID = az devops project show --project $AZDO_PROJECT --query id -o tsv
$REPO_NAME = $AZDO_PROJECT  # Change if your repo name differs from project name
$REPO_ID = az repos show --repository $REPO_NAME --query id -o tsv
```

**Git Bash:**
```bash
PROJECT_ID=$(az devops project show --project "$AZDO_PROJECT" --query id -o tsv)
REPO_NAME="$AZDO_PROJECT"  # Change if your repo name differs from project name
REPO_ID=$(az repos show --repository "$REPO_NAME" --query id -o tsv)
```

Next, find the Build Service identity descriptor:

**PowerShell:**
```powershell
$GRAPH_USERS = az devops invoke --area graph --resource users --query-parameters 'api-version=7.1-preview.1' --http-method GET -o json | ConvertFrom-Json
$BUILD_SERVICE_NAME = "$AZDO_PROJECT Build Service ($ORG_NAME)"
$BUILD_SERVICE_DESCRIPTOR = ($GRAPH_USERS.value | Where-Object { $_.displayName -eq $BUILD_SERVICE_NAME }).descriptor
```

**Git Bash:**
```bash
BUILD_SERVICE_NAME="$AZDO_PROJECT Build Service ($ORG_NAME)"
BUILD_SERVICE_DESCRIPTOR=$(az devops invoke --area graph --resource users --query-parameters 'api-version=7.1-preview.1' --http-method GET -o json | grep -B5 "\"displayName\": \"$BUILD_SERVICE_NAME\"" | grep '"descriptor"' | head -1 | cut -d'"' -f4)
```

Finally, grant the Contribute permission (bit 4) on the repository:

**PowerShell:**
```powershell
$GIT_REPOS_NAMESPACE = az devops security permission namespace list --query "[?name=='Git Repositories'].namespaceId" -o tsv
$TOKEN = "repoV2/$PROJECT_ID/$REPO_ID"
az devops security permission update --namespace-id $GIT_REPOS_NAMESPACE --subject $BUILD_SERVICE_DESCRIPTOR --token $TOKEN --allow-bit 4
```

**Git Bash:**
```bash
GIT_REPOS_NAMESPACE=$(az devops security permission namespace list --query "[?name=='Git Repositories'].namespaceId" -o tsv)
TOKEN="repoV2/$PROJECT_ID/$REPO_ID"
az devops security permission update --namespace-id "$GIT_REPOS_NAMESPACE" --subject "$BUILD_SERVICE_DESCRIPTOR" --token "$TOKEN" --allow-bit 4
```

Verify the permission was set:

**PowerShell:**
```powershell
az devops security permission show --namespace-id $GIT_REPOS_NAMESPACE --subject $BUILD_SERVICE_DESCRIPTOR --token $TOKEN --query "[].acesDictionary.*.resolvedPermissions" -o json
```

**Git Bash:**
```bash
az devops security permission show --namespace-id "$GIT_REPOS_NAMESPACE" --subject "$BUILD_SERVICE_DESCRIPTOR" --token "$TOKEN" --query "[].acesDictionary.*.resolvedPermissions" -o json
```

---

## Step 9: Verify Setup

Verify all resources were created correctly:

**Service Connections:**
```bash
az devops service-endpoint list --query "[].name" -o table
```

**Variable Groups:**
```bash
az pipelines variable-group list --query "[].name" -o table
```

**Environments:**

**PowerShell:**
```powershell
(az devops invoke --area environments --resource environments --route-parameters project=$AZDO_PROJECT --http-method GET --api-version 7.1 -o json | ConvertFrom-Json).value | Select-Object name
```

**Git Bash:**
```bash
az devops invoke --area environments --resource environments --route-parameters project="$AZDO_PROJECT" --http-method GET --api-version 7.1 -o json | grep -o '"name": *"[^"]*"' | cut -d'"' -f4
```

**Service Principal Role Assignment:**

**PowerShell:**
```powershell
az role assignment list --assignee $APP_ID --query "[].{Role:roleDefinitionName, Scope:scope}" -o table
```

**Git Bash:**
```bash
az role assignment list --assignee "$APP_ID" --query "[].{Role:roleDefinitionName, Scope:scope}" -o table
```

**Final Test:** Run the extract pipeline manually to verify end-to-end authentication and permissions.

---

## Step 10: Create Pipelines

Create Azure Pipelines from the YAML files in your repository.

**Prerequisites:** Ensure your pipeline YAML files are committed to the repository (e.g., `azure-pipelines-extract.yml`, `azure-pipelines-publish.yml`).

**Create Extract Pipeline:**

**PowerShell:**
```powershell
az pipelines create --name "apiops-extract" --repository $REPO_NAME --branch main --yml-path "azure-pipelines-extract.yml" --repository-type tfsgit --skip-first-run true
```

**Git Bash:**
```bash
az pipelines create --name "apiops-extract" --repository "$REPO_NAME" --branch main --yml-path "azure-pipelines-extract.yml" --repository-type tfsgit --skip-first-run true
```

**Create Publish Pipeline:**

**PowerShell:**
```powershell
az pipelines create --name "apiops-publish" --repository $REPO_NAME --branch main --yml-path "azure-pipelines-publish.yml" --repository-type tfsgit --skip-first-run true
```

**Git Bash:**
```bash
az pipelines create --name "apiops-publish" --repository "$REPO_NAME" --branch main --yml-path "azure-pipelines-publish.yml" --repository-type tfsgit --skip-first-run true
```

**Verify pipelines were created:**
```bash
az pipelines list --query "[].name" -o table
```

**Run the extract pipeline:**

**PowerShell:**
```powershell
az pipelines run --name "apiops-extract"
```

**Git Bash:**
```bash
az pipelines run --name "apiops-extract"
```

---

## Security Notes
- Use separate service principals for production environments
- Enable environment approvals for production deployments
- Rotate service principal secrets periodically (recommended: 90 days)
- Use managed identities when possible for Azure-hosted agents
- Review RBAC assignments regularly
