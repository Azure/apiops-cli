# APIOps GitHub Actions identity setup guide

> Prefer an automated walkthrough? Open `.github/prompts/apiops-setup-workflow-identity.prompt.md` in VS Code with GitHub Copilot and ask Copilot to guide or automate the setup for you.

> **Important identity distinction:** In GitHub Actions, the Azure app registration/service principal is only for Azure and APIM access. Pull request creation is handled separately by the workflow's `GITHUB_TOKEN`, so Azure RBAC alone will not give the workflow permission to open PRs.

## Before you start

- An Azure subscription with an API Management instance
- GitHub repository admin access
- Permission in Microsoft Entra ID to create or manage app registrations

Helpful documentation:

- [Use OpenID Connect with Azure Login in GitHub Actions](https://learn.microsoft.com/azure/developer/github/connect-from-azure-openid-connect)
- [Create and manage app registrations in the Azure portal](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app)
- [Assign Azure roles using the Azure portal](https://learn.microsoft.com/azure/role-based-access-control/role-assignments-portal)
- [Manage GitHub Actions secrets](https://docs.github.com/actions/security-guides/encrypted-secrets)
- [Manage GitHub environments](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment)

## Step 1: Review the generated workflow files in GitHub

1. Commit and push the generated files to your repository.
2. Open your repository in the **GitHub web UI**.
3. Go to **Actions** and confirm you can see:
   - **Run APIM Extractor**
   - **Run APIM Publisher**
4. If your organization requires approval for new workflows, complete that approval before continuing.

## Step 2: Create or choose an app registration in Azure portal

> 📖 [Register an application in the Azure portal](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app)

1. Open the **Azure portal**.
2. Go to **Microsoft Entra ID** → **App registrations** → **New registration**.
3. Enter a friendly name such as `apiops-github-sp`.
4. Register the application and open its overview page.
5. Record these values for later:
   - **Application (client) ID**
   - **Directory (tenant) ID**

## Step 3: Grant the Azure identity access to APIM

> 📖 [Assign Azure roles using the Azure portal](https://learn.microsoft.com/azure/role-based-access-control/role-assignments-portal)

For each environment, do the following steps:

1. In the **Azure portal**, open the resource group that contains the APIM instance for that environment.
2. Go to **Access control (IAM)** → **Add role assignment**.
3. Assign **Reader** on the resource group to the app registration.
4. Open the APIM service itself and assign **API Management Service Contributor** to the app registration.
5. Wait a few minutes for RBAC changes to propagate before you test the workflow.

## Step 4: Add federated credentials in Azure portal

> 📖 [Configure a federated identity credential on an app](https://learn.microsoft.com/entra/workload-id/workload-identity-federation-create-trust)

1. Return to **Microsoft Entra ID** → **App registrations** → your app.
2. Open **Certificates & secrets** → **Federated credentials** → **Add credential**.
3. Add one credential for the main branch publish workflow:
   - **Scenario**: **GitHub Actions deploying Azure resources**
   - **Organization**: your GitHub org or user
   - **Repository**: your repository
   - **Entity type**: **Branch**
   - **Branch name**: `main`
   - **Credential name**: `github-main-branch`
4. For each environment, add one additional federated credential:
   - **Entity type**: **Environment**
   - **Environment name**: the GitHub environment name (must match what you create in Step 5)
   - **Credential name**: `github-env-<environment>`

## Step 5: Create GitHub environments in the web UI

> 📖 [Using environments for deployment](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment)

1. In GitHub, go to **Settings** → **Environments**.
2. For each environment, create a GitHub environment with the same name used during `apiops init`.
3. Add protection rules such as required reviewers for production environments if your process needs approvals.

## Step 6: Add repository and environment secrets in GitHub

> 📖 [Using secrets in GitHub Actions](https://docs.github.com/actions/security-guides/using-secrets-in-github-actions)

1. Go to **Settings** → **Secrets and variables** → **Actions**.
2. Under **Repository secrets**, create:
   - `AZURE_CLIENT_ID` — the Application (client) ID from the app registration
   - `AZURE_TENANT_ID` — the Directory (tenant) ID from the app registration
3. For each environment, add the following **environment secrets**:
   - `AZURE_SUBSCRIPTION_ID` — the Azure subscription ID for that environment
   - `APIM_RESOURCE_GROUP_<ENV>` — the resource group containing the APIM instance (replace `<ENV>` with the upper-case environment name)
   - `APIM_SERVICE_NAME_<ENV>` — the APIM service name (replace `<ENV>` with the upper-case environment name)

## Step 7: Verify the workflow end to end

1. Go to **Actions** → **Run APIM Extractor** → **Run workflow**.
2. Select the environment you configured in GitHub and choose whether to run **Extract All APIs** or use `configuration.extractor.yaml`.
3. Confirm the workflow can authenticate to Azure, export artifacts, and create a pull request.
4. If the Azure login succeeds but the PR step fails, review repository permissions for `GITHUB_TOKEN` and any branch protection rules because PR creation is not controlled by the Azure identity.

## Security Notes

- Prefer OIDC/federated credentials over client secrets so there is no stored Azure credential to rotate.
- Grant the workflow identity only the Azure roles it actually needs by following a least-privilege approach.
- Periodically review GitHub environments, repository secrets, and Azure role assignments.
