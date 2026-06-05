// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T042 & T051: Init orchestrator service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initService } from '../../../src/services/init-service.js';
import { InitConfig } from '../../../src/models/config.js';
import * as fs from 'fs/promises';
import type { PathLike } from 'node:fs';
import * as path from 'path';

// Mock the file system
vi.mock('fs/promises');

// Mock the prompt service
vi.mock('../../../src/services/prompt-service.js', () => ({
  promptService: {
    isTTY: vi.fn(() => false),
    askCIProvider: vi.fn(async () => 'github-actions'),
    askArtifactDir: vi.fn(async (def: string) => def),
    askEnvironments: vi.fn(async (def: string[]) => def),
  },
}));

// Mock the identity guide service
vi.mock('../../../src/services/identity-guide-service.js', () => ({
  identityGuideService: {
    generateGitHubActionsGuide: vi.fn(() => '# GitHub Actions Guide'),
    generateAzureDevOpsGuide: vi.fn(() => '# Azure DevOps Guide'),
  },
}));

// Mock logger to reduce noise in tests
vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/** Default CLI package path used in tests (absolute, ends in .tgz) */
const TEST_CLI_PACKAGE = '/packages/apiops-0.1.0.tgz';
/** Resolved form — matches what path.resolve() returns at runtime (adds drive letter on Windows) */
const TEST_CLI_PACKAGE_RESOLVED = path.resolve(TEST_CLI_PACKAGE);

