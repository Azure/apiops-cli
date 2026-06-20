// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Core TypeScript interfaces
 * ResourceDescriptor, ResourcePayload, ApimServiceContext, DependencyEdge
 */

import { ResourceType } from './resource-types.js';

export interface ResourceDescriptor {
  type: ResourceType;
  /**
   * Ordered name-parts that fill the positional `{0}`, `{1}`, … placeholders
   * in both `armPathSuffix` and `artifactDirectory` for this resource type.
   *
   * Examples:
   *   NamedValue "mySecret"                   → nameParts: ['mySecret']
   *   ApiOperation api="petstore" op="get"     → nameParts: ['petstore', 'get']
   *   ApiOperationPolicy api="petstore" op="get" → nameParts: ['petstore', 'get']
   *   ServicePolicy                            → nameParts: []
   */
  nameParts: string[];
  /** Workspace name if workspace-scoped */
  workspace?: string;
}

export interface ResourcePayload {
  descriptor: ResourceDescriptor;
  /** Raw JSON from APIM GET response (properties envelope). Never parsed into typed fields. */
  json: Record<string, unknown>;
}

/**
 * Scope of a resource referenced by a workspace association link.
 *
 * Workspace products (and other workspace association parents) can link to
 * resources that live either inside the workspace (`workspace`) or at the
 * service level (`service`, e.g. the built-in `administrators`/`developers`/
 * `guests` groups). The scope must be preserved so publish can rebuild the
 * link target's ARM path at the correct scope.
 */
export type AssociationScope = 'service' | 'workspace';

/**
 * An entry in an association file (apis.json, groups.json, tags.json).
 *
 * `scope` is optional for backward compatibility: legacy artifacts and
 * service-scoped associations store only `{ name }`. When present, it records
 * whether the linked resource lives at service or workspace scope.
 */
export interface AssociationEntry {
  name: string;
  scope?: AssociationScope;
}

export interface ApimServiceContext {
  subscriptionId: string;
  resourceGroup: string;
  serviceName: string;
  apiVersion: string;
  baseUrl: string;
}

export interface DependencyEdge {
  from: ResourceType;
  to: ResourceType;
  required: boolean;
}

export interface PublishAction {
  type: 'put' | 'delete';
  descriptor: ResourceDescriptor;
  /** JSON body for PUT; undefined for DELETE */
  payload?: Record<string, unknown>;
  /** Dry-run description of what would change */
  description: string;
}
