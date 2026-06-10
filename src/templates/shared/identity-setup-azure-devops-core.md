## Prerequisites
- Azure DevOps organization and project
- Azure CLI installed and authenticated (`az login`)
- `az devops` extension (`az extension add --name azure-devops`)

This flow is designed for Microsoft-hosted or self-hosted agents and uses workload identity federation (OIDC) instead of managed identity.

> **Note:** All commands are shown for both **PowerShell** and **Git Bash** where syntax differs.

---

## Step 1: Gather Per-Environment Information

**Copilot:** Ask the user for the following values before proceeding. Store each answer for use in later steps.

For each environment, provide either **Option A** (three separate values) or **Option B** (a single full APIM resource ID in the form `/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<name>`). Copilot will parse Option B into the individual components automatically.

| Variable | Description | Example |
|----------|-------------|---------|
| `APP_NAME` | Display name for the Entra application | `apiops-azdo-sp` |
| `AZDO_ORG` | Azure DevOps organization URL | `https://dev.azure.com/my-org` |
| `AZDO_PROJECT` | Azure DevOps project name | `my-project` |
| `TENANT_ID` | Tenant ID that should own the app/service connection | `11111111-2222-3333-4444-555555555555` |

For each environment in the configured list, gather these values (where `<ENV_UPPER>` is the upper-case environment name):
- `APIM_SUBSCRIPTION_<ENV_UPPER>`
- `APIM_RG_<ENV_UPPER>`
- `APIM_NAME_<ENV_UPPER>`
- `APIM_RESOURCE_ID_<ENV_UPPER>` *(optional Option B shorthand)*

---

## Step 2: Set Variables

**PowerShell:**
```powershell
$APP_NAME = "apiops-azdo-sp"
$AZDO_ORG = "<your-azdo-org-url>"
$AZDO_PROJECT = "<your-project>"
$TENANT_ID = "<your-tenant-id>"
$ENVIRONMENTS = @({{ENVIRONMENTS_ARRAY_POWERSHELL}})

# Fill these maps with values for each environment.
$APIM_SUBSCRIPTIONS = @{}
$APIM_RESOURCE_GROUPS = @{}
$APIM_SERVICE_NAMES = @{}

foreach ($env in $ENVIRONMENTS) {
    # Option A: provide values directly.
    $APIM_SUBSCRIPTIONS[$env] = "<subscription-id-for-$env>"
    $APIM_RESOURCE_GROUPS[$env] = "<resource-group-for-$env>"
    $APIM_SERVICE_NAMES[$env] = "<service-name-for-$env>"

    # Option B: if APIM resource ID is provided, parse it into the same maps.
    # $resourceId = "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<name>"
    # if ($resourceId) {
    #     $parts = $resourceId.Trim('/') -split '/'
    #     $APIM_SUBSCRIPTIONS[$env] = $parts[1]
    #     $APIM_RESOURCE_GROUPS[$env] = $parts[3]
    #     $APIM_SERVICE_NAMES[$env] = $parts[7]
    # }
}
```

**Git Bash:**
```bash
APP_NAME="apiops-azdo-sp"
AZDO_ORG="<your-azdo-org-url>"
AZDO_PROJECT="<your-project>"
TENANT_ID="<your-tenant-id>"
ENVIRONMENTS=({{ENVIRONMENTS_ARRAY_BASH}})

# Fill these maps with values for each environment.
declare -A APIM_SUBSCRIPTIONS
declare -A APIM_RESOURCE_GROUPS
declare -A APIM_SERVICE_NAMES

for env in "${ENVIRONMENTS[@]}"; do
    # Option A: provide values directly.
    APIM_SUBSCRIPTIONS["$env"]="<subscription-id-for-$env>"
    APIM_RESOURCE_GROUPS["$env"]="<resource-group-for-$env>"
    APIM_SERVICE_NAMES["$env"]="<service-name-for-$env>"

    # Option B: if APIM resource ID is provided, parse it into the same maps.
    # resource_id="/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<name>"
    # if [[ -n "$resource_id" ]]; then
    #   IFS='/' read -r _ subscriptions sub resourceGroups rg providers provider service svc <<< "$resource_id"
    #   APIM_SUBSCRIPTIONS["$env"]="$sub"
    #   APIM_RESOURCE_GROUPS["$env"]="$rg"
    #   APIM_SERVICE_NAMES["$env"]="$svc"
    # fi
done
```

