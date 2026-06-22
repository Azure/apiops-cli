// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for ConfigureService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureService } from '../../../src/services/configure-service.js';
import { ConfigureConfig } from '../../../src/models/config.js';
import * as fs from 'fs/promises';

// Mock file system
vi.mock('fs/promises');

// Mock artifact scanner
vi.mock('../../../src/services/artifact-scanner.js', () => ({
  artifactScanner: {
    scan: vi.fn(async () => ({
      apis: [{ name: 'echo-api' }, { name: 'petstore-api' }],
      namedValues: [
        { name: 'api-key', isSecret: true },
        { name: 'plain-value', isSecret: false, currentValue: 'hello' },
      ],
      backends: [{ name: 'orders-backend', url: 'https://dev.example.com' }],
      loggers: [],
      diagnostics: [],
      products: [],
    })),
  },
}));

// Mock prompt service
vi.mock('../../../src/services/prompt-service.js', () => ({
  promptService: {
    isTTY: vi.fn(() => false),
    askApiFilter: vi.fn(async (names: string[]) => names),
    askSecretTokenName: vi.fn(async (_name: string, _env: string, suggested: string) => suggested),
    askBackendUrl: vi.fn(async () => ''),
    askYesNo: vi.fn(async () => false),
  },
}));

// Quiet logger
vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setFormat: vi.fn(),
  },
}));

function makeConfig(overrides: Partial<ConfigureConfig> = {}): ConfigureConfig {
  return {
    artifactDir: './apim-artifacts',
    environments: ['dev', 'prod'],
    outputDir: '/output',
    nonInteractive: true,
    force: false,
    ...overrides,
  };
}

describe('configure-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    // No existing files by default
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
  });

  describe('run (non-interactive)', () => {
    it('should write filter and override config files', async () => {
      const result = await configureService.run(makeConfig());

      expect(result.writtenFiles).toHaveLength(3); // filter + dev + prod
      expect(result.writtenFiles[0]).toBe('configuration.extractor.yaml');
      expect(result.writtenFiles[1]).toBe('configuration.dev.yaml');
      expect(result.writtenFiles[2]).toBe('configuration.prod.yaml');
    });

    it('should include selected APIs in the filter config', async () => {
      const result = await configureService.run(makeConfig());

      expect(result.filterConfig).toContain('apis:');
      expect(result.filterConfig).toContain('- echo-api');
      expect(result.filterConfig).toContain('- petstore-api');
    });

    it('should add secret named value overrides with token placeholders', async () => {
      const result = await configureService.run(makeConfig());

      // prod override should reference api-key with a token placeholder
      const prodOverride = result.overrideConfigs['prod'];
      expect(prodOverride).toBeDefined();
      expect(prodOverride).toContain('api-key');
      expect(prodOverride).toContain('{#[API_KEY]#}');
    });

    it('should not add overrides for non-secret named values', async () => {
      const result = await configureService.run(makeConfig());

      const prodOverride = result.overrideConfigs['prod'];
      expect(prodOverride).not.toContain('plain-value');
    });

    it('should throw on conflict without --force', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined); // files exist

      await expect(configureService.run(makeConfig({ force: false }))).rejects.toThrow(
        'already exist'
      );
    });

    it('should overwrite existing files when --force is set', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined); // files exist

      const result = await configureService.run(makeConfig({ force: true }));
      expect(result.writtenFiles).toHaveLength(3);
    });

    it('should generate config with helpful comments when no secrets found', async () => {
      const { artifactScanner: scanner } = await import('../../../src/services/artifact-scanner.js');
      vi.mocked(scanner.scan).mockResolvedValueOnce({
        apis: [],
        namedValues: [],
        backends: [],
        loggers: [],
        diagnostics: [],
        products: [],
      });

      const result = await configureService.run(makeConfig());

      const devOverride = result.overrideConfigs['dev'];
      expect(devOverride).toContain('No secret named values');
    });
  });

  describe('run (interactive)', () => {
    it('should call askApiFilter when in TTY mode', async () => {
      const { promptService } = await import('../../../src/services/prompt-service.js');
      vi.mocked(promptService.isTTY).mockReturnValue(true);
      vi.mocked(promptService.askYesNo).mockResolvedValue(false);

      await configureService.run(makeConfig({ nonInteractive: false }));

      expect(promptService.askApiFilter).toHaveBeenCalled();
    });

    it('should call askSecretTokenName for each secret × environment when in TTY mode', async () => {
      const { promptService } = await import('../../../src/services/prompt-service.js');
      vi.mocked(promptService.isTTY).mockReturnValue(true);
      vi.mocked(promptService.askYesNo).mockResolvedValue(false);

      await configureService.run(makeConfig({ nonInteractive: false, environments: ['dev', 'prod'] }));

      // 1 secret × 2 environments = 2 calls
      expect(promptService.askSecretTokenName).toHaveBeenCalledTimes(2);
    });
  });
});
