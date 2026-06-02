// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArtifactStore } from '../../../src/clients/artifact-store.js';
import { ResourceDescriptor } from '../../../src/models/types.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('ArtifactStore', () => {
  let store: ArtifactStore;
  let tmpDir: string;

  beforeEach(async () => {
    store = new ArtifactStore();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-store-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('writeResource / readResource', () => {
    it('should write and read back a resource', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['mySecret'],
      };
      const json = { properties: { displayName: 'My Secret', value: 'hidden' } };

      await store.writeResource(tmpDir, descriptor, json);
      const result = await store.readResource(tmpDir, descriptor);

      expect(result).toEqual(json);
    });

    it('should return undefined for non-existent resource', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['does-not-exist'],
      };
      const result = await store.readResource(tmpDir, descriptor);
      expect(result).toBeUndefined();
    });

    it('should create parent directories as needed', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Backend,
        nameParts: ['deep-backend'],
      };

      await store.writeResource(tmpDir, descriptor, { url: 'https://example.com' });

      const expectedDir = path.join(tmpDir, 'backends', 'deep-backend');
      const stat = await fs.stat(expectedDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should handle types with no info file gracefully', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ProductTag,
        nameParts: ['my-product', 'my-tag'],
      };

      // writeResource should be a no-op
      await store.writeResource(tmpDir, descriptor, { test: true });
      // readResource should return undefined
      const result = await store.readResource(tmpDir, descriptor);
      expect(result).toBeUndefined();
    });
  });

  describe('writeContent / readContent', () => {
    it('should write and read policy XML', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['my-api'],
      };
      const policy = '<policies><inbound /></policies>';

      await store.writeContent(tmpDir, descriptor, policy, 'policy');
      const result = await store.readContent(tmpDir, descriptor, 'policy');

      expect(result).toBeDefined();
      expect(result!.content).toBe(policy);
    });

    it('should write and read API specification', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      const spec = 'openapi: "3.0.0"\ninfo:\n  title: My API';

      await store.writeContent(tmpDir, descriptor, spec, 'specification', 'yaml');
      const result = await store.readContent(tmpDir, descriptor, 'specification');

      expect(result).toBeDefined();
      expect(result!.content).toBe(spec);
      expect(result!.format).toBe('yaml');
    });

    it('should return undefined for non-existent policy', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['no-api'],
      };
      const result = await store.readContent(tmpDir, descriptor, 'policy');
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent specification', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['no-api'],
      };
      const result = await store.readContent(tmpDir, descriptor, 'specification');
      expect(result).toBeUndefined();
    });

    it('should decode HTML entities in policy XML (newlines)', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['my-api'],
      };
      // Simulate APIM's JSON response with encoded newlines
      const policyWithEntities = '<set-variable name="test" value="@{&#xD;&#xA;    var x = 1;&#xD;&#xA;}" />';
      const expectedPolicy = '<set-variable name="test" value="@{\r\n    var x = 1;\r\n}" />';

      await store.writeContent(tmpDir, descriptor, policyWithEntities, 'policy');
      const result = await store.readContent(tmpDir, descriptor, 'policy');

      expect(result).toBeDefined();
      expect(result!.content).toBe(expectedPolicy);
    });

    it('should decode HTML entities in policy XML (all standard entities)', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ServicePolicy,
        nameParts: [],
      };
      // Test multiple HTML entities
      const policyWithEntities =
        '<policies>&quot;test&quot; &apos;value&apos; &lt;tag&gt; &amp; &amp;#xD;&#xA;</policies>';
      const expectedPolicy = '<policies>"test" \'value\' <tag> & &#xD;\n</policies>';

      await store.writeContent(tmpDir, descriptor, policyWithEntities, 'policy');
      const result = await store.readContent(tmpDir, descriptor, 'policy');

      expect(result).toBeDefined();
      expect(result!.content).toBe(expectedPolicy);
    });

    it('should handle lowercase HTML entity variants', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ProductPolicy,
        nameParts: ['my-product'],
      };
      // APIM may return lowercase variants
      const policyWithEntities = '<set-variable value="@{&#xd;&#xa;test&#xd;&#xa;}" />';
      const expectedPolicy = '<set-variable value="@{\r\ntest\r\n}" />';

      await store.writeContent(tmpDir, descriptor, policyWithEntities, 'policy');
      const result = await store.readContent(tmpDir, descriptor, 'policy');

      expect(result).toBeDefined();
      expect(result!.content).toBe(expectedPolicy);
    });

    it('should not decode entities in specifications, only policies', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      // Specification should NOT be decoded (these are true entity references in YAML/OpenAPI)
      const spec = 'title: &quot;My API&quot;';

      await store.writeContent(tmpDir, descriptor, spec, 'specification', 'yaml');
      const result = await store.readContent(tmpDir, descriptor, 'specification');

      expect(result).toBeDefined();
      expect(result!.content).toBe(spec);
    });

    it('should preserve policy content without HTML entities', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['my-api'],
      };
      const policy = `<policies>
  <inbound>
    <set-variable name="test" value="@(context.Request.Headers["x-custom"])" />
  </inbound>
</policies>`;

      await store.writeContent(tmpDir, descriptor, policy, 'policy');
      const result = await store.readContent(tmpDir, descriptor, 'policy');

      expect(result).toBeDefined();
      expect(result!.content).toBe(policy);
    });
  });

  describe('writeAssociation / readAssociation', () => {
    it('should write and read product-api association', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['starter'],
      };
      const apis = ['api1', 'api2'];

      await store.writeAssociation(tmpDir, descriptor, 'apis', apis);
      const result = await store.readAssociation(tmpDir, descriptor, 'apis');

      expect(result).toEqual(apis);
    });

    it('should return empty array for missing association', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['no-product'],
      };
      const result = await store.readAssociation(tmpDir, descriptor, 'apis');
      expect(result).toEqual([]);
    });
  });

  describe('deleteResource', () => {
    it('should delete an existing resource directory', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Tag,
        nameParts: ['delete-me'],
      };

      await store.writeResource(tmpDir, descriptor, { name: 'delete-me' });

      // Verify it exists
      const before = await store.readResource(tmpDir, descriptor);
      expect(before).toBeDefined();

      // Delete it
      await store.deleteResource(tmpDir, descriptor);

      // Verify it's gone
      const after = await store.readResource(tmpDir, descriptor);
      expect(after).toBeUndefined();
    });

    it('should not throw when deleting non-existent resource', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Tag,
        nameParts: ['never-existed'],
      };
      await expect(store.deleteResource(tmpDir, descriptor)).resolves.not.toThrow();
    });
  });

  describe('listResources', () => {
    it('should return empty array for empty directory', async () => {
      const result = await store.listResources(tmpDir);
      expect(result).toEqual([]);
    });

    it('should return empty array for non-existent directory', async () => {
      const result = await store.listResources(path.join(tmpDir, 'nonexistent'));
      expect(result).toEqual([]);
    });

    it('should list resources after writing them', async () => {
      await store.writeResource(tmpDir, { type: ResourceType.Api, nameParts: ['api1'] }, { id: 1 });
      await store.writeResource(tmpDir, { type: ResourceType.Api, nameParts: ['api2'] }, { id: 2 });
      await store.writeResource(tmpDir, { type: ResourceType.Product, nameParts: ['prod1'] }, { id: 3 });

      const result = await store.listResources(tmpDir);
      expect(result.length).toBeGreaterThanOrEqual(3);

      const apiNames = result
        .filter((d) => d.type === ResourceType.Api)
        .map((d) => d.nameParts[0])
        .sort();
      expect(apiNames).toContain('api1');
      expect(apiNames).toContain('api2');

      const productNames = result
        .filter((d) => d.type === ResourceType.Product)
        .map((d) => d.nameParts[0]);
      expect(productNames).toContain('prod1');
    });
  });

  describe('UTF-8 encoding', () => {
    it('should handle unicode resource names', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['héllo-wörld'],
      };
      const json = { properties: { displayName: 'Héllo Wörld' } };

      await store.writeResource(tmpDir, descriptor, json);
      const result = await store.readResource(tmpDir, descriptor);
      expect(result).toEqual(json);
    });
  });
});
