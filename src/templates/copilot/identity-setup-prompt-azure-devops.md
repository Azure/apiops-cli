# Setup Azure DevOps Identity for APIOps

> **How to use:** Open this file in VS Code with GitHub Copilot and ask
> Copilot to help you run through the steps. Copilot will prompt you for
> required values and generate exact CLI commands for your environment.

> **Important identity distinction:** The Azure app registration/service principal created in this flow is only for Azure and APIM access. Repository contributions and pull request creation come from the Azure DevOps Build Service identity, which must be granted repo permissions separately.

## Goal

Configure workload identity federation (OIDC), Azure DevOps federated service connections,
and variable groups
for APIOps extract and publish pipelines.

{{AZURE_DEVOPS_CORE_STEPS}}

## Step 10: Enable Pipeline Contributions

Grant the Build Service permission to contribute to the repository.

**PowerShell:**
```powershell
$PROJECT_ID = az devops project show --project $AZDO_PROJECT --query id -o tsv
$REPO_NAME = $AZDO_PROJECT
$REPO_ID = az repos show --repository $REPO_NAME --query id -o tsv

$GRAPH_USERS = az devops invoke --area graph --resource users --query-parameters 'api-version=7.1-preview.1' --http-method GET -o json | ConvertFrom-Json
$BUILD_SERVICE_NAME = "$AZDO_PROJECT Build Service ($ORG_NAME)"
$BUILD_SERVICE_DESCRIPTOR = ($GRAPH_USERS.value | Where-Object { $_.displayName -eq $BUILD_SERVICE_NAME }).descriptor

$GIT_REPOS_NAMESPACE = az devops security permission namespace list --query "[?name=='Git Repositories'].namespaceId" -o tsv
$TOKEN = "repoV2/$PROJECT_ID/$REPO_ID"
az devops security permission update --namespace-id $GIT_REPOS_NAMESPACE --subject $BUILD_SERVICE_DESCRIPTOR --token $TOKEN --allow-bit 4
```

**Git Bash:**
```bash
PROJECT_ID=$(az devops project show --project "$AZDO_PROJECT" --query id -o tsv)
REPO_NAME="$AZDO_PROJECT"
REPO_ID=$(az repos show --repository "$REPO_NAME" --query id -o tsv)

BUILD_SERVICE_NAME="$AZDO_PROJECT Build Service ($ORG_NAME)"
BUILD_SERVICE_DESCRIPTOR=$(az devops invoke --area graph --resource users --query-parameters 'api-version=7.1-preview.1' --http-method GET -o json | grep -B5 "\"displayName\": \"$BUILD_SERVICE_NAME\"" | grep '"descriptor"' | head -1 | cut -d'"' -f4)

GIT_REPOS_NAMESPACE=$(az devops security permission namespace list --query "[?name=='Git Repositories'].namespaceId" -o tsv)
TOKEN="repoV2/$PROJECT_ID/$REPO_ID"
az devops security permission update --namespace-id "$GIT_REPOS_NAMESPACE" --subject "$BUILD_SERVICE_DESCRIPTOR" --token "$TOKEN" --allow-bit 4
```

---

## Step 11: Verify Setup

Verify all resources were created correctly:

**Service Connections:**
```bash
az devops service-endpoint list --query "[].name" -o table
```

**Variable Groups:**
```bash
az pipelines variable-group list --query "[].name" -o table
```

Run the APIOps pipelines and confirm they can authenticate and access APIM resources.

---

## Step 12: Create Pipelines

Create Azure Pipelines from the YAML files in your repository.

**PowerShell:**
```powershell
$REPO_NAME = $AZDO_PROJECT

az pipelines create --name "apiops-extract" --repository $REPO_NAME --branch main --yml-path ".azdo/pipelines/run-apiops-extractor.yml" --repository-type tfsgit --skip-first-run true
az pipelines create --name "apiops-publish" --repository $REPO_NAME --branch main --yml-path ".azdo/pipelines/run-apiops-publisher.yml" --repository-type tfsgit --skip-first-run true
```

**Git Bash:**
```bash
REPO_NAME="$AZDO_PROJECT"

az pipelines create --name "apiops-extract" --repository "$REPO_NAME" --branch main --yml-path ".azdo/pipelines/run-apiops-extractor.yml" --repository-type tfsgit --skip-first-run true
az pipelines create --name "apiops-publish" --repository "$REPO_NAME" --branch main --yml-path ".azdo/pipelines/run-apiops-publisher.yml" --repository-type tfsgit --skip-first-run true
```

Verify pipelines were created:
```bash
az pipelines list --query "[].name" -o table
```

---

## UI Reference Context

Use this UI-oriented reference when you need to explain where a setting lives in the Azure portal or Azure DevOps web portal while automating the setup.

{{IDENTITY_GUIDE_CONTEXT}}