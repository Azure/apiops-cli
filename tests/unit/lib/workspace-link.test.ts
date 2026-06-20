// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect } from 'vitest';
import {
  extractScopeFromLinkId,
  extractLinkTarget,
  buildWorkspaceResourceId,
  buildLinkPayload,
} from '../../../src/lib/workspace-link.js';
import { ApimServiceContext } from '../../../src/models/types.js';

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
