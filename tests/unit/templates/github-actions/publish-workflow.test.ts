// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for GitHub Actions publish workflow template
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

    it('should create a single parameterized publish job', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
      });
      expect(workflow).toContain('publish:');
      expect(workflow).not.toContain('publish-dev:');
      expect(workflow).not.toContain('publish-staging:');
      expect(workflow).not.toContain('publish-prod:');
    });

    it('should drive the job environment from the ENVIRONMENT input', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain("environment: ${{ github.event.inputs.ENVIRONMENT || 'dev' }}");
      expect(workflow).not.toContain('environment: prod');
    });

    it('should define a workflow-level TARGET_ENV variable defaulting to the first environment', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain("TARGET_ENV: ${{ github.event.inputs.ENVIRONMENT || 'dev' }}");
    });

    it('should have the publish job depend on get-commit', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('needs: get-commit');
      expect(workflow).not.toContain('needs: [get-commit, publish-dev]');
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

    it('should select the target environment from the ENVIRONMENT input', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain("TARGET_ENV: ${{ github.event.inputs.ENVIRONMENT || 'dev' }}");
      expect(workflow).not.toContain("ENVIRONMENT == 'dev'");
    });

    it('should select env-suffixed secrets dynamically by environment', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain("${{ secrets[format('APIM_RESOURCE_GROUP_{0}', steps.env.outputs.upper)] }}");
      expect(workflow).toContain("${{ secrets[format('APIM_SERVICE_NAME_{0}', steps.env.outputs.upper)] }}");
    });

    it('should resolve an uppercase environment suffix for secret lookup', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('id: env');
      expect(workflow).toContain("tr '[:lower:]' '[:upper:]'");
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

    it('should target the parameterized configuration file for token substitution', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('files: \'["configuration.${{ env.TARGET_ENV }}.yaml"]\'');
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

    it('should validate unresolved tokens after substitution', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('Validate token source values');
      expect(workflow).toContain('AVAILABLE_SECRETS_JSON: ${{ toJSON(secrets) }}');
      expect(workflow).toContain("echo \"::error::Missing secret for token '$token'\"");
      expect(workflow).toContain("printf '%s=%s\\n' \"$token\" \"$value\" >> \"$GITHUB_ENV\"");
      expect(workflow).toContain('Validate token substitution');
      expect(workflow).toContain("grep -q '{#\\[' \"$config_file\"");
    });

    it('should place token validation step between substitution and publish', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const validateSourcesIdx = workflow.indexOf('Validate token source values');
      const substituteIdx = workflow.indexOf('cschleiden/replace-tokens');
      const validateSubstitutionIdx = workflow.indexOf('Validate token substitution');
      const publishIdx = workflow.indexOf('npx apiops publish');
      expect(validateSourcesIdx).toBeLessThan(substituteIdx);
      expect(substituteIdx).toBeLessThan(validateSubstitutionIdx);
      expect(validateSubstitutionIdx).toBeLessThan(publishIdx);
    });

    it('should include dry-run validation steps before publish steps', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      expect(workflow).toContain('Dry-run validation (incremental)');
      expect(workflow).toContain('Dry-run validation (all artifacts)');
    });

    it('should include --dry-run flag in dry-run validation steps', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const lines = workflow.split('\n');
      const dryRunIncrIdx = lines.findIndex((l) => l.includes('Dry-run validation (incremental)'));
      const dryRunSection = lines.slice(dryRunIncrIdx, dryRunIncrIdx + 15).join('\n');
      expect(dryRunSection).toContain('--dry-run');
    });

    it('should place dry-run validation before actual publish steps', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const dryRunIdx = workflow.indexOf('Dry-run validation (incremental)');
      const publishIdx = workflow.indexOf('Publish (incremental');
      expect(dryRunIdx).toBeGreaterThan(0);
      expect(dryRunIdx).toBeLessThan(publishIdx);
    });

    it('should include parameterized dry-run validation steps', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
      });
      expect(workflow).toContain('Dry-run validation (incremental)');
      expect(workflow).toContain('Dry-run validation (all artifacts)');
    });

    it('should pass commit-id in incremental dry-run step', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const lines = workflow.split('\n');
      const dryRunIncrIdx = lines.findIndex((l) => l.includes('Dry-run validation (incremental)'));
      const nextStepIdx = lines.findIndex((l, i) => i > dryRunIncrIdx + 1 && l.includes('- name:'));
      const dryRunSection = lines.slice(dryRunIncrIdx, nextStepIdx).join('\n');
      expect(dryRunSection).toContain('--commit-id');
      expect(dryRunSection).toContain('--dry-run');
    });

    it('should not pass commit-id in all-artifacts dry-run step', () => {
      const workflow = generatePublishWorkflow({
        artifactDir: './apim-artifacts',
        environments: ['dev'],
      });
      const lines = workflow.split('\n');
      const dryRunAllIdx = lines.findIndex((l) => l.includes('Dry-run validation (all artifacts)'));
      const nextStepIdx = lines.findIndex((l, i) => i > dryRunAllIdx + 1 && l.includes('- name:'));
      const dryRunSection = lines.slice(dryRunAllIdx, nextStepIdx).join('\n');
      expect(dryRunSection).not.toContain('--commit-id');
      expect(dryRunSection).toContain('--dry-run');
    });
  });
});
