/**
 * T045: Azure DevOps extract pipeline template
 * Manual trigger with configuration choice and auto-PR creation
 */

export interface ExtractPipelineConfig {
  artifactDir: string;
  environments: string[];
}

export function generateExtractPipeline(config: ExtractPipelineConfig): string {
  const envValues = config.environments.map((env) => `      - '${env}'`).join('\n');

  return `# Azure DevOps Pipeline: Run APIM Extractor

trigger: none

parameters:
  - name: ENVIRONMENT
    type: string
    displayName: 'Choose which environment to extract from'
    default: '${config.environments[0]}'
    values:
${envValues}
  - name: CONFIGURATION_YAML_PATH
    type: string
    displayName: 'Choose whether to extract all APIs or use the extraction configuration file'
    default: 'Extract All APIs'
    values:
      - 'Extract All APIs'
      - 'configuration.extract.yaml'

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

  - script: |
      az extension add --name azure-devops --upgrade
      az devops configure --defaults organization=$(System.TeamFoundationCollectionUri) project=$(System.TeamProject)
    displayName: 'Install Azure DevOps CLI extension'
    env:
      AZURE_DEVOPS_EXT_PAT: $(System.AccessToken)

  - script: npm install @peterhauge/apiops-cli@$(APIOPS_CLI_VERSION)
    displayName: 'Install dependencies'

  - task: AzureCLI@2
    displayName: 'Run APIM Extract (All APIs)'
    condition: eq('\${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')
    inputs:
      azureSubscription: 'AZURE_SERVICE_CONNECTION_\${{ upper(parameters.ENVIRONMENT) }}'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      addSpnToEnvironment: true
      workingDirectory: '$(Build.SourcesDirectory)'
      inlineScript: |
        npx apiops extract \\
          --resource-group "$(APIM_RESOURCE_GROUP)" \\
          --service-name "$(APIM_SERVICE_NAME)" \\
          --output $(Build.SourcesDirectory)/${config.artifactDir} \\
          --subscription-id "$(AZURE_SUBSCRIPTION_ID)"

  - task: AzureCLI@2
    displayName: 'Run APIM Extract (With Configuration)'
    condition: ne('\${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')
    inputs:
      azureSubscription: 'AZURE_SERVICE_CONNECTION_\${{ upper(parameters.ENVIRONMENT) }}'
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      addSpnToEnvironment: true
      workingDirectory: '$(Build.SourcesDirectory)'
      inlineScript: |
        npx apiops extract \\
          --resource-group "$(APIM_RESOURCE_GROUP)" \\
          --service-name "$(APIM_SERVICE_NAME)" \\
          --output $(Build.SourcesDirectory)/${config.artifactDir} \\
          --filter $(Build.SourcesDirectory)/configuration.extract.yaml \\
          --subscription-id "$(AZURE_SUBSCRIPTION_ID)"

  - task: PublishPipelineArtifact@1
    displayName: 'Publish artifacts'
    inputs:
      targetPath: ${config.artifactDir}
      artifactName: apim-artifacts

  - script: |
      BRANCH_NAME="apim-extract-\${{ parameters.ENVIRONMENT }}-$(Build.BuildId)"
      
      # Configure git authentication using System.AccessToken
      git config user.name "Azure DevOps"
      git config user.email "azuredevops@microsoft.com"
      git config --global http.extraheader "AUTHORIZATION: bearer $SYSTEM_ACCESSTOKEN"
      
      # Create and commit changes
      git checkout -b "$BRANCH_NAME"
      git add ${config.artifactDir}
      
      if git diff --cached --quiet; then
        echo "No changes to commit"
        echo "##vso[task.setvariable variable=HAS_CHANGES]false"
      else
        git commit -m "chore: update APIM artifacts from \${{ parameters.ENVIRONMENT }} extract"
        git push origin "$BRANCH_NAME"
        echo "##vso[task.setvariable variable=HAS_CHANGES]true"
        echo "##vso[task.setvariable variable=BRANCH_NAME]$BRANCH_NAME"
        echo "Branch '$BRANCH_NAME' created and pushed successfully"
      fi
    displayName: 'Create branch with changes'
    env:
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)

  - task: PowerShell@2
    displayName: 'Create pull request'
    condition: and(succeeded(), eq(variables['HAS_CHANGES'], 'true'))
    env:
      AZURE_DEVOPS_EXT_PAT: $(System.AccessToken)
    inputs:
      targetType: 'inline'
      pwsh: true
      script: |
        $branchName = "$(BRANCH_NAME)"
        $title = "chore: APIM \${{ parameters.ENVIRONMENT }} extract (Build $(Build.BuildId))"
        $description = "Automated extraction of APIM artifacts from **\${{ parameters.ENVIRONMENT }}** environment.\`n\`nBuild: [$(Build.BuildId)]($(System.TeamFoundationCollectionUri)$(System.TeamProject)/_build/results?buildId=$(Build.BuildId))"
        
        Write-Host "Creating pull request from branch: $branchName"
        
        az repos pr create \`
          --organization "$(System.TeamFoundationCollectionUri)" \`
          --project "$(System.TeamProject)" \`
          --repository "$(Build.Repository.Name)" \`
          --source-branch "$branchName" \`
          --target-branch "$(Build.SourceBranchName)" \`
          --title "$title" \`
          --description "$description" \`
          --auto-complete false \`
          --output table
        
        if ($LASTEXITCODE -eq 0) {
          Write-Host "##[section]✅ Pull request created successfully"
        } else {
          Write-Host "##[error]Failed to create pull request"
          exit 1
        }
`;
}
