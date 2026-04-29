/**
 * T048: Identity setup guide generator
 * Step-by-step instructions for service principal, RBAC, federated credentials,
 * pipeline secrets/service connections. Optional az CLI automation per FR-021.
 */

export interface IdentityGuideService {
  generateGitHubActionsGuide(
    subscriptionId: string,
    resourceGroup: string,
    environments: string[]
  ): string;
  
  generateAzureDevOpsGuide(
    subscriptionId: string,
    resourceGroup: string,
    environments: string[]
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
    environments: string[]
  ): string {
    return `# Azure DevOps Identity Setup Guide

## Prerequisites
- Azure subscription: ${subscriptionId}
- Resource group: ${resourceGroup}
- Azure DevOps organization and project

## Step 1: Create Service Principal

Create a service principal for each environment or use a single shared one:

\`\`\`bash
# Set variables
SUBSCRIPTION_ID="${subscriptionId}"
RESOURCE_GROUP="${resourceGroup}"
APP_NAME="apiops-azdo-sp"

# Create Service Principal with Contributor role
SP_OUTPUT=$(az ad sp create-for-rbac \\
  --name "$APP_NAME" \\
  --role "API Management Service Contributor" \\
  --scopes "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP" \\
  --sdk-auth)

echo "$SP_OUTPUT"

# Save the output - you'll need these values:
# - appId (client ID)
# - password (client secret)
# - tenant
\`\`\`

## Step 2: Create Azure Service Connections

In Azure DevOps, create service connections for Azure Resource Manager:

1. Go to Project Settings → Service connections
2. Click "New service connection" → "Azure Resource Manager" → "Service principal (manual)"
3. Fill in the details from Step 1:
   - **Subscription ID**: ${subscriptionId}
   - **Subscription Name**: (your subscription name)
   - **Service Principal ID**: appId from Step 1
   - **Service Principal Key**: password from Step 1
   - **Tenant ID**: tenant from Step 1

${environments.map((env) => `
**For ${env} environment:**
- Connection name: \`AZURE_SERVICE_CONNECTION_${env.toUpperCase()}\`
- Verify: Test the connection
`).join('\n')}

**For extract pipeline:**
- Connection name: \`AZURE_SERVICE_CONNECTION\`
- Verify: Test the connection

## Step 3: Create Variable Groups

Create variable groups in Azure DevOps Library:

### Common Variable Group (\`apim-common\`):
- \`AZURE_SUBSCRIPTION_ID\`: ${subscriptionId}
- \`APIM_RESOURCE_GROUP\`: ${resourceGroup}
- \`APIM_SERVICE_NAME\`: <your-apim-service-name>
- \`AZURE_SERVICE_CONNECTION\`: Name from Step 2

${environments.map((env) => `
### ${env} Environment Variable Group (\`apim-${env}\`):
- \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\`: Resource group for ${env}
- \`APIM_SERVICE_NAME_${env.toUpperCase()}\`: APIM service name for ${env}
- \`AZURE_SERVICE_CONNECTION_${env.toUpperCase()}\`: Service connection name for ${env}
`).join('\n')}

## Step 4: Configure Pipeline Permissions

1. Go to Pipelines → Library → Variable Groups
2. For each variable group, click "Pipeline permissions"
3. Allow the extract and publish pipelines to use these variable groups

## Step 5: Create Environments

Create deployment environments in Azure DevOps:

1. Go to Pipelines → Environments
2. Create new environment for each:
${environments.map((env) => `   - \`${env}\``).join('\n')}
3. Configure approvals and checks as needed for production environments

## Step 6: Enable Pipeline Contributions

For the extract pipeline to commit changes:

1. Go to Project Settings → Repositories → Security
2. Find "Build Service" account
3. Grant "Contribute" and "Contribute to pull requests" permissions

## Step 7: Verify Setup

Run the extract pipeline manually to verify authentication and permissions.

## Security Notes
- Use separate service principals for production environments
- Enable environment approvals for production deployments
- Rotate service principal secrets periodically (recommended: 90 days)
- Use managed identities when possible for Azure-hosted agents
- Review RBAC assignments regularly
`;
  }
}

export const identityGuideService: IdentityGuideService = new IdentityGuideServiceImpl();
