// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Identity setup guide generator
 * Step-by-step instructions for service principal, RBAC, federated credentials,
 * pipeline secrets/service connections. Optional az CLI automation per FR-021.
 */

import {
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
    const federatedCredentialRows = environments.map((env) =>
      `| \`${env}\` | \`github-env-${env}\` | \`repo:<your-github-org>/<your-github-repo>:environment:${env}\` |`
    ).join('\n');

    const environmentSecrets = environments.map((env) => `### ${env} environment
- Create a GitHub environment named \`${env}\` in **Settings** → **Environments**
- Add environment secret \`AZURE_SUBSCRIPTION_ID\` with the subscription ID used for ${env}
- Add environment secret \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\` with the APIM resource group for ${env}
- Add environment secret \`APIM_SERVICE_NAME_${env.toUpperCase()}\` with the APIM service name for ${env}
`).join('\n');

    const environmentAzureAccessNotes = environments.map((env) =>
      `- **${env}** — assign **Reader** on the resource group you will store in \`APIM_RESOURCE_GROUP_${env.toUpperCase()}\`, then assign **API Management Service Contributor** on the APIM instance you will store in \`APIM_SERVICE_NAME_${env.toUpperCase()}\`.`
    ).join('\n');

    return renderTemplate(githubActionsIdentityGuideTemplate, {
      SUBSCRIPTION_ID: subscriptionId,
      RESOURCE_GROUP: resourceGroup,
      FEDERATED_CREDENTIAL_ROWS: federatedCredentialRows,
      ENVIRONMENT_SECRET_SECTIONS: environmentSecrets,
      ENVIRONMENT_AZURE_ACCESS_NOTES: environmentAzureAccessNotes,
    });
  }

  generateAzureDevOpsGuide(
    environments: string[]
  ): string {
    const serviceConnectionRows = environments.map((environment) =>
      `| \`${environment}\` | \`AZURE_SERVICE_CONNECTION_${environment.toUpperCase()}\` | Azure Resource Manager → Workload identity federation → subscription that contains the ${environment} APIM instance |`
    ).join('\n');

    const variableGroupRows = environments.map((environment) =>
      `| \`${environment}\` | \`apim-${environment}\` | \`AZURE_SERVICE_CONNECTION\`, \`AZURE_SUBSCRIPTION_ID\`, \`APIM_RESOURCE_GROUP\`, \`APIM_SERVICE_NAME\`, \`APIM_RESOURCE_GROUP_${environment.toUpperCase()}\`, \`APIM_SERVICE_NAME_${environment.toUpperCase()}\` |`
    ).join('\n');

    return renderTemplate(azureDevOpsIdentityGuideTemplate, {
      SERVICE_CONNECTION_ROWS: serviceConnectionRows,
      VARIABLE_GROUP_ROWS: variableGroupRows,
    });
  }
}

export const identityGuideService: IdentityGuideService = new IdentityGuideServiceImpl();
