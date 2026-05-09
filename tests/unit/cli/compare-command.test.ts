/**
 * Unit tests for T-CMP-01: compare-command.ts CLI registration
 */

import { describe, it, expect } from 'vitest';
import { createCompareCommand, resolveSubscriptionIds } from '../../../src/cli/compare-command.js';

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

// ── resolveSubscriptionIds ────────────────────────────────────────────────────

describe('resolveSubscriptionIds', () => {
  describe('shared subscription mode (--subscription-id)', () => {
    it('uses --subscription-id for both sides when no per-side flags are set', () => {
      const result = resolveSubscriptionIds('shared-sub', true, undefined, undefined);
      expect(result).toEqual({
        sourceSubscriptionId: 'shared-sub',
        targetSubscriptionId: 'shared-sub',
      });
    });

    it('uses AZURE_SUBSCRIPTION_ID env var for both sides when --subscription-id is not set', () => {
      const result = resolveSubscriptionIds('env-sub', false, undefined, undefined);
      expect(result).toEqual({
        sourceSubscriptionId: 'env-sub',
        targetSubscriptionId: 'env-sub',
      });
    });
  });

  describe('per-side subscription mode (--source/--target-subscription-id)', () => {
    it('uses per-side IDs when both are provided', () => {
      const result = resolveSubscriptionIds(undefined, false, 'src-sub', 'tgt-sub');
      expect(result).toEqual({
        sourceSubscriptionId: 'src-sub',
        targetSubscriptionId: 'tgt-sub',
      });
    });
  });

  describe('mutual exclusion', () => {
    it('returns error when --subscription-id and --source-subscription-id are both set', () => {
      const result = resolveSubscriptionIds('shared-sub', true, 'src-sub', undefined);
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/mutually exclusive/);
    });

    it('returns error when --subscription-id and --target-subscription-id are both set', () => {
      const result = resolveSubscriptionIds('shared-sub', true, undefined, 'tgt-sub');
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/mutually exclusive/);
    });

    it('returns error when --subscription-id and both per-side flags are set', () => {
      const result = resolveSubscriptionIds('shared-sub', true, 'src-sub', 'tgt-sub');
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/mutually exclusive/);
    });
  });

  describe('paired per-side flags requirement', () => {
    it('returns error when only --source-subscription-id is set (no target)', () => {
      const result = resolveSubscriptionIds(undefined, false, 'src-sub', undefined);
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/--target-subscription-id is required/);
    });

    it('returns error when only --target-subscription-id is set (no source)', () => {
      const result = resolveSubscriptionIds(undefined, false, undefined, 'tgt-sub');
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/--source-subscription-id is required/);
    });
  });

  describe('missing subscription ID', () => {
    it('returns error when no subscription information is provided at all', () => {
      const result = resolveSubscriptionIds(undefined, false, undefined, undefined);
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/Subscription ID required/);
    });
  });
});
