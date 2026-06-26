// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Azure DevOps publish pipeline template
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

    it('should include ENVIRONMENT parameter with per-env options only', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('name: ENVIRONMENT');
      expect(pipeline).toContain("default: 'dev'");
      expect(pipeline).toContain("- 'dev'");
      expect(pipeline).toContain("- 'prod'");
    });

    it('should create a single parameterized publish stage', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
      });
      expect(pipeline).toContain('stage: Publish');
      expect(pipeline).not.toContain('stage: Publish_dev');
      expect(pipeline).not.toContain('stage: Publish_staging');
      expect(pipeline).not.toContain('stage: Publish_prod');
    });

    it('should not chain stages with dependsOn', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
      });
      expect(pipeline).not.toContain('dependsOn: Publish');
    });

    it('should drive the stage from the ENVIRONMENT parameter', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain("displayName: 'Publish to ${{ parameters.ENVIRONMENT }}'");
      expect(pipeline).not.toContain("eq('${{ parameters.ENVIRONMENT }}', 'dev')");
    });

    it('should select the variable group from the ENVIRONMENT parameter', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('- group: apim-${{ parameters.ENVIRONMENT }}');
    });

    it('should use deployment job with environment', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('deployment: Deploy');
      expect(pipeline).toContain('environment: ${{ parameters.ENVIRONMENT }}');
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
      expect(pipeline).toContain("and(succeeded(), ne('${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))");
      expect(pipeline).toContain("and(succeeded(), eq('${{ parameters.COMMIT_ID_CHOICE }}', 'publish-all-artifacts-in-repo'))");
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
      const allArtStart = lines.findIndex((l) => l.includes("Publish (all artifacts)"));
      // Find the next step or stage boundary after the all-artifacts step
      const sectionEnd = lines.findIndex((l, i) => i > allArtStart + 1 && (l.includes('- task:') || l.includes('- stage:')));
      const end = sectionEnd === -1 ? lines.length : sectionEnd;
      const allArtSection = lines.slice(allArtStart, end).join('\n');
      expect(allArtSection).not.toContain('--commit-id');
    });

    it('should select the service connection from the ENVIRONMENT parameter', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain("azureSubscription: 'AZURE_SERVICE_CONNECTION_${{ upper(parameters.ENVIRONMENT) }}'");
    });

    it('should reference env-suffixed resource group and service name via parameter', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('$(APIM_RESOURCE_GROUP_${{ upper(parameters.ENVIRONMENT) }})');
      expect(pipeline).toContain('$(APIM_SERVICE_NAME_${{ upper(parameters.ENVIRONMENT) }})');
    });

    it('should reference the env-specific override file via parameter', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('--overrides configuration.${{ parameters.ENVIRONMENT }}.yaml');
    });

    it('should use lockfile-aware dependency install', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then');
      expect(pipeline).toContain('npm ci');
      expect(pipeline).toContain('npm install');
      expect(pipeline).toContain('npx apiops publish');
    });

    it('should include token substitution step before publish', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('replacetokens@6');
      expect(pipeline).toContain("tokenPattern: 'custom'");
      expect(pipeline).toContain("tokenPrefix: '{#['");
      expect(pipeline).toContain("tokenSuffix: ']#}'");
      expect(pipeline).toContain("missingVarAction: 'keep'");
      expect(pipeline).toContain("missingVarLog: 'error'");
    });

    it('should validate unresolved tokens after substitution', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('Validate token substitution');
      expect(pipeline).toContain("grep -q '{#\\[' configuration.${{ parameters.ENVIRONMENT }}.yaml");
    });

    it('should target the parameterized configuration file for token substitution', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain("sources: 'configuration.${{ parameters.ENVIRONMENT }}.yaml'");
    });

    it('should place token substitution step before publish steps', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const tokenIdx = pipeline.indexOf('replacetokens@6');
      const publishIdx = pipeline.indexOf('npx apiops publish');
      expect(tokenIdx).toBeGreaterThan(0);
      expect(tokenIdx).toBeLessThan(publishIdx);
    });

    it('should include dry-run validation steps before publish steps', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(pipeline).toContain('Dry-run validation (incremental)');
      expect(pipeline).toContain('Dry-run validation (all artifacts)');
    });

    it('should include --dry-run flag in dry-run validation steps', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const lines = pipeline.split('\n');
      const dryRunIncrIdx = lines.findIndex((l) => l.includes('Dry-run validation (incremental)'));
      const dryRunSection = lines.slice(dryRunIncrIdx, dryRunIncrIdx + 20).join('\n');
      expect(dryRunSection).toContain('--dry-run');
    });

    it('should place dry-run validation before actual publish steps', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const dryRunIdx = pipeline.indexOf('Dry-run validation (incremental)');
      const publishIdx = pipeline.indexOf("Publish (incremental");
      expect(dryRunIdx).toBeGreaterThan(0);
      expect(dryRunIdx).toBeLessThan(publishIdx);
    });

    it('should include dry-run validation steps for the parameterized environment', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(pipeline).toContain('Dry-run validation (incremental)');
      expect(pipeline).toContain('Dry-run validation (all artifacts)');
    });

    it('should pass commit-id in incremental dry-run step', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const lines = pipeline.split('\n');
      const dryRunIncrIdx = lines.findIndex((l) => l.includes('Dry-run validation (incremental)'));
      const nextTaskIdx = lines.findIndex((l, i) => i > dryRunIncrIdx + 1 && l.includes("- task:"));
      const dryRunSection = lines.slice(dryRunIncrIdx, nextTaskIdx).join('\n');
      expect(dryRunSection).toContain('--commit-id');
      expect(dryRunSection).toContain('--dry-run');
    });

    it('should not pass commit-id in all-artifacts dry-run step', () => {
      const pipeline = generatePublishPipeline({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const lines = pipeline.split('\n');
      const dryRunAllIdx = lines.findIndex((l) => l.includes('Dry-run validation (all artifacts)'));
      const nextTaskIdx = lines.findIndex((l, i) => i > dryRunAllIdx + 1 && l.includes("- task:"));
      const dryRunSection = lines.slice(dryRunAllIdx, nextTaskIdx).join('\n');
      expect(dryRunSection).not.toContain('--commit-id');
      expect(dryRunSection).toContain('--dry-run');
    });
  });
});
