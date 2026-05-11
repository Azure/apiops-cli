/**
 * Unit tests for T044: GitHub Actions publish workflow template
 */

import { describe, it, expect } from 'vitest';
import { generatePublishWorkflow } from '../../../../src/templates/github-actions/publish-workflow.js';

describe('github-actions/publish-workflow', () => {
  describe('generatePublishWorkflow', () => {
    it('should generate workflow with correct name', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('name: Run APIM Publisher');
    });

    it('should include push trigger on main branch', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('push:');
      expect(workflow).toContain('branches:');
      expect(workflow).toContain('- main');
    });

    it('should include path filters for artifact directory', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './custom-dir',
        environments: ['dev'],
      });
      expect(workflow).toContain("paths:");
      expect(workflow).toContain("- './custom-dir/**'");
    });

    it('should include path filters for configuration files', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(workflow).toContain("- 'configuration.*.yaml'");
    });

    it('should include COMMIT_ID_CHOICE workflow_dispatch input', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('COMMIT_ID_CHOICE:');
      expect(workflow).toContain('type: choice');
      expect(workflow).toContain('publish-artifacts-in-last-commit');
      expect(workflow).toContain('publish-all-artifacts-in-repo');
    });

    it('should include ENVIRONMENT workflow_dispatch input with environment options', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('ENVIRONMENT:');
      expect(workflow).toContain('- dev');
      expect(workflow).toContain('- prod');
    });

    it('should include get-commit job', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(workflow).toContain('get-commit:');
      expect(workflow).toContain('commit_id');
      expect(workflow).toContain('GITHUB_SHA');
    });

    it('should create job for each environment', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
      });
      expect(workflow).toContain('publish-dev:');
      expect(workflow).toContain('publish-staging:');
      expect(workflow).toContain('publish-prod:');
    });

    it('should set environment for each job', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('environment: dev');
      expect(workflow).toContain('environment: prod');
    });

    it('should include chained needs hints in comments for sequential deployment', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
      });
      // Chaining hints appear as comments for opt-in sequential deployment
      expect(workflow).toContain('needs: [get-commit, publish-dev]');
      expect(workflow).toContain('needs: [get-commit, publish-staging]');
    });

    it('should have all environment jobs depend on get-commit', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('needs: get-commit');
    });

    it('should have conditional steps for incremental vs all artifacts publish', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(workflow).toContain('incremental - last commit only');
      expect(workflow).toContain('all artifacts');
      expect(workflow).toContain("!= 'publish-all-artifacts-in-repo'");
      expect(workflow).toContain("== 'publish-all-artifacts-in-repo'");
    });

    it('should pass commit_id from get-commit job in incremental step', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(workflow).toContain('--commit-id ${{ needs.get-commit.outputs.commit_id }}');
    });

    it('should not pass commit_id in all-artifacts step', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const lines = workflow.split('\n');
      const allArtifactsStart = lines.findIndex((l) => l.includes('all artifacts'));
      const allArtifactsSection = lines.slice(allArtifactsStart, allArtifactsStart + 15).join('\n');
      expect(allArtifactsSection).not.toContain('--commit-id');
    });

    it('should filter jobs by ENVIRONMENT input', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain("ENVIRONMENT == 'dev'");
      expect(workflow).toContain("ENVIRONMENT == 'prod'");
    });

    it('should use environment-specific secrets', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('${{ secrets.APIM_RESOURCE_GROUP_DEV }}');
      expect(workflow).toContain('${{ secrets.APIM_SERVICE_NAME_DEV }}');
      expect(workflow).toContain('${{ secrets.APIM_RESOURCE_GROUP_PROD }}');
      expect(workflow).toContain('${{ secrets.APIM_SERVICE_NAME_PROD }}');
    });

    it('should use environment-specific secrets for resource group and service name', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('${{ secrets.APIM_RESOURCE_GROUP_DEV }}');
      expect(workflow).toContain('${{ secrets.APIM_SERVICE_NAME_DEV }}');
      expect(workflow).toContain('${{ secrets.APIM_RESOURCE_GROUP_PROD }}');
      expect(workflow).toContain('${{ secrets.APIM_SERVICE_NAME_PROD }}');
    });

    it('should have id-token write permission for OIDC', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(workflow).toContain('permissions:');
      expect(workflow).toContain('id-token: write');
    });

    it('should have contents read permission', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(workflow).toContain('contents: read');
    });

    it('should checkout with fetch-depth 2 for git diff', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(workflow).toContain('fetch-depth: 2');
    });

    it('should use npm install to install dependencies', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(workflow).toContain('npm install');
      expect(workflow).toContain('npx apiops publish');
    });

    it('should enable first environment to run automatically on push to main', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      // First environment's if-condition must include the push event trigger
      expect(workflow).toContain("ENVIRONMENT == 'dev' || github.event_name == 'push'");
    });

    it('should not auto-trigger subsequent environments on push to main', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
      });
      // staging and prod must NOT include the push trigger in their active if-conditions
      // (they may appear in comments but not as live conditions)
      const lines = workflow.split('\n');

      for (const env of ['staging', 'prod']) {
        const jobStart = lines.findIndex((l) => l.includes(`publish-${env}:`));
        // Find the actual `if:` line (not a comment) within the next 10 lines
        const jobLines = lines.slice(jobStart, jobStart + 10);
        const ifLine = jobLines.find((l) => l.trimStart().startsWith('if:') && !l.trimStart().startsWith('#'));
        expect(ifLine).toBeDefined();
        expect(ifLine).not.toContain('event_name');
      }
    });

    it('should pass commit_id on push trigger via incremental step condition', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      // The incremental step condition is true when COMMIT_ID_CHOICE is empty (push trigger),
      // so --commit-id will be passed automatically on push.
      expect(workflow).toContain("COMMIT_ID_CHOICE != 'publish-all-artifacts-in-repo'");
      expect(workflow).toContain('--commit-id ${{ needs.get-commit.outputs.commit_id }}');
    });
  });
});
