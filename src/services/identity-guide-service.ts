// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T048: Identity setup guide generator
 * Step-by-step instructions for service principal, RBAC, federated credentials,
 * pipeline secrets/service connections. Optional az CLI automation per FR-021.
 */

import {
  azureDevOpsIdentitySetupCoreTemplate,
  azureDevOpsIdentityGuideTemplate,
  githubActionsIdentityGuideTemplate,
} from '../templates/generated/embedded-markdown.js';

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
  private renderTemplate(template: string, tokens: Record<string, string>): string {
    return Object.entries(tokens).reduce(
      (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, value),
      template
    );
  }

  generateGitHubActionsGuide(
    subscriptionId: string,
    resourceGroup: string,
    environments: string[]
  ): string {
    const federatedCredentialsPerEnvironment = environments.map((env) => `az ad app federated-credential create \\
  --id "$APP_ID" \\
  --parameters '{
    "name": "github-env-${env}",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"$GITHUB_ORG"'/'"$GITHUB_REPO"':environment:${env}",
    "audiences": ["api://AzureADTokenExchange"]
  }'`).join('\n\n');

    const environmentSecrets = environments.map((env) => `
**For ${env} environment:**
- \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\`: Resource group for ${env}
- \`APIM_SERVICE_NAME_${env.toUpperCase()}\`: APIM service name for ${env}
`).join('\n');

    return this.renderTemplate(githubActionsIdentityGuideTemplate, {
      SUBSCRIPTION_ID: subscriptionId,
      RESOURCE_GROUP: resourceGroup,
      FEDERATED_CREDENTIALS_PER_ENV: federatedCredentialsPerEnvironment,
      ENVIRONMENT_SECRETS: environmentSecrets,
    });
  }

  generateAzureDevOpsGuide(
    subscriptionId: string,
    resourceGroup: string,
    environments: string[]
  ): string {
    const environmentsArrayPowerShell = environments.map((e) => `"${e}"`).join(', ');
    const environmentsArrayBash = environments.map((e) => `"${e}"`).join(' ');

    const coreSteps = this.renderTemplate(azureDevOpsIdentitySetupCoreTemplate, {
      SUBSCRIPTION_ID: subscriptionId,
      RESOURCE_GROUP: resourceGroup,
      ENVIRONMENTS_ARRAY_POWERSHELL: environmentsArrayPowerShell,
      ENVIRONMENTS_ARRAY_BASH: environmentsArrayBash,
    });

    return this.renderTemplate(azureDevOpsIdentityGuideTemplate, {
      AZURE_DEVOPS_CORE_STEPS: coreSteps,
    });
  }
}

export const identityGuideService: IdentityGuideService = new IdentityGuideServiceImpl();
