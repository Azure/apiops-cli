/**
 * T045: Azure DevOps extract pipeline template
 * Manual trigger with configuration choice and auto-PR creation
 */

export interface ExtractPipelineConfig {
  artifactDir: string;
}

export function generateExtractPipeline(config: ExtractPipelineConfig): string {
  return `# Azure DevOps Pipeline: Run APIM Extractor

trigger: none

parameters:
  - name: CONFIGURATION_YAML_PATH
    type: string
    displayName: 'Choose whether to extract all APIs or use the extraction configuration file'
    default: 'Extract All APIs'
    values:
      - 'Extract All APIs'
      - 'configuration.extract.yaml'
  - name: resourceGroup
    type: string
    displayName: 'Azure Resource Group'
    default: $(APIM_RESOURCE_GROUP)
  - name: serviceName
    type: string
    displayName: 'APIM Service Name'
    default: $(APIM_SERVICE_NAME)

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: apim-common

steps:
  - task: NodeTool@0
    displayName: 'Setup Node.js'
    inputs:
      versionSpec: '22.x'

  - script: npm ci
    displayName: 'Install dependencies'

  - task: AzureCLI@2
    displayName: 'Run APIM Extract (All APIs)'
    condition: eq('\${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')
    inputs:
      azureSubscription: '$(AZURE_SERVICE_CONNECTION)'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        npx apiops extract \\
          --resource-group \${{ parameters.resourceGroup }} \\
          --service-name \${{ parameters.serviceName }} \\
          --output ${config.artifactDir} \\
          --subscription-id $(AZURE_SUBSCRIPTION_ID)

  - task: AzureCLI@2
    displayName: 'Run APIM Extract (With Configuration)'
    condition: ne('\${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')
    inputs:
      azureSubscription: '$(AZURE_SERVICE_CONNECTION)'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        npx apiops extract \\
          --resource-group \${{ parameters.resourceGroup }} \\
          --service-name \${{ parameters.serviceName }} \\
          --output ${config.artifactDir} \\
          --filter configuration.extract.yaml \\
          --subscription-id $(AZURE_SUBSCRIPTION_ID)

  - task: PublishPipelineArtifact@1
    displayName: 'Publish artifacts'
    inputs:
      targetPath: ${config.artifactDir}
      artifactName: apim-artifacts

  - script: |
      BRANCH_NAME="apim-extract-$(Build.BuildId)"
      git config user.name "Azure DevOps"
      git config user.email "azuredevops@microsoft.com"
      git checkout -b "$BRANCH_NAME"
      git add ${config.artifactDir}
      if git diff --cached --quiet; then
        echo "No changes to commit"
      else
        git commit -m "chore: update APIM artifacts from extract"
        git push origin "$BRANCH_NAME"
        echo "##vso[task.logissue type=warning]Branch '$BRANCH_NAME' pushed. Please create a pull request to merge the changes."
      fi
    displayName: 'Create branch with changes'
    env:
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)
`;
}
