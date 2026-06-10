// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
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

    it('should chain jobs with needs dependencies', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
      });
      expect(workflow).toContain('needs: [get-commit, publish-dev]');
      expect(workflow).toContain('needs: [get-commit, publish-staging]');
    });

    it('should have first environment depend on get-commit only', () => {
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

    it('should include token substitution step before publish', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('cschleiden/replace-tokens@v1.3');
      expect(workflow).toContain("tokenPrefix: '{#['");
      expect(workflow).toContain("tokenSuffix: ']#}'");
    });

    it('should target environment-specific configuration file for token substitution', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('files: \'["configuration.dev.yaml"]\'');
      expect(workflow).toContain('files: \'["configuration.prod.yaml"]\'');
    });

    it('should place token substitution step before publish steps', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const tokenIdx = workflow.indexOf('cschleiden/replace-tokens');
      const publishIdx = workflow.indexOf('npx apiops publish');
      expect(tokenIdx).toBeGreaterThan(0);
      expect(tokenIdx).toBeLessThan(publishIdx);
    });
  });
});
