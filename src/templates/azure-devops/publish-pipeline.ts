// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Azure DevOps publish pipeline template
 * Multi-stage pipeline with commit ID choice, environment selection, and variable groups
 */

export interface PublishPipelineConfig {
  artifactDir: string;
  environments: string[];
}

export function generatePublishPipeline(config: PublishPipelineConfig): string {
  const defaultEnvironment = config.environments[0] ?? 'dev';
  const envValues = config.environments.map((env) => `      - '${env}'`).join('\n');

  const stages = config.environments.map((env) => {
    const envUpper = env.toUpperCase();

    return `- stage: Publish_${env}
  displayName: 'Publish to ${env}'
  condition: eq('\${{ parameters.ENVIRONMENT }}', '${env}')
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

              - task: UseNode@1
                displayName: 'Setup Node.js'
                inputs:
                  version: '22.x'

              - script: |
                  node -v
                  npm -v
                displayName: 'Verify Node.js version'

              - script: |
                  if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
                    npm ci
                  else
                    npm install
                  fi
                displayName: 'Install dependencies'

              - task: replacetokens@6
                displayName: 'Substitute tokens in configuration.${env}.yaml'
                inputs:
                  sources: 'configuration.${env}.yaml'
                  tokenPattern: 'custom'
                  tokenPrefix: '{#['
                  tokenSuffix: ']#}'
                  missingVarAction: 'keep'

              - script: |
                  if grep -q '{#\\[' configuration.${env}.yaml; then
                    echo "Unresolved tokens remain in configuration.${env}.yaml"
                    grep -o '{#\\[[^]]*\\]#}' configuration.${env}.yaml | sort -u
                    exit 1
                  fi
                displayName: 'Validate token substitution (${env})'

              - task: AzureCLI@2
                displayName: 'Dry-run validation (${env}, incremental)'
                condition: and(succeeded(), ne('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))
                inputs:
                  azureSubscription: 'AZURE_SERVICE_CONNECTION_${envUpper}'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_${envUpper}) \\
                      --service-name $(APIM_SERVICE_NAME_${envUpper}) \\
                      --source ${config.artifactDir} \\
                      --overrides configuration.${env}.yaml \\
                      --commit-id $(Build.SourceVersion) \\
                      --subscription-id $(AZURE_SUBSCRIPTION_ID) \\
                      --dry-run

              - task: AzureCLI@2
                displayName: 'Dry-run validation (${env}, all artifacts)'
                condition: and(succeeded(), eq('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))
                inputs:
                  azureSubscription: 'AZURE_SERVICE_CONNECTION_${envUpper}'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_${envUpper}) \\
                      --service-name $(APIM_SERVICE_NAME_${envUpper}) \\
                      --source ${config.artifactDir} \\
                      --overrides configuration.${env}.yaml \\
                      --subscription-id $(AZURE_SUBSCRIPTION_ID) \\
                      --dry-run

              - task: AzureCLI@2
                displayName: 'Publish to ${env} (incremental - last commit only)'
                condition: and(succeeded(), ne('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))
                inputs:
                  azureSubscription: 'AZURE_SERVICE_CONNECTION_${envUpper}'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_${envUpper}) \\
                      --service-name $(APIM_SERVICE_NAME_${envUpper}) \\
                      --source ${config.artifactDir} \\
                      --overrides configuration.${env}.yaml \\
                      --commit-id $(Build.SourceVersion) \\
                      --subscription-id $(AZURE_SUBSCRIPTION_ID)

              - task: AzureCLI@2
                displayName: 'Publish to ${env} (all artifacts)'
                condition: and(succeeded(), eq('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))
                inputs:
                  azureSubscription: 'AZURE_SERVICE_CONNECTION_${envUpper}'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_${envUpper}) \\
                      --service-name $(APIM_SERVICE_NAME_${envUpper}) \\
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
    default: '${defaultEnvironment}'
    values:
${envValues}

stages:
${stages}
`;
}
