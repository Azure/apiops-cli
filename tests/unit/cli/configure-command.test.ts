// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Configure command CLI registration
 */

import { describe, it, expect } from 'vitest';
import { createConfigureCommand } from '../../../src/cli/configure-command.js';

describe('configure-command', () => {
  describe('createConfigureCommand', () => {
    it('should create a command named "configure"', () => {
      const cmd = createConfigureCommand();
      expect(cmd.name()).toBe('configure');
    });

    it('should have a description', () => {
      const cmd = createConfigureCommand();
      expect(cmd.description()).toBeTruthy();
      expect(cmd.description().toLowerCase()).toContain('filter');
    });

    it('should have --artifact-dir option with default', () => {
      const cmd = createConfigureCommand();
      const opt = cmd.options.find((o) => o.long === '--artifact-dir');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe('./apim-artifacts');
    });

    it('should have --environments option with default', () => {
      const cmd = createConfigureCommand();
      const opt = cmd.options.find((o) => o.long === '--environments');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe('dev,prod');
    });

    it('should have --output option with default', () => {
      const cmd = createConfigureCommand();
      const opt = cmd.options.find((o) => o.long === '--output');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe('.');
    });

    it('should have --non-interactive option defaulting to false', () => {
      const cmd = createConfigureCommand();
      const opt = cmd.options.find((o) => o.long === '--non-interactive');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe(false);
    });

    it('should have --force option defaulting to false', () => {
      const cmd = createConfigureCommand();
      const opt = cmd.options.find((o) => o.long === '--force');
      expect(opt).toBeDefined();
      expect(opt?.defaultValue).toBe(false);
    });

    it('should have all expected options', () => {
      const cmd = createConfigureCommand();
      const expectedOptions = [
        '--artifact-dir',
        '--environments',
        '--output',
        '--non-interactive',
        '--force',
      ];

      expectedOptions.forEach((optName) => {
        const opt = cmd.options.find((o) => o.long === optName);
        expect(opt, `option ${optName} should be defined`).toBeDefined();
      });
    });
  });
});
