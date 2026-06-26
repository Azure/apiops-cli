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

  // A single parameterized stage drives all environments. The ENVIRONMENT
  // parameter is resolved at template (compile) time, so it can select the
  // variable group, deployment environment, config file, and env-suffixed
  // variable names (via upper()) without duplicating the stage per environment.
  const stage = `- stage: Publish
  displayName: 'Publish to \${{ parameters.ENVIRONMENT }}'
  variables:
    - group: apim-\${{ parameters.ENVIRONMENT }}
  jobs:
    - deployment: Deploy
      displayName: 'Deploy to \${{ parameters.ENVIRONMENT }}'
      environment: \${{ parameters.ENVIRONMENT }}
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
                displayName: 'Substitute tokens in configuration.\${{ parameters.ENVIRONMENT }}.yaml'
                inputs:
                  sources: 'configuration.\${{ parameters.ENVIRONMENT }}.yaml'
                  tokenPattern: 'custom'
                  tokenPrefix: '{#['
                  tokenSuffix: ']#}'
                  missingVarAction: 'keep'
                  missingVarLog: 'error'

              - script: |
                  if grep -q '{#\\[' configuration.\${{ parameters.ENVIRONMENT }}.yaml; then
                    echo "Unresolved tokens remain in configuration.\${{ parameters.ENVIRONMENT }}.yaml"
                    grep -o '{#\\[[^]]*\\]#}' configuration.\${{ parameters.ENVIRONMENT }}.yaml | sort -u
                    exit 1
                  fi
                displayName: 'Validate token substitution'

              - task: AzureCLI@2
                displayName: 'Dry-run validation (incremental)'
                condition: and(succeeded(), ne('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))
                inputs:
                  azureSubscription: 'AZURE_SERVICE_CONNECTION_\${{ upper(parameters.ENVIRONMENT) }}'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_\${{ upper(parameters.ENVIRONMENT) }}) \\
                      --service-name $(APIM_SERVICE_NAME_\${{ upper(parameters.ENVIRONMENT) }}) \\
                      --source ${config.artifactDir} \\
                      --overrides configuration.\${{ parameters.ENVIRONMENT }}.yaml \\
                      --commit-id $(Build.SourceVersion) \\
                      --subscription-id $(AZURE_SUBSCRIPTION_ID) \\
                      --dry-run

              - task: AzureCLI@2
                displayName: 'Dry-run validation (all artifacts)'
                condition: and(succeeded(), eq('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))
                inputs:
                  azureSubscription: 'AZURE_SERVICE_CONNECTION_\${{ upper(parameters.ENVIRONMENT) }}'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_\${{ upper(parameters.ENVIRONMENT) }}) \\
                      --service-name $(APIM_SERVICE_NAME_\${{ upper(parameters.ENVIRONMENT) }}) \\
                      --source ${config.artifactDir} \\
                      --overrides configuration.\${{ parameters.ENVIRONMENT }}.yaml \\
                      --subscription-id $(AZURE_SUBSCRIPTION_ID) \\
                      --dry-run

              - task: AzureCLI@2
                displayName: 'Publish (incremental - last commit only)'
                condition: and(succeeded(), ne('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))
                inputs:
                  azureSubscription: 'AZURE_SERVICE_CONNECTION_\${{ upper(parameters.ENVIRONMENT) }}'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_\${{ upper(parameters.ENVIRONMENT) }}) \\
                      --service-name $(APIM_SERVICE_NAME_\${{ upper(parameters.ENVIRONMENT) }}) \\
                      --source ${config.artifactDir} \\
                      --overrides configuration.\${{ parameters.ENVIRONMENT }}.yaml \\
                      --commit-id $(Build.SourceVersion) \\
                      --subscription-id $(AZURE_SUBSCRIPTION_ID)

              - task: AzureCLI@2
                displayName: 'Publish (all artifacts)'
                condition: and(succeeded(), eq('\${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))
                inputs:
                  azureSubscription: 'AZURE_SERVICE_CONNECTION_\${{ upper(parameters.ENVIRONMENT) }}'
                  scriptType: 'bash'
                  scriptLocation: 'inlineScript'
                  inlineScript: |
                    npx apiops publish \\
                      --resource-group $(APIM_RESOURCE_GROUP_\${{ upper(parameters.ENVIRONMENT) }}) \\
                      --service-name $(APIM_SERVICE_NAME_\${{ upper(parameters.ENVIRONMENT) }}) \\
                      --source ${config.artifactDir} \\
                      --overrides configuration.\${{ parameters.ENVIRONMENT }}.yaml \\
                      --subscription-id $(AZURE_SUBSCRIPTION_ID)
`;

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
${stage}
`;
}
