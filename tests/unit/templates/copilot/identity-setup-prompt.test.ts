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

    it('should detect and resolve existing secret conflicts before writing', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev', 'prod'] });

      expect(prompt).toContain('Never overwrite an existing secret silently');
      expect(prompt).toContain('gh secret list --repo');
      expect(prompt).toContain('--env "dev" --json name');
      expect(prompt).toContain('--env "prod" --json name');
      expect(prompt).toContain('**Overwrite**');
      expect(prompt).toContain('**Rename**');
      expect(prompt).toContain('**Reuse**');
      expect(prompt).toContain('skip its `gh secret set` command');
      expect(prompt).toContain('case-insensitive reserved-name set');
      expect(prompt).toContain('add each chosen name immediately');
      expect(prompt).toContain('not starting with `GITHUB_`');
    });

    it('should update workflow references and summarize secret decisions', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });

      expect(prompt).toContain('secrets.AZURE_CLIENT_ID');
      expect(prompt).toContain('.github/workflows/');
      expect(prompt).toContain("secrets[format('APIM_RESOURCE_GROUP_{0}', ...)]");
      expect(prompt).toContain('environment-keyed expression that covers every environment mapping');
      expect(prompt).toContain('retain the original computed lookup as the fallback');
      expect(prompt).toContain('environment-scoped `AZURE_SUBSCRIPTION_ID` renames');
      expect(prompt).toContain('scope-aware mapping');
      expect(prompt).toContain('Show the complete mapping and proposed file changes');
      expect(prompt).toContain('**created**, **overwritten**, **renamed**, or **reused**');
      expect(prompt).toContain('Never print secret values');
    });

    it('should target the selected repository for every secret write', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      const setCommands = prompt.split('\n').filter(line => line.startsWith('gh secret set '));
      const listCommands = prompt.split('\n').filter(line => line.startsWith('gh secret list '));

      expect(setCommands.length).toBeGreaterThan(0);
      expect(listCommands.length).toBe(2);
      expect(listCommands.every(line => line.includes('--repo "${GITHUB_ORG}/${GITHUB_REPO}"'))).toBe(true);
      expect(setCommands.every(line => line.includes('--repo "${GITHUB_ORG}/${GITHUB_REPO}"'))).toBe(true);
      expect(setCommands.filter(line => line.includes('--env ')).every(line => line.includes('--env "dev"'))).toBe(true);
    });

    it('should safely render custom environment names used in shell variables', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['qa_east_2'] });

      expect(prompt).toContain('--env "qa_east_2"');
      expect(prompt).toContain('APIM_RESOURCE_GROUP_QA_EAST_2');
    });

    it('should reject GitHub environment names that are unsafe in generated commands', () => {
      expect(() => generateIdentitySetupPrompt({ environments: ['qa east'] })).toThrow(
        'Invalid GitHub environment name "qa east"'
      );
      expect(() => generateIdentitySetupPrompt({ environments: ['qa"east'] })).toThrow(
        'Invalid GitHub environment name'
      );
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

    it('should include the GitHub identity distinction note', () => {
      const prompt = generateIdentitySetupPrompt({ environments: ['dev'] });
      expect(prompt).toContain('pull request creation automatically');
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
      expect(prompt).not.toMatch(/\{\{[^}]+\}\}/);
    });

    it('should generate Azure DevOps instructions when ciProvider is azure-devops', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).toContain('# Setup Azure DevOps Identity for APIOps');
      expect(prompt).toContain('WorkloadIdentityFederation');
      expect(prompt).toContain('service-endpoint create --service-endpoint-configuration');
      expect(prompt).toContain('az ad app federated-credential create');
      expect(prompt).not.toContain('gh secret set');
    });

    it('should include the Azure DevOps identity distinction note and UI guide context', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).toContain('Build Service identity');
    });

    it('should ask Copilot to gather per-environment APIM info for each ADO environment', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).toContain('APIM_SUBSCRIPTION_<ENV_UPPER>');
      expect(prompt).toContain('APIM_RG_<ENV_UPPER>');
      expect(prompt).toContain('APIM_NAME_<ENV_UPPER>');
    });

    it('should offer Option B resource ID shorthand per environment in ADO prompt', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).toContain('APIM_RESOURCE_ID_<ENV_UPPER>');
      expect(prompt).toContain('Option B');
    });

    it('should create one service connection per environment (not a shared base connection) in ADO prompt', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).toContain('AZURE_SERVICE_CONNECTION_$envUpper');
      expect(prompt).toContain('AZURE_SERVICE_CONNECTION_$env_upper');
      // No generic shared base connection
      expect(prompt).not.toContain('"AZURE_SERVICE_CONNECTION" --azure-rm-service-principal-id');
    });

    it('should create per-env variable groups with non-suffixed variable names in ADO prompt', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      // Groups are created inside environment loops
      expect(prompt).toContain('--name "apim-$env"');
      // Non-suffixed variable names inside the group
      expect(prompt).toContain('APIM_RESOURCE_GROUP=');
      expect(prompt).toContain('APIM_SERVICE_NAME=');
      expect(prompt).toContain('AZURE_SUBSCRIPTION_ID=');
    });

    it('should assign RBAC roles per environment in ADO prompt', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).toContain('API Management Service Contributor');
      expect(prompt).toContain('foreach ($env in $ENVIRONMENTS)');
      expect(prompt).toContain('for env in "${ENVIRONMENTS[@]}"; do');
    });

    it('should authorize environments for pipeline access in ADO prompt', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).toContain('pipelinePermissions/environment');
      expect(prompt).toContain('"allPipelines":{"authorized":true}');
    });

    it('should render environment arrays for PowerShell and Git Bash in ADO prompt', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).toContain('$ENVIRONMENTS = @("dev", "prod")');
      expect(prompt).toContain('ENVIRONMENTS=("dev" "prod")');
    });

    it('should not contain unresolved template placeholders in ADO prompt', () => {
      const prompt = generateIdentitySetupPrompt({
        environments: ['dev', 'prod'],
        ciProvider: 'azure-devops',
      });
      expect(prompt).not.toMatch(/\{\{[^}]+\}\}/);
    });
  });
});
