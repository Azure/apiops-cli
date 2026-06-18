// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadFilterConfig, loadOverrideConfig } from '../../../src/lib/config-loader.js';
import { logger } from '../../../src/lib/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('config-loader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadFilterConfig', () => {
    it('should load a valid filter YAML file', async () => {
      const content = `
apis:
  - api1
  - api2
products:
  - starter
tags:
  - v1
`;
      const filePath = path.join(tmpDir, 'filter.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.apis).toEqual(['api1', 'api2']);
      expect(config!.products).toEqual(['starter']);
      expect(config!.tags).toEqual(['v1']);
    });

    it('should return undefined for missing file', async () => {
      const config = await loadFilterConfig(path.join(tmpDir, 'nonexistent.yaml'));
      expect(config).toBeUndefined();
    });

    it('should return empty config for empty YAML', async () => {
      const filePath = path.join(tmpDir, 'empty.yaml');
      await fs.writeFile(filePath, '{}', 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
    });

    it('should handle completely empty file', async () => {
      const filePath = path.join(tmpDir, 'blank.yaml');
      await fs.writeFile(filePath, '', 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config).toEqual({});
    });

    it('should handle file with only comments', async () => {
      const filePath = path.join(tmpDir, 'comments.yaml');
      await fs.writeFile(filePath, '# This is a comment\n# Another comment', 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config).toEqual({});
    });

    it('should throw for invalid type (non-array field)', async () => {
      const content = `
apis: "not-an-array"
`;
      const filePath = path.join(tmpDir, 'bad.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      await expect(loadFilterConfig(filePath)).rejects.toThrow('must be an array');
    });

    it('should throw for array containing non-strings', async () => {
      const content = `
apis:
  - 123
  - true
`;
      const filePath = path.join(tmpDir, 'bad2.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      await expect(loadFilterConfig(filePath)).rejects.toThrow('must be a string');
    });

    it('should handle all filter fields', async () => {
      const content = `
apis: [a]
backends: [b]
products: [c]
namedValues: [d]
loggers: [e]
diagnostics: [f]
tags: [g]
policyFragments: [h]
gateways: [i]
versionSets: [j]
groups: [k]
subscriptions: [l]
schemas: [m]
policyRestrictions: [n]
documentations: [o]
workspaces: [p]
`;
      const filePath = path.join(tmpDir, 'all-fields.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.apis).toEqual(['a']);
      expect(config!.workspaces).toEqual(['p']);
    });

    it('should accept legacy *Names keys as aliases', async () => {
      const content = `
apiNames:
  - api1
  - api2
productNames:
  - starter
backendNames:
  - backend1
versionSetNames:
  - vs1
`;
      const filePath = path.join(tmpDir, 'legacy.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.apis).toEqual(['api1', 'api2']);
      expect(config!.products).toEqual(['starter']);
      expect(config!.backends).toEqual(['backend1']);
      expect(config!.versionSets).toEqual(['vs1']);
    });

    it('should throw when both Toolkit and legacy keys are used for the same field', async () => {
      const content = `
apis:
  - api1
apiNames:
  - api2
`;
      const filePath = path.join(tmpDir, 'conflict.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      await expect(loadFilterConfig(filePath)).rejects.toThrow(
        "contains both 'apis' and 'apiNames'"
      );
    });

    it('should accept a mix of Toolkit and legacy keys for different fields', async () => {
      const content = `
apis:
  - api1
backendNames:
  - backend1
versionSets:
  - vs1
`;
      const filePath = path.join(tmpDir, 'mixed.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.apis).toEqual(['api1']);
      expect(config!.backends).toEqual(['backend1']);
      expect(config!.versionSets).toEqual(['vs1']);
    });

    it('should load nested API filter entries', async () => {
      const content = `
apis:
  - simple-api
  - complex-api:
      operations:
        - get-pets
      diagnostics: []
`;
      const filePath = path.join(tmpDir, 'nested-api-filter.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.apis).toEqual(['simple-api', 'complex-api']);
      expect(config!.apiSubFilters).toEqual({
        'complex-api': {
          operations: ['get-pets'],
          diagnostics: [],
        },
      });
    });

    it('should load nested workspace filter entries', async () => {
      const content = `
workspaces:
  - ws-simple
  - ws-complex:
      apis:
        - api-a
      diagnostics: []
`;
      const filePath = path.join(tmpDir, 'nested-workspace-filter.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.workspaces).toEqual(['ws-simple', 'ws-complex']);
      expect(config!.workspaceSubFilters).toEqual({
        'ws-complex': {
          apis: ['api-a'],
          diagnostics: [],
        },
      });
    });

    it('should warn about unknown top-level filter keys', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const content = `
apis:
  - api1
mystery:
  - value
`;
      const filePath = path.join(tmpDir, 'unknown-filter-key.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config!.apis).toEqual(['api1']);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown filter config key 'mystery'"));
    });
  });

  describe('loadOverrideConfig', () => {
    it('should load a valid override YAML file', async () => {
      const content = `
namedValues:
  - name: nv1
    properties:
      value: "overridden"
backends:
  - name: be1
    properties:
      url: "https://new-backend.com"
`;
      const filePath = path.join(tmpDir, 'override.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadOverrideConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.namedValues).toBeDefined();
      expect(config!.backends).toBeDefined();
    });

    it('should return undefined for missing file', async () => {
      const config = await loadOverrideConfig(path.join(tmpDir, 'nonexistent.yaml'));
      expect(config).toBeUndefined();
    });

    it('should handle completely empty file', async () => {
      const filePath = path.join(tmpDir, 'blank.yaml');
      await fs.writeFile(filePath, '', 'utf-8');

      const config = await loadOverrideConfig(filePath);
      expect(config).toBeDefined();
      expect(config).toEqual({});
    });

    it('should handle file with only comments', async () => {
      const filePath = path.join(tmpDir, 'comments.yaml');
      await fs.writeFile(filePath, '# Override config\n# TODO: add overrides', 'utf-8');

      const config = await loadOverrideConfig(filePath);
      expect(config).toBeDefined();
      expect(config).toEqual({});
    });

    it('should normalize APIOps toolkit array format', async () => {
      const content = `
namedValues:
  - name: nv1
    properties:
      value: "overridden"
backends:
  - name: be1
    properties:
      url: "https://new-backend.com"
`;
      const filePath = path.join(tmpDir, 'override-toolkit.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadOverrideConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.namedValues).toEqual({
        nv1: {
          properties: {
            value: 'overridden',
          },
        },
      });
      expect(config!.backends).toEqual({
        be1: {
          properties: {
            url: 'https://new-backend.com',
          },
        },
      });
    });

    it('should throw for mixed toolkit and keyed-map override format', async () => {
      const content = `
namedValues:
  - name: nv1
    properties:
      value: "from-array"
backends:
  be1:
    url: "https://from-map.example.com"
`;
      const filePath = path.join(tmpDir, 'override-keyed-map.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      await expect(loadOverrideConfig(filePath)).rejects.toThrow(
        'Invalid overrides.backends: expected an array in toolkit format'
      );
    });

    it('should throw for pure keyed-map override format', async () => {
      const content = `
namedValues:
  nv1:
    value: "from-map"
backends:
  be1:
    url: "https://from-map.example.com"
`;
      const filePath = path.join(tmpDir, 'override-pure-keyed-map.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      await expect(loadOverrideConfig(filePath)).rejects.toThrow(
        'Invalid overrides.namedValues: expected an array in toolkit format'
      );
    });

    it('should fall back to item fields when toolkit item has no properties object', async () => {
      const content = `
namedValues:
  - name: nv1
    value: "inline-value"
`;
      const filePath = path.join(tmpDir, 'override-no-properties.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadOverrideConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.namedValues).toEqual({
        nv1: {
          properties: {
            value: 'inline-value',
          },
        },
      });
    });

    it('should throw for invalid override section type', async () => {
      const content = `
namedValues: 123
`;
      const filePath = path.join(tmpDir, 'override-invalid-section.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      await expect(loadOverrideConfig(filePath)).rejects.toThrow(
        'Invalid overrides.namedValues: expected an array in toolkit format'
      );
    });

    it('should ignore invalid array entries', async () => {
      const content = `
namedValues:
  - name: nv1
    properties:
      value: "valid"
backends:
  - properties:
      url: "https://missing-name.example.com"
  - name: "   "
    properties:
      url: "https://blank-name.example.com"
  - name: be1
    properties:
      url: "https://valid.example.com"
`;
      const filePath = path.join(tmpDir, 'override-invalid-items.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadOverrideConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.namedValues).toEqual({
        nv1: {
          properties: {
            value: 'valid',
          },
        },
      });
      expect(config!.backends).toEqual({
        be1: {
          properties: {
            url: 'https://valid.example.com',
          },
        },
      });
    });

    it('should load override sections beyond the original core set', async () => {
      const content = `
products:
  - name: starter
    properties:
      displayName: "Starter Plus"
gateways:
  - name: gw-1
    properties:
      description: "Gateway 1"
tags:
  - name: tag-a
    properties:
      displayName: "Tag A"
policies:
  - name: policy
    properties:
      format: "rawxml"
policyFragments:
  - name: fragment-a
    properties:
      format: "rawxml"
`;
      const filePath = path.join(tmpDir, 'override-all-sections.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadOverrideConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.products).toEqual({
        starter: {
          properties: {
            displayName: 'Starter Plus',
          },
        },
      });
      expect(config!.gateways).toEqual({
        'gw-1': {
          properties: {
            description: 'Gateway 1',
          },
        },
      });
      expect(config!.tags).toEqual({
        'tag-a': {
          properties: {
            displayName: 'Tag A',
          },
        },
      });
      expect(config!.policies).toEqual({
        policy: {
          properties: {
            format: 'rawxml',
          },
        },
      });
      expect(config!.policyFragments).toEqual({
        'fragment-a': {
          properties: {
            format: 'rawxml',
          },
        },
      });
    });

    it('should load nested API overrides with child sections', async () => {
      const content = `
apis:
  - name: my-api
    properties:
      serviceUrl: "https://prod.example.com"
    diagnostics:
      - name: applicationinsights
        properties:
          loggerId: "/new-logger"
    operations:
      - name: get-pets
        properties:
          method: "GET"
`;
      const filePath = path.join(tmpDir, 'override-nested-api.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadOverrideConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.apis).toEqual({
        'my-api': {
          properties: {
            serviceUrl: 'https://prod.example.com',
          },
          children: {
            diagnostics: {
              applicationinsights: {
                properties: {
                  loggerId: '/new-logger',
                },
              },
            },
            operations: {
              'get-pets': {
                properties: {
                  method: 'GET',
                },
              },
            },
          },
        },
      });
    });

    it('should warn when an override section contains duplicate names', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const content = `
namedValues:
  - name: nv1
    properties:
      value: "first"
  - name: nv1
    properties:
      value: "second"
`;
      const filePath = path.join(tmpDir, 'override-duplicate-names.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadOverrideConfig(filePath);
      expect(config!.namedValues).toEqual({
        nv1: {
          properties: {
            value: 'second',
          },
        },
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Duplicate name 'nv1' in overrides.namedValues")
      );
    });
  });
});