---

## Step 3: Configure Azure DevOps CLI

Install the extension (works in both shells):
```bash
az extension add --name azure-devops
```

Set organization defaults:

For self-hosted Azure DevOps Server, use your server/collection URL format:
- `https://<server>/<collection>`

**PowerShell:**
```powershell
az devops configure --defaults organization=$AZDO_ORG project=$AZDO_PROJECT
$ORG_NAME = $AZDO_ORG -replace 'https://dev\.azure\.com/', ''
```

**Git Bash:**
```bash
az devops configure --defaults organization="$AZDO_ORG" project="$AZDO_PROJECT"
ORG_NAME="${AZDO_ORG##*/}"
```

**Self-hosted note:** If your server URL includes a collection segment (for example, `https://ado.contoso.local/DefaultCollection`), set `ORG_NAME` to the value expected in the Build Service identity display name for your server/project.

---

## Step 4: Verify Tenant ID

Before creating identity objects, confirm you are logged into the intended tenant.

**PowerShell:**
```powershell
$CURRENT_TENANT_ID = az account show --query tenantId -o tsv
Write-Host "Current tenant: $CURRENT_TENANT_ID"
if ($CURRENT_TENANT_ID -ne $TENANT_ID) {
    throw "Tenant mismatch. Expected $TENANT_ID but got $CURRENT_TENANT_ID. Run: az login --tenant $TENANT_ID"
}
```

**Git Bash:**
```bash
CURRENT_TENANT_ID=$(az account show --query tenantId -o tsv)
echo "Current tenant: $CURRENT_TENANT_ID"
if [[ "$CURRENT_TENANT_ID" != "$TENANT_ID" ]]; then
    echo "Tenant mismatch. Expected $TENANT_ID but got $CURRENT_TENANT_ID"
    echo "Run: az login --tenant $TENANT_ID"
    exit 1
fi
```

---

## Step 5: Create Entra Application and Service Principal (No Secret)

> ⚠️ **Error Handling:** If any command fails, stop immediately and show the user the full error output verbatim. Do NOT retry silently.

**PowerShell:**
```powershell
az ad app create --display-name $APP_NAME | Out-Null
$APP_ID = az ad app list --display-name $APP_NAME --query "[0].appId" -o tsv
az ad sp create --id $APP_ID | Out-Null
Write-Host "App ID: $APP_ID"
Write-Host "Tenant ID: $TENANT_ID"
```

**Git Bash:**
```bash
az ad app create --display-name "$APP_NAME" >/dev/null
APP_ID=$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv)
az ad sp create --id "$APP_ID" >/dev/null
echo "App ID: $APP_ID"
echo "Tenant ID: $TENANT_ID"
```

No client secret is required in this flow.

---

## Step 6: Assign RBAC Roles Per Environment

Grant the service principal **Reader** on each resource group and **API Management Service Contributor** on each APIM instance.

### PowerShell
```powershell
foreach ($env in $ENVIRONMENTS) {
    az role assignment create --assignee "$APP_ID" --role "Reader" --scope "/subscriptions/$($APIM_SUBSCRIPTIONS[$env])/resourceGroups/$($APIM_RESOURCE_GROUPS[$env])"
    az role assignment create --assignee "$APP_ID" --role "API Management Service Contributor" --scope "/subscriptions/$($APIM_SUBSCRIPTIONS[$env])/resourceGroups/$($APIM_RESOURCE_GROUPS[$env])/providers/Microsoft.ApiManagement/service/$($APIM_SERVICE_NAMES[$env])"
}
```

### Git Bash
```bash
for env in "${ENVIRONMENTS[@]}"; do
    az role assignment create --assignee "$APP_ID" --role "Reader" --scope "/subscriptions/${APIM_SUBSCRIPTIONS[$env]}/resourceGroups/${APIM_RESOURCE_GROUPS[$env]}"
    az role assignment create --assignee "$APP_ID" --role "API Management Service Contributor" --scope "/subscriptions/${APIM_SUBSCRIPTIONS[$env]}/resourceGroups/${APIM_RESOURCE_GROUPS[$env]}/providers/Microsoft.ApiManagement/service/${APIM_SERVICE_NAMES[$env]}"
done
```

