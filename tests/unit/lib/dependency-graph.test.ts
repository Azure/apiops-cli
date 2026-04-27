import { describe, it, expect } from 'vitest';
import {
  DEPENDENCY_EDGES,
  TIER_1_RESOURCES,
  TIER_2_RESOURCES,
  TIER_3_RESOURCES,
  TIER_4_RESOURCES,
  getTopologicalOrder,
  getResourceTier,
  getDependencies,
  getDependents,
  assertAcyclic,
} from '../../../src/lib/dependency-graph.js';
import { ResourceType } from '../../../src/models/resource-types.js';

describe('dependency-graph', () => {
  describe('tier constants', () => {
    it('should have 33 total resources across all tiers', () => {
      const total =
        TIER_1_RESOURCES.length +
        TIER_2_RESOURCES.length +
        TIER_3_RESOURCES.length +
        TIER_4_RESOURCES.length;
      expect(total).toBe(33);
    });

    it('should not have duplicate resources across tiers', () => {
      const all = [
        ...TIER_1_RESOURCES,
        ...TIER_2_RESOURCES,
        ...TIER_3_RESOURCES,
        ...TIER_4_RESOURCES,
      ];
      const unique = new Set(all);
      expect(unique.size).toBe(all.length);
    });

    it('should place independent resources in tier 1', () => {
      expect(TIER_1_RESOURCES).toContain(ResourceType.NamedValue);
      expect(TIER_1_RESOURCES).toContain(ResourceType.Tag);
      expect(TIER_1_RESOURCES).toContain(ResourceType.Backend);
      expect(TIER_1_RESOURCES).toContain(ResourceType.Logger);
    });

    it('should place resources with only tier-1 deps in tier 2', () => {
      expect(TIER_2_RESOURCES).toContain(ResourceType.Diagnostic);
      expect(TIER_2_RESOURCES).toContain(ResourceType.Api);
      expect(TIER_2_RESOURCES).toContain(ResourceType.Product);
      expect(TIER_2_RESOURCES).toContain(ResourceType.ServicePolicy);
    });

    it('should place child resources in tier 3', () => {
      expect(TIER_3_RESOURCES).toContain(ResourceType.ApiPolicy);
      expect(TIER_3_RESOURCES).toContain(ResourceType.ProductApi);
      expect(TIER_3_RESOURCES).toContain(ResourceType.ApiOperation);
    });

    it('should place grandchild resources in tier 4', () => {
      expect(TIER_4_RESOURCES).toContain(ResourceType.ApiOperationPolicy);
      expect(TIER_4_RESOURCES).toContain(ResourceType.GraphQLResolverPolicy);
    });
  });

  describe('getTopologicalOrder', () => {
    it('should return all 33 resource types', () => {
      const order = getTopologicalOrder();
      expect(order).toHaveLength(33);
    });

    it('should return tier-1 resources before tier-2', () => {
      const order = getTopologicalOrder();
      const tier1End = Math.max(...TIER_1_RESOURCES.map((t) => order.indexOf(t)));
      const tier2Start = Math.min(...TIER_2_RESOURCES.map((t) => order.indexOf(t)));
      expect(tier1End).toBeLessThan(tier2Start);
    });

    it('should return tier-2 resources before tier-3', () => {
      const order = getTopologicalOrder();
      const tier2End = Math.max(...TIER_2_RESOURCES.map((t) => order.indexOf(t)));
      const tier3Start = Math.min(...TIER_3_RESOURCES.map((t) => order.indexOf(t)));
      expect(tier2End).toBeLessThan(tier3Start);
    });

    it('should return tier-3 resources before tier-4', () => {
      const order = getTopologicalOrder();
      const tier3End = Math.max(...TIER_3_RESOURCES.map((t) => order.indexOf(t)));
      const tier4Start = Math.min(...TIER_4_RESOURCES.map((t) => order.indexOf(t)));
      expect(tier3End).toBeLessThan(tier4Start);
    });
  });

  describe('getResourceTier', () => {
    it('should return 1 for tier-1 resources', () => {
      for (const t of TIER_1_RESOURCES) {
        expect(getResourceTier(t)).toBe(1);
      }
    });

    it('should return 2 for tier-2 resources', () => {
      for (const t of TIER_2_RESOURCES) {
        expect(getResourceTier(t)).toBe(2);
      }
    });

    it('should return 3 for tier-3 resources', () => {
      for (const t of TIER_3_RESOURCES) {
        expect(getResourceTier(t)).toBe(3);
      }
    });

    it('should return 4 for tier-4 resources', () => {
      for (const t of TIER_4_RESOURCES) {
        expect(getResourceTier(t)).toBe(4);
      }
    });
  });

  describe('getDependencies', () => {
    it('should return empty for tier-1 resources (no deps)', () => {
      expect(getDependencies(ResourceType.NamedValue)).toHaveLength(0);
      expect(getDependencies(ResourceType.Tag)).toHaveLength(0);
      expect(getDependencies(ResourceType.Backend)).toHaveLength(0);
    });

    it('should return Logger dependency for Diagnostic', () => {
      const deps = getDependencies(ResourceType.Diagnostic);
      expect(deps.some((d) => d.to === ResourceType.Logger)).toBe(true);
    });

    it('should return Api and Tag dependencies for ApiTag', () => {
      const deps = getDependencies(ResourceType.ApiTag);
      expect(deps.some((d) => d.to === ResourceType.Api)).toBe(true);
      expect(deps.some((d) => d.to === ResourceType.Tag)).toBe(true);
    });

    it('should return ApiOperation dependency for ApiOperationPolicy', () => {
      const deps = getDependencies(ResourceType.ApiOperationPolicy);
      expect(deps.some((d) => d.to === ResourceType.ApiOperation)).toBe(true);
    });
  });

  describe('getDependents', () => {
    it('should return dependents for Api (many child types)', () => {
      const dependents = getDependents(ResourceType.Api);
      expect(dependents.length).toBeGreaterThan(5);
      expect(dependents).toContain(ResourceType.ApiPolicy);
      expect(dependents).toContain(ResourceType.ApiOperation);
      expect(dependents).toContain(ResourceType.ApiTag);
    });

    it('should return dependents for Tag', () => {
      const dependents = getDependents(ResourceType.Tag);
      expect(dependents).toContain(ResourceType.ProductTag);
      expect(dependents).toContain(ResourceType.ApiTag);
    });

    it('should return no dependents for leaf types', () => {
      expect(getDependents(ResourceType.ApiOperationPolicy)).toHaveLength(0);
      expect(getDependents(ResourceType.GraphQLResolverPolicy)).toHaveLength(0);
    });
  });

  describe('DEPENDENCY_EDGES', () => {
    it('should only reference valid resource types', () => {
      const validTypes = new Set(Object.values(ResourceType));
      for (const edge of DEPENDENCY_EDGES) {
        expect(validTypes.has(edge.from), `Invalid 'from' type: ${edge.from}`).toBe(true);
        expect(validTypes.has(edge.to), `Invalid 'to' type: ${edge.to}`).toBe(true);
      }
    });

    it('dependencies should always go from higher tier to lower tier', () => {
      for (const edge of DEPENDENCY_EDGES) {
        const fromTier = getResourceTier(edge.from);
        const toTier = getResourceTier(edge.to);
        expect(
          fromTier > toTier,
          `Edge ${edge.from}(tier ${fromTier}) -> ${edge.to}(tier ${toTier}) goes wrong direction`
        ).toBe(true);
      }
    });
  });

  describe('assertAcyclic', () => {
    it('should not throw for the current graph', () => {
      expect(() => assertAcyclic()).not.toThrow();
    });
  });
});
