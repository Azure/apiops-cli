// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Workspace link response helpers.
 *
 * In workspace scope, association resources (ProductApi, ProductGroup, ApiTag,
 * ProductTag) use "link" endpoints that return objects shaped like:
 *   { name: "opaqueLinkId", properties: { apiId: "/subscriptions/.../apis/myApi" } }
 *
 * This module provides helpers to extract the actual resource name from
 * these link responses and to build link payloads for publishing.
 */

import { ApimServiceContext } from '../models/types.js';

/**
 * Extracts the resource name from a workspace link response item.
 *
 * Link responses store the associated resource's full ARM ID in a property
 * (e.g. `properties.apiId`). This function extracts the last path segment
 * (the resource name) from that ARM ID.
 *
 * @param json - Raw link response item from LIST
 * @param linkIdProperty - Property name containing the ARM ID (e.g. 'apiId', 'groupId')
 * @returns The extracted resource name, or undefined if not found
 */
export function extractNameFromLink(
  json: Record<string, unknown>,
  linkIdProperty: string
): string | undefined {
  const properties = json.properties as Record<string, unknown> | undefined;
  if (!properties) {
    return undefined;
  }

  const armId = properties[linkIdProperty];
  if (typeof armId !== 'string' || armId.length === 0) {
    return undefined;
  }

  // ARM resource IDs look like: /subscriptions/.../apis/myApiName
  // Extract the last segment as the resource name
  const segments = armId.split('/');
  const lastSegment = segments[segments.length - 1];
  return lastSegment && lastSegment.length > 0
    ? decodeURIComponent(lastSegment)
    : undefined;
}

/**
 * Builds the full ARM resource ID for a workspace-scoped resource.
 * Used when creating link resources that reference another resource via its ARM ID.
 *
 * @param context - APIM service context (may be service-scoped or workspace-scoped)
 * @param resourcePath - The ARM path segment (e.g. 'apis/myApi' or 'groups/myGroup')
 * @param workspace - Optional workspace name; required when context is service-scoped
 * @returns Full ARM resource ID
 */
export function buildWorkspaceResourceId(
  context: ApimServiceContext,
  resourcePath: string,
  workspace?: string
): string {
  const url = new URL(context.baseUrl);
  const basePath = url.pathname;

  // If context already includes the workspace segment, use it directly
  if (isWorkspaceScope(context)) {
    return `${basePath}/${resourcePath}`;
  }

  // Context is service-scoped — prepend the workspace segment from the descriptor
  if (workspace) {
    return `${basePath}/workspaces/${encodeURIComponent(workspace)}/${resourcePath}`;
  }

  // Fallback: no workspace info available (should not happen in practice)
  return `${basePath}/${resourcePath}`;
}

/**
 * Checks whether a service context is workspace-scoped.
 * Workspace-scoped contexts have `/workspaces/{name}` appended after the
 * APIM service segment in their base URL. We match the specific ARM path
 * structure rather than a naive substring check, so an API or resource
 * named "workspaces" won't cause a false positive.
 */
const WORKSPACE_SCOPE_PATTERN = /\/Microsoft\.ApiManagement\/service\/[^/]+\/workspaces\/[^/]+/i;

export function isWorkspaceScope(context: ApimServiceContext): boolean {
  return WORKSPACE_SCOPE_PATTERN.test(context.baseUrl);
}

/**
 * Builds the PUT payload for creating a workspace link resource.
 *
 * @param context - APIM service context (may be service-scoped or workspace-scoped)
 * @param linkIdProperty - Property name for the ARM ID (e.g. 'apiId', 'groupId')
 * @param resourceType - The ARM resource type segment (e.g. 'apis', 'groups', 'products')
 * @param resourceName - The resource name to link to
 * @param workspace - Optional workspace name; required when context is service-scoped
 * @returns PUT payload for the link resource
 */
export function buildLinkPayload(
  context: ApimServiceContext,
  linkIdProperty: string,
  resourceType: string,
  resourceName: string,
  workspace?: string
): Record<string, unknown> {
  const resourceId = buildWorkspaceResourceId(
    context,
    `${resourceType}/${encodeURIComponent(resourceName)}`,
    workspace
  );

  return {
    properties: {
      [linkIdProperty]: resourceId,
    },
  };
}
