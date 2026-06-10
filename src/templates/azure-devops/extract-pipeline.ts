// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T045: Azure DevOps extract pipeline template
 * Manual trigger with environment choice, configuration choice, and auto-PR creation
 */

export interface ExtractPipelineConfig {
  artifactDir: string;
  environments: string[];
}

export function generateExtractPipeline(config: ExtractPipelineConfig): string {
  const defaultEnv = config.environments[0];
  const envValues = config.environments.map((env) => `      - '${env}'`).join('\n');
  const varGroupBlocks = config.environments
    .map((env) => `- \${{ if eq(parameters.ENVIRONMENT, '${env}') }}:\n  - group: apim-${env}`)
    .join('\n');

  return `# Azure DevOps Pipeline: Run APIM Extractor

trigger: none

parameters:
  - name: ENVIRONMENT
    type: string
    displayName: 'Choose which environment to extract from'
    default: '${defaultEnv}'
    values:
${envValues}
  - name: CONFIGURATION_YAML_PATH
    type: string
    displayName: 'Choose whether to extract all APIs or use the extraction configuration file'
    default: 'Extract All APIs'
    values:
      - 'Extract All APIs'
      - 'configuration.extractor.yaml'

pool:
  vmImage: 'ubuntu-latest'

variables:
${varGroupBlocks}

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
      APIM_RESOURCE_GROUP='$(APIM_RESOURCE_GROUP)'
      APIM_SERVICE_NAME='$(APIM_SERVICE_NAME)'
      SERVICE_CONNECTION='$(AZURE_SERVICE_CONNECTION)'
      SUBSCRIPTION_ID='$(AZURE_SUBSCRIPTION_ID)'

      if [[ -z "$APIM_RESOURCE_GROUP" || "$APIM_RESOURCE_GROUP" == '$('*')' ]]; then
        echo "##vso[task.logissue type=error]APIM_RESOURCE_GROUP is not set. Ensure variable group 'apim-\${{ parameters.ENVIRONMENT }}' is authorized and defines APIM_RESOURCE_GROUP."
        exit 2
      fi

      if [[ -z "$APIM_SERVICE_NAME" || "$APIM_SERVICE_NAME" == '$('*')' ]]; then
        echo "##vso[task.logissue type=error]APIM_SERVICE_NAME is not set. Ensure variable group 'apim-\${{ parameters.ENVIRONMENT }}' is authorized and defines APIM_SERVICE_NAME."
        exit 2
      fi

      if [[ -z "$SERVICE_CONNECTION" || "$SERVICE_CONNECTION" == '$('*')' ]]; then
        echo "##vso[task.logissue type=error]AZURE_SERVICE_CONNECTION is not set. Ensure variable group 'apim-\${{ parameters.ENVIRONMENT }}' is authorized and defines AZURE_SERVICE_CONNECTION."
        exit 2
      fi

      if [[ -z "$SUBSCRIPTION_ID" || "$SUBSCRIPTION_ID" == '$('*')' ]]; then
        echo "##vso[task.logissue type=error]AZURE_SUBSCRIPTION_ID is not set. Ensure variable group 'apim-\${{ parameters.ENVIRONMENT }}' is authorized and defines AZURE_SUBSCRIPTION_ID."
        exit 2
      fi

      echo "All required variables are configured for environment '\${{ parameters.ENVIRONMENT }}'"
    displayName: 'Validate required variables'

  - task: AzureCLI@2
    displayName: 'Run APIM Extract (All APIs)'
    condition: eq('\${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')
    inputs:
      azureSubscription: '$(AZURE_SERVICE_CONNECTION)'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        npx @peterhauge/apiops-cli extract \\
          --resource-group "$(APIM_RESOURCE_GROUP)" \\
          --service-name "$(APIM_SERVICE_NAME)" \\
          --output ${config.artifactDir} \\
          --subscription-id "$(AZURE_SUBSCRIPTION_ID)"

  - task: AzureCLI@2
    displayName: 'Run APIM Extract (With Configuration)'
    condition: ne('\${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')
    inputs:
      azureSubscription: '$(AZURE_SERVICE_CONNECTION)'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        npx @peterhauge/apiops-cli extract \\
          --resource-group "$(APIM_RESOURCE_GROUP)" \\
          --service-name "$(APIM_SERVICE_NAME)" \\
          --output ${config.artifactDir} \\
          --filter configuration.extractor.yaml \\
          --subscription-id "$(AZURE_SUBSCRIPTION_ID)"

  - task: PublishPipelineArtifact@1
    displayName: 'Publish artifacts'
    inputs:
      targetPath: ${config.artifactDir}
      artifactName: apim-artifacts

  - bash: |
      BRANCH_NAME="apim-extract-$(Build.BuildId)"
      TARGET_BRANCH="$(Build.SourceBranch)"
      BUILD_ID="$(Build.BuildId)"

      git config user.name "Azure DevOps"
      git config user.email "azuredevops@microsoft.com"
      git checkout -b "$BRANCH_NAME"
      git add ${config.artifactDir}
      if git diff --cached --quiet; then
        echo "No changes to commit"
        exit 0
      fi
      git commit -m "chore: update APIM artifacts from extract"
      git push origin "$BRANCH_NAME"

      PR_PAYLOAD=$(printf '{"title":"APIM Extract - Update artifacts","description":"Auto-generated by APIM extract pipeline run %s","sourceRefName":"refs/heads/%s","targetRefName":"%s"}' \\
        "$BUILD_ID" "$BRANCH_NAME" "$TARGET_BRANCH")

      HTTP_STATUS=$(curl -s -o /tmp/pr_response.json -w "%{http_code}" -X POST \\
        -H "Content-Type: application/json" \\
        -H "Authorization: Bearer $SYSTEM_ACCESSTOKEN" \\
        "$(System.TeamFoundationCollectionUri)$(System.TeamProject)/_apis/git/repositories/$(Build.Repository.Name)/pullrequests?api-version=7.1" \\
        -d "$PR_PAYLOAD")

      if [ "$HTTP_STATUS" = "201" ]; then
        PR_ID=$(python3 -c "import json; print(json.load(open('/tmp/pr_response.json'))['pullRequestId'])" 2>/dev/null)
        echo "##vso[task.logissue type=warning]Pull request created: $(System.TeamFoundationCollectionUri)$(System.TeamProject)/_git/$(Build.Repository.Name)/pullrequest/$PR_ID"
      else
        echo "##vso[task.logissue type=warning]Could not auto-create PR (HTTP $HTTP_STATUS). Please create a PR from '$BRANCH_NAME' to '$TARGET_BRANCH' manually."
      fi
    displayName: 'Create branch and open pull request'
    env:
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)
`;
}