---

## Step 7: Create Workload Identity Federation Service Connections

Create one service connection per environment, each scoped to that environment's subscription,
using Azure Resource Manager with Workload Identity Federation.

This step is fully automatable with `az devops service-endpoint create`.
After each endpoint is created, capture its generated issuer/subject and create
the corresponding federated credential in Entra.

**PowerShell:**
```powershell
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    $name = "AZURE_SERVICE_CONNECTION_$envUpper"
    $subscriptionName = az account show --subscription $($APIM_SUBSCRIPTIONS[$env]) --query name -o tsv

    $payload = @{
        name = $name
        type = "azurerm"
        url = "https://management.azure.com/"
        authorization = @{
            scheme = "WorkloadIdentityFederation"
            parameters = @{
                tenantid = $TENANT_ID
                serviceprincipalid = $APP_ID
            }
        }
        data = @{
            environment = "AzureCloud"
            identityType = "AppRegistrationManual"
            scopeLevel = "Subscription"
            subscriptionId = $APIM_SUBSCRIPTIONS[$env]
            subscriptionName = $subscriptionName
        }
    } | ConvertTo-Json -Depth 8

    $file = "se-$env.json"
    $payload | Out-File -Encoding utf8 -FilePath $file
    az devops service-endpoint create --service-endpoint-configuration $file | Out-Null
    Remove-Item $file -ErrorAction SilentlyContinue

    $endpoint = az devops service-endpoint list --query "[?name=='$name'] | [0]" -o json | ConvertFrom-Json
    $issuer = $endpoint.authorization.parameters.workloadIdentityFederationIssuer
    $subject = $endpoint.authorization.parameters.workloadIdentityFederationSubject

    $FED_CRED_NAME = "azdo-$env"

    $payload = @{
        name = $FED_CRED_NAME
        issuer = $issuer
        subject = $subject
        audiences = @("api://AzureADTokenExchange")
    } | ConvertTo-Json -Depth 5

    az ad app federated-credential create --id $APP_ID --parameters $payload
}
```

**Git Bash:**
```bash
for env in "${ENVIRONMENTS[@]}"; do
        env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
        name="AZURE_SERVICE_CONNECTION_$env_upper"
        subscription_name=$(az account show --subscription "${APIM_SUBSCRIPTIONS[$env]}" --query name -o tsv)

        cat > "se-$env.json" <<JSON
{
    "name": "$name",
    "type": "azurerm",
    "url": "https://management.azure.com/",
    "authorization": {
        "scheme": "WorkloadIdentityFederation",
        "parameters": {
            "tenantid": "$TENANT_ID",
            "serviceprincipalid": "$APP_ID"
        }
    },
    "data": {
        "environment": "AzureCloud",
        "identityType": "AppRegistrationManual",
        "scopeLevel": "Subscription",
        "subscriptionId": "${APIM_SUBSCRIPTIONS[$env]}",
        "subscriptionName": "$subscription_name"
    }
}
JSON

        az devops service-endpoint create --service-endpoint-configuration "se-$env.json" >/dev/null
        rm -f "se-$env.json"

        issuer=$(az devops service-endpoint list --query "[?name=='$name'] | [0].authorization.parameters.workloadIdentityFederationIssuer" -o tsv)
        subject=$(az devops service-endpoint list --query "[?name=='$name'] | [0].authorization.parameters.workloadIdentityFederationSubject" -o tsv)

    FED_CRED_NAME="azdo-$env"

    az ad app federated-credential create \
      --id "$APP_ID" \
            --parameters "{\"name\":\"$FED_CRED_NAME\",\"issuer\":\"$issuer\",\"subject\":\"$subject\",\"audiences\":[\"api://AzureADTokenExchange\"]}"
done
```

Authorize service connections for all pipelines (prevents first-run permission prompts):

**PowerShell:**
```powershell
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    $name = "AZURE_SERVICE_CONNECTION_$envUpper"
    $id = az devops service-endpoint list --query "[?name=='$name'].id | [0]" -o tsv
    if ($id) {
        az devops service-endpoint update --id $id --enable-for-all true | Out-Null
    }
}
```

