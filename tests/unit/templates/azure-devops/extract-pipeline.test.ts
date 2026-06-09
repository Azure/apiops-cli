// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T045: Azure DevOps extract pipeline template
 */

import { describe, it, expect } from 'vitest';
import { generateExtractPipeline } from '../../../../src/templates/azure-devops/extract-pipeline.js';

describe('azure-devops/extract-pipeline', () => {
  describe('generateExtractPipeline', () => {
    it('should generate pipeline with correct header', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('# Azure DevOps Pipeline: Run APIM Extractor');
    });

    it('should have trigger: none (manual only, no schedule)', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('trigger: none');
      expect(pipeline).not.toContain('schedules:');
      expect(pipeline).not.toContain('cron:');
    });

    it('should include CONFIGURATION_YAML_PATH parameter with choice values', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('name: CONFIGURATION_YAML_PATH');
      expect(pipeline).toContain("'Extract All APIs'");
      expect(pipeline).toContain("'configuration.extractor.yaml'");
    });

    it('should include runtime parameters for resource group and service name', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('parameters:');
      expect(pipeline).toContain('name: resourceGroup');
      expect(pipeline).toContain('name: serviceName');
    });

    it('should use ubuntu-latest pool', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain("vmImage: 'ubuntu-latest'");
    });

    it('should include apim-common variable group', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('variables:');
      expect(pipeline).toContain('- group: apim-common');
    });

    it('should include Node.js setup step', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('UseNode@1');
      expect(pipeline).toContain("versionSpec: '22.x'");
    });

    it('should include npm ci step', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('npm ci');
    });

    it('should have conditional extract steps for All APIs vs With Configuration', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain("Run APIM Extract (All APIs)");
      expect(pipeline).toContain("Run APIM Extract (With Configuration)");
      expect(pipeline).toContain("eq('${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')");
      expect(pipeline).toContain("ne('${{ parameters.CONFIGURATION_YAML_PATH }}', 'Extract All APIs')");
    });

    it('should use AzureCLI task for authentication', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('AzureCLI@2');
      expect(pipeline).toContain("azureSubscription: '$(AZURE_SERVICE_CONNECTION)'");
    });

    it('should use custom artifact directory in extract command', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './custom-dir' });
      expect(pipeline).toContain('--output ./custom-dir');
    });

    it('should include subscription-id flag', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('--subscription-id $(AZURE_SUBSCRIPTION_ID)');
    });

    it('should publish pipeline artifacts', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('PublishPipelineArtifact@1');
      expect(pipeline).toContain('artifactName: apim-artifacts');
    });

    it('should create a branch with changes instead of pushing directly to main', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('Create branch with changes');
      expect(pipeline).toContain('git checkout -b');
      expect(pipeline).toContain('apim-extract-$(Build.BuildId)');
      // Should NOT push directly to main
      expect(pipeline).not.toContain('git push origin HEAD:main');
    });

    it('should use npm ci to install dependencies (uses tgz from package.json)', () => {
      const pipeline = generateExtractPipeline({ artifactDir: './apim-artifacts' });
      expect(pipeline).toContain('npm ci');
      expect(pipeline).toContain('npx apiops extract');
    });
  });
});
