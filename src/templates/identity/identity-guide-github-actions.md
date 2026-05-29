# GitHub Actions Identity Setup Guide

## Prerequisites
- Azure subscription: {{SUBSCRIPTION_ID}}
- Resource group: {{RESOURCE_GROUP}}
- GitHub repository with OIDC enabled

## Step 1: Create Service Principal

Run the following Azure CLI commands to create a service principal with federated credentials:

```bash
# Set variables
SUBSCRIPTION_ID="{{SUBSCRIPTION_ID}}"
RESOURCE_GROUP="{{RESOURCE_GROUP}}"
APP_NAME="apiops-github-sp"
GITHUB_ORG="<your-github-org>"
GITHUB_REPO="<your-github-repo>"

# Create Azure AD Application
APP_ID=$(az ad app create \
  --display-name "$APP_NAME" \
  --query appId -o tsv)

# Create Service Principal
az ad sp create --id "$APP_ID"

# Get Service Principal Object ID
SP_OBJECT_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

echo "Application (client) ID: $APP_ID"
echo "Service Principal Object ID: $SP_OBJECT_ID"
```

## Step 2: Assign RBAC Roles

Grant the service principal "API Management Service Contributor" role on your APIM instance:

```bash
# Get APIM resource ID
APIM_RESOURCE_ID=$(az apim show \
  --resource-group "$RESOURCE_GROUP" \
  --name "<your-apim-service-name>" \
  --query id -o tsv)

# Assign role
az role assignment create \
  --assignee "$APP_ID" \
  --role "API Management Service Contributor" \
  --scope "$APIM_RESOURCE_ID"
```

## Step 3: Configure Federated Credentials

Set up OIDC federation for GitHub Actions:

```bash
# For main branch deployments
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"$GITHUB_ORG"'/'"$GITHUB_REPO"':ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# For environment deployments (repeat for each environment)
{{FEDERATED_CREDENTIALS_PER_ENV}}
```

## Step 4: Configure GitHub Secrets

Add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions):

### Repository Secrets:
- `AZURE_CLIENT_ID`: $APP_ID (from Step 1)
- `AZURE_TENANT_ID`: Run `az account show --query tenantId -o tsv`
- `AZURE_SUBSCRIPTION_ID`: {{SUBSCRIPTION_ID}}

### Environment-Specific Secrets:
{{ENVIRONMENT_SECRETS}}

### Extract Workflow Secrets:
- `APIM_RESOURCE_GROUP`: Default resource group for extract
- `APIM_SERVICE_NAME`: Default APIM service name for extract

## Step 5: Verify Setup

Test the authentication by running a workflow manually or pushing to main branch.

## Security Notes
- Use GitHub Environments for production deployments with required reviewers
- Review federated credential subjects periodically (no secrets to rotate — OIDC authentication has no stored credentials)
- Review RBAC role assignments regularly and remove any no longer needed
- Use least-privilege RBAC assignments