**Git Bash:**
```bash
for env in "${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    name="AZURE_SERVICE_CONNECTION_$env_upper"
    id=$(az devops service-endpoint list --query "[?name=='$name'].id | [0]" -o tsv)
    if [[ -n "$id" ]]; then
        az devops service-endpoint update --id "$id" --enable-for-all true >/dev/null
    fi
done
```

Verify:
```bash
az devops service-endpoint list --query "[].name" -o table
```

---

## Step 8: Create Variable Groups

Create one variable group per environment. Each group uses the **non-suffixed** variable names expected by the pipelines (`APIM_RESOURCE_GROUP`, `APIM_SERVICE_NAME`, `AZURE_SUBSCRIPTION_ID`, `AZURE_SERVICE_CONNECTION`).

**PowerShell:**
```powershell
foreach ($env in $ENVIRONMENTS) {
    $envUpper = $env.ToUpper()
    az pipelines variable-group create --name "apim-$env" --variables AZURE_SUBSCRIPTION_ID=$($APIM_SUBSCRIPTIONS[$env]) APIM_RESOURCE_GROUP=$($APIM_RESOURCE_GROUPS[$env]) APIM_SERVICE_NAME=$($APIM_SERVICE_NAMES[$env]) AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION_$envUpper"
}
```

**Git Bash:**
```bash
for env in "${ENVIRONMENTS[@]}"; do
    env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')
    az pipelines variable-group create --name "apim-$env" --variables AZURE_SUBSCRIPTION_ID="${APIM_SUBSCRIPTIONS[$env]}" APIM_RESOURCE_GROUP="${APIM_RESOURCE_GROUPS[$env]}" APIM_SERVICE_NAME="${APIM_SERVICE_NAMES[$env]}" AZURE_SERVICE_CONNECTION="AZURE_SERVICE_CONNECTION_$env_upper"
done
```

Authorize all groups for pipeline use:

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

Verify:
```bash
az pipelines variable-group list --query "[].name" -o table
```

---

## Step 9 (in pipeline): Create Environments

Create deployment environments in Azure DevOps:

**PowerShell:**
```powershell
foreach ($env in $ENVIRONMENTS) {
    $body = "{\"name\": \"$env\"}"
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

Authorize each environment for all pipelines (prevents first-run permission prompts):

**PowerShell:**
```powershell
$ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798"
$TOKEN = az account get-access-token --resource $ADO_RESOURCE --query accessToken -o tsv

foreach ($env in $ENVIRONMENTS) {
    $envId = az devops invoke --area environments --resource environments --route-parameters project=$AZDO_PROJECT --query-parameters "api-version=7.1" --query "value[?name=='$env'].id | [0]" -o tsv
    if ($envId) {
        $url = "$AZDO_ORG/$AZDO_PROJECT/_apis/pipelines/pipelinePermissions/environment/$envId?api-version=7.1-preview.1"
        $body = '{"allPipelines":{"authorized":true}}'
        Invoke-RestMethod -Method Patch -Uri $url -Headers @{ Authorization = "Bearer $TOKEN" } -ContentType "application/json" -Body $body | Out-Null
    }
}
```

**Git Bash:**
```bash
ADO_RESOURCE="499b84ac-1321-427f-aa17-267ca6975798"
TOKEN=$(az account get-access-token --resource "$ADO_RESOURCE" --query accessToken -o tsv)

for env in "${ENVIRONMENTS[@]}"; do
    env_id=$(az devops invoke --area environments --resource environments --route-parameters project="$AZDO_PROJECT" --query-parameters "api-version=7.1" --query "value[?name=='$env'].id | [0]" -o tsv)
    if [[ -n "$env_id" ]]; then
        curl -sS -X PATCH \
          -H "Authorization: Bearer $TOKEN" \
          -H "Content-Type: application/json" \
          "$AZDO_ORG/$AZDO_PROJECT/_apis/pipelines/pipelinePermissions/environment/$env_id?api-version=7.1-preview.1" \
          -d '{"allPipelines":{"authorized":true}}' >/dev/null
    fi
done
```

**Note:** Environment approvals and checks still must be configured via the Azure DevOps UI.

---
