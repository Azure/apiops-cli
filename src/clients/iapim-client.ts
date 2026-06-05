// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T009: IApimClient interface
 * Abstraction over Azure APIM REST API calls
 */

import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';

export interface IApimClient {
  /**
   * List all resources of a given type. Handles ARM pagination (nextLink).
   * Returns an async iterable of raw JSON objects from the `value` array.
   */
  listResources(
    context: ApimServiceContext,
    type: ResourceType,
    parent?: ResourceDescriptor
  ): AsyncIterable<Record<string, unknown>>;

  /**
   * Get a single resource by descriptor.
   * Returns the raw JSON response body, or undefined if 404.
   */
  getResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<Record<string, unknown> | undefined>;

  /**
   * Create or update a resource (PUT).
   * Returns the response JSON body.
   * Polls provisioningState for long-running operations.
   */
  putResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>>;

  /**
   * Partially update a resource (PATCH).
   * Only the properties present in the payload are updated.
   * Returns the response JSON body.
   */
  patchResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>>;

  /**
   * Delete a resource (DELETE).
   * Returns true if deleted, false if already absent (404).
   * Polls provisioningState for long-running operations.
   */
  deleteResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<boolean>;

  /**
   * List API revisions for a given API.
   * Returns an async iterable of revision metadata objects.
   */
  listApiRevisions(
    context: ApimServiceContext,
    apiName: string
  ): AsyncIterable<Record<string, unknown>>;

  /**
   * Get the API specification (OpenAPI/GraphQL/WSDL/WADL) content.
   * Returns the raw content string and detected format.
   * @param apiType - Optional API type from properties.type (e.g. 'graphql', 'soap', 'http').
   *   Used to select the correct APIM export format. Defaults to OpenAPI link export.
   */
  getApiSpecification(
    context: ApimServiceContext,
    apiName: string,
    apiType?: string
  ): Promise<
    | { content: string; format: 'yaml' | 'json' | 'graphql' | 'wsdl' | 'wadl' }
    | undefined
  >;

  /**
   * Validate that the target resource group and APIM service instance exist.
   * Throws an error with a clear message if either is not found (404).
   * Must be called before any publish operations to surface missing infrastructure early.
   */
  validatePreFlight(context: ApimServiceContext): Promise<void>;
}
