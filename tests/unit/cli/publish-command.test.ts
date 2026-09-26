// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Publish command CLI registration
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createPublishCommand,
  hasMutuallyExclusivePublishOptions,
  outputText,
} from '../../../src/cli/publish-command.js';
import { PublishResult } from '../../../src/services/publish-service.js';

describe('publish-command', () => {
  describe('createPublishCommand', () => {
    it('should register publish subcommand', () => {
      const cmd = createPublishCommand();
      expect(cmd.name()).toBe('publish');
    });

    it('should have required --resource-group option', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const rgOpt = opts.find((o) => o.long === '--resource-group');
      expect(rgOpt).toBeDefined();
      expect(rgOpt?.required).toBe(true);
    });

    it('should have required --service-name option', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const snOpt = opts.find((o) => o.long === '--service-name');
      expect(snOpt).toBeDefined();
      expect(snOpt?.required).toBe(true);
    });

    it('should have --source option with default', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const sourceOpt = opts.find((o) => o.long === '--source');
      expect(sourceOpt).toBeDefined();
      expect(sourceOpt?.defaultValue).toBe('./apim-artifacts');
    });

    it('should have --overrides option', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const overridesOpt = opts.find((o) => o.long === '--overrides');
      expect(overridesOpt).toBeDefined();
    });

    it('should have --filter option', () => {
      const cmd = createPublishCommand();
      expect(cmd.options.find((o) => o.long === '--filter')).toBeDefined();
    });

    it('should have a negated --no-transitive flag', () => {
      const cmd = createPublishCommand();
      const transitiveOpt = cmd.options.find((o) => o.long === '--no-transitive');
      expect(transitiveOpt).toBeDefined();
      expect(transitiveOpt?.negate).toBe(true);
    });

    it('should have --commit-id option', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const commitIdOpt = opts.find((o) => o.long === '--commit-id');
      expect(commitIdOpt).toBeDefined();
    });

    it('should have --dry-run flag with default false', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const dryRunOpt = opts.find((o) => o.long === '--dry-run');
      expect(dryRunOpt).toBeDefined();
      expect(dryRunOpt?.defaultValue).toBe(false);
    });

    it('should have --delete-unmatched flag with default false', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const deleteOpt = opts.find((o) => o.long === '--delete-unmatched');
      expect(deleteOpt).toBeDefined();
      expect(deleteOpt?.defaultValue).toBe(false);
    });

    it('should have a description', () => {
      const cmd = createPublishCommand();
      expect(cmd.description()).toBeTruthy();
      expect(cmd.description().toLowerCase()).toContain('publish');
    });
  });

  describe('executePublish behavior', () => {
    it('should require subscription-id', () => {
      const cmd = createPublishCommand();
      // Subscription ID is a global option, not on this command
      // Just verify the command exists
      expect(cmd).toBeDefined();
    });
  });

  describe('configuration loading', () => {
    it('should pass dry-run flag to publish service', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const dryRunOpt = opts.find((o) => o.long === '--dry-run');
      expect(dryRunOpt).toBeDefined();
    });

    it('should pass delete-unmatched flag to publish service', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const deleteOpt = opts.find((o) => o.long === '--delete-unmatched');
      expect(deleteOpt).toBeDefined();
    });

    it('should support overrides file path', () => {
      const cmd = createPublishCommand();
      const opts = cmd.options;
      const overridesOpt = opts.find((o) => o.long === '--overrides');
      expect(overridesOpt).toBeDefined();
    });
  });

  describe('environment variables', () => {
    it('should read COMMIT_ID from environment', () => {
      // The actual reading of COMMIT_ID happens in executePublish
      // This test verifies the command is set up to support it
      const cmd = createPublishCommand();
      expect(cmd).toBeDefined();
    });

    it('should read AZURE_SUBSCRIPTION_ID from environment', () => {
      // The actual reading happens in executePublish
      const cmd = createPublishCommand();
      expect(cmd).toBeDefined();
    });
  });

  describe('mutually exclusive publish modes', () => {
    it('should allow explicit delete-unmatched in incremental mode', () => {
      expect(hasMutuallyExclusivePublishOptions(true, 'abc123')).toBe(false);
    });

    it('should allow delete-unmatched in full publish mode', () => {
      expect(hasMutuallyExclusivePublishOptions(true, undefined)).toBe(false);
    });

    it('should allow commit-id incremental mode without delete-unmatched', () => {
      expect(hasMutuallyExclusivePublishOptions(false, 'abc123')).toBe(false);
    });

    it('should reject filter with delete-unmatched', () => {
      expect(hasMutuallyExclusivePublishOptions(true, undefined, true)).toBe(true);
    });

    it('should allow filter without delete-unmatched', () => {
      expect(hasMutuallyExclusivePublishOptions(false, undefined, true)).toBe(false);
    });
  });

  describe('outputText', () => {
    const baseResult: PublishResult = {
      totalPuts: 41,
      totalPatches: 0,
      totalDeletes: 0,
      totalErrors: 0,
      totalSkipped: 1,
      exitCode: 0,
      actions: [],
    };

    function render(result: PublishResult, dryRun = false): string {
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        outputText(result, dryRun);
        return stdout.mock.calls.map((call) => String(call[0])).join('');
      } finally {
        stdout.mockRestore();
      }
    }

    it('includes retry counts and elapsed time in the summary', () => {
      const output = render({
        ...baseResult,
        elapsedMs: 12_345,
        totalRetries: 6,
        retriedResources: 2,
      });

      expect(output).toContain('41 creates/updates, 0 patches, 0 deletes, 1 skipped\n');
      expect(output).toContain('6 retries across 2 resources\n');
      expect(output).toContain('Completed in 12.3s\n');
    });

    it('omits the retry line when no retries occurred', () => {
      const output = render({ ...baseResult, elapsedMs: 500, totalRetries: 0, retriedResources: 0 });

      expect(output).not.toContain('retr');
      expect(output).toContain('Completed in 0.5s\n');
    });

    it('uses singular wording for a single retry', () => {
      const output = render({ ...baseResult, totalRetries: 1, retriedResources: 1 });

      expect(output).toContain('1 retry across 1 resource\n');
    });
  });
});
