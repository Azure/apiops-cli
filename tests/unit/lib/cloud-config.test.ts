// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for cloud-config module.
 */

import { describe, it, expect } from 'vitest';
import {
  getCloudConfig,
  buildArmBaseUrl,
} from '../../../src/lib/cloud-config.js';

describe('getCloudConfig', () => {
  it('should return config for short name "public"', () => {
    const config = getCloudConfig('public');
    expect(config.armBaseUrl).toBe('https://management.azure.com');
    expect(config.authScope).toBe('https://management.azure.com/.default');
  });

  it('should return config for short name "china"', () => {
    const config = getCloudConfig('china');
    expect(config.armBaseUrl).toBe('https://management.chinacloudapi.cn');
    expect(config.authScope).toBe('https://management.chinacloudapi.cn/.default');
  });

  it('should return config for short name "usgov"', () => {
    const config = getCloudConfig('usgov');
    expect(config.armBaseUrl).toBe('https://management.usgovcloudapi.net');
    expect(config.authScope).toBe('https://management.usgovcloudapi.net/.default');
  });

  it('should return config for short name "germany"', () => {
    const config = getCloudConfig('germany');
    expect(config.armBaseUrl).toBe('https://management.microsoftazure.de');
    expect(config.authScope).toBe('https://management.microsoftazure.de/.default');
  });

  it('should return config for official name "AzureCloud"', () => {
    const config = getCloudConfig('AzureCloud');
    expect(config.armBaseUrl).toBe('https://management.azure.com');
  });

  it('should return config for official name "AzureChinaCloud"', () => {
    const config = getCloudConfig('AzureChinaCloud');
    expect(config.armBaseUrl).toBe('https://management.chinacloudapi.cn');
  });

  it('should return config for official name "AzureUSGovernment"', () => {
    const config = getCloudConfig('AzureUSGovernment');
    expect(config.armBaseUrl).toBe('https://management.usgovcloudapi.net');
  });

  it('should return config for official name "AzureGermanCloud"', () => {
    const config = getCloudConfig('AzureGermanCloud');
    expect(config.armBaseUrl).toBe('https://management.microsoftazure.de');
  });

  it('should throw for unknown cloud name', () => {
    expect(() => getCloudConfig('nonexistent')).toThrow('Unknown cloud "nonexistent"');
  });

  it('should include valid names in error message', () => {
    expect(() => getCloudConfig('bad')).toThrow('Valid values:');
  });

  it('should have auth scopes ending with /.default for all clouds', () => {
    for (const name of ['public', 'china', 'usgov', 'germany']) {
      const config = getCloudConfig(name);
      expect(config.authScope.endsWith('/.default'), `${name} scope should end with /.default`).toBe(true);
    }
  });

  it('should have auth scopes ending with /.default for all official names', () => {
    for (const name of ['AzureCloud', 'AzureChinaCloud', 'AzureUSGovernment', 'AzureGermanCloud']) {
      const config = getCloudConfig(name);
      expect(config.authScope.endsWith('/.default'), `${name} scope should end with /.default`).toBe(true);
    }
  });

  it('should return readonly config objects', () => {
    const config1 = getCloudConfig('public');
    const config2 = getCloudConfig('public');
    // Same reference for short names (from the object)
    expect(config1).toEqual(config2);
  });

  it('should map official names to same config as short names', () => {
    const pairs: Array<[string, string]> = [
      ['public', 'AzureCloud'],
      ['china', 'AzureChinaCloud'],
      ['usgov', 'AzureUSGovernment'],
      ['germany', 'AzureGermanCloud'],
    ];

    for (const [short, official] of pairs) {
      const shortConfig = getCloudConfig(short);
      const officialConfig = getCloudConfig(official);
      expect(shortConfig.armBaseUrl).toBe(officialConfig.armBaseUrl);
      expect(shortConfig.authScope).toBe(officialConfig.authScope);
    }
  });
});

describe('buildArmBaseUrl', () => {
  it('should build public cloud URL with encoded components', () => {
    const url = buildArmBaseUrl('public', 'sub-1', 'rg-1', 'apim-1');
    expect(url).toBe(
      'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
    );
  });

  it('should build china cloud URL', () => {
    const url = buildArmBaseUrl('china', 'sub-1', 'rg-1', 'apim-1');
    expect(url).toContain('management.chinacloudapi.cn');
  });

  it('should build usgov cloud URL', () => {
    const url = buildArmBaseUrl('usgov', 'sub-1', 'rg-1', 'apim-1');
    expect(url).toContain('management.usgovcloudapi.net');
  });

  it('should build germany cloud URL', () => {
    const url = buildArmBaseUrl('germany', 'sub-1', 'rg-1', 'apim-1');
    expect(url).toContain('management.microsoftazure.de');
  });

  it('should work with official cloud names', () => {
    const url = buildArmBaseUrl('AzureUSGovernment', 'sub-1', 'rg-1', 'apim-1');
    expect(url).toContain('management.usgovcloudapi.net');
  });

  it('should encode special characters in path segments', () => {
    const url = buildArmBaseUrl('public', 'sub/id', 'rg name', 'apim&svc');
    expect(url).toContain('sub%2Fid');
    expect(url).toContain('rg%20name');
    expect(url).toContain('apim%26svc');
  });

  it('should throw for unknown cloud', () => {
    expect(() => buildArmBaseUrl('invalid', 'sub', 'rg', 'svc')).toThrow('Unknown cloud');
  });

  it('should contain the expected ARM path structure', () => {
    const url = buildArmBaseUrl('public', 'mySub', 'myRg', 'mySvc');
    expect(url).toMatch(
      /\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.ApiManagement\/service\/[^/]+$/,
    );
  });
});
