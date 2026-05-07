/**
 * T046: Azure DevOps publish pipeline template
 * Simplified pipeline with environment selection and variable groups
 */

export interface PublishPipelineConfig {
  artifactDir: string;
  environments: string[];
}

export function generatePublishPipeline(config: PublishPipelineConfig): string {
  const envValues = config.environments.map((env) => `      - '${env}'`).join('\n');

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
  - name: ENVIRONMENT
    type: string
    displayName: 'Choose which environment to publish to'
    default: '${config.environments[0]}'
    values:
${envValues}

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: apim-common
  - \${{ if eq(parameters.ENVIRONMENT, '${config.environments[0]}') }}:
    - group: apim-${config.environments[0]}
${config.environments.slice(1).map(env => `  - \${{ if eq(parameters.ENVIRONMENT, '${env}') }}:
    - group: apim-${env}`).join('\n')}

steps:
  - task: UseNode@1
    displayName: 'Setup Node.js'
    inputs:
      version: '22.x'

  - script: npm install @peterhauge/apiops-cli@$(APIOPS_CLI_VERSION)
    displayName: 'Install dependencies'

  - task: AzureCLI@2
    displayName: 'Publish to \${{ parameters.ENVIRONMENT }}'
    inputs:
      azureSubscription: 'AZURE_SERVICE_CONNECTION_\${{ upper(parameters.ENVIRONMENT) }}'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      addSpnToEnvironment: true
      workingDirectory: '$(Build.SourcesDirectory)'
      inlineScript: |
        OVERRIDES_FILE="$(Build.SourcesDirectory)/configuration.\${{ parameters.ENVIRONMENT }}.yaml"

        if [ -f "$OVERRIDES_FILE" ]; then
          echo "Using overrides file: $OVERRIDES_FILE"
          npx apiops publish \\
            --resource-group "$(APIM_RESOURCE_GROUP)" \\
            --service-name "$(APIM_SERVICE_NAME)" \\
            --source "$(Build.SourcesDirectory)/${config.artifactDir}" \\
            --overrides "$OVERRIDES_FILE" \\
            --subscription-id "$(AZURE_SUBSCRIPTION_ID)"
        else
          echo "No overrides file found at $OVERRIDES_FILE, publishing without overrides"
          npx apiops publish \\
            --resource-group "$(APIM_RESOURCE_GROUP)" \\
            --service-name "$(APIM_SERVICE_NAME)" \\
            --source "$(Build.SourcesDirectory)/${config.artifactDir}" \\
            --subscription-id "$(AZURE_SUBSCRIPTION_ID)"
        fi
`;
}
