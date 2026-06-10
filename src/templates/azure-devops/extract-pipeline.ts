// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
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
      - 'configuration.extractor.yaml'
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
  - checkout: self
    persistCredentials: true
    fetchDepth: 2

  - task: UseNode@1
    displayName: 'Setup Node.js'
    inputs:
      version: '22.x'

  - script: |
      if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then
        npm ci
      else
        npm install --no-audit --no-fund
      fi
    displayName: 'Install dependencies'

  - bash: |
      echo "##vso[task.setvariable variable=RESOURCE_GROUP]\${{ parameters.resourceGroup }}"
      echo "##vso[task.setvariable variable=SERVICE_NAME]\${{ parameters.serviceName }}"
    displayName: 'Set parameters as variables'

  - bash: |
      RESOURCE_GROUP='$(RESOURCE_GROUP)'
      SERVICE_NAME='$(SERVICE_NAME)'
      SERVICE_CONNECTION='$(AZURE_SERVICE_CONNECTION)'
      SUBSCRIPTION_ID='$(AZURE_SUBSCRIPTION_ID)'

      is_unresolved() {
        local value="$1"
        case "$value" in
          ""|\$\(*\)) return 0 ;;
          *) return 1 ;;
        esac
      }

      if is_unresolved "$RESOURCE_GROUP"; then
        echo "##vso[task.logissue type=error]RESOURCE_GROUP was not resolved. Verify apim-common defines APIM_RESOURCE_GROUP and is authorized for this pipeline."
        exit 2
      fi

      if is_unresolved "$SERVICE_NAME"; then
        echo "##vso[task.logissue type=error]SERVICE_NAME was not resolved. Verify apim-common defines APIM_SERVICE_NAME and is authorized for this pipeline."
        exit 2
      fi

      if is_unresolved "$SERVICE_CONNECTION"; then
        echo "##vso[task.logissue type=error]AZURE_SERVICE_CONNECTION was not resolved. Verify apim-common defines AZURE_SERVICE_CONNECTION and is authorized for this pipeline."
        exit 2
      fi

      if is_unresolved "$SUBSCRIPTION_ID"; then
        echo "##vso[task.logissue type=error]AZURE_SUBSCRIPTION_ID was not resolved. Verify apim-common defines AZURE_SUBSCRIPTION_ID and is authorized for this pipeline."
        exit 2
      fi
    displayName: 'Validate required variables'

  - task: AzureCLI@2
    displayName: 'Run APIM Extract (All APIs)'
    condition: eq('\${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')
    inputs:
      azureSubscription: '$(AZURE_SERVICE_CONNECTION)'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        SUBSCRIPTION_ID='$(AZURE_SUBSCRIPTION_ID)'

        is_unresolved() {
          local value="$1"
          case "$value" in
            ""|\$\(*\)) return 0 ;;
            *) return 1 ;;
          esac
        }

        if is_unresolved "$SUBSCRIPTION_ID"; then
          echo "##vso[task.logissue type=error]AZURE_SUBSCRIPTION_ID was not resolved. Ensure apim-common is authorized and defines AZURE_SUBSCRIPTION_ID."
          exit 2
        fi
        npx @peterhauge/apiops-cli extract \\
          --resource-group "$(RESOURCE_GROUP)" \\
          --service-name "$(SERVICE_NAME)" \\
          --output ${config.artifactDir} \\
          --subscription-id "$SUBSCRIPTION_ID"

  - task: AzureCLI@2
    displayName: 'Run APIM Extract (With Configuration)'
    condition: ne('\${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')
    inputs:
      azureSubscription: '$(AZURE_SERVICE_CONNECTION)'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        SUBSCRIPTION_ID='$(AZURE_SUBSCRIPTION_ID)'

        is_unresolved() {
          local value="$1"
          case "$value" in
            ""|\$\(*\)) return 0 ;;
            *) return 1 ;;
          esac
        }

        if is_unresolved "$SUBSCRIPTION_ID"; then
          echo "##vso[task.logissue type=error]AZURE_SUBSCRIPTION_ID was not resolved. Ensure apim-common is authorized and defines AZURE_SUBSCRIPTION_ID."
          exit 2
        fi
        npx @peterhauge/apiops-cli extract \\
          --resource-group "$(RESOURCE_GROUP)" \\
          --service-name "$(SERVICE_NAME)" \\
          --output ${config.artifactDir} \\
          --filter configuration.extractor.yaml \\
          --subscription-id "$SUBSCRIPTION_ID"

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
