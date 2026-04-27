/**
 * T007: Core TypeScript interfaces
 * ResourceDescriptor, ResourcePayload, ApimServiceContext, DependencyEdge
 */

import { ResourceType } from './resource-types.js';

export interface ResourceDescriptor {
  type: ResourceType;
  name: string;
  /** Parent resource name (e.g., API name for ApiOperation) */
  parent?: string;
  /** Grandparent resource name (e.g., API name for ApiOperationPolicy) */
  grandparent?: string;
  /** Workspace name if workspace-scoped */
  workspace?: string;
}

export interface ResourcePayload {
  descriptor: ResourceDescriptor;
  /** Raw JSON from APIM GET response (properties envelope). Never parsed into typed fields. */
  json: Record<string, unknown>;
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
