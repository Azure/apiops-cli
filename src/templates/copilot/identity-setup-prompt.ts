// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * GitHub Copilot prompt template for automating identity setup.
 * Generates a .prompt.md file that guides Copilot through:
 *   1. Gathering environment and identity information
 *   2. Creating identity configuration for the selected CI provider
 *   3. Assigning RBAC roles
 *   4. Completing provider-specific setup tasks
 */

import {
  azureDevOpsIdentitySetupCoreTemplate,
  azureDevOpsIdentityGuideTemplate,
  copilotAzureDevOpsIdentitySetupPromptTemplate,
  copilotGithubEnvironmentFederatedCredentialTemplate,
  copilotGithubEnvironmentSecretCommandsTemplate,
  copilotGitHubActionsIdentitySetupPromptTemplate,
  githubActionsIdentityGuideTemplate,
} from '../generated/embedded-markdown.js';
import { renderTemplate } from '../../lib/render-template.js';

export interface IdentitySetupPromptConfig {
  environments: string[];
  ciProvider?: 'github-actions' | 'azure-devops';
}

export function generateIdentitySetupPrompt(config: IdentitySetupPromptConfig): string {
  if (config.ciProvider === 'azure-devops') {
    const environmentsArrayPowerShell = config.environments
      .map((environment) => `"${environment}"`)
      .join(', ');
    const environmentsArrayBash = config.environments
      .map((environment) => `"${environment}"`)
      .join(' ');

    const coreSteps = renderTemplate(azureDevOpsIdentitySetupCoreTemplate, {
      ENVIRONMENTS_ARRAY_POWERSHELL: environmentsArrayPowerShell,
      ENVIRONMENTS_ARRAY_BASH: environmentsArrayBash,
    });

    const manualGuideContext = renderTemplate(azureDevOpsIdentityGuideTemplate, {
      SERVICE_CONNECTION_ROWS: config.environments.map((environment) =>
        `| \`${environment}\` | \`AZURE_SERVICE_CONNECTION_${environment.toUpperCase()}\` | Azure Resource Manager → Workload identity federation → subscription that contains the ${environment} APIM instance |`
      ).join('\n'),
      VARIABLE_GROUP_ROWS: config.environments.map((environment) =>
        `| \`${environment}\` | \`apim-${environment}\` | \`AZURE_SERVICE_CONNECTION\`, \`AZURE_SUBSCRIPTION_ID\`, \`APIM_RESOURCE_GROUP\`, \`APIM_SERVICE_NAME\`, \`APIM_RESOURCE_GROUP_${environment.toUpperCase()}\`, \`APIM_SERVICE_NAME_${environment.toUpperCase()}\` |`
      ).join('\n'),
    });

    return renderTemplate(copilotAzureDevOpsIdentitySetupPromptTemplate, {
      AZURE_DEVOPS_CORE_STEPS: coreSteps,
      IDENTITY_GUIDE_CONTEXT: manualGuideContext,
    });
  }

  const envSecrets = config.environments.map((env) =>
    `- \`AZURE_SUBSCRIPTION_ID\` — Azure subscription ID for **${env}** environment
- \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\` — Resource group containing the **${env}** APIM instance
- \`APIM_SERVICE_NAME_${env.toUpperCase()}\` — APIM service name for **${env}**`
  ).join('\n');

  const envFedCreds = config.environments.map((env) =>
    renderTemplate(copilotGithubEnvironmentFederatedCredentialTemplate, {
      ENV: env,
    })
  ).join('\n\n');

  const ghSecretEnvCmds = config.environments.map((env) =>
    renderTemplate(copilotGithubEnvironmentSecretCommandsTemplate, {
      ENV: env,
      ENV_UPPER: env.toUpperCase(),
    })
  ).join('\n\n');

  const environmentCreationCommands = config.environments.map((env) =>
    `# Create the ${env} environment (requires GitHub CLI)
gh api --method PUT "repos/\${GITHUB_ORG}/\${GITHUB_REPO}/environments/${env}"`
  ).join('\n\n');

  const envSubscriptionTableRows = config.environments.map((env) =>
    `| \`AZURE_SUBSCRIPTION_ID_${env.toUpperCase()}\` | Azure subscription ID for **${env}** environment | \`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\` |`
  ).join('\n');

  const envApimTableRows = config.environments.map((env) =>
    `| \`APIM_RG_${env.toUpperCase()}\` | Resource group for **${env}** APIM instance | \`rg-apim-${env}\` |
| \`APIM_NAME_${env.toUpperCase()}\` | APIM service name for **${env}** | \`apim-${env}\` |`
  ).join('\n');

  const envReaderRoleSnippets = config.environments.map((env) =>
    `\`\`\`bash
# Reader role for ${env} resource group
az role assignment create \\
  --assignee "$APP_ID" \\
  --role "Reader" \\
  --scope "/subscriptions/\${AZURE_SUBSCRIPTION_ID_${env.toUpperCase()}}/resourceGroups/\${APIM_RG_${env.toUpperCase()}}"
\`\`\``
  ).join('\n\n');

  const envApimRoleSnippets = config.environments.map((env) =>
    `\`\`\`bash
# Assign role for ${env} environment
az role assignment create \\
  --assignee "$APP_ID" \\
  --role "API Management Service Contributor" \\
  --scope "/subscriptions/\${AZURE_SUBSCRIPTION_ID_${env.toUpperCase()}}/resourceGroups/\${APIM_RG_${env.toUpperCase()}}/providers/Microsoft.ApiManagement/service/\${APIM_NAME_${env.toUpperCase()}}"
\`\`\``
  ).join('\n\n');

  const manualGuideContext = renderTemplate(githubActionsIdentityGuideTemplate, {
    SUBSCRIPTION_ID: '<your-subscription-id>',
    RESOURCE_GROUP: '<your-resource-group>',
    FEDERATED_CREDENTIAL_ROWS: config.environments.map((env) =>
      `| \`${env}\` | \`github-env-${env}\` | \`repo:<your-github-org>/<your-github-repo>:environment:${env}\` |`
    ).join('\n'),
    ENVIRONMENT_AZURE_ACCESS_NOTES: config.environments.map((env) =>
      `- **${env}** — assign **Reader** on the resource group you will store in \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\`, then assign **API Management Service Contributor** on the APIM instance you will store in \`APIM_SERVICE_NAME_${env.toUpperCase()}\`.`
    ).join('\n'),
    ENVIRONMENT_SECRET_SECTIONS: config.environments.map((env) => `### ${env} environment
- Create a GitHub environment named \`${env}\` in **Settings** → **Environments**
- Add environment secret \`AZURE_SUBSCRIPTION_ID\` with the subscription ID used for ${env}
- Add environment secret \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\` with the APIM resource group for ${env}
- Add environment secret \`APIM_SERVICE_NAME_${env.toUpperCase()}\` with the APIM service name for ${env}
`).join('\n'),
  });

  return renderTemplate(copilotGitHubActionsIdentitySetupPromptTemplate, {
    ENV_SECRETS_REFERENCE: envSecrets,
    ENV_FEDERATED_CREDENTIALS: envFedCreds,
    GH_SECRET_ENV_COMMANDS: ghSecretEnvCmds,
    ENVIRONMENT_CREATION_COMMANDS: environmentCreationCommands,
    ENV_SUBSCRIPTION_TABLE_ROWS: envSubscriptionTableRows,
    ENV_APIM_TABLE_ROWS: envApimTableRows,
    ENV_READER_ROLE_SNIPPETS: envReaderRoleSnippets,
    ENV_APIM_ROLE_SNIPPETS: envApimRoleSnippets,
    IDENTITY_GUIDE_CONTEXT: manualGuideContext,
  });
}
