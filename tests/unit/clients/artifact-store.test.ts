// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ArtifactStore } from '../../../src/clients/artifact-store.js';
import { ResourceDescriptor } from '../../../src/models/types.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildArtifactFilePath,
  buildAssociationFilePath,
  buildPolicyFilePath,
  buildSpecificationFilePath,
} from '../../../src/lib/resource-path.js';
import { shouldReconcileResource } from '../../../src/services/filter-service.js';

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

      expect(result).toEqual(apis.map(name => ({ name })));
    });

    it('should preserve association scope round-trip', async () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Product,
        nameParts: ['ws-product'],
      };
      const entries = [
        { name: 'administrators', scope: 'service' as const },
        { name: 'ws-group', scope: 'workspace' as const },
      ];

      await store.writeAssociation(tmpDir, descriptor, 'groups', entries);
      const result = await store.readAssociation(tmpDir, descriptor, 'groups');

      expect(result).toEqual(entries);
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

      const apis = result
        .filter((d) => d.type === ResourceType.Api)
        .map((d) => d.nameParts[0])
        .sort();
      expect(apis).toContain('api1');
      expect(apis).toContain('api2');

      const products = result
        .filter((d) => d.type === ResourceType.Product)
        .map((d) => d.nameParts[0]);
      expect(products).toContain('prod1');
    });
  });

  describe('commitStagedExtraction', () => {
    it('should remove stale in-scope artifacts and preserve excluded or unmanaged files', async () => {
      const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
      const currentApi = { type: ResourceType.Api, nameParts: ['current-api'] };
      const staleApi = { type: ResourceType.Api, nameParts: ['stale-api'] };
      const excludedApi = { type: ResourceType.Api, nameParts: ['excluded-api'] };

      try {
        await store.writeResource(tmpDir, currentApi, { version: 'old' });
        await store.writeResource(tmpDir, staleApi, { version: 'stale' });
        await store.writeResource(tmpDir, excludedApi, { version: 'excluded' });
        await fs.writeFile(path.join(tmpDir, 'notes.md'), 'keep me', 'utf-8');
        await store.writeResource(stagingDir, currentApi, { version: 'new' });

        await store.commitStagedExtraction(
          stagingDir,
          tmpDir,
          descriptor => descriptor.nameParts[0] !== 'excluded-api',
          true
        );

        await expect(store.readResource(tmpDir, currentApi)).resolves.toEqual({ version: 'new' });
        await expect(store.readResource(tmpDir, staleApi)).resolves.toBeUndefined();
        await expect(store.readResource(tmpDir, excludedApi)).resolves.toEqual({ version: 'excluded' });
        await expect(fs.readFile(path.join(tmpDir, 'notes.md'), 'utf-8')).resolves.toBe('keep me');
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    });

    it('should preserve stale artifacts when cleanup is disabled', async () => {
      const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
      const staleApi = { type: ResourceType.Api, nameParts: ['stale-api'] };

      try {
        await store.writeResource(tmpDir, staleApi, { version: 'stale' });

        await store.commitStagedExtraction(stagingDir, tmpDir, () => true, false);

        await expect(store.readResource(tmpDir, staleApi)).resolves.toEqual({ version: 'stale' });
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    });

    it('should remove a stale gateway association file omitted from staging', async () => {
      const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
      const gateway = { type: ResourceType.Gateway, nameParts: ['gateway-1'] };

      try {
        await store.writeResource(tmpDir, gateway, { name: 'gateway-1' });
        await store.writeAssociation(tmpDir, gateway, 'apis', ['old-api']);
        await store.writeResource(stagingDir, gateway, { name: 'gateway-1' });

        await store.commitStagedExtraction(stagingDir, tmpDir, () => true, true);

        await expect(fs.access(buildAssociationFilePath(tmpDir, gateway, 'apis'))).rejects.toThrow();
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    });

    it('should remove stale API specifications and wikis', async () => {
      const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
      const api = { type: ResourceType.Api, nameParts: ['api-1'] };
      const apiWiki = { type: ResourceType.ApiWiki, nameParts: ['api-1'] };
      const product = { type: ResourceType.Product, nameParts: ['product-1'] };
      const productWiki = { type: ResourceType.ProductWiki, nameParts: ['product-1'] };

      try {
        await store.writeResource(tmpDir, api, { name: 'api-1' });
        await store.writeContent(tmpDir, api, 'openapi: 3.0.0', 'specification', 'yaml');
        await store.writeResource(tmpDir, apiWiki, { name: 'default' });
        await store.writeResource(tmpDir, product, { name: 'product-1' });
        await store.writeResource(tmpDir, productWiki, { name: 'default' });
        await store.writeResource(stagingDir, api, { name: 'api-1' });
        await store.writeResource(stagingDir, product, { name: 'product-1' });

        await store.commitStagedExtraction(stagingDir, tmpDir, () => true, true);

        await expect(store.readContent(tmpDir, api, 'specification')).resolves.toBeUndefined();
        await expect(store.readResource(tmpDir, apiWiki)).resolves.toBeUndefined();
        await expect(store.readResource(tmpDir, productWiki)).resolves.toBeUndefined();
        await expect(fs.access(buildSpecificationFilePath(tmpDir, api, 'yaml'))).rejects.toThrow();
        await expect(fs.access(buildArtifactFilePath(tmpDir, apiWiki)!)).rejects.toThrow();
        await expect(fs.access(buildArtifactFilePath(tmpDir, productWiki)!)).rejects.toThrow();
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    });

    it.each([undefined, 'workspace-1'])(
      'should remove every managed supplemental artifact in workspace %s',
      async (workspace) => {
        const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
        const api = { type: ResourceType.Api, nameParts: ['api-1'], workspace };
        const apiPolicy = { type: ResourceType.ApiPolicy, nameParts: ['api-1'], workspace };
        const apiWiki = { type: ResourceType.ApiWiki, nameParts: ['api-1'], workspace };
        const product = { type: ResourceType.Product, nameParts: ['product-1'], workspace };
        const productPolicy = { type: ResourceType.ProductPolicy, nameParts: ['product-1'], workspace };
        const productWiki = { type: ResourceType.ProductWiki, nameParts: ['product-1'], workspace };
        const operationPolicy = { type: ResourceType.ApiOperationPolicy, nameParts: ['api-1', 'op-1'], workspace };
        const resolverPolicy = { type: ResourceType.GraphQLResolverPolicy, nameParts: ['api-1', 'resolver-1'], workspace };
        const gateway = { type: ResourceType.Gateway, nameParts: ['gateway-1'], workspace };
        const formats = ['yaml', 'json', 'graphql', 'wsdl', 'wadl'] as const;

        try {
          await store.writeResource(tmpDir, api, { name: 'api-1' });
          await store.writeResource(tmpDir, apiWiki, { name: 'default' });
          await store.writeContent(tmpDir, apiPolicy, '<policies />', 'policy');
          await store.writeContent(tmpDir, operationPolicy, '<policies />', 'policy');
          await store.writeContent(tmpDir, resolverPolicy, '<policies />', 'policy');
          if (!workspace) {
            await store.writeContent(
              tmpDir,
              { type: ResourceType.ServicePolicy, nameParts: [] },
              '<policies />',
              'policy'
            );
          }
          for (const format of formats) {
            await store.writeContent(tmpDir, api, `spec-${format}`, 'specification', format);
          }
          await store.writeResource(tmpDir, product, { name: 'product-1' });
          await store.writeResource(tmpDir, productWiki, { name: 'default' });
          await store.writeContent(tmpDir, productPolicy, '<policies />', 'policy');
          await store.writeAssociation(tmpDir, product, 'apis', ['api-1']);
          await store.writeAssociation(tmpDir, product, 'groups', ['group-1']);
          await store.writeAssociation(tmpDir, product, 'tags', ['tag-1']);
          await store.writeResource(tmpDir, gateway, { name: 'gateway-1' });
          await store.writeAssociation(tmpDir, gateway, 'apis', ['api-1']);

          await store.writeResource(stagingDir, api, { name: 'api-1' });
          await store.writeResource(stagingDir, product, { name: 'product-1' });
          await store.writeResource(stagingDir, gateway, { name: 'gateway-1' });

          await store.commitStagedExtraction(stagingDir, tmpDir, () => true, true);

          for (const format of formats) {
            await expect(fs.access(buildSpecificationFilePath(tmpDir, api, format))).rejects.toThrow();
          }
          await expect(fs.access(buildPolicyFilePath(tmpDir, apiPolicy))).rejects.toThrow();
          await expect(fs.access(buildPolicyFilePath(tmpDir, operationPolicy))).rejects.toThrow();
          await expect(fs.access(buildPolicyFilePath(tmpDir, resolverPolicy))).rejects.toThrow();
          if (!workspace) {
            await expect(fs.access(buildPolicyFilePath(
              tmpDir,
              { type: ResourceType.ServicePolicy, nameParts: [] }
            ))).rejects.toThrow();
          }
          await expect(fs.access(buildArtifactFilePath(tmpDir, apiWiki)!)).rejects.toThrow();
          await expect(fs.access(buildPolicyFilePath(tmpDir, productPolicy))).rejects.toThrow();
          await expect(fs.access(buildArtifactFilePath(tmpDir, productWiki)!)).rejects.toThrow();
          for (const association of ['apis', 'groups', 'tags'] as const) {
            await expect(fs.access(buildAssociationFilePath(tmpDir, product, association))).rejects.toThrow();
          }
          await expect(fs.access(buildAssociationFilePath(tmpDir, gateway, 'apis'))).rejects.toThrow();
        } finally {
          await fs.rm(stagingDir, { recursive: true, force: true });
        }
      }
    );

    it('should reconcile only selected workspace sub-filter artifacts', async () => {
      const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
      const selected = { type: ResourceType.Api, nameParts: ['selected'], workspace: 'ws-1' };
      const excluded = { type: ResourceType.Api, nameParts: ['excluded'], workspace: 'ws-1' };
      const otherWorkspace = { type: ResourceType.Api, nameParts: ['selected'], workspace: 'ws-2' };
      const filter = {
        workspaces: ['ws-1'],
        workspaceSubFilters: { 'ws-1': { apis: ['selected'] } },
      };

      try {
        await store.writeResource(tmpDir, selected, { name: 'selected' });
        await store.writeResource(tmpDir, excluded, { name: 'excluded' });
        await store.writeResource(tmpDir, otherWorkspace, { name: 'selected' });

        await store.commitStagedExtraction(
          stagingDir,
          tmpDir,
          descriptor => shouldReconcileResource(descriptor, filter),
          true
        );

        await expect(store.readResource(tmpDir, selected)).resolves.toBeUndefined();
        await expect(store.readResource(tmpDir, excluded)).resolves.toEqual({ name: 'excluded' });
        await expect(store.readResource(tmpDir, otherWorkspace)).resolves.toEqual({ name: 'selected' });
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    });

    it('should restore the original output when committing the candidate fails', async () => {
      const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
      const descriptor = { type: ResourceType.Api, nameParts: ['api-1'] };
      const rename = vi.fn<typeof fs.rename>(async (oldPath, newPath) => {
        if (path.basename(String(oldPath)).startsWith(`.${path.basename(tmpDir)}.candidate-`)) {
          throw new Error('candidate rename failed');
        }
        await fs.rename(oldPath, newPath);
      });
      const failingStore = new ArtifactStore({ rename, rm: fs.rm });

      try {
        await store.writeResource(tmpDir, descriptor, { version: 'old' });
        await store.writeResource(stagingDir, descriptor, { version: 'new' });

        await expect(
          failingStore.commitStagedExtraction(stagingDir, tmpDir, () => true, true)
        ).rejects.toThrow('candidate rename failed');
        await expect(store.readResource(tmpDir, descriptor)).resolves.toEqual({ version: 'old' });
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    });

    it('should preserve the original output when creating the backup fails', async () => {
      const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
      const descriptor = { type: ResourceType.Api, nameParts: ['api-1'] };
      const rename = vi.fn<typeof fs.rename>().mockRejectedValue(new Error('backup rename failed'));
      const failingStore = new ArtifactStore({ rename, rm: fs.rm });

      try {
        await store.writeResource(tmpDir, descriptor, { version: 'old' });
        await store.writeResource(stagingDir, descriptor, { version: 'new' });

        await expect(
          failingStore.commitStagedExtraction(stagingDir, tmpDir, () => true, true)
        ).rejects.toThrow('backup rename failed');
        await expect(store.readResource(tmpDir, descriptor)).resolves.toEqual({ version: 'old' });
        expect(rename).toHaveBeenCalledOnce();
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    });

    it('should preserve the backup and report both errors when rollback fails', async () => {
      const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
      const descriptor = { type: ResourceType.Api, nameParts: ['api-1'] };
      let renameCall = 0;
      const rename = vi.fn<typeof fs.rename>(async (oldPath, newPath) => {
        renameCall++;
        if (renameCall > 1) {
          throw new Error(renameCall === 2 ? 'candidate rename failed' : 'restore failed');
        }
        await fs.rename(oldPath, newPath);
      });
      const failingStore = new ArtifactStore({ rename, rm: fs.rm });

      try {
        await store.writeResource(tmpDir, descriptor, { version: 'old' });
        await store.writeResource(stagingDir, descriptor, { version: 'new' });

        const error = await failingStore
          .commitStagedExtraction(stagingDir, tmpDir, () => true, true)
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toHaveLength(2);
        expect((error as Error).message).toContain('Backup remains at');
        const backups = (await fs.readdir(path.dirname(tmpDir)))
          .filter((entry) => entry.startsWith(`.${path.basename(tmpDir)}.backup-`));
        expect(backups).toHaveLength(1);
        await expect(store.readResource(path.join(path.dirname(tmpDir), backups[0]), descriptor))
          .resolves.toEqual({ version: 'old' });
        await fs.rm(path.join(path.dirname(tmpDir), backups[0]), { recursive: true, force: true });
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
    });

    it('should succeed when removing the committed backup fails', async () => {
      const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-staging-'));
      const descriptor = { type: ResourceType.Api, nameParts: ['api-1'] };
      const remove = vi.fn<typeof fs.rm>(async (target, options) => {
        if (String(target).includes('.backup-')) {
          throw new Error('backup cleanup failed');
        }
        await fs.rm(target, options);
      });
      const resilientStore = new ArtifactStore({ rename: fs.rename, rm: remove });

      try {
        await store.writeResource(tmpDir, descriptor, { version: 'old' });
        await store.writeResource(stagingDir, descriptor, { version: 'new' });

        await expect(
          resilientStore.commitStagedExtraction(stagingDir, tmpDir, () => true, true)
        ).resolves.toBeUndefined();
        await expect(store.readResource(tmpDir, descriptor)).resolves.toEqual({ version: 'new' });
        const backups = (await fs.readdir(path.dirname(tmpDir)))
          .filter((entry) => entry.startsWith(`.${path.basename(tmpDir)}.backup-`));
        expect(backups).toHaveLength(1);
        for (const backup of backups) {
          await fs.rm(path.join(path.dirname(tmpDir), backup), { recursive: true, force: true });
        }
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true });
      }
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
