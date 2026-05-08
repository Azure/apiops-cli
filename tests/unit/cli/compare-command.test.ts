/**
 * Unit tests for T-CMP-01: compare-command.ts CLI registration
 */

import { describe, it, expect } from 'vitest';
import { createCompareCommand } from '../../../src/cli/compare-command.js';

describe('createCompareCommand', () => {
  it('should register compare subcommand', () => {
    const cmd = createCompareCommand();
    expect(cmd.name()).toBe('compare');
  });

  it('should have required --source-resource-group option', () => {
    const cmd = createCompareCommand();
    const opt = cmd.options.find((o) => o.long === '--source-resource-group');
    expect(opt).toBeDefined();
    expect(opt?.required).toBe(true);
  });

  it('should have required --source-service-name option', () => {
    const cmd = createCompareCommand();
    const opt = cmd.options.find((o) => o.long === '--source-service-name');
    expect(opt).toBeDefined();
    expect(opt?.required).toBe(true);
  });

  it('should have required --target-resource-group option', () => {
    const cmd = createCompareCommand();
    const opt = cmd.options.find((o) => o.long === '--target-resource-group');
    expect(opt).toBeDefined();
    expect(opt?.required).toBe(true);
  });

  it('should have required --target-service-name option', () => {
    const cmd = createCompareCommand();
    const opt = cmd.options.find((o) => o.long === '--target-service-name');
    expect(opt).toBeDefined();
    expect(opt?.required).toBe(true);
  });

  it('should have optional --source-subscription-id option', () => {
    const cmd = createCompareCommand();
    const opt = cmd.options.find((o) => o.long === '--source-subscription-id');
    expect(opt).toBeDefined();
    // Optional option — mandatory is false (only required if provided)
    expect(opt?.mandatory).toBe(false);
  });

  it('should have optional --target-subscription-id option', () => {
    const cmd = createCompareCommand();
    const opt = cmd.options.find((o) => o.long === '--target-subscription-id');
    expect(opt).toBeDefined();
    // Optional option — mandatory is false (only required if provided)
    expect(opt?.mandatory).toBe(false);
  });
});
