// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T045: Azure DevOps extract pipeline template
 */

import { describe, it, expect } from 'vitest';
import { generateExtractPipeline } from '../../../../src/templates/azure-devops/extract-pipeline.js';

const defaultConfig = { artifactDir: './apim-artifacts', environments: ['dev', 'prod'] };

describe('azure-devops/extract-pipeline', () => {
  describe('generateExtractPipeline', () => {
    it('should generate pipeline with correct header', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('# Azure DevOps Pipeline: Run APIM Extractor');
    });

    it('should have trigger: none (manual only, no schedule)', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('trigger: none');
      expect(pipeline).not.toContain('schedules:');
      expect(pipeline).not.toContain('cron:');
    });

    it('should include CONFIGURATION_YAML_PATH parameter with choice values', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('name: CONFIGURATION_YAML_PATH');
      expect(pipeline).toContain("'Extract All APIs'");
      expect(pipeline).toContain("'configuration.extractor.yaml'");
    });

    it('should include ENVIRONMENT parameter defaulting to first environment', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('name: ENVIRONMENT');
      expect(pipeline).toContain("default: 'dev'");
      expect(pipeline).toContain("- 'dev'");
      expect(pipeline).toContain("- 'prod'");
      expect(pipeline).not.toContain('name: resourceGroup');
      expect(pipeline).not.toContain('name: serviceName');
    });

    it('should default ENVIRONMENT to the first provided environment', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts', environments: ['staging', 'production', 'qa'] });
      expect(pipeline).toContain("default: 'staging'");
      expect(pipeline).toContain("- 'staging'");
      expect(pipeline).toContain("- 'production'");
      expect(pipeline).toContain("- 'qa'");
    });

    it('should use ubuntu-latest pool', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain("vmImage: 'ubuntu-latest'");
    });

    it('should include conditional variable groups per environment', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain("${{ if eq(parameters.ENVIRONMENT, 'dev') }}:");
      expect(pipeline).toContain('- group: apim-dev');
      expect(pipeline).toContain("${{ if eq(parameters.ENVIRONMENT, 'prod') }}:");
      expect(pipeline).toContain('- group: apim-prod');
      expect(pipeline).not.toContain('- group: apim-common');
    });

    it('should include Node.js setup step', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('UseNode@1');
      expect(pipeline).toContain("version: '22.x'");
    });

    it('should include npm ci step', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('npm ci');
    });

    it('should have conditional extract steps for All APIs vs With Configuration', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain("Run APIM Extract (All APIs)");
      expect(pipeline).toContain("Run APIM Extract (With Configuration)");
      expect(pipeline).toContain("eq('${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')");
      expect(pipeline).toContain("ne('${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')");
    });

    it('should use AzureCLI task for authentication', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('AzureCLI@2');
      expect(pipeline).toContain("azureSubscription: '$(AZURE_SERVICE_CONNECTION)'");
    });

    it('should use APIM_RESOURCE_GROUP and APIM_SERVICE_NAME from variable group', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('--resource-group "$(APIM_RESOURCE_GROUP)"');
      expect(pipeline).toContain('--service-name "$(APIM_SERVICE_NAME)"');
    });

    it('should use custom artifact directory in extract command', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './custom-dir', environments: ['dev'] });
      expect(pipeline).toContain('--output ./custom-dir');
    });

    it('should include subscription-id flag referencing AZURE_SUBSCRIPTION_ID', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('--subscription-id "$(AZURE_SUBSCRIPTION_ID)"');
    });

    it('should publish pipeline artifacts', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('PublishPipelineArtifact@1');
      expect(pipeline).toContain('artifactName: apim-artifacts');
    });

    it('should create branch and automatically open a pull request via ADO REST API', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('Create branch and open pull request');
      expect(pipeline).toContain('git checkout -b');
      expect(pipeline).toContain('apim-extract-$(Build.BuildId)');
      expect(pipeline).toContain('pullrequests?api-version=7.1');
      expect(pipeline).toContain('SYSTEM_ACCESSTOKEN: $(System.AccessToken)');
      // Should NOT push directly to main
      expect(pipeline).not.toContain('git push origin HEAD:main');
    });

    it('should use npm ci to install dependencies (uses tgz from package.json)', () => {
      const pipeline = generateExtractPipeline(defaultConfig);
      expect(pipeline).toContain('npm ci');
      expect(pipeline).toContain('npx @peterhauge/apiops-cli extract');
    });
  });
});
