// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Identity setup guide generator
 */

import { describe, it, expect } from 'vitest';
import { identityGuideService } from '../../../src/services/identity-guide-service.js';

describe('identity-guide-service', () => {
  describe('generateGitHubActionsGuide', () => {
    it('should include subscription ID in guide', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev', 'prod']
      );
      expect(guide).toContain('sub-12345');
    });

    it('should include resource group in guide', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('my-rg');
    });

    it('should mention the Copilot prompt file and UI flow', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('.github/prompts/apiops-setup-workflow-identity.prompt.md');
      expect(guide).toContain('Azure portal');
      expect(guide).toContain('GitHub web UI');
    });

    it('should explain the GitHub identity distinction', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('GITHUB_TOKEN');
      expect(guide).toContain('only for Azure and APIM access');
    });

    it('should include portal-based Azure access steps', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('API Management Service Contributor');
      expect(guide).toContain('Access control (IAM)');
      expect(guide).toContain('Federated credentials');
    });

    it('should include documentation links', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('https://learn.microsoft.com/');
      expect(guide).toContain('https://docs.github.com/');
    });

    it('should include environment-specific secrets for each environment', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev', 'staging', 'prod']
      );
      expect(guide).toContain('dev environment');
      expect(guide).toContain('staging environment');
      expect(guide).toContain('prod environment');
      expect(guide).toContain('APIM_RESOURCE_GROUP_DEV');
      expect(guide).toContain('APIM_RESOURCE_GROUP_STAGING');
      expect(guide).toContain('APIM_RESOURCE_GROUP_PROD');
    });

    it('should include security notes', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('Security Notes');
      expect(guide).toContain('least-privilege');
    });

    it('should create federated credential for each environment', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev', 'prod']
      );
      expect(guide).toContain('github-env-dev');
      expect(guide).toContain('github-env-prod');
      expect(guide).toContain('environment:dev');
      expect(guide).toContain('environment:prod');
    });

    it('should render all template placeholders', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).not.toContain('{{');
      expect(guide).not.toContain('}}');
    });
  });

  describe('generateAzureDevOpsGuide', () => {
    it('should mention the Copilot prompt file and UI flow', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide(['dev', 'prod']);
      expect(guide).toContain('.github/prompts/apiops-setup-pipeline-identity.prompt.md');
      expect(guide).toContain('Azure DevOps web portal');
      expect(guide).toContain('Azure portal');
    });

    it('should explain the Azure DevOps identity distinction', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide(['dev', 'prod']);
      expect(guide).toContain('Build Service identity');
      expect(guide).toContain('separate from the Azure app registration');
      expect(guide).toContain('Create pull request');
    });

    it('should include environment-specific service connections and variable groups', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide(['dev', 'prod']);
      expect(guide).toContain('AZURE_SERVICE_CONNECTION_DEV');
      expect(guide).toContain('AZURE_SERVICE_CONNECTION_PROD');
      expect(guide).toContain('apim-dev');
      expect(guide).toContain('apim-prod');
      expect(guide).toContain('AZURE_SERVICE_CONNECTION');
      expect(guide).toContain('APIM_RESOURCE_GROUP_DEV');
      expect(guide).toContain('APIM_SERVICE_NAME_PROD');
    });

    it('should render all template placeholders', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide(['dev']);
      expect(guide).not.toMatch(/\{\{[^}]+\}\}/);
    });

  });
});
