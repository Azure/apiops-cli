/**
 * Unit tests for Azure DevOps Copilot identity setup prompt template
 */

import { describe, it, expect } from 'vitest';
import { generateIdentitySetupAzdoPrompt } from '../../../../src/templates/copilot/identity-setup-azdo-prompt.js';

describe('copilot/identity-setup-azdo-prompt', () => {
  describe('generateIdentitySetupAzdoPrompt', () => {
    it('should generate a prompt with the correct title', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('# Setup Azure DevOps Identity for APIOps');
    });

    it('should include all step sections (Step 0 through Step 9)', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('## Step 0');
      expect(prompt).toContain('## Step 1');
      expect(prompt).toContain('## Step 2');
      expect(prompt).toContain('## Step 3');
      expect(prompt).toContain('## Step 4');
      expect(prompt).toContain('## Step 5');
      expect(prompt).toContain('## Step 6');
      expect(prompt).toContain('## Step 7');
      expect(prompt).toContain('## Step 8');
      expect(prompt).toContain('## Step 9');
    });

    it('should ask Copilot to gather information from the user', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('Gather Information');
      expect(prompt).toContain('SUBSCRIPTION_ID');
      expect(prompt).toContain('RESOURCE_GROUP');
      expect(prompt).toContain('APP_NAME');
      expect(prompt).toContain('AZDO_ORG');
      expect(prompt).toContain('ORG_NAME');
      expect(prompt).toContain('AZDO_PROJECT');
    });

    it('should include per-environment variables in gather table', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('APIM_RG_DEV');
      expect(prompt).toContain('APIM_NAME_DEV');
      expect(prompt).toContain('APIM_RG_PROD');
      expect(prompt).toContain('APIM_NAME_PROD');
    });

    it('should include service principal creation commands', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('az ad sp create-for-rbac');
      expect(prompt).toContain('API Management Service Contributor');
      expect(prompt).toContain('python3 -c "import sys,json');
      expect(prompt).toContain('APP_ID=$(echo "$SP_OUTPUT"');
      expect(prompt).toContain('PASSWORD=$(echo "$SP_OUTPUT"');
      expect(prompt).toContain('TENANT_ID=$(echo "$SP_OUTPUT"');
    });

    it('should include Azure DevOps CLI configuration commands', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('az extension add --name azure-devops');
      expect(prompt).toContain('az devops configure --defaults');
      expect(prompt).toContain('SUBSCRIPTION_NAME=$(az account show');
    });

    it('should include base service connection creation command', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('az devops service-endpoint azurerm create');
      expect(prompt).toContain('--name "AZURE_SERVICE_CONNECTION"');
      expect(prompt).toContain('--azure-rm-service-principal-id "$APP_ID"');
      expect(prompt).toContain('--azure-rm-subscription-id "$SUBSCRIPTION_ID"');
      expect(prompt).toContain('--azure-rm-tenant-id "$TENANT_ID"');
    });

    it('should include per-environment service connection creation commands', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('# Create service connection for dev environment');
      expect(prompt).toContain('# Create service connection for prod environment');
      expect(prompt).toContain('env_upper=$(echo "dev" | tr \'[:lower:]\' \'[:upper:]\')');
      expect(prompt).toContain('env_upper=$(echo "prod" | tr \'[:lower:]\' \'[:upper:]\')');
      expect(prompt).toContain('--name "AZURE_SERVICE_CONNECTION_${env_upper}"');
    });

    it('should include service connection verification command', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('az devops service-endpoint list');
    });

    it('should include password environment variable setup and cleanup', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('export AZURE_DEVOPS_EXT_AZURE_RM_SERVICE_PRINCIPAL_KEY="$PASSWORD"');
      expect(prompt).toContain('unset AZURE_DEVOPS_EXT_AZURE_RM_SERVICE_PRINCIPAL_KEY');
    });

    it('should include common variable group creation command', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('az pipelines variable-group create');
      expect(prompt).toContain('--name "apim-common"');
      expect(prompt).toContain('AZURE_SUBSCRIPTION_ID="${SUBSCRIPTION_ID}"');
      expect(prompt).toContain('APIM_RESOURCE_GROUP="${RESOURCE_GROUP}"');
    });

    it('should include per-environment variable group creation commands', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('# Create variable group for dev environment');
      expect(prompt).toContain('# Create variable group for prod environment');
      expect(prompt).toContain('--name "apim-dev"');
      expect(prompt).toContain('--name "apim-prod"');
      expect(prompt).toContain('APIM_RESOURCE_GROUP="${APIM_RG_DEV}"');
      expect(prompt).toContain('APIM_SERVICE_NAME="${APIM_NAME_DEV}"');
      expect(prompt).toContain('APIM_RESOURCE_GROUP="${APIM_RG_PROD}"');
      expect(prompt).toContain('APIM_SERVICE_NAME="${APIM_NAME_PROD}"');
    });

    it('should include variable group authorization commands', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('for id in $(az pipelines variable-group list');
      expect(prompt).toContain('az pipelines variable-group update --group-id "$id" --authorize true');
    });

    it('should include variable group verification command', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('az pipelines variable-group list --query "[].name" -o table');
    });

    it('should include environment creation commands', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('# Create dev environment');
      expect(prompt).toContain('# Create prod environment');
      expect(prompt).toContain('az devops invoke');
      expect(prompt).toContain('--area distributedtask');
      expect(prompt).toContain('--resource environments');
      expect(prompt).toContain('"name": "dev"');
      expect(prompt).toContain('"name": "prod"');
    });

    it('should include Build Service permission commands', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('BUILD_SERVICE_NAME="${AZDO_PROJECT} Build Service (${ORG_NAME})"');
      expect(prompt).toContain('az devops user show');
      expect(prompt).toContain('az devops security permission update');
      expect(prompt).toContain('--allow-bit 4');
    });

    it('should include pipeline creation commands', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('az pipelines create');
      expect(prompt).toContain('--name "APIM Extractor"');
      expect(prompt).toContain('--name "APIM Publisher"');
      expect(prompt).toContain('--yml-path ".azdo/pipelines/run-apim-extractor.yml"');
      expect(prompt).toContain('--yml-path ".azdo/pipelines/run-apim-publisher.yml"');
    });

    it('should include verification step with all checks', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('## Step 9 — Verify');
      expect(prompt).toContain('Service Connections:');
      expect(prompt).toContain('Variable Groups:');
      expect(prompt).toContain('Pipelines:');
    });

    it('should include Variable Groups Reference section', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('## Variable Groups Reference');
      expect(prompt).toContain('### apim-common');
      expect(prompt).toContain('### apim-dev');
      expect(prompt).toContain('### apim-prod');
    });

    it('should mention using the file with Copilot in VS Code', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('Open this file in VS Code with GitHub Copilot');
    });

    it('should include tool authentication check in Step 0', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('## Step 0 — Tool Authentication Check');
      expect(prompt).toContain('az version');
      expect(prompt).toContain('az account show');
      expect(prompt).toContain('az extension show --name azure-devops');
      expect(prompt).toContain('Tool Authentication Status:');
    });

    it('should include Azure DevOps extension installation instructions', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('Azure DevOps extension is required');
      expect(prompt).toContain('az extension add --name azure-devops');
    });

    it('should include error handling reminders', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('⚠️ **Error Handling:**');
      expect(prompt).toContain('stop immediately and show the user the full error output verbatim');
      expect(prompt).toContain('Do NOT retry silently');
    });

    it('should include security note about password handling', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('⚠️ **Security Note:**');
      expect(prompt).toContain('service principal password is set via environment variable');
    });

    it('should include note about environment approvals', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('Environment approvals and checks must be configured via the Azure DevOps UI');
      expect(prompt).toContain('Pipelines → Environments');
    });

    it('should only use bash commands (no PowerShell)', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).not.toContain('PowerShell');
      expect(prompt).not.toContain('$env:');
      expect(prompt).not.toContain('.ps1');
      // Should have bash-specific patterns
      expect(prompt).toContain('```bash');
      expect(prompt).toContain('export ');
      expect(prompt).toContain('unset ');
    });

    it('should populate per-environment variables correctly with multiple environments', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev', 'staging', 'prod'] });
      
      // Check gather table includes all environments
      expect(prompt).toContain('APIM_RG_DEV');
      expect(prompt).toContain('APIM_NAME_DEV');
      expect(prompt).toContain('APIM_RG_STAGING');
      expect(prompt).toContain('APIM_NAME_STAGING');
      expect(prompt).toContain('APIM_RG_PROD');
      expect(prompt).toContain('APIM_NAME_PROD');

      // Check service connections for all environments
      expect(prompt).toContain('# Create service connection for dev environment');
      expect(prompt).toContain('# Create service connection for staging environment');
      expect(prompt).toContain('# Create service connection for prod environment');

      // Check variable groups for all environments
      expect(prompt).toContain('--name "apim-dev"');
      expect(prompt).toContain('--name "apim-staging"');
      expect(prompt).toContain('--name "apim-prod"');

      // Check environments creation
      expect(prompt).toContain('"name": "dev"');
      expect(prompt).toContain('"name": "staging"');
      expect(prompt).toContain('"name": "prod"');

      // Check variable groups reference
      expect(prompt).toContain('### apim-dev');
      expect(prompt).toContain('### apim-staging');
      expect(prompt).toContain('### apim-prod');
    });

    it('should include expected output in verification step', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('Expected output:');
      expect(prompt).toContain('AZURE_SERVICE_CONNECTION_DEV');
      expect(prompt).toContain('AZURE_SERVICE_CONNECTION_PROD');
    });

    it('should include testing instructions', () => {
      const prompt = generateIdentitySetupAzdoPrompt({ environments: ['dev'] });
      expect(prompt).toContain('To test the extract pipeline');
      expect(prompt).toContain('APIM Extractor');
      expect(prompt).toContain('Run pipeline');
    });
  });
});
