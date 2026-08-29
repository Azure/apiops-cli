// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Extract command CLI registration
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createExtractCommand,
  executeExtract,
  shouldRemoveStaleArtifacts,
} from '../../../src/cli/extract-command.js';
import { ExtractionResult } from '../../../src/services/extract-service.js';
import { ApimClient } from '../../../src/clients/apim-client.js';
import { IArtifactStore } from '../../../src/clients/iartifact-store.js';

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

    it('should have an opt-in --remove-stale option', () => {
      const cmd = createExtractCommand();
      const option = cmd.options.find((candidate) => candidate.long === '--remove-stale');
      expect(option).toBeDefined();
      expect(option?.defaultValue).toBeUndefined();
    });

    it('should have a description', () => {
      const cmd = createExtractCommand();
      expect(cmd.description()).toBeTruthy();
    });
  });

  describe('shouldRemoveStaleArtifacts', () => {
    it('should remove stale artifacts only after a successful extraction', () => {
      expect(shouldRemoveStaleArtifacts({ exitCode: 0 }, true)).toBe(true);
      expect(shouldRemoveStaleArtifacts({ exitCode: 0 }, false)).toBe(false);
      expect(shouldRemoveStaleArtifacts({ exitCode: 1 }, true)).toBe(false);
      expect(shouldRemoveStaleArtifacts({ exitCode: 2 }, true)).toBe(false);
    });
  });

  describe('executeExtract cleanup gating', () => {
    it.each([
      { exitCode: 0, removeStale: true, expectedCommit: true, expectedCleanup: true },
      { exitCode: 0, removeStale: false, expectedCommit: true, expectedCleanup: false },
      { exitCode: 1, removeStale: true, expectedCommit: true, expectedCleanup: false },
      { exitCode: 2, removeStale: true, expectedCommit: false, expectedCleanup: false },
    ])('should gate stale cleanup for exit code $exitCode', async ({
      exitCode,
      removeStale,
      expectedCommit,
      expectedCleanup,
    }) => {
      const commitStagedExtraction = vi.fn().mockResolvedValue(undefined);
      const store = { commitStagedExtraction } as unknown as IArtifactStore;
      const result: ExtractionResult = {
        totalExtracted: exitCode === 2 ? 0 : 1,
        totalErrors: exitCode === 0 ? 0 : 1,
        typeResults: [],
        apiResults: [],
        productResults: [],
        workspaceResults: [],
        extractedDescriptors: [],
        collectedPolicies: new Map(),
        exitCode,
      };
      const exit = vi.fn();
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        await executeExtract(
          {
            resourceGroup: 'rg-1',
            serviceName: 'apim-1',
            output: `test-output-${exitCode}`,
            transitive: true,
            removeStale,
          },
          { subscriptionId: 'sub-1', format: 'json' },
          {
            runExtraction: vi.fn().mockResolvedValue(result),
            createClient: () => ({}) as ApimClient,
            createStore: () => store,
            exit,
          }
        );

        if (expectedCommit) {
          expect(commitStagedExtraction).toHaveBeenCalledOnce();
          expect(commitStagedExtraction.mock.calls[0]?.[3]).toBe(expectedCleanup);
        } else {
          expect(commitStagedExtraction).not.toHaveBeenCalled();
        }
        expect(exit).toHaveBeenCalledWith(exitCode);
      } finally {
        stdout.mockRestore();
      }
    });
  });
});
