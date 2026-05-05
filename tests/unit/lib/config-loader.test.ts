import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFilterConfig, loadOverrideConfig, loadOTelConfig } from '../../../src/lib/config-loader.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('config-loader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadFilterConfig', () => {
    it('should load a valid filter YAML file', async () => {
      const content = `
apiNames:
  - api1
  - api2
productNames:
  - starter
tagNames:
  - v1
`;
      const filePath = path.join(tmpDir, 'filter.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.apiNames).toEqual(['api1', 'api2']);
      expect(config!.productNames).toEqual(['starter']);
      expect(config!.tagNames).toEqual(['v1']);
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
apiNames: "not-an-array"
`;
      const filePath = path.join(tmpDir, 'bad.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      await expect(loadFilterConfig(filePath)).rejects.toThrow('must be an array');
    });

    it('should throw for array containing non-strings', async () => {
      const content = `
apiNames:
  - 123
  - true
`;
      const filePath = path.join(tmpDir, 'bad2.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      await expect(loadFilterConfig(filePath)).rejects.toThrow('must be a string');
    });

    it('should handle all filter fields', async () => {
      const content = `
apiNames: [a]
backendNames: [b]
productNames: [c]
namedValueNames: [d]
loggerNames: [e]
diagnosticNames: [f]
tagNames: [g]
policyFragmentNames: [h]
gatewayNames: [i]
versionSetNames: [j]
groupNames: [k]
subscriptionNames: [l]
schemaNames: [m]
policyRestrictionNames: [n]
documentationNames: [o]
workspaceNames: [p]
`;
      const filePath = path.join(tmpDir, 'all-fields.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadFilterConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.apiNames).toEqual(['a']);
      expect(config!.workspaceNames).toEqual(['p']);
    });
  });

  describe('loadOverrideConfig', () => {
    it('should load a valid override YAML file', async () => {
      const content = `
namedValues:
  nv1:
    value: "overridden"
backends:
  be1:
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
  });

  describe('loadOTelConfig', () => {
    it('should load a valid OTel YAML file', async () => {
      const content = `
exporters:
  otlp:
    endpoint: "http://localhost:4317"
service:
  pipelines:
    traces:
      exporters: [otlp]
`;
      const filePath = path.join(tmpDir, 'otel.yaml');
      await fs.writeFile(filePath, content, 'utf-8');

      const config = await loadOTelConfig(filePath);
      expect(config).toBeDefined();
      expect(config!.exporters).toBeDefined();
    });

    it('should return undefined for missing file', async () => {
      const config = await loadOTelConfig(path.join(tmpDir, 'nonexistent.yaml'));
      expect(config).toBeUndefined();
    });

    it('should handle completely empty file', async () => {
      const filePath = path.join(tmpDir, 'blank.yaml');
      await fs.writeFile(filePath, '', 'utf-8');

      const config = await loadOTelConfig(filePath);
      expect(config).toBeDefined();
      expect(config).toEqual({});
    });

    it('should handle file with only whitespace', async () => {
      const filePath = path.join(tmpDir, 'whitespace.yaml');
      await fs.writeFile(filePath, '   \n  \n  ', 'utf-8');

      const config = await loadOTelConfig(filePath);
      expect(config).toBeDefined();
      expect(config).toEqual({});
    });
  });
});
