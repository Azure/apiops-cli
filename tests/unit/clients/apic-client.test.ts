// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for ApicClient.validatePreFlight — resource group and API Center
 * service existence checks, including principals without Reader on the
 * resource group.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApicClient, ApicHttpError } from '../../../src/clients/apic-client.js';
import { ApicServiceContext } from '../../../src/models/apic-types.js';
import { buildApicBaseUrl } from '../../../src/lib/apic-uri.js';
import { logger } from '../../../src/lib/logger.js';

const testContext: ApicServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apic-1',
  apiVersion: '2024-06-01-preview',
  baseUrl: buildApicBaseUrl('public', 'sub-1', 'rg-1', 'apic-1'),
};

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApicClient.validatePreFlight', () => {
  const rgUrl = 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1?api-version=2021-04-01';
  const serviceUrl = `${testContext.baseUrl}?api-version=${testContext.apiVersion}`;
  const rgForbidden = {
    error: {
      code: 'AuthorizationFailed',
      message:
        "The client does not have authorization to perform action 'Microsoft.Resources/subscriptions/resourceGroups/read' " +
        "over scope '/subscriptions/sub-1/resourceGroups/rg-1'",
    },
  };

  let client: ApicClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  /** Stub fetch with separate responses for the resource group and API Center service GETs. */
  function stubResponses(rg: () => Response, service: () => Response): void {
    fetchSpy.mockImplementation((url: string) => {
      if (url === rgUrl) return Promise.resolve(rg());
      if (url === serviceUrl) return Promise.resolve(service());
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
  }

  beforeEach(() => {
    client = new ApicClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'getToken').mockResolvedValue('fake-token');
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ['public', 'https://management.azure.com'],
    ['usgov', 'https://management.usgovcloudapi.net'],
    ['china', 'https://management.chinacloudapi.cn'],
  ])('should use the %s endpoint for both pre-flight checks', async (cloud, endpoint) => {
    fetchSpy.mockImplementation(() => Promise.resolve(makeResponse(200, {})));
    const context: ApicServiceContext = {
      ...testContext,
      resourceGroup: 'rg with spaces',
      baseUrl: buildApicBaseUrl(cloud, 'sub-1', 'rg with spaces', 'apic-1'),
    };

    await client.validatePreFlight(context);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      `${endpoint}/subscriptions/sub-1/resourceGroups/rg%20with%20spaces?api-version=2021-04-01`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      `${context.baseUrl}?api-version=${context.apiVersion}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should pass when the resource group read is forbidden but the API Center service exists', async () => {
    const debugSpy = vi.spyOn(logger, 'debug');
    const warnSpy = vi.spyOn(logger, 'warn');
    stubResponses(() => makeResponse(403, rgForbidden), () => makeResponse(200, {}));

    await expect(client.validatePreFlight(testContext)).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("No permission to read resource group 'rg-1' (HTTP 403)"),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should report a possibly wrong resource group when the resource group read is forbidden and the service is not found', async () => {
    stubResponses(() => makeResponse(403, rgForbidden), () => makeResponse(404, { error: { code: 'ResourceNotFound' } }));

    await expect(client.validatePreFlight(testContext)).rejects.toThrow(
      "API Center service 'apic-1' not found in resource group 'rg-1' of subscription 'sub-1'. " +
      'Ensure the subscription, resource group and API Center service name are correct and that the API Center service exists before publishing.',
    );
  });

  it('should report a permission error when the service read is forbidden', async () => {
    stubResponses(() => makeResponse(403, rgForbidden), () => makeResponse(403, { error: { code: 'AuthorizationFailed' } }));

    await expect(client.validatePreFlight(testContext)).rejects.toThrow(
      "Insufficient permissions to read API Center service 'apic-1'. " +
      'Ensure the service principal has at least Reader role on the API Center resource.',
    );
  });

  it('should report a missing resource group without checking the service', async () => {
    stubResponses(() => makeResponse(404, { error: { code: 'ResourceGroupNotFound' } }), () => makeResponse(200, {}));

    await expect(client.validatePreFlight(testContext)).rejects.toThrow(
      "Resource group 'rg-1' not found in subscription 'sub-1'. Ensure the resource group exists before publishing.",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should report a missing service when the resource group exists', async () => {
    stubResponses(() => makeResponse(200, {}), () => makeResponse(404, { error: { code: 'ResourceNotFound' } }));

    await expect(client.validatePreFlight(testContext)).rejects.toThrow(
      "API Center service 'apic-1' not found in resource group 'rg-1'. Ensure the API Center service exists before publishing.",
    );
  });

  it('should fail with an authentication error when the resource group read returns 401', async () => {
    stubResponses(() => makeResponse(401, { error: { code: 'InvalidAuthenticationToken' } }), () => makeResponse(200, {}));

    await expect(client.validatePreFlight(testContext)).rejects.toThrow(
      "Authentication failed when checking resource group 'rg-1'.",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should rethrow other resource group errors unchanged', async () => {
    stubResponses(() => makeResponse(400, { error: { code: 'InvalidSubscriptionId' } }), () => makeResponse(200, {}));

    const error = await client.validatePreFlight(testContext).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApicHttpError);
    expect((error as ApicHttpError).status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
