// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T047: Config templates
 */

import { describe, it, expect } from 'vitest';
import { generateFilterConfig } from '../../../../src/templates/configs/filter-config.js';
import { generateOverrideConfig } from '../../../../src/templates/configs/override-config.js';

describe('configs/filter-config', () => {
  describe('generateFilterConfig', () => {
    it('should generate YAML comment header', () => {
      const config = generateFilterConfig();
      expect(config).toContain('# APIM Extract Filter Configuration');
    });

    it('should include commented examples for apiNames', () => {
      const config = generateFilterConfig();
      expect(config).toContain('# apiNames:');
    });

    it('should include commented examples for productNames', () => {
      const config = generateFilterConfig();
      expect(config).toContain('# productNames:');
    });

    it('should include commented examples for backendNames', () => {
      const config = generateFilterConfig();
      expect(config).toContain('# backendNames:');
    });

    it('should include commented examples for namedValueNames', () => {
      const config = generateFilterConfig();
      expect(config).toContain('# namedValueNames:');
    });

    it('should include commented examples for policyFragmentNames', () => {
      const config = generateFilterConfig();
      expect(config).toContain('# policyFragmentNames:');
    });

    it('should include commented examples for all supported filter fields', () => {
      const config = generateFilterConfig();
      const fields = [
        'gatewayNames',
        'versionSetNames',
        'groupNames',
        'subscriptionNames',
        'schemaNames',
        'policyRestrictionNames',
        'documentationNames',
        'workspaceNames',
      ];
      fields.forEach((field) => {
        expect(config).toContain(`# ${field}:`);
      });
    });

    it('should document empty arrays as exclude-all behavior', () => {
      const config = generateFilterConfig();
      expect(config).toContain('# - Set a section to an empty array ([]) to exclude ALL resources of that type');
      expect(config).toContain('#   gatewayNames: []');
      expect(config).toContain('#   subscriptionNames: []');
    });

    it('should not have any uncommented configuration by default', () => {
      const config = generateFilterConfig();
      const lines = config.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
      expect(lines).toHaveLength(0);
    });
  });
});

describe('configs/override-config', () => {
  describe('generateOverrideConfig', () => {
    it('should generate environment-specific header', () => {
      const config = generateOverrideConfig('dev');
      expect(config).toContain('# APIM Override Configuration for dev environment');
    });

    it('should include environment name in examples', () => {
      const config = generateOverrideConfig('production');
      expect(config).toContain('production-api-key-value');
      expect(config).toContain('production-db.example.com');
      expect(config).toContain('production-kv.vault.azure.net');
    });

    it('should include namedValues override examples', () => {
      const config = generateOverrideConfig('dev');
      expect(config).toContain('# namedValues:');
      expect(config).toContain('#   api-key:');
      expect(config).toContain('#     value:');
    });

    it('should include backends override examples', () => {
      const config = generateOverrideConfig('dev');
      expect(config).toContain('# backends:');
      expect(config).toContain('#   backend-api:');
      expect(config).toContain('#     url:');
    });

    it('should include apis override examples', () => {
      const config = generateOverrideConfig('dev');
      expect(config).toContain('# apis:');
      expect(config).toContain('#   echo-api:');
      expect(config).toContain('#     serviceUrl:');
    });

    it('should include KeyVault example in namedValues', () => {
      const config = generateOverrideConfig('staging');
      expect(config).toContain('#   secret-from-keyvault:');
      expect(config).toContain('#     keyVault:');
      expect(config).toContain('#       secretIdentifier:');
      expect(config).toContain('staging-kv.vault.azure.net');
    });

    it('should include diagnostics override examples', () => {
      const config = generateOverrideConfig('dev');
      expect(config).toContain('# diagnostics:');
      expect(config).toContain('#   applicationinsights:');
      expect(config).toContain('#     loggerId:');
    });

    it('should include loggers override examples', () => {
      const config = generateOverrideConfig('dev');
      expect(config).toContain('# loggers:');
      expect(config).toContain('#   appinsights-logger:');
      expect(config).toContain('#     resourceId:');
    });

    it('should not have any uncommented configuration by default', () => {
      const config = generateOverrideConfig('dev');
      const lines = config.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
      expect(lines).toHaveLength(0);
    });
  });
});
