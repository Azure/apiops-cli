// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Extract command CLI registration
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createExtractCommand,
  executeExtract,
  outputText,
  shouldRemoveStaleArtifacts,
} from '../../../src/cli/extract-command.js';
import { ExtractionResult } from '../../../src/services/extract-service.js';
import { ApimClient } from '../../../src/clients/apim-client.js';
import { IArtifactStore } from '../../../src/clients/iartifact-store.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApiExtractionResult } from '../../../src/services/api-extractor.js';
import { TypeExtractionResult } from '../../../src/services/resource-extractor.js';
import { ArtifactStore } from '../../../src/clients/artifact-store.js';
import type { ExtractConfig } from '../../../src/models/config.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

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

  describe('executeExtract stale dependencies', () => {
    const orders = { type: ResourceType.Api, nameParts: ['orders'] };

    /** Extract into `output` with `filterYaml`, where the extract finds only API orders. */
    async function extractOrders(root: string, output: string, filterYaml: string, store: ArtifactStore): Promise<string[]> {
      const filterPath = path.join(root, 'filter.yaml');
      await fs.writeFile(filterPath, filterYaml);
      const result: ExtractionResult = {
        totalExtracted: 1,
        totalErrors: 0,
        typeResults: [],
        apiResults: [],
        productResults: [],
        workspaceResults: [],
        extractedDescriptors: [orders],
        collectedPolicies: new Map(),
        exitCode: 0,
      };
      const runExtraction = vi.fn(async (_client: unknown, _store: unknown, config: ExtractConfig) => {
        await store.writeResource(config.outputDir, orders, { name: 'orders', properties: {} });
        return result;
      });
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        await executeExtract(
          { resourceGroup: 'rg-1', serviceName: 'apim-1', output, filter: filterPath, transitive: true, removeStale: true },
          { subscriptionId: 'sub-1', format: 'json' },
          { runExtraction, createClient: () => ({}) as ApimClient, createStore: () => store, exit: vi.fn() }
        );
      } finally {
        stdout.mockRestore();
      }
      return (await store.listResources(output))
        .map((descriptor) => `${descriptor.type}:${descriptor.nameParts.join('/')}`)
        .sort();
    }

    it('should remove an old link to a tag the filter excludes, and the tag', async () => {
      const filterYaml = "apis: [orders]\ntags: ['!internal']\n";
      const tagName = 'internal';
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-extract-stale-'));
      const output = path.join(root, 'artifacts');
      const store = new ArtifactStore();
      try {
        await store.writeResource(output, orders, { name: 'orders', properties: {} });
        await store.writeResource(output, { type: ResourceType.ApiTag, nameParts: ['orders', tagName] }, { properties: {} });
        await store.writeResource(output, { type: ResourceType.Tag, nameParts: [tagName] }, { name: tagName, properties: {} });
        await store.writeResource(output, { type: ResourceType.Tag, nameParts: ['standalone'] }, { name: 'standalone', properties: {} });

        // Every other tag is in this filter's scope, so standalone goes too: the extract did not find it.
        expect(await extractOrders(root, output, filterYaml, store)).toEqual(['Api:orders']);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('outputText', () => {
    function typeResult(type: ResourceType, successCount: number, errorCount = 0): TypeExtractionResult {
      return {
        type,
        extracted: Array.from({ length: successCount }, (_, i) => ({
          descriptor: { type, nameParts: [`${type}-${i}`] },
          json: {},
          status: 'success' as const,
        })),
        totalCount: successCount + errorCount,
        errorCount,
      };
    }

    function apiResult(apiName: string, overrides: Partial<ApiExtractionResult> = {}): ApiExtractionResult {
      return {
        apiName,
        errorCount: 0,
        revisions: [],
        specification: false,
        operations: [],
        operationPolicies: [],
        tags: [],
        diagnostics: [],
        schemas: [],
        releases: [],
        tagDescriptions: [],
        wiki: false,
        mcpServer: false,
        resolvers: [],
        resolverPolicies: [],
        policies: [],
        ...overrides,
      };
    }

    function render(result: ExtractionResult, elapsedMs: number): string {
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        outputText(result, elapsedMs);
        return stdout.mock.calls.map((call) => String(call[0])).join('');
      } finally {
        stdout.mockRestore();
      }
    }

    const baseResult: ExtractionResult = {
      totalExtracted: 0,
      totalErrors: 0,
      typeResults: [],
      apiResults: [],
      productResults: [],
      workspaceResults: [],
      extractedDescriptors: [],
      collectedPolicies: new Map(),
      exitCode: 0,
    };

    it('groups extracted types by dependency tier', () => {
      const output = render(
        {
          ...baseResult,
          typeResults: [
            typeResult(ResourceType.NamedValue, 2),
            typeResult(ResourceType.Api, 1),
            typeResult(ResourceType.Subscription, 3, 1),
            typeResult(ResourceType.Tag, 1),
          ],
        },
        0
      );

      expect(output).toContain(
        'Tier 1: Independent resources\n  Extracted 2 NamedValue(s)\n  Extracted 1 Tag(s)\n\n'
      );
      expect(output).toContain('Tier 2: Resources with dependencies\n  Extracted 1 Api(s)\n\n');
      expect(output).toContain(
        'Tier 3: Child resources\n  Extracted 3 Subscription(s)\n  Failed 1 Subscription(s)\n\n'
      );
      expect(output.indexOf('Tier 1:')).toBeLessThan(output.indexOf('Tier 2:'));
      expect(output.indexOf('Tier 2:')).toBeLessThan(output.indexOf('Tier 3:'));
    });

    it('lists every API, including those without sub-resources', () => {
      const output = render(
        {
          ...baseResult,
          apiResults: [
            apiResult('echo', {
              specification: true,
              operations: [{ descriptor: { type: ResourceType.ApiOperation, nameParts: ['echo', 'get'] }, json: {}, status: 'success' }],
            }),
            apiResult('src-graphql-synthetic'),
          ],
        },
        0
      );

      expect(output).toContain('  API "echo": spec, 1 ops\n');
      expect(output).toContain('  API "src-graphql-synthetic": definition only\n');
    });

    it('lists extracted APIs whose sub-resource extraction failed', () => {
      const output = render(
        {
          ...baseResult,
          typeResults: [
            {
              type: ResourceType.Api,
              extracted: [
                { descriptor: { type: ResourceType.Api, nameParts: ['echo'] }, json: {}, status: 'success' },
                { descriptor: { type: ResourceType.Api, nameParts: ['broken'] }, json: {}, status: 'success' },
              ],
              totalCount: 2,
              errorCount: 0,
            },
          ],
          apiResults: [apiResult('echo', { specification: true })],
        },
        0
      );

      expect(output).toContain('APIs:\n  API "echo": spec\n  API "broken": sub-resource extraction failed\n');
    });

    it('includes elapsed time on the Total line', () => {
      const output = render({ ...baseResult, totalExtracted: 96 }, 12_345);

      expect(output).toContain('Total: 96 resources extracted, 0 errors in 12.3s\n');
    });
  });
});
