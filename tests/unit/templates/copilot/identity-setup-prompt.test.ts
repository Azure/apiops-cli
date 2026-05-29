// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for GitHub Copilot identity setup prompt template
 */

import { describe, it, expect } from 'vitest';
import { generateIdentitySetupPrompt } from '../../../../src/templates/copilot/identity-setup-prompt.js';

describe('copilot/identity-setup-prompt', () => {
  describe('generateIdentitySetupPrompt', () => {
    it('should generate a prompt with the correct title', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('# Setup GitHub Actions Identity for APIOps');
    });

    it('should include step-by-step sections', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('## Step 0');
      expect(prompt).toContain('## Step 1');
      expect(prompt).toContain('## Step 2');
      expect(prompt).toContain('## Step 3');
      expect(prompt).toContain('## Step 4');
      expect(prompt).toContain('## Step 5');
      expect(prompt).toContain('## Step 6');
      expect(prompt).toContain('## Step 7');
    });

    it('should ask Copilot to gather information from the user', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('Gather Information');
      expect(prompt).toContain('AZURE_SUBSCRIPTION_ID');
      expect(prompt).toContain('AZURE_TENANT_ID');
      expect(prompt).toContain('GITHUB_ORG');
      expect(prompt).toContain('GITHUB_REPO');
    });

    it('should include Azure AD app creation commands', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('az ad app create');
      expect(prompt).toContain('az ad sp create');
    });

    it('should include RBAC role assignment for each environment', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev', 'staging', 'prod'] });
      expect(prompt).toContain('API Management Service Contributor');
      expect(prompt).toContain('Assign role for dev');
      expect(prompt).toContain('Assign role for staging');
      expect(prompt).toContain('Assign role for prod');
    });

    it('should include federated credential commands for main branch', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('az ad app federated-credential create');
      expect(prompt).toContain('ref:refs/heads/main');
    });

    it('should include federated credential commands for each environment', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain(':environment:dev');
      expect(prompt).toContain(':environment:prod');
      expect(prompt).toContain('github-env-dev');
      expect(prompt).toContain('github-env-prod');
    });

    it('should include GitHub environment creation commands', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('gh api --method PUT');
      expect(prompt).toContain('environments/dev');
      expect(prompt).toContain('environments/prod');
    });

    it('should include gh secret set commands for repository secrets', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('gh secret set AZURE_CLIENT_ID');
      expect(prompt).toContain('gh secret set AZURE_TENANT_ID');
      expect(prompt).toContain('gh secret set AZURE_SUBSCRIPTION_ID');
    });

    it('should include per-environment secret set commands', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('gh secret set APIM_RESOURCE_GROUP_DEV');
      expect(prompt).toContain('gh secret set APIM_SERVICE_NAME_DEV');
      expect(prompt).toContain('gh secret set APIM_RESOURCE_GROUP_PROD');
      expect(prompt).toContain('gh secret set APIM_SERVICE_NAME_PROD');
    });

    it('should include per-environment secret set commands for resource group and service name', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('gh secret set APIM_RESOURCE_GROUP_DEV');
      expect(prompt).toContain('gh secret set APIM_SERVICE_NAME_DEV');
    });

    it('should include a secrets reference section', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('## Secrets Reference');
      expect(prompt).toContain('Repository Secrets');
      expect(prompt).toContain('Per-Environment Secrets');
    });

    it('should include environment-specific variable names in gather table', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).toContain('APIM_RG_DEV');
      expect(prompt).toContain('APIM_NAME_DEV');
      expect(prompt).toContain('APIM_RG_PROD');
      expect(prompt).toContain('APIM_NAME_PROD');
    });

    it('should mention using the file with Copilot in VS Code', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('Open this file in VS Code with GitHub Copilot');
    });

    it('should include tool authentication check in Step 0', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('## Step 0 — Tool Authentication Check');
      expect(prompt).toContain('az version');
      expect(prompt).toContain('az account show');
      expect(prompt).toContain('gh auth status');
      expect(prompt).toContain('Tool Authentication Status:');
    });

    it('should include platform-specific commands for Azure AD app creation', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('**On macOS/Linux (Bash):**');
      expect(prompt).toContain('**On Windows (PowerShell):**');
      expect(prompt).toContain('APP_ID=$(az ad app create');
      expect(prompt).toContain('$APP_ID = az ad app create');
    });

    it('should include platform-specific commands for federated credentials', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('**Platform Note:**');
      expect(prompt).toContain('different escaping on Windows PowerShell vs macOS/Linux Bash');
    });

    it('should include error handling reminders', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('⚠️ **Error Handling:**');
      expect(prompt).toContain('stop immediately and show the user the full error output verbatim');
      expect(prompt).toContain('Do NOT retry silently');
    });

    it('should include troubleshooting guidance in verification step', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('If the workflow fails with authentication errors');
      expect(prompt).toContain('RBAC permissions not yet propagated');
      expect(prompt).toContain('wait 5-10 minutes');
    });

    it('should render all template placeholders', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev', 'prod'] });
      expect(prompt).not.toContain('{{');
      expect(prompt).not.toContain('}}');
    });

    it('should generate Azure DevOps instructions when ciProvider is azure-devops', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).toContain('# Azure DevOps Identity Setup Guide');
      expect(prompt).toContain('az devops service-endpoint azurerm create');
      expect(prompt).not.toContain('gh secret set');
    });
  });
});
