# Azure DevOps Identity Setup Guide

{{AZURE_DEVOPS_CORE_STEPS}}

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