describe('init-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock fs.mkdir to succeed — resolves with undefined when recursive: true
    // creates a new directory (Node.js returns the first created directory path
    // or undefined when the directory already existed)
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    
    // Mock fs.writeFile to succeed
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    // Mock fs.copyFile to succeed
    vi.mocked(fs.copyFile).mockResolvedValue(undefined);
    
    // Mock fs.access: the CLI tarball exists, all other files don't
    vi.mocked(fs.access).mockImplementation(async (filePath: PathLike) => {
      if (filePath.toString() === TEST_CLI_PACKAGE_RESOLVED) {
        return Promise.resolve();
      }
      throw new Error('ENOENT');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('run', () => {
    it('should throw error in non-interactive mode without CI provider', async () => {
      const config: InitConfig = {
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      await expect(initService.run(config)).rejects.toThrow(
        'Non-interactive mode requires --ci flag'
      );
    });

    it('should generate GitHub Actions workflows when ciProvider is github-actions', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      const result = await initService.run(config);

      expect(result.pipelines).toContain('.github/workflows/run-apim-extractor.yml');
      expect(result.pipelines).toContain('.github/workflows/run-apim-publisher.yml');
    });

    it('should generate Azure DevOps pipelines when ciProvider is azure-devops', async () => {
      const config: InitConfig = {
        ciProvider: 'azure-devops',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      const result = await initService.run(config);

      expect(result.pipelines).toContain('.azdo/pipelines/run-apim-extractor.yml');
      expect(result.pipelines).toContain('.azdo/pipelines/run-apim-publisher.yml');
    });

    it('should generate filter configuration file', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      const result = await initService.run(config);

      expect(result.configs).toContain('configuration.extract.yaml');
    });

    it('should generate override configuration for each environment', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev', 'staging', 'prod'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      const result = await initService.run(config);

      expect(result.configs).toContain('configuration.dev.yaml');
      expect(result.configs).toContain('configuration.staging.yaml');
      expect(result.configs).toContain('configuration.prod.yaml');
    });

    it('should create artifact directory', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './custom-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      const result = await initService.run(config);

      expect(result.directories).toContain('./custom-artifacts');
      expect(vi.mocked(fs.mkdir)).toHaveBeenCalledWith(
        path.join('/test', 'custom-artifacts'),
        expect.objectContaining({ recursive: true })
      );
    });

    it('should create .gitkeep in artifact directory', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      await initService.run(config);

      const gitkeepCalls = vi.mocked(fs.writeFile).mock.calls.filter(
        (call) => call[0] === path.join('/test', 'apim-artifacts', '.gitkeep')
      );
      expect(gitkeepCalls).toHaveLength(1);
    });

    it('should throw when GitHub Actions workflows exist and --force is not set', async () => {
      // Mock file exists for extract workflow and the CLI tarball
      vi.mocked(fs.access).mockImplementation(async (filePath: PathLike) => {
        const p = filePath.toString();
        if (p === TEST_CLI_PACKAGE_RESOLVED || p.includes('run-apim-extractor.yml')) {
          return Promise.resolve();
        }
        throw new Error('ENOENT');
      });

      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      await expect(initService.run(config)).rejects.toThrow(
        'Use --force to overwrite existing files'
      );
    });

    it('should overwrite when GitHub Actions workflows exist and --force is set', async () => {
      // Mock file exists for extract workflow and the CLI tarball
      vi.mocked(fs.access).mockImplementation(async (filePath: PathLike) => {
        const p = filePath.toString();
        if (p === TEST_CLI_PACKAGE_RESOLVED || p.includes('run-apim-extractor.yml')) {
          return Promise.resolve();
        }
        throw new Error('ENOENT');
      });

      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: true,
      };

      // Should not throw, just warn and proceed
      await expect(initService.run(config)).resolves.toBeDefined();
    });

    it('should throw when config files exist and --force is not set', async () => {
      // Mock file exists for filter config and the CLI tarball
      vi.mocked(fs.access).mockImplementation(async (filePath: PathLike) => {
        const p = filePath.toString();
        if (p === TEST_CLI_PACKAGE_RESOLVED || p.includes('configuration.extract.yaml')) {
          return Promise.resolve();
        }
        throw new Error('ENOENT');
      });

      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      await expect(initService.run(config)).rejects.toThrow(
        'Use --force to overwrite existing files'
      );
    });

    it('should overwrite when config files exist and --force is set', async () => {
      // Mock file exists for filter config and the CLI tarball
      vi.mocked(fs.access).mockImplementation(async (filePath: PathLike) => {
        const p = filePath.toString();
        if (p === TEST_CLI_PACKAGE_RESOLVED || p.includes('configuration.extract.yaml')) {
          return Promise.resolve();
        }
        throw new Error('ENOENT');
      });

      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: true,
      };

      // Should not throw, just warn and proceed
      await expect(initService.run(config)).resolves.toBeDefined();
    });

    it('should write identity guide file for GitHub Actions', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      await initService.run(config);

      const guideCalls = vi.mocked(fs.writeFile).mock.calls.filter(
        (call) => call[0] === path.join('/test', 'IDENTITY-SETUP-GITHUB.md')
      );
      expect(guideCalls).toHaveLength(1);
    });

    it('should write identity guide file for Azure DevOps', async () => {
      const config: InitConfig = {
        ciProvider: 'azure-devops',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      await initService.run(config);

      const guideCalls = vi.mocked(fs.writeFile).mock.calls.filter(
        (call) => call[0] === path.join('/test', 'IDENTITY-SETUP-AZDO.md')
      );
      expect(guideCalls).toHaveLength(1);
    });

    it('should generate Copilot identity setup prompt for GitHub Actions', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      const result = await initService.run(config);

      expect(result.configs).toContain('.github/prompts/apiops-setup-identity.prompt.md');
      const promptCalls = vi.mocked(fs.writeFile).mock.calls.filter(
        (call) => call[0] === path.join('/test', '.github/prompts/apiops-setup-identity.prompt.md')
      );
      expect(promptCalls).toHaveLength(1);
      const content = promptCalls[0][1] as string;
      expect(content).toContain('Setup GitHub Actions Identity');
      expect(content).toContain('gh secret set');
    });

    it('should generate Copilot identity setup prompt for Azure DevOps', async () => {
      const config: InitConfig = {
        ciProvider: 'azure-devops',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev', 'prod'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      const result = await initService.run(config);

      expect(result.configs).toContain('.github/prompts/apiops-setup-identity.prompt.md');
      const promptCalls = vi.mocked(fs.writeFile).mock.calls.filter(
        (call) => call[0] === path.join('/test', '.github/prompts/apiops-setup-identity.prompt.md')
      );
      expect(promptCalls).toHaveLength(1);
      const content = promptCalls[0][1] as string;
      expect(content).toContain('Setup Azure DevOps Identity for APIOps');
      expect(content).toContain('az devops service-endpoint azurerm create');
    });

    it('should copy CLI tarball into .apiops directory', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      const result = await initService.run(config);

      expect(result.directories).toContain('.apiops');
      expect(vi.mocked(fs.mkdir)).toHaveBeenCalledWith(
        path.join('/test', '.apiops'),
        expect.objectContaining({ recursive: true })
      );
      expect(vi.mocked(fs.copyFile)).toHaveBeenCalledWith(
        TEST_CLI_PACKAGE_RESOLVED,
        path.join('/test', '.apiops', 'apiops-0.1.0.tgz')
      );
    });

    it('should generate package.json with file: dependency to tarball in local mode', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      const result = await initService.run(config);

      expect(result.configs).toContain('package.json');
      const pkgCalls = vi.mocked(fs.writeFile).mock.calls.filter(
        (call) => call[0] === path.join('/test', 'package.json')
      );
      expect(pkgCalls).toHaveLength(1);
      const content = pkgCalls[0][1] as string;
      const pkg = JSON.parse(content);
      expect(pkg.dependencies.apiops).toContain('file:');
      expect(pkg.dependencies.apiops).toContain('apiops-0.1.0.tgz');
    });

    it('should generate package.json with npm dependency when cliPackage not provided', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        // cliPackage is omitted — npm mode
        force: false,
      };

      const result = await initService.run(config);

      expect(result.configs).toContain('package.json');
      const pkgCalls = vi.mocked(fs.writeFile).mock.calls.filter(
        (call) => call[0] === path.join('/test', 'package.json')
      );
      expect(pkgCalls).toHaveLength(1);
      const content = pkgCalls[0][1] as string;
      const pkg = JSON.parse(content);
      expect(pkg.dependencies['@peterhauge/apiops-cli']).toBe('latest');
      expect(pkg.dependencies.apiops).toBeUndefined();
    });

    it('should NOT copy tarball or create .apiops directory in npm mode', async () => {
      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        // cliPackage is omitted — npm mode
        force: false,
      };

      const result = await initService.run(config);

      // .apiops should NOT be in generated directories
      expect(result.directories).not.toContain('.apiops');
      // copyFile should NOT have been called
      expect(vi.mocked(fs.copyFile)).not.toHaveBeenCalled();
    });

    it('should throw if CLI package tarball does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: '/nonexistent/apiops-0.1.0.tgz',
        force: false,
      };

      await expect(initService.run(config)).rejects.toThrow('CLI package not found');
    });

    it('should throw if CLI package is not a .tgz file', async () => {
      const badPath = '/packages/apiops-0.1.0.zip';
      const badPathResolved = path.resolve(badPath);
      vi.mocked(fs.access).mockImplementation(async (filePath: PathLike) => {
        if (filePath.toString() === badPathResolved) {
          return Promise.resolve();
        }
        throw new Error('ENOENT');
      });

      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: badPath,
        force: false,
      };

      await expect(initService.run(config)).rejects.toThrow(
        'CLI package must be a .tgz tarball'
      );
    });

    it('should merge dependency when package.json already exists in local mode', async () => {
      vi.mocked(fs.access).mockImplementation(async (filePath: PathLike) => {
        const p = filePath.toString();
        if (p === TEST_CLI_PACKAGE_RESOLVED || p.includes('package.json')) {
          return Promise.resolve();
        }
        throw new Error('ENOENT');
      });

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(
          {
            name: 'existing-repo',
            version: '2.0.0',
            private: true,
            scripts: { lint: 'eslint .' },
            dependencies: { lodash: '^4.17.21', apiops: 'file:.apiops/old.tgz' },
          },
          null,
          2
        )
      );

      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        cliPackage: TEST_CLI_PACKAGE,
        force: false,
      };

      await expect(initService.run(config)).resolves.toBeDefined();

      const pkgCalls = vi.mocked(fs.writeFile).mock.calls.filter(
        (call) => call[0] === path.join('/test', 'package.json')
      );
      expect(pkgCalls).toHaveLength(1);
      const content = pkgCalls[0][1] as string;
      const pkg = JSON.parse(content);
      expect(pkg.name).toBe('existing-repo');
      expect(pkg.scripts).toEqual({ lint: 'eslint .' });
      expect(pkg.dependencies.lodash).toBe('^4.17.21');
      expect(pkg.dependencies.apiops).toContain('file:.apiops/apiops-0.1.0.tgz');
    });

    it('should merge dependency when package.json already exists in npm mode', async () => {
      vi.mocked(fs.access).mockImplementation(async (filePath: PathLike) => {
        const p = filePath.toString();
        if (p.includes('package.json')) {
          return Promise.resolve();
        }
        throw new Error('ENOENT');
      });

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(
          {
            name: 'existing-repo',
            version: '2.0.0',
            private: true,
            dependencies: { lodash: '^4.17.21' },
          },
          null,
          2
        )
      );

      const config: InitConfig = {
        ciProvider: 'github-actions',
        nonInteractive: true,
        artifactDir: './apim-artifacts',
        environments: ['dev'],
        outputDir: '/test',
        // cliPackage is omitted — npm mode
        force: false,
      };

      await expect(initService.run(config)).resolves.toBeDefined();

      const pkgCalls = vi.mocked(fs.writeFile).mock.calls.filter(
        (call) => call[0] === path.join('/test', 'package.json')
      );
      expect(pkgCalls).toHaveLength(1);
      const content = pkgCalls[0][1] as string;
      const pkg = JSON.parse(content);
      expect(pkg.dependencies.lodash).toBe('^4.17.21');
      expect(pkg.dependencies['@peterhauge/apiops-cli']).toBe('latest');
    });
  });
});
