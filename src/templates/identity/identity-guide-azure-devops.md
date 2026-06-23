# Identity setup guide for APIOps extract and publish Azure DevOps Pipelines

> Prefer an automated walkthrough? Open `.github/prompts/apiops-setup-pipeline-identity.prompt.md` in VS Code with GitHub Copilot and ask Copilot to guide or automate the setup for you.

> **Important identity distinction:** In Azure DevOps, the Azure app registration/service principal is for Azure and APIM access only. Repository contributions and pull request creation come from the project **Build Service identity**, which must be granted repository permissions separately.

## Before you start

- Access to the **Azure portal**
- Access to the **Azure DevOps web portal**
- Permission to create or manage app registrations in Microsoft Entra ID
- Permission to create Azure DevOps service connections, variable groups, environments, and pipelines

Helpful documentation:

- [Create and manage app registrations in the Azure portal](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app)
- [Assign Azure roles using the Azure portal](https://learn.microsoft.com/azure/role-based-access-control/role-assignments-portal)
- [Create Azure Resource Manager service connections with workload identity federation](https://learn.microsoft.com/azure/devops/pipelines/library/connect-to-azure)
- [Create variable groups in Azure Pipelines](https://learn.microsoft.com/azure/devops/pipelines/library/variable-groups)
- [Set repository permissions in Azure DevOps](https://learn.microsoft.com/azure/devops/repos/git/set-git-repository-permissions)

## Step 1: Review the generated pipeline files in your repo

1. Commit and push the generated files to your Azure DevOps repository.
2. Confirm these files are available in the repo browser:
   - `.azdo/pipelines/run-apim-extractor.yml`
   - `.azdo/pipelines/run-apim-publisher.yml`
3. Note the environment names you chose when running `apiops init` because you will create matching service connections, variable groups, and approvals.

## Step 2: Create or choose an app registration in Azure portal

1. Open the **Azure portal**.
2. Go to **Microsoft Entra ID** → **App registrations** → **New registration**.
3. Enter a friendly name such as `apiops-azdo-sp`.
4. Register the application and open its overview page.
5. Record:
   - **Application (client) ID**
   - **Directory (tenant) ID**
6. You do not need to create a client secret for this workload identity federation flow.

## Step 3: Grant the Azure identity access to each APIM environment

For each environment, use the **Azure portal** to grant:

- **Reader** on the resource group that contains the APIM instance
- **API Management Service Contributor** on the APIM service itself

Use **Access control (IAM)** on each resource group and APIM instance to create the assignments.

## Step 4: Create one Azure service connection per environment

1. In **Azure DevOps**, open **Project settings** → **Service connections** → **New service connection**.
2. Choose **Azure Resource Manager**.
3. Select **Workload identity federation**.
4. Use the app registration from Step 2.
5. Create one service connection per environment using the exact names below unless you also plan to edit the generated pipeline YAML and variable-group values:

| Environment | Required service connection name | Scope guidance |
|---|---|---|
{{SERVICE_CONNECTION_ROWS}}

6. Complete the validation flow in Azure DevOps so the service connection can issue the issuer and subject values required for federation.
7. If Azure DevOps asks you to finish the federated credential in Azure, follow the linked experience or copy the issuer/subject into the app registration's **Federated credentials** blade in the Azure portal.

## Step 5: Create variable groups in Azure DevOps

1. Go to **Pipelines** → **Library** → **+ Variable group**.
2. Create one variable group per environment:

| Environment | Variable group name | Required variables |
|---|---|---|
{{VARIABLE_GROUP_ROWS}}

3. Include both the non-suffixed variables used by the extractor pipeline and the environment-suffixed APIM variables used by the publish pipeline.
4. Authorize each variable group for pipeline use when Azure DevOps prompts you.

## Step 6: Create Azure DevOps environments and approvals

1. Go to **Pipelines** → **Environments**.
2. Create an environment for each deployment target used by the publish pipeline.
3. Add approvals and checks for production or other protected environments as needed by your release process.

## Step 7: Grant repository permissions to the Build Service identity

1. In **Azure DevOps**, open **Project settings** → **Repositories** → your repository → **Security**.
2. Find the entry named **`<Project Name> Build Service (<Organization Name>)`**.
3. Grant the minimum permissions required for your workflow, typically:
   - **Contribute**
   - **Create branch**
   - **Create pull request**
4. If the pipeline can read APIM but cannot push extracted artifacts or open a PR, this is usually the missing step because the Build Service identity is separate from the Azure app registration.

## Step 8: Create the pipelines in Azure DevOps

1. Go to **Pipelines** → **Create Pipeline**.
2. Choose your repository.
3. Select **Existing Azure Pipelines YAML file**.
4. Create a pipeline for each generated YAML file:
   - `.azdo/pipelines/run-apim-extractor.yml`
   - `.azdo/pipelines/run-apim-publisher.yml`
5. Save without running if you still need approvals or variable authorization.

## Step 9: Verify the setup

1. Run the extractor pipeline manually.
2. Confirm the pipeline can authenticate to Azure and read/write the expected APIM resources.
3. Confirm it can push artifacts and create a pull request in Azure DevOps.
4. If Azure access works but PR creation fails, re-check repository permissions for the Build Service identity.

## Security notes

- Prefer workload identity federation over client secrets.
- Scope Azure roles and service connections only to the subscriptions and APIM instances each environment needs.
- Review Build Service repository permissions regularly and remove extra rights if they are no longer needed.
