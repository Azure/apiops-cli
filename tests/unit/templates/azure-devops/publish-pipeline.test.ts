// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T046: Azure DevOps publish pipeline template
 */

import { describe, it, expect } from 'vitest';
import { generatePublishPipeline } from '../../../../src/templates/azure-devops/publish-pipeline.js';

describe('azure-devops/publish-pipeline', () => {
  describe('generatePublishPipeline', () => {
    it('should generate pipeline with correct header', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('# Azure DevOps Pipeline: Run APIM Publisher');
    });

    it('should trigger on main branch', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('trigger:');
      expect(pipeline).toContain('branches:');
      expect(pipeline).toContain('include:');
      expect(pipeline).toContain('- main');
    });

    it('should include path filters for artifact directory', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './custom-dir',
        environments: ['dev'],
      });
      expect(pipeline).toContain('paths:');
      expect(pipeline).toContain('include:');
      expect(pipeline).toContain("- './custom-dir/**'");
    });

    it('should include path filters for configuration files', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain("- 'configuration.*.yaml'");
    });

    it('should have pr: none', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('pr: none');
    });

    it('should include COMMIT_ID_CHOICE parameter', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('name: COMMIT_ID_CHOICE');
      expect(pipeline).toContain("'publish-artifacts-in-last-commit'");
      expect(pipeline).toContain("'publish-all-artifacts-in-repo'");
    });

    it('should include ENVIRONMENT parameter with all and per-env options', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('name: ENVIRONMENT');
      expect(pipeline).toContain("- 'all'");
      expect(pipeline).toContain("- 'dev'");
      expect(pipeline).toContain("- 'prod'");
    });

    it('should create stage for each environment', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
      });
      expect(pipeline).toContain('stage: Publish_dev');
      expect(pipeline).toContain('stage: Publish_staging');
      expect(pipeline).toContain('stage: Publish_prod');
    });

    it('should chain stages with dependsOn', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
      });
      expect(pipeline).toContain('dependsOn: Publish_dev');
      expect(pipeline).toContain('dependsOn: Publish_staging');
    });

    it('should filter stages by ENVIRONMENT parameter', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain("eq('${{ parameters.ENVIRONMENT }}', 'dev')");
      expect(pipeline).toContain("eq('${{ parameters.ENVIRONMENT }}', 'prod')");
      expect(pipeline).toContain("eq('${{ parameters.ENVIRONMENT }}', 'all')");
    });

    it('should use environment-specific variable groups', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('- group: apim-dev');
      expect(pipeline).toContain('- group: apim-prod');
    });

    it('should use deployment job with environment', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('deployment: Deploy');
      expect(pipeline).toContain('environment: dev');
    });

    it('should use runOnce deployment strategy', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('strategy:');
      expect(pipeline).toContain('runOnce:');
      expect(pipeline).toContain('deploy:');
    });

    it('should checkout repository with fetchDepth 2 for git diff', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('checkout: self');
      expect(pipeline).toContain('fetchDepth: 2');
    });

    it('should have conditional steps for incremental vs all artifacts publish', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('incremental - last commit only');
      expect(pipeline).toContain('all artifacts');
      expect(pipeline).toContain("ne('${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo')");
      expect(pipeline).toContain("eq('${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo')");
    });

    it('should pass Build.SourceVersion as commit-id in incremental step', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('--commit-id $(Build.SourceVersion)');
    });

    it('should not pass commit-id in all-artifacts step', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const lines = pipeline.split('\n');
      const allArtStart = lines.findIndex((l) => l.includes("Publish to dev (all artifacts)"));
      // Find the next step or stage boundary after the all-artifacts step
      const sectionEnd = lines.findIndex((l, i) => i > allArtStart + 1 && (l.includes('- task:') || l.includes('- stage:')));
      const end = sectionEnd === -1 ? lines.length : sectionEnd;
      const allArtSection = lines.slice(allArtStart, end).join('\n');
      expect(allArtSection).not.toContain('--commit-id');
    });

    it('should use environment-specific service connection', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('$(AZURE_SERVICE_CONNECTION_DEV)');
      expect(pipeline).toContain('$(AZURE_SERVICE_CONNECTION_PROD)');
    });

    it('should use environment-specific resource group and service name', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('$(APIM_RESOURCE_GROUP_DEV)');
      expect(pipeline).toContain('$(APIM_SERVICE_NAME_DEV)');
      expect(pipeline).toContain('$(APIM_RESOURCE_GROUP_PROD)');
      expect(pipeline).toContain('$(APIM_SERVICE_NAME_PROD)');
    });

    it('should use environment-specific override files', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('--override configuration.dev.yaml');
      expect(pipeline).toContain('--override configuration.prod.yaml');
    });

    it('should use npm ci to install dependencies (uses tgz from package.json)', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('npm ci');
      expect(pipeline).toContain('npx apiops publish');
    });
  });
});
