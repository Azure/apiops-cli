// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T043: GitHub Actions extract workflow template
 */

import { describe, it, expect } from 'vitest';
import { generateExtractWorkflow } from '../../../../src/templates/github-actions/extract-workflow.js';

describe('github-actions/extract-workflow', () => {
  describe('generateExtractWorkflow', () => {
    it('should generate workflow with correct name', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('name: Run APIM Extractor');
    });

    it('should only have workflow_dispatch trigger (no schedule)', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('workflow_dispatch:');
      expect(workflow).not.toContain('schedule:');
      expect(workflow).not.toContain('cron:');
    });

    it('should include CONFIGURATION_YAML_PATH choice input', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('CONFIGURATION_YAML_PATH:');
      expect(workflow).toContain('type: choice');
      expect(workflow).toContain('Extract All APIs');
      expect(workflow).toContain('configuration.extract.yaml');
    });

    it('should include ENVIRONMENT choice input', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('ENVIRONMENT:');
      expect(workflow).toContain('type: choice');
      expect(workflow).toContain('- dev');
      expect(workflow).toContain('- prod');
    });

    it('should include Azure login step with federated credentials', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('Azure Login (Federated Credential)');
      expect(workflow).toContain('azure/login@v2');
      expect(workflow).toContain('${{ secrets.AZURE_CLIENT_ID }}');
      expect(workflow).toContain('${{ secrets.AZURE_TENANT_ID }}');
      expect(workflow).toContain('${{ secrets.AZURE_SUBSCRIPTION_ID }}');
    });

    it('should have conditional extract steps for All APIs vs With Configuration', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain("Run APIM Extract (All APIs)");
      expect(workflow).toContain("Run APIM Extract (With Configuration)");
      expect(workflow).toContain("== 'Extract All APIs'");
      expect(workflow).toContain("!= 'Extract All APIs'");
    });

    it('should not include --filter flag in All APIs step', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      const lines = workflow.split('\n');
      const allApisStart = lines.findIndex((l) => l.includes('Run APIM Extract (All APIs)'));
      const withConfigStart = lines.findIndex((l) => l.includes('Run APIM Extract (With Configuration)'));
      const allApisSection = lines.slice(allApisStart, withConfigStart).join('\n');
      expect(allApisSection).not.toContain('--filter');
    });

    it('should include --filter flag in With Configuration step', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      const lines = workflow.split('\n');
      const withConfigStart = lines.findIndex((l) => l.includes('Run APIM Extract (With Configuration)'));
      const withConfigSection = lines.slice(withConfigStart).join('\n');
      expect(withConfigSection).toContain('--filter configuration.extract.yaml');
    });

    it('should use custom artifact directory in extract command', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './custom-dir' });
      expect(workflow).toContain('--output ./custom-dir');
    });

    it('should include artifact upload step', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('Upload artifacts');
      expect(workflow).toContain('actions/upload-artifact@v4');
      expect(workflow).toContain('name: apim-artifacts');
    });

    it('should create a pull request instead of committing directly', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('create-pull-request:');
      expect(workflow).toContain('peter-evans/create-pull-request@v6');
      expect(workflow).toContain('labels: extract, automated pr');
      // Should NOT have direct git push to main
      expect(workflow).not.toContain('git push');
      expect(workflow).not.toContain('[skip ci]');
    });

    it('should have two jobs: extract and create-pull-request', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('extract:');
      expect(workflow).toContain('create-pull-request:');
      expect(workflow).toContain('needs: extract');
    });

    it('should download artifacts in the PR job', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('actions/download-artifact@v4');
    });

    it('should have id-token write permission for OIDC', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('permissions:');
      expect(workflow).toContain('id-token: write');
    });

    it('should have contents write and pull-requests write permissions', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('contents: write');
      expect(workflow).toContain('pull-requests: write');
    });

    it('should use npm install to install dependencies', () => {
      const workflow = generateExtractWorkflow({ artifactDir: './apim-artifacts' });
      expect(workflow).toContain('npm install');
      expect(workflow).toContain('npx apiops extract');
    });
  });
});
