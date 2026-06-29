// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Identity setup guide generator
 */

import { describe, it, expect } from 'vitest';
import { identityGuideService } from '../../../src/services/identity-guide-service.js';

describe('identity-guide-service', () => {
  describe('generateGitHubActionsGuide', () => {
    it('should return static GitHub Actions guide content', () => {
      const guide = identityGuideService.generateGitHubActionsGuide();
      expect(guide).toContain('APIOps GitHub Actions identity setup guide');
    });

    it('should mention the Copilot prompt file and UI flow', () => {
      const guide = identityGuideService.generateGitHubActionsGuide();
      expect(guide).toContain('.github/prompts/apiops-setup-workflow-identity.prompt.md');
      expect(guide).toContain('Azure portal');
      expect(guide).toContain('GitHub web UI');
    });

    it('should explain the GitHub identity distinction', () => {
      const guide = identityGuideService.generateGitHubActionsGuide();
      expect(guide).toContain('GITHUB_TOKEN');
      expect(guide).toContain('only for Azure and APIM access');
    });

    it('should include portal-based Azure access steps', () => {
      const guide = identityGuideService.generateGitHubActionsGuide();
      expect(guide).toContain('API Management Service Contributor');
      expect(guide).toContain('Access control (IAM)');
      expect(guide).toContain('Federated credentials');
    });

    it('should include documentation links', () => {
      const guide = identityGuideService.generateGitHubActionsGuide();
      expect(guide).toContain('https://learn.microsoft.com/');
      expect(guide).toContain('https://docs.github.com/');
    });

    it('should describe environment secrets generically', () => {
      const guide = identityGuideService.generateGitHubActionsGuide();
      expect(guide).toContain('APIM_RESOURCE_GROUP_<ENV>');
      expect(guide).toContain('APIM_SERVICE_NAME_<ENV>');
      expect(guide).toContain('For each environment');
    });

    it('should include security notes', () => {
      const guide = identityGuideService.generateGitHubActionsGuide();
      expect(guide).toContain('Security Notes');
      expect(guide).toContain('least-privilege');
    });

    it('should not contain any template placeholders', () => {
      const guide = identityGuideService.generateGitHubActionsGuide();
      expect(guide).not.toMatch(/\{\{[^}]+\}\}/);
    });
  });

  describe('generateAzureDevOpsGuide', () => {
    it('should return static Azure DevOps guide content', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide();
      expect(guide).toContain('Identity setup guide for APIOps extract and publish Azure DevOps Pipelines');
    });

    it('should mention the Copilot prompt file and UI flow', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide();
      expect(guide).toContain('.github/prompts/apiops-setup-pipeline-identity.prompt.md');
      expect(guide).toContain('Azure DevOps');
      expect(guide).toContain('Azure portal');
    });

    it('should explain the Azure DevOps identity distinction', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide();
      expect(guide).toContain('Build Service identity');
      expect(guide).toContain('separate from the Azure app registration');
      expect(guide).toContain('Create pull request');
    });

    it('should describe service connections and variable groups generically', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide();
      expect(guide).toContain('AZURE_SERVICE_CONNECTION_<ENV>');
      expect(guide).toContain('apim-<environment>');
      expect(guide).toContain('For each environment');
    });

    it('should not contain any template placeholders', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide();
      expect(guide).not.toMatch(/\{\{[^}]+\}\}/);
    });
  });
});
