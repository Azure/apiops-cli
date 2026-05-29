// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T048: Identity setup guide generator
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

    it('should include service principal creation steps', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('Create Service Principal');
      expect(guide).toContain('az ad app create');
      expect(guide).toContain('az ad sp create');
    });

    it('should include RBAC role assignment steps', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('Assign RBAC Roles');
      expect(guide).toContain('API Management Service Contributor');
      expect(guide).toContain('az role assignment create');
    });

    it('should include federated credentials setup', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('Configure Federated Credentials');
      expect(guide).toContain('az ad app federated-credential create');
      expect(guide).toContain('token.actions.githubusercontent.com');
    });

    it('should include GitHub secrets configuration', () => {
      const guide = identityGuideService.generateGitHubActionsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('Configure GitHub Secrets');
      expect(guide).toContain('AZURE_CLIENT_ID');
      expect(guide).toContain('AZURE_TENANT_ID');
      expect(guide).toContain('AZURE_SUBSCRIPTION_ID');
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
    it('should include subscription ID in guide', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide(
        'sub-12345',
        'my-rg',
        ['dev', 'prod']
      );
      expect(guide).toContain('sub-12345');
    });

    it('should include resource group in guide', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).toContain('my-rg');
    });

    it('should render all template placeholders', () => {
      const guide = identityGuideService.generateAzureDevOpsGuide(
        'sub-12345',
        'my-rg',
        ['dev']
      );
      expect(guide).not.toContain('{{');
      expect(guide).not.toContain('}}');
    });

  });
});
