// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * GitHub Copilot prompt template for automating identity setup.
 * Generates a .prompt.md file that guides Copilot through:
 *   1. Gathering Azure & GitHub info from the user
 *   2. Creating Azure AD app registration + federated credentials
 *   3. Assigning RBAC roles
 *   4. Setting GitHub repository secrets
 */

import { copilotIdentitySetupPromptTemplate } from '../generated/embedded-markdown.js';

export interface IdentitySetupPromptConfig {
  environments: string[];
}

function renderTemplate(template: string, tokens: Record<string, string>): string {
  return Object.entries(tokens).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, value),
    template
  );
}

export function generateIdentitySetupPrompt(config: IdentitySetupPromptConfig): string {
  const envSecrets = config.environments.map((env) =>
    `- \`AZURE_SUBSCRIPTION_ID\` — Azure subscription ID for **${env}** environment
- \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\` — Resource group containing the **${env}** APIM instance
- \`APIM_SERVICE_NAME_${env.toUpperCase()}\` — APIM service name for **${env}**`
  ).join('\n');

  const envFedCreds = config.environments.map((env) =>
    `### ${env} environment

**On macOS/Linux (Bash):**
\`\`\`bash
az ad app federated-credential create \\
  --id "$APP_ID" \\
  --parameters '{
    "name": "github-env-${env}",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"\${GITHUB_ORG}"'/'"\${GITHUB_REPO}"':environment:${env}",
    "audiences": ["api://AzureADTokenExchange"]
  }'
\`\`\`

**On Windows (PowerShell):**
\`\`\`powershell
az ad app federated-credential create \`
  --id $APP_ID \`
  --parameters '{\\"name\\":\\"github-env-${env}\\",\\"issuer\\":\\"https://token.actions.githubusercontent.com\\",\\"subject\\":\\"repo:'\${GITHUB_ORG}'/'\${GITHUB_REPO}':environment:${env}\\",\\"audiences\\":[\\"api://AzureADTokenExchange\\"]}'
\`\`\``
  ).join('\n\n');

  const ghSecretEnvCmds = config.environments.map((env) =>
    `# ${env} environment secrets
gh secret set AZURE_SUBSCRIPTION_ID --body "\${AZURE_SUBSCRIPTION_ID_${env.toUpperCase()}}" --env ${env}
gh secret set APIM_RESOURCE_GROUP_${env.toUpperCase()} --body "\${APIM_RG_${env.toUpperCase()}}" --env ${env}
gh secret set APIM_SERVICE_NAME_${env.toUpperCase()} --body "\${APIM_NAME_${env.toUpperCase()}}" --env ${env}`
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

  return renderTemplate(copilotIdentitySetupPromptTemplate, {
    ENV_SECRETS_REFERENCE: envSecrets,
    ENV_FEDERATED_CREDENTIALS: envFedCreds,
    GH_SECRET_ENV_COMMANDS: ghSecretEnvCmds,
    ENVIRONMENT_CREATION_COMMANDS: environmentCreationCommands,
    ENV_SUBSCRIPTION_TABLE_ROWS: envSubscriptionTableRows,
    ENV_APIM_TABLE_ROWS: envApimTableRows,
    ENV_READER_ROLE_SNIPPETS: envReaderRoleSnippets,
    ENV_APIM_ROLE_SNIPPETS: envApimRoleSnippets,
  });
}
