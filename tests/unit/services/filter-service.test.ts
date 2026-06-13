// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Filter service
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
        nameParts: ['my-api'],
      };
      expect(shouldIncludeResource(descriptor)).toBe(true);
      expect(shouldIncludeResource(descriptor, undefined)).toBe(true);
    });

    it('should include resources when filter field is undefined', () => {
      const filter: FilterConfig = { products: ['my-product'] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should exclude all resources when filter field is empty array', () => {
      const filter: FilterConfig = { apis: [] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(false);
    });

    it('should include matching resources (case-insensitive)', () => {
      const filter: FilterConfig = { apis: ['My-Api'] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should exclude non-matching resources', () => {
      const filter: FilterConfig = { apis: ['other-api'] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api'],
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(false);
    });

    it('should match API revisions by root name', () => {
      const filter: FilterConfig = { apis: ['my-api'] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.Api,
        nameParts: ['my-api;rev=2'],
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should filter child resources by parent name', () => {
      const filter: FilterConfig = { apis: ['my-api'] };

      // ApiPolicy child — nameParts: [apiName]
      const policyDescriptor: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['my-api'],
      };
      expect(shouldIncludeResource(policyDescriptor, filter)).toBe(true);

      // Non-matching parent
      const otherPolicy: ResourceDescriptor = {
        type: ResourceType.ApiPolicy,
        nameParts: ['other-api'],
      };
      expect(shouldIncludeResource(otherPolicy, filter)).toBe(false);
    });

    it('should filter grandchild resources by grandparent name', () => {
      const filter: FilterConfig = { apis: ['my-api'] };

      // ApiOperationPolicy — nameParts: [apiName, opName], filter checks nameParts[0]
      const opPolicy: ResourceDescriptor = {
        type: ResourceType.ApiOperationPolicy,
        nameParts: ['my-api', 'get-users'],
      };
      expect(shouldIncludeResource(opPolicy, filter)).toBe(true);

      const otherOpPolicy: ResourceDescriptor = {
        type: ResourceType.ApiOperationPolicy,
        nameParts: ['other-api', 'get-users'],
      };
      expect(shouldIncludeResource(otherOpPolicy, filter)).toBe(false);
    });

    it('should filter product children by product name', () => {
      const filter: FilterConfig = { products: ['starter'] };

      // ProductPolicy — nameParts: [productName]
      const productPolicy: ResourceDescriptor = {
        type: ResourceType.ProductPolicy,
        nameParts: ['starter'],
      };
      expect(shouldIncludeResource(productPolicy, filter)).toBe(true);

      const otherProductPolicy: ResourceDescriptor = {
        type: ResourceType.ProductPolicy,
        nameParts: ['premium'],
      };
      expect(shouldIncludeResource(otherProductPolicy, filter)).toBe(false);
    });

    it('should filter product children by parent name, not by child name (ProductApi)', () => {
      // nameParts[0] = productName for ProductApi
      const filter: FilterConfig = { products: ['starter'] };

      // ProductApi with product='premium' should NOT match filter for 'starter'
      const productApi: ResourceDescriptor = {
        type: ResourceType.ProductApi,
        nameParts: ['premium', 'starter'], // product=premium, api=starter
      };
      expect(shouldIncludeResource(productApi, filter)).toBe(false);
    });

    it('should include ServicePolicy when policies filter is undefined', () => {
      const filter: FilterConfig = { apis: [] };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ServicePolicy,
        nameParts: [],
      };
      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should filter ServicePolicy via policies key', () => {
      // ServicePolicy has nameParts: [] — uses fixed singleton name "policy"
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ServicePolicy,
        nameParts: [],
      };

      // Include when listed
      const includeFilter: FilterConfig = { policies: ['policy'] };
      expect(shouldIncludeResource(descriptor, includeFilter)).toBe(true);

      // Exclude when empty array
      const excludeFilter: FilterConfig = { policies: [] };
      expect(shouldIncludeResource(descriptor, excludeFilter)).toBe(false);
    });

    it('should filter named values', () => {
      const filter: FilterConfig = { namedValues: ['my-secret'] };
      const included: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['my-secret'],
      };
      const excluded: ResourceDescriptor = {
        type: ResourceType.NamedValue,
        nameParts: ['other-value'],
      };
      expect(shouldIncludeResource(included, filter)).toBe(true);
      expect(shouldIncludeResource(excluded, filter)).toBe(false);
    });

    it('should filter backends', () => {
      const filter: FilterConfig = { backends: ['my-backend'] };
      const included: ResourceDescriptor = {
        type: ResourceType.Backend,
        nameParts: ['my-backend'],
      };
      expect(shouldIncludeResource(included, filter)).toBe(true);
    });

    it('should filter gateways', () => {
      const filter: FilterConfig = { gateways: ['gw-1'] };
      const included: ResourceDescriptor = {
        type: ResourceType.Gateway,
        nameParts: ['gw-1'],
      };
      expect(shouldIncludeResource(included, filter)).toBe(true);
    });

    it('should filter gateway children by gateway name', () => {
      const filter: FilterConfig = { gateways: ['gw-1'] };
      const gwApi: ResourceDescriptor = {
        type: ResourceType.GatewayApi,
        nameParts: ['gw-1', 'my-api'], // nameParts[0]=gatewayName, nameParts[1]=apiName
      };
      expect(shouldIncludeResource(gwApi, filter)).toBe(true);

      const otherGwApi: ResourceDescriptor = {
        type: ResourceType.GatewayApi,
        nameParts: ['gw-2', 'my-api'],
      };
      expect(shouldIncludeResource(otherGwApi, filter)).toBe(false);
    });

    it('should include API operations listed in apiSubFilters', () => {
      const filter: FilterConfig = {
        apis: ['my-api'],
        apiSubFilters: {
          'my-api': {
            operations: ['get-pets'],
          },
        },
      };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiOperation,
        nameParts: ['my-api', 'get-pets'],
      };

      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should exclude API operations when operation sub-filter is empty', () => {
      const filter: FilterConfig = {
        apis: ['my-api'],
        apiSubFilters: {
          'my-api': {
            operations: [],
          },
        },
      };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiOperation,
        nameParts: ['my-api', 'get-pets'],
      };

      expect(shouldIncludeResource(descriptor, filter)).toBe(false);
    });

    it('should include API diagnostics when no diagnostic sub-filter is specified', () => {
      const filter: FilterConfig = {
        apis: ['my-api'],
        apiSubFilters: {
          'my-api': {
            operations: ['get-pets'],
          },
        },
      };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiDiagnostic,
        nameParts: ['my-api', 'applicationinsights'],
      };

      expect(shouldIncludeResource(descriptor, filter)).toBe(true);
    });

    it('should exclude API schemas when schema sub-filter is empty', () => {
      const filter: FilterConfig = {
        apis: ['my-api'],
        apiSubFilters: {
          'my-api': {
            schemas: [],
          },
        },
      };
      const descriptor: ResourceDescriptor = {
        type: ResourceType.ApiSchema,
        nameParts: ['my-api', 'pet-schema'],
      };

      expect(shouldIncludeResource(descriptor, filter)).toBe(false);
    });

    it('should filter workspaces', () => {
      const filter: FilterConfig = { workspaces: ['workspace-a'] };
      const included: ResourceDescriptor = {
        type: ResourceType.Workspace,
        nameParts: ['workspace-a'],
      };
      const excluded: ResourceDescriptor = {
        type: ResourceType.Workspace,
        nameParts: ['workspace-b'],
      };

      expect(shouldIncludeResource(included, filter)).toBe(true);
      expect(shouldIncludeResource(excluded, filter)).toBe(false);
    });
  });

  describe('filterResources', () => {
    it('should return all resources when no filter', () => {
      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['api-1'] },
        { type: ResourceType.Api, nameParts: ['api-2'] },
      ];
      expect(filterResources(descriptors)).toEqual(descriptors);
    });

    it('should filter resources based on config', () => {
      const filter: FilterConfig = { apis: ['api-1'] };
      const descriptors: ResourceDescriptor[] = [
        { type: ResourceType.Api, nameParts: ['api-1'] },
        { type: ResourceType.Api, nameParts: ['api-2'] },
      ];
      const result = filterResources(descriptors, filter);
      expect(result).toHaveLength(1);
      expect(result[0]?.nameParts[0]).toBe('api-1');
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
