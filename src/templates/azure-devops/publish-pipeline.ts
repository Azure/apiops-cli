// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T046: Azure DevOps publish pipeline template
 * Multi-stage pipeline with commit ID choice, environment selection, and variable groups
 */

export interface PublishPipelineConfig {
  artifactDir: string;
  environments: string[];
}

export function generatePublishPipeline(config: PublishPipelineConfig): string {
  const envValues = config.environments.map((env) => `      - '${env}'`).join('\n');

  const stages = config.environments.map((env, idx) => {
    const dependsOn = idx === 0 ? '' : `  dependsOn: Publish_${config.environments[idx - 1]}\n`;

    return `${dependsOn}- stage: Publish_${env}
  displayName: 'Publish to ${env}'
  condition: or(eq('\${{ parameters.ENVIRONMENT }}', '${env}'), eq('\${{ parameters.ENVIRONMENT }}', 'all'))
  variables:
    - group: apim-${env}
  jobs:
    - deployment: Deploy
      displayName: 'Deploy to ${env}'
      environment: ${env}
      pool:
        vmImage: 'ubuntu-latest'
      strategy:
        runOnce:
          deploy:
            steps:
              - checkout: self
                fetchDepth: 2

              - task: NodeTool@0
                displayName: 'Setup Node.js'
                inputs:
                  versionSpec: '22.x'

              - script: npm ci
                displayName: 'Install dependencies'

              - task: AzureCLI@2
                displayName: 'Publish to ${env} (incremental - last commit only)'
                condition: ne('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo')
                inputs:
                  azureSubscription: '$(AZURE_SERVICE_CONNECTION_${env.toUpperCase()})'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_${env.toUpperCase()}) \\
                      --service-name $(APIM_SERVICE_NAME_${env.toUpperCase()}) \\
                      --source ${config.artifactDir} \\
                      --overrides configuration.${env}.yaml \\
                      --commit-id $(Build.SourceVersion) \\
                      --subscription-id $(AZURE_SUBSCRIPTION_ID)

              - task: AzureCLI@2
                displayName: 'Publish to ${env} (all artifacts)'
                condition: eq('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo')
                inputs:
                  azureSubscription: '$(AZURE_SERVICE_CONNECTION_${env.toUpperCase()})'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_${env.toUpperCase()}) \\
                      --service-name $(APIM_SERVICE_NAME_${env.toUpperCase()}) \\
                      --source ${config.artifactDir} \\
                      --overrides configuration.${env}.yaml \\
                      --subscription-id $(AZURE_SUBSCRIPTION_ID)
`;
  }).join('\n');

  return `# Azure DevOps Pipeline: Run APIM Publisher

trigger:
  branches:
    include:
      - main
  paths:
    include:
      - '${config.artifactDir}/**'
      - 'configuration.*.yaml'

pr: none

parameters:
  - name: COMMIT_ID_CHOICE
    type: string
    displayName: 'Choose "publish-all-artifacts-in-repo" only when you want to force republishing all artifacts (e.g. after build failure). Otherwise stick with the default behavior of "publish-artifacts-in-last-commit"'
    default: 'publish-artifacts-in-last-commit'
    values:
      - 'publish-artifacts-in-last-commit'
      - 'publish-all-artifacts-in-repo'
  - name: ENVIRONMENT
    type: string
    displayName: 'Choose which environment to publish to'
    default: 'all'
    values:
      - 'all'
${envValues}

stages:
${stages}
`;
}
