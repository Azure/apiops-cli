// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T011: Static dependency graph implementation
 * 33 resource types, 4 tiers, topological sort, cycle-detection assertion
 */

import { ResourceType } from '../models/resource-types.js';
import { DependencyEdge } from '../models/types.js';

/**
 * Static dependency edges between resource types.
 *
 * Note: This dependency graph is resource-type-based and does not account for
 * workspace-specific dependency variations. All resource types have the same
 * dependency rules regardless of workspace context. This is correct for the
 * current APIM API (2024-05-01) where workspace scoping does not introduce
 * different dependency relationships.
 */
export const DEPENDENCY_EDGES: DependencyEdge[] = [
  // Tier 1 -> Tier 2 dependencies
  { from: ResourceType.Diagnostic, to: ResourceType.Logger, required: false },
  { from: ResourceType.ServicePolicy, to: ResourceType.NamedValue, required: false },
  { from: ResourceType.ServicePolicy, to: ResourceType.PolicyFragment, required: false },
  { from: ResourceType.Api, to: ResourceType.VersionSet, required: false },

  // Tier 2 -> Tier 3 dependencies
  { from: ResourceType.ProductPolicy, to: ResourceType.Product, required: true },
  { from: ResourceType.ProductGroup, to: ResourceType.Product, required: true },
  { from: ResourceType.ProductGroup, to: ResourceType.Group, required: true },
  { from: ResourceType.ProductTag, to: ResourceType.Product, required: true },
  { from: ResourceType.ProductTag, to: ResourceType.Tag, required: true },
  { from: ResourceType.ProductApi, to: ResourceType.Product, required: true },
  { from: ResourceType.ProductApi, to: ResourceType.Api, required: true },
  { from: ResourceType.ProductWiki, to: ResourceType.Product, required: true },

  { from: ResourceType.ApiPolicy, to: ResourceType.Api, required: true },
  { from: ResourceType.ApiTag, to: ResourceType.Api, required: true },
  { from: ResourceType.ApiTag, to: ResourceType.Tag, required: true },
  { from: ResourceType.ApiDiagnostic, to: ResourceType.Api, required: true },
  { from: ResourceType.ApiDiagnostic, to: ResourceType.Logger, required: false },
  { from: ResourceType.ApiOperation, to: ResourceType.Api, required: true },
  { from: ResourceType.ApiSchema, to: ResourceType.Api, required: true },
  { from: ResourceType.ApiRelease, to: ResourceType.Api, required: true },
  { from: ResourceType.ApiTagDescription, to: ResourceType.Api, required: true },
  { from: ResourceType.ApiTagDescription, to: ResourceType.Tag, required: true },
  { from: ResourceType.ApiWiki, to: ResourceType.Api, required: true },
  { from: ResourceType.GraphQLResolver, to: ResourceType.Api, required: true },

  { from: ResourceType.GatewayApi, to: ResourceType.Gateway, required: true },
  { from: ResourceType.GatewayApi, to: ResourceType.Api, required: true },

  { from: ResourceType.Subscription, to: ResourceType.Product, required: false },
  { from: ResourceType.Subscription, to: ResourceType.Api, required: false },

  { from: ResourceType.McpServer, to: ResourceType.Api, required: true },

  // Tier 3 -> Tier 4 dependencies
  { from: ResourceType.ApiOperationPolicy, to: ResourceType.ApiOperation, required: true },
  { from: ResourceType.GraphQLResolverPolicy, to: ResourceType.GraphQLResolver, required: true },
];

export const TIER_1_RESOURCES: ResourceType[] = [
  ResourceType.NamedValue,
  ResourceType.Tag,
  ResourceType.Gateway,
  ResourceType.VersionSet,
  ResourceType.Backend,
  ResourceType.Logger,
  ResourceType.Group,
  ResourceType.PolicyFragment,
  ResourceType.GlobalSchema,
  ResourceType.PolicyRestriction,
  ResourceType.Documentation,
];

export const TIER_2_RESOURCES: ResourceType[] = [
  ResourceType.Diagnostic,
  ResourceType.ServicePolicy,
  ResourceType.Product,
  ResourceType.Api,
];

export const TIER_3_RESOURCES: ResourceType[] = [
  ResourceType.ProductPolicy,
  ResourceType.ProductGroup,
  ResourceType.ProductTag,
  ResourceType.ProductApi,
  ResourceType.ProductWiki,
  ResourceType.ApiPolicy,
  ResourceType.ApiTag,
  ResourceType.ApiDiagnostic,
  ResourceType.ApiOperation,
  ResourceType.ApiSchema,
  ResourceType.ApiRelease,
  ResourceType.ApiTagDescription,
  ResourceType.ApiWiki,
  ResourceType.McpServer,
  ResourceType.GraphQLResolver,
  ResourceType.GatewayApi,
  ResourceType.Subscription,
];

export const TIER_4_RESOURCES: ResourceType[] = [
  ResourceType.ApiOperationPolicy,
  ResourceType.GraphQLResolverPolicy,
];

/**
 * Returns all resource types in topological order (dependencies first).
 * This is the order in which resources should be extracted and published.
 */
export function getTopologicalOrder(): ResourceType[] {
  return [
    ...TIER_1_RESOURCES,
    ...TIER_2_RESOURCES,
    ...TIER_3_RESOURCES,
    ...TIER_4_RESOURCES,
  ];
}

/**
 * Returns the tier number (1-4) for a given resource type.
 */
export function getResourceTier(type: ResourceType): number {
  if (TIER_1_RESOURCES.includes(type)) return 1;
  if (TIER_2_RESOURCES.includes(type)) return 2;
  if (TIER_3_RESOURCES.includes(type)) return 3;
  if (TIER_4_RESOURCES.includes(type)) return 4;
  throw new Error(`Unknown resource type: ${type}`);
}

/**
 * Returns all dependencies for a given resource type.
 */
export function getDependencies(type: ResourceType): DependencyEdge[] {
  return DEPENDENCY_EDGES.filter((edge) => edge.from === type);
}

/**
 * Returns all resource types that depend on a given resource type.
 */
export function getDependents(type: ResourceType): ResourceType[] {
  return DEPENDENCY_EDGES.filter((edge) => edge.to === type).map(
    (edge) => edge.from
  );
}

/**
 * Validates that the dependency graph is acyclic.
 * Throws an error if a cycle is detected.
 */
export function assertAcyclic(): void {
  const visited = new Set<ResourceType>();
  const recursionStack = new Set<ResourceType>();

  function hasCycle(current: ResourceType): boolean {
    visited.add(current);
    recursionStack.add(current);

    const deps = getDependencies(current);
    for (const edge of deps) {
      if (!visited.has(edge.to)) {
        if (hasCycle(edge.to)) {
          return true;
        }
      } else if (recursionStack.has(edge.to)) {
        return true;
      }
    }

    recursionStack.delete(current);
    return false;
  }

  for (const type of getTopologicalOrder()) {
    if (!visited.has(type)) {
      if (hasCycle(type)) {
        throw new Error('Dependency graph contains a cycle');
      }
    }
  }
}

// Assert at module load time that the graph is acyclic
assertAcyclic();
