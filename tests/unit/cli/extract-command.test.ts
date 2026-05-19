// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for T028/T029: Extract command CLI registration
 */

import { describe, it, expect } from 'vitest';
import { createExtractCommand } from '../../../src/cli/extract-command.js';

describe('extract-command', () => {
  describe('createExtractCommand', () => {
    it('should create a command named "extract"', () => {
      const cmd = createExtractCommand();
      expect(cmd.name()).toBe('extract');
    });

    it('should have required --resource-group option', () => {
      const cmd = createExtractCommand();
      const opts = cmd.options;
      const rgOpt = opts.find((o) => o.long === '--resource-group');
      expect(rgOpt).toBeDefined();
      expect(rgOpt?.required).toBe(true);
    });

    it('should have required --service-name option', () => {
      const cmd = createExtractCommand();
      const opts = cmd.options;
      const snOpt = opts.find((o) => o.long === '--service-name');
      expect(snOpt).toBeDefined();
      expect(snOpt?.required).toBe(true);
    });

    it('should have optional --output with default', () => {
      const cmd = createExtractCommand();
      const opts = cmd.options;
      const outOpt = opts.find((o) => o.long === '--output');
      expect(outOpt).toBeDefined();
      expect(outOpt?.defaultValue).toBe('./apim-artifacts');
    });

    it('should have --filter option', () => {
      const cmd = createExtractCommand();
      const opts = cmd.options;
      const filterOpt = opts.find((o) => o.long === '--filter');
      expect(filterOpt).toBeDefined();
    });

    it('should have --no-transitive option', () => {
      const cmd = createExtractCommand();
      const opts = cmd.options;
      const noTransOpt = opts.find((o) => o.long === '--no-transitive');
      expect(noTransOpt).toBeDefined();
    });

    it('should have --spec-format option', () => {
      const cmd = createExtractCommand();
      const opts = cmd.options;
      const specOpt = opts.find((o) => o.long === '--spec-format');
      expect(specOpt).toBeDefined();
    });

    it('should have a description', () => {
      const cmd = createExtractCommand();
      expect(cmd.description()).toBeTruthy();
    });
  });
});
