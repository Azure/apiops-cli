// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T050: Init command CLI registration
 */

import { describe, it, expect } from 'vitest';
import { createInitCommand } from '../../../src/cli/init-command.js';

describe('init-command', () => {
  describe('createInitCommand', () => {
    it('should create a command named "init"', () => {
      const cmd = createInitCommand();
      expect(cmd.name()).toBe('init');
    });

    it('should have a description', () => {
      const cmd = createInitCommand();
      expect(cmd.description()).toBeTruthy();
      expect(cmd.description()).toContain('CI/CD');
    });

    it('should have --ci option', () => {
      const cmd = createInitCommand();
      const opts = cmd.options;
      const ciOpt = opts.find((o) => o.long === '--ci');
      expect(ciOpt).toBeDefined();
      // The option itself is not required, but when present it requires a value
      expect(ciOpt?.mandatory).toBe(false);
    });

    it('should have --non-interactive option', () => {
      const cmd = createInitCommand();
      const opts = cmd.options;
      const nonInteractiveOpt = opts.find((o) => o.long === '--non-interactive');
      expect(nonInteractiveOpt).toBeDefined();
      expect(nonInteractiveOpt?.required).toBe(false);
    });

    it('should have --artifact-dir option with default', () => {
      const cmd = createInitCommand();
      const opts = cmd.options;
      const artifactDirOpt = opts.find((o) => o.long === '--artifact-dir');
      expect(artifactDirOpt).toBeDefined();
      expect(artifactDirOpt?.defaultValue).toBe('./apim-artifacts');
    });

    it('should have --environments option with default', () => {
      const cmd = createInitCommand();
      const opts = cmd.options;
      const envOpt = opts.find((o) => o.long === '--environments');
      expect(envOpt).toBeDefined();
      expect(envOpt?.defaultValue).toBe('dev,prod');
    });

    it('should have --cli-package optional option', () => {
      const cmd = createInitCommand();
      const opts = cmd.options;
      const cliPkgOpt = opts.find((o) => o.long === '--cli-package');
      expect(cliPkgOpt).toBeDefined();
      // The option itself is not mandatory, but when present it requires a value
      expect(cliPkgOpt?.mandatory).toBe(false);
    });

    it('should have --force option defaulting to false', () => {
      const cmd = createInitCommand();
      const opts = cmd.options;
      const forceOpt = opts.find((o) => o.long === '--force');
      expect(forceOpt).toBeDefined();
      expect(forceOpt?.defaultValue).toBe(false);
    });

    it('should have all expected options for non-interactive mode', () => {
      const cmd = createInitCommand();
      const expectedOptions = ['--ci', '--non-interactive', '--artifact-dir', '--environments', '--cli-package', '--force'];
      
      expectedOptions.forEach((optName) => {
        const opt = cmd.options.find((o) => o.long === optName);
        expect(opt).toBeDefined();
      });
    });
  });
});
