/**
 * Unit tests for T024: Filter service
 */

import { describe, it, expect } from 'vitest';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ResourceDescriptor } from '../../../src/models/types.js';
import { FilterConfig } from '../../../src/models/config.js';
import {
  shouldIncludeResource,
  filterResources,
  extractRootApiName,
} from '../../../src/services/filter-service.js';

describe('filter-service', () => {
  describe('shouldIncludeResource', () => {
    it('should include all resources when no filter is provided', () => {
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'my-api',
      };
      expect(shouldIncludeResource(descriptor)).toBe(true);
      expect(shouldIncludeResource(descriptor, undefined)).toBe(true);
    });

    it('should include resources when filter field is undefined', () => {
      const filter: FilterConfig = { productNames: ['my-product'] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'my-api',
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should exclude all resources when filter field is empty array', () => {
      const filter: FilterConfig = { apiNames: [] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'my-api',
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(false);
    });

    it('should include matching resources (case-insensitive)', () => {
      const filter: FilterConfig = { apiNames: ['My-Api'] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'my-api',
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should exclude non-matching resources', () => {
      const filter: FilterConfig = { apiNames: ['other-api'] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'my-api',
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(false);
    });

    it('should match API revisions by root name', () => {
      const filter: FilterConfig = { apiNames: ['my-api'] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        name: 'my-api;rev=2',
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should filter child resources by parent name', () => {
      const filter: FilterConfig = { apiNames: ['my-api'] };

      // ApiPolicy child — should match by parent API name
      const policyDescriptor: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        name: 'policy',
        parent: 'my-api',
      };
      expect(shouldIncludeResource(policyDescriptor, filter)).toBe(true);

      // Non-matching parent
      const otherPolicy: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        name: 'policy',
        parent: 'other-api',
      };
      expect(shouldIncludeResource(otherPolicy, filter)).toBe(false);
    });

    it('should filter grandchild resources by grandparent name', () => {
      const filter: FilterConfig = { apiNames: ['my-api'] };

      // ApiOperationPolicy — should match by grandparent API name
      const opPolicy: ResourceDescriptor = {
        type: ResourceType.ApiOperationPolicy,
        name: 'policy',
        parent: 'get-users',
        grandparent: 'my-api',
      };
      expect(shouldIncludeResource(opPolicy, filter)).toBe(true);

      const otherOpPolicy: ResourceDescriptor = {
        type: ResourceType.ApiOperationPolicy,
        name: 'policy',
        parent: 'get-users',
        grandparent: 'other-api',
      };
      expect(shouldIncludeResource(otherOpPolicy, filter)).toBe(false);
    });

    it('should filter product children by product name', () => {
      const filter: FilterConfig = { productNames: ['starter'] };

      const productPolicy: ResourceDescriptor = {
        type: ResourceType.ProductPolicy,
        name: 'policy',
        parent: 'starter',
      };
      expect(shouldIncludeResource(productPolicy, filter)).toBe(true);

      const otherProductPolicy: ResourceDescriptor = {
        type: ResourceType.ProductPolicy,
        name: 'policy',
        parent: 'premium',
      };
      expect(shouldIncludeResource(otherProductPolicy, filter)).toBe(false);
    });

    it('should not incorrectly match product children when parent is missing', () => {
      // Regression: product children without a parent should not fall back to
      // matching descriptor.name (which is the child's own name, not the product)
      const filter: FilterConfig = { productNames: ['policy'] };

      const orphanPolicy: ResourceDescriptor = {
        type: ResourceType.ProductPolicy,
        name: 'policy',
        // parent is intentionally omitted
      };
      // Without parent, filter can't determine which product this belongs to,
      // so it should be included by default (not matched against the child's own name)
      expect(shouldIncludeResource(orphanPolicy, filter)).toBe(true);
    });

    it('should filter product children by parent name, not by child name', () => {
      // Confirm that when parent IS present and filter does NOT match,
      // the child's own name does not cause a false positive
      const filter: FilterConfig = { productNames: ['starter'] };

      const productApi: ResourceDescriptor = {
        type: ResourceType.ProductApi,
        name: 'starter', // child name coincidentally matches filter
        parent: 'premium', // but parent does NOT match
      };
      expect(shouldIncludeResource(productApi, filter)).toBe(false);
    });

    it('should always include ServicePolicy', () => {
      const filter: FilterConfig = { apiNames: [] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ServicePolicy,
        name: 'policy',
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should filter named values', () => {
      const filter: FilterConfig = { namedValueNames: ['my-secret'] };
      const included: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        name: 'my-secret',
      };
      const excluded: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        name: 'other-value',
      };
      expect(shouldIncludeResource(included, filter)).toBe(true);
      expect(shouldIncludeResource(excluded, filter)).toBe(false);
    });

    it('should filter backends', () => {
      const filter: FilterConfig = { backendNames: ['my-backend'] };
      const included: ResourceDescriptor = {
        type: ResourceType.Backend,
        name: 'my-backend',
      };
      expect(shouldIncludeResource(included, filter)).toBe(true);
    });

    it('should filter gateways', () => {
      const filter: FilterConfig = { gatewayNames: ['gw-1'] };
      const included: ResourceDescriptor = {
        type: ResourceType.Gateway,
        name: 'gw-1',
      };
      expect(shouldIncludeResource(included, filter)).toBe(true);
    });

    it('should filter gateway children by gateway name', () => {
      const filter: FilterConfig = { gatewayNames: ['gw-1'] };
      const gwApi: ResourceDescriptor = {
        type: ResourceType.GatewayApi,
        name: 'my-api',
        parent: 'gw-1',
      };
      expect(shouldIncludeResource(gwApi, filter)).toBe(true);

      const otherGwApi: ResourceDescriptor = {
        type: ResourceType.GatewayApi,
        name: 'my-api',
        parent: 'gw-2',
      };
      expect(shouldIncludeResource(otherGwApi, filter)).toBe(false);
    });
  });

  describe('filterResources', () => {
    it('should return all resources when no filter', () => {
      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.Api, name: 'api-1' },
        { type: ResourceType.Api, name: 'api-2' },
      ];
      expect(filterResources(descriptors)).toEqual(descriptors);
    });

    it('should filter resources based on config', () => {
      const filter: FilterConfig = { apiNames: ['api-1'] };
      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.Api, name: 'api-1' },
        { type: ResourceType.Api, name: 'api-2' },
      ];
      const result = filterResources(descriptors, filter);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('api-1');
    });
  });

  describe('extractRootApiName', () => {
    it('should return name as-is when no revision suffix', () => {
      expect(extractRootApiName('my-api')).toBe('my-api');
    });

    it('should strip revision suffix', () => {
      expect(extractRootApiName('my-api;rev=2')).toBe('my-api');
      expect(extractRootApiName('my-api;rev=10')).toBe('my-api');
    });

    it('should handle empty string', () => {
      expect(extractRootApiName('')).toBe('');
    });
  });
});
