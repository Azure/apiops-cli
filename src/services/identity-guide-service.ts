// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Identity setup guide generator
 * Step-by-step instructions for service principal, RBAC, federated credentials,
 * pipeline secrets/service connections. Optional az CLI automation per FR-021.
 */

import {
  azureDevOpsIdentitySetupCoreTemplate,
  azureDevOpsIdentityGuideTemplate,
  githubActionsIdentityGuideTemplate,
} from '../templates/generated/embedded-markdown.js';
import { renderTemplate } from '../lib/render-template.js';

export interface IdentityGuideService {
  generateGitHubActionsGuide(
    subscriptionId: string,
    resourceGroup: string,
    environments: string[]
  ): string;

  generateAzureDevOpsGuide(
    environments: string[]
  ): string;
}

class IdentityGuideServiceImpl implements IdentityGuideService {
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

    return renderTemplate(githubActionsIdentityGuideTemplate, {
      SUBSCRIPTION_ID: subscriptionId,
      RESOURCE_GROUP: resourceGroup,
      FEDERATED_CREDENTIALS_PER_ENV: federatedCredentialsPerEnvironment,
      ENVIRONMENT_SECRETS: environmentSecrets,
    });
  }

  generateAzureDevOpsGuide(
    environments: string[]
  ): string {
    const environmentsArrayPowerShell = environments
      .map((environment) => `"${environment}"`)
      .join(', ');
    const environmentsArrayBash = environments
      .map((environment) => `"${environment}"`)
      .join(' ');

    const coreSteps = renderTemplate(azureDevOpsIdentitySetupCoreTemplate, {
      ENVIRONMENTS_ARRAY_POWERSHELL: environmentsArrayPowerShell,
      ENVIRONMENTS_ARRAY_BASH: environmentsArrayBash,
    });

    return renderTemplate(azureDevOpsIdentityGuideTemplate, {
      AZURE_DEVOPS_CORE_STEPS: coreSteps,
    });
  }
}

export const identityGuideService: IdentityGuideService = new IdentityGuideServiceImpl();
