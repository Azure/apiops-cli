// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractScopeFromLinkId,
  extractLinkTarget,
  buildWorkspaceResourceId,
  buildLinkPayload,
  listWorkspaceTagLinks,
} from '../../../src/lib/workspace-link.js';
import { ApimServiceContext } from '../../../src/models/types.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { logger } from '../../../src/lib/logger.js';
import type { IApimClient } from '../../../src/clients/iapim-client.js';

const SERVICE_BASE =
  'https://management.azure.com/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/apim';
const WORKSPACE_BASE = `${SERVICE_BASE}/workspaces/ws`;

function makeContext(baseUrl: string): ApimServiceContext {
  return {
    baseUrl,
    subscriptionId: 'sub',
    resourceGroup: 'rg',
    serviceName: 'apim',
  } as ApimServiceContext;
}

describe('extractScopeFromLinkId', () => {
  it('returns "workspace" for workspace-scoped ARM IDs', () => {
    const id = `${WORKSPACE_BASE}/groups/devs`;
    expect(extractScopeFromLinkId(id)).toBe('workspace');
  });

  it('returns "service" for service-scoped ARM IDs', () => {
    const id = `${SERVICE_BASE}/groups/administrators`;
    expect(extractScopeFromLinkId(id)).toBe('service');
  });

  it('is case-insensitive on the provider segment', () => {
    const id = `${SERVICE_BASE.replace('Microsoft.ApiManagement', 'microsoft.apimanagement')}/workspaces/ws/groups/g`;
    expect(extractScopeFromLinkId(id)).toBe('workspace');
  });
});

describe('extractLinkTarget', () => {
  it('extracts name and service scope for a service-level group link', () => {
    const json = {
      name: 'opaque-link-id',
      properties: { groupId: `${SERVICE_BASE}/groups/administrators` },
    };
    expect(extractLinkTarget(json, 'groupId')).toEqual({
      name: 'administrators',
      scope: 'service',
    });
  });

  it('extracts name and workspace scope for a workspace-level group link', () => {
    const json = {
      name: 'opaque-link-id',
      properties: { groupId: `${WORKSPACE_BASE}/groups/ws-group` },
    };
    expect(extractLinkTarget(json, 'groupId')).toEqual({
      name: 'ws-group',
      scope: 'workspace',
    });
  });

  it('returns undefined when the ARM ID property is missing', () => {
    const json = { name: 'x', properties: {} };
    expect(extractLinkTarget(json, 'groupId')).toBeUndefined();
  });
});

describe('buildWorkspaceResourceId', () => {
  it('strips the workspace segment when scope is "service"', () => {
    const context = makeContext(WORKSPACE_BASE);
    const id = buildWorkspaceResourceId(context, 'groups/administrators', 'ws', 'service');
    expect(id).toBe(
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/apim/groups/administrators'
    );
    expect(id).not.toContain('/workspaces/');
  });

  it('keeps the workspace segment when scope is "workspace" and context is workspace-scoped', () => {
    const context = makeContext(WORKSPACE_BASE);
    const id = buildWorkspaceResourceId(context, 'groups/ws-group', 'ws', 'workspace');
    expect(id).toBe(
      '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/apim/workspaces/ws/groups/ws-group'
    );
  });

  it('prepends the workspace segment when context is service-scoped', () => {
    const context = makeContext(SERVICE_BASE);
    const id = buildWorkspaceResourceId(context, 'groups/ws-group', 'ws', 'workspace');
    expect(id).toContain('/workspaces/ws/groups/ws-group');
  });
});

describe('buildLinkPayload', () => {
  it('builds a service-scoped link target inside a workspace context', () => {
    const context = makeContext(WORKSPACE_BASE);
    const payload = buildLinkPayload(
      context,
      'groupId',
      'groups',
      'administrators',
      'ws',
      'service'
    );
    const groupId = (payload.properties as Record<string, unknown>).groupId as string;
    expect(groupId).not.toContain('/workspaces/');
    expect(groupId).toContain('/service/apim/groups/administrators');
  });

  it('builds a workspace-scoped link target by default', () => {
    const context = makeContext(WORKSPACE_BASE);
    const payload = buildLinkPayload(context, 'groupId', 'groups', 'ws-group', 'ws');
    const groupId = (payload.properties as Record<string, unknown>).groupId as string;
    expect(groupId).toContain('/workspaces/ws/groups/ws-group');
  });
});

describe('listWorkspaceTagLinks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A client whose tag-link listings come from `links` (tag name → link responses). */
  function clientWith(links: Record<string, Array<Record<string, unknown>> | Error>): IApimClient {
    return {
      listResources: async function* (_ctx: ApimServiceContext, _type: ResourceType, parent?: { nameParts: string[] }) {
        const entry = links[parent?.nameParts[0] ?? ''] ?? [];
        if (entry instanceof Error) throw entry;
        yield* entry;
      },
    } as unknown as IApimClient;
  }
  const collect = async <T>(items: AsyncIterable<T>) => {
    const result: T[] = [];
    for await (const item of items) result.push(item);
    return result;
  };

  it('should yield each tag with the API or product its links point at', async () => {
    const client = clientWith({
      public: [{ properties: { apiId: `${WORKSPACE_BASE}/apis/orders` } }, { properties: { apiId: `${WORKSPACE_BASE}/apis/billing` } }],
      internal: [],
    });

    await expect(collect(listWorkspaceTagLinks(client, makeContext(WORKSPACE_BASE), ['public', 'internal'], ResourceType.ApiTag)))
      .resolves.toEqual([{ tagName: 'public', targetName: 'orders' }, { tagName: 'public', targetName: 'billing' }]);
  });

  it('should throw for a link without a readable target', async () => {
    const client = clientWith({ partner: [{ properties: {} }] });

    await expect(collect(listWorkspaceTagLinks(client, makeContext(WORKSPACE_BASE), ['partner'], ResourceType.ProductTag)))
      .rejects.toThrow('Failed to extract product name from tag "partner" productLink response');
  });

  it('should warn and rethrow when listing a tag\'s links fails', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const client = clientWith({ public: new Error('HTTP 500') });

    await expect(collect(listWorkspaceTagLinks(client, makeContext(WORKSPACE_BASE), ['public'], ResourceType.ApiTag)))
      .rejects.toThrow('HTTP 500');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
