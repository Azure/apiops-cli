// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for finding stale pulled-in dependencies (extract --remove-stale)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactStore } from '../../../src/clients/artifact-store.js';
import type { IArtifactStore } from '../../../src/clients/iartifact-store.js';
import { logger } from '../../../src/lib/logger.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import type { ResourceDescriptor } from '../../../src/models/types.js';
import type { FilterConfig } from '../../../src/models/config.js';
import { findStaleDependencies } from '../../../src/services/stale-dependency-finder.js';

const orders: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['orders'] };
const billing: ResourceDescriptor = { type: ResourceType.Api, nameParts: ['billing'] };
const tag = (name: string): ResourceDescriptor => ({ type: ResourceType.Tag, nameParts: [name] });
const apiTag = (api: string, name: string): ResourceDescriptor => ({ type: ResourceType.ApiTag, nameParts: [api, name] });

/** The filter a team extracting only `orders` uses: dependencies are pulled in. */
const filter: FilterConfig = { apis: ['orders'], tags: [], loggers: [], namedValues: [] };

describe('stale-dependency-finder', () => {
  const store = new ArtifactStore();
  let root: string;
  let outputDir: string;
  let stagingDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-stale-'));
    outputDir = path.join(root, 'output');
    stagingDir = path.join(root, 'staging');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const write = (dir: string, descriptor: ResourceDescriptor, properties: Record<string, unknown> = {}) =>
    store.writeResource(dir, descriptor, { name: descriptor.nameParts.at(-1), properties });

  const names = (descriptors: ResourceDescriptor[]) =>
    descriptors.map((descriptor) => `${descriptor.type}:${descriptor.nameParts.join('/')}`).sort();

  it('should report a tag the selected API no longer links to', async () => {
    await write(outputDir, orders);
    await write(outputDir, apiTag('orders', 'public'));
    await write(outputDir, tag('public'));
    await write(stagingDir, orders);

    expect(names(await findStaleDependencies(store, outputDir, stagingDir, filter))).toEqual(['Tag:public']);
  });

  it('should keep a dependency another artifact in the output still references', async () => {
    await write(outputDir, orders);
    await write(outputDir, apiTag('orders', 'public'));
    await write(outputDir, billing);
    await write(outputDir, apiTag('billing', 'public'));
    await write(outputDir, tag('public'));
    await write(stagingDir, orders);

    expect(await findStaleDependencies(store, outputDir, stagingDir, filter)).toEqual([]);
  });

  it('should keep a dependency the extract wrote again', async () => {
    await write(outputDir, orders);
    await write(outputDir, apiTag('orders', 'public'));
    await write(outputDir, tag('public'));
    await write(stagingDir, orders);
    await write(stagingDir, apiTag('orders', 'public'));
    await write(stagingDir, tag('public'));

    expect(await findStaleDependencies(store, outputDir, stagingDir, filter)).toEqual([]);
  });

  it('should leave alone an out-of-scope artifact the selection never referenced', async () => {
    await write(outputDir, orders);
    await write(outputDir, tag('standalone'));
    await write(stagingDir, orders);

    expect(await findStaleDependencies(store, outputDir, stagingDir, filter)).toEqual([]);
  });

  it("should follow a dependency's own dependencies, including named values referenced by display name", async () => {
    const diagnostic: ResourceDescriptor = { type: ResourceType.ApiDiagnostic, nameParts: ['orders', 'applicationinsights'] };
    await write(outputDir, orders);
    await write(outputDir, diagnostic, { loggerId: '/loggers/ai' });
    await write(outputDir, { type: ResourceType.Logger, nameParts: ['ai'] }, { credentials: { instrumentationKey: '{{AI Key}}' } });
    await write(outputDir, { type: ResourceType.NamedValue, nameParts: ['ai-key'] }, { displayName: 'AI Key' });
    await write(stagingDir, orders);

    expect(names(await findStaleDependencies(store, outputDir, stagingDir, filter))).toEqual([
      'Logger:ai',
      'NamedValue:ai-key',
    ]);
  });

  it("should follow a policy attribute set to a named value to the backend the named value's value names", async () => {
    const policy = (api: string): ResourceDescriptor => ({ type: ResourceType.ApiPolicy, nameParts: [api] });
    const writePolicy = (dir: string, api: string) =>
      store.writeContent(dir, policy(api), '<policies><inbound><set-backend-service backend-id="{{Backend_Id}}" /></inbound></policies>', 'policy', 'xml');
    const backendFilter: FilterConfig = { ...filter, backends: [] };
    await write(outputDir, orders);
    await writePolicy(outputDir, 'orders');
    await write(outputDir, { type: ResourceType.NamedValue, nameParts: ['backend-id'] }, { displayName: 'Backend_Id', value: 'function-backend' });
    await write(outputDir, { type: ResourceType.Backend, nameParts: ['function-backend'] });
    await write(stagingDir, orders);

    expect(names(await findStaleDependencies(store, outputDir, stagingDir, backendFilter))).toEqual([
      'Backend:function-backend',
      'NamedValue:backend-id',
    ]);

    // Another API left in the output still sends requests to the backend.
    await write(outputDir, billing);
    await writePolicy(outputDir, 'billing');
    expect(await findStaleDependencies(store, outputDir, stagingDir, backendFilter)).toEqual([]);
  });

  it('should keep a named value only a Liquid body still uses, and report it once nothing does', async () => {
    const policy: ResourceDescriptor = { type: ResourceType.ApiPolicy, nameParts: ['orders'] };
    const liquid = '<policies><inbound><set-body template="liquid">nv=[{{Backend_Id}}] liquid=[{{body.id}}]</set-body></inbound></policies>';
    await write(outputDir, orders);
    await store.writeContent(outputDir, policy, liquid, 'policy', 'xml');
    await write(outputDir, { type: ResourceType.NamedValue, nameParts: ['backend-id'] }, { displayName: 'Backend_Id', value: 'x' });
    await write(stagingDir, orders);
    await store.writeContent(stagingDir, policy, liquid, 'policy', 'xml');

    expect(await findStaleDependencies(store, outputDir, stagingDir, filter)).toEqual([]);

    await store.writeContent(stagingDir, policy, '<policies><inbound /></policies>', 'policy', 'xml');
    expect(names(await findStaleDependencies(store, outputDir, stagingDir, filter))).toEqual(['NamedValue:backend-id']);
  });

  it("should keep a dependency's own dependency that another artifact still uses", async () => {
    const diagnostic: ResourceDescriptor = { type: ResourceType.ApiDiagnostic, nameParts: ['orders', 'applicationinsights'] };
    await write(outputDir, orders);
    await write(outputDir, diagnostic, { loggerId: '/loggers/ai' });
    await write(outputDir, { type: ResourceType.Logger, nameParts: ['ai'] }, { credentials: { instrumentationKey: '{{AI Key}}' } });
    await write(outputDir, { type: ResourceType.NamedValue, nameParts: ['ai-key'] }, { displayName: 'AI Key' });
    await write(outputDir, { type: ResourceType.Backend, nameParts: ['legacy'] }, { credentials: { header: { key: ['{{AI Key}}'] } } });
    await write(stagingDir, orders);

    // The backend is outside the filter, so --remove-stale keeps it.
    expect(names(await findStaleDependencies(store, outputDir, stagingDir, { ...filter, backends: [] }))).toEqual([
      'Logger:ai',
    ]);
  });

  it("should report a product's groups and tags it no longer links to, keeping one another product links to", async () => {
    const starter: ResourceDescriptor = { type: ResourceType.Product, nameParts: ['starter'] };
    const gold: ResourceDescriptor = { type: ResourceType.Product, nameParts: ['gold'] };
    await write(outputDir, starter);
    await store.writeAssociation(outputDir, starter, 'groups', [{ name: 'support-team' }, { name: 'partners' }]);
    await store.writeAssociation(outputDir, starter, 'tags', [{ name: 'promo' }]);
    await write(outputDir, gold);
    await store.writeAssociation(outputDir, gold, 'groups', [{ name: 'partners' }]);
    await write(outputDir, { type: ResourceType.Group, nameParts: ['support-team'] });
    await write(outputDir, { type: ResourceType.Group, nameParts: ['partners'] });
    await write(outputDir, tag('promo'));
    await write(stagingDir, starter);

    const productFilter: FilterConfig = { products: ['starter'], groups: [], tags: [] };
    expect(names(await findStaleDependencies(store, outputDir, stagingDir, productFilter))).toEqual([
      'Group:support-team',
      'Tag:promo',
    ]);
  });

  it("should decide workspace artifacts by the workspace's sub-filter, including a link to a service-level group", async () => {
    const wsOrders: ResourceDescriptor = { ...orders, workspace: 'team-a' };
    const wsStarter: ResourceDescriptor = { type: ResourceType.Product, nameParts: ['starter'], workspace: 'team-a' };
    const gold: ResourceDescriptor = { type: ResourceType.Product, nameParts: ['gold'] };
    await write(outputDir, wsOrders);
    await write(outputDir, { ...apiTag('orders', 'public'), workspace: 'team-a' });
    await write(outputDir, { ...tag('public'), workspace: 'team-a' });
    await write(outputDir, wsStarter);
    await store.writeAssociation(outputDir, wsStarter, 'groups', [
      { name: 'partners', scope: 'service' },
      { name: 'auditors', scope: 'service' },
    ]);
    await write(outputDir, gold);
    await store.writeAssociation(outputDir, gold, 'groups', [{ name: 'partners' }]);
    await write(outputDir, { type: ResourceType.Group, nameParts: ['partners'] });
    await write(outputDir, { type: ResourceType.Group, nameParts: ['auditors'] });
    await write(stagingDir, wsOrders);
    await write(stagingDir, wsStarter);

    const workspaceFilter: FilterConfig = {
      products: [],
      groups: [],
      workspaceSubFilters: { 'team-*': { apis: ['orders'], products: ['starter'], tags: [] } },
    };
    // The service-level product gold (outside the filter) still links to partners.
    expect(names(await findStaleDependencies(store, outputDir, stagingDir, workspaceFilter))).toEqual([
      'Group:auditors',
      'Tag:public',
    ]);
  });

  it('should report nothing when an artifact left in the output cannot be checked', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await write(outputDir, orders);
    await write(outputDir, apiTag('orders', 'public'));
    await write(outputDir, tag('public'));
    await write(outputDir, billing);
    await write(stagingDir, orders);
    const failingStore: IArtifactStore = Object.create(store);
    failingStore.readResource = async (dir, descriptor) => {
      if (descriptor.nameParts[0] === 'billing') {
        throw new Error('Unexpected token in JSON');
      }
      return store.readResource(dir, descriptor);
    };

    try {
      expect(await findStaleDependencies(failingStore, outputDir, stagingDir, { ...filter, apis: ['orders'] })).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Keeping every pulled-in dependency'));
    } finally {
      warn.mockRestore();
    }
  });

  it('should report an excluded tag that only an old link from the selected API referenced', async () => {
    await write(outputDir, orders);
    await write(outputDir, apiTag('orders', 'internal'));
    await write(outputDir, tag('internal'));
    await write(stagingDir, orders);

    // The old link itself is removed as one of the API's children.
    expect(names(await findStaleDependencies(store, outputDir, stagingDir, { apis: ['orders'], tags: ['!internal'] })))
      .toEqual(['Tag:internal']);
  });

  it('should stop scanning once every candidate is known to be needed', async () => {
    await write(outputDir, orders);
    await write(outputDir, apiTag('orders', 'public'));
    await write(outputDir, tag('public'));
    for (let index = 0; index < 30; index++) {
      await write(outputDir, { type: ResourceType.Api, nameParts: [`other-${index}`] });
    }
    await write(stagingDir, orders);
    await write(stagingDir, billing);
    await write(stagingDir, apiTag('billing', 'public'));
    const countingStore: IArtifactStore = Object.create(store);
    let otherReads = 0;
    countingStore.readResource = async (dir, descriptor) => {
      if (descriptor.nameParts[0]?.startsWith('other-')) {
        otherReads++;
      }
      return store.readResource(dir, descriptor);
    };

    expect(await findStaleDependencies(countingStore, outputDir, stagingDir, { ...filter, apis: ['orders', 'billing'] })).toEqual([]);
    // The staged link from billing rescues the only candidate, so most of the other APIs are never read.
    expect(otherReads).toBeLessThan(30);
  });

  it('should read nothing when every existing artifact is selected or written again', async () => {
    await write(outputDir, orders);
    await write(outputDir, apiTag('orders', 'public'));
    await write(outputDir, tag('public'));
    await write(stagingDir, orders);
    await write(stagingDir, tag('public'));
    const countingStore: IArtifactStore = Object.create(store);
    let reads = 0;
    countingStore.readResource = async (dir, descriptor) => {
      reads++;
      return store.readResource(dir, descriptor);
    };

    expect(await findStaleDependencies(countingStore, outputDir, stagingDir, { apis: ['orders'] })).toEqual([]);
    expect(reads).toBe(0);
  });
});
