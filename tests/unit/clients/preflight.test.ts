// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for the shared publish pre-flight check: the resource group and
 * service GETs, their URLs, and the messages for missing resources and
 * 401/403 responses. `get` is a stub, so no HTTP client is involved.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  PreFlightContext,
  PreFlightGet,
  PreFlightServiceKind,
  validateServicePreFlight,
} from '../../../src/clients/preflight.js';
import { HttpError } from '../../../src/clients/arm-http-client.js';
import { logger } from '../../../src/lib/logger.js';

const context: PreFlightContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'svc-1',
  apiVersion: '2024-01-01',
  baseUrl: 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Test.Provider/services/svc-1',
};

const kind: PreFlightServiceKind = {
  label: 'Test service',
  instance: 'test instance',
  roleTarget: 'the test resource',
};

const RG_URL = 'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1?api-version=2021-04-01';
const SERVICE_URL = `${context.baseUrl}?api-version=${context.apiVersion}`;

/** A GET outcome: a returned response status, or a thrown error. */
type Outcome = number | Error;

function armError(status: number): HttpError {
  return new HttpError(status, `HTTP ${status}: {}`, 'SomeCode');
}

/**
 * Stub `get` that answers the resource group and service URLs with the given
 * outcomes. Like the clients' request wrappers, it returns a 404 (or 2xx)
 * response and throws an HttpError for other non-2xx statuses.
 */
function stubGet(rg: Outcome, service: Outcome): Mock<PreFlightGet> {
  return vi.fn<PreFlightGet>(async (url: string) => {
    const outcome = url === RG_URL ? rg : url === SERVICE_URL ? service : new Error(`Unexpected URL: ${url}`);
    if (outcome instanceof Error) {
      throw outcome;
    }
    return new Response('{}', { status: outcome });
  });
}

describe('validateServicePreFlight', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should check the resource group and then the service', async () => {
    const get = stubGet(200, 200);

    await expect(validateServicePreFlight(context, kind, get)).resolves.toBeUndefined();

    expect(get.mock.calls.map(([url]) => url)).toEqual([RG_URL, SERVICE_URL]);
  });

  it('should build both URLs from the base URL origin with encoding and api-versions', async () => {
    const sovereign: PreFlightContext = {
      subscriptionId: 'sub/1',
      resourceGroup: 'rg with spaces',
      serviceName: 'svc-1',
      apiVersion: '2024-06-01-preview',
      baseUrl:
        'https://management.usgovcloudapi.net/subscriptions/sub%2F1/resourceGroups/rg%20with%20spaces' +
        '/providers/Test.Provider/services/svc-1',
    };
    const get = vi.fn<PreFlightGet>(async () => new Response('{}', { status: 200 }));

    await validateServicePreFlight(sovereign, kind, get);

    expect(get.mock.calls.map(([url]) => url)).toEqual([
      'https://management.usgovcloudapi.net/subscriptions/sub%2F1/resourceGroups/rg%20with%20spaces?api-version=2021-04-01',
      `${sovereign.baseUrl}?api-version=2024-06-01-preview`,
    ]);
  });

  describe('resource group read forbidden (403)', () => {
    it('should pass when the service exists, logging at debug and not warning', async () => {
      const get = stubGet(armError(403), 200);

      await expect(validateServicePreFlight(context, kind, get)).resolves.toBeUndefined();

      expect(get).toHaveBeenCalledTimes(2);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("No permission to read resource group 'rg-1'"));
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should name the subscription and resource group as possibly wrong when the service is not found', async () => {
      const get = stubGet(armError(403), 404);

      await expect(validateServicePreFlight(context, kind, get)).rejects.toThrow(
        "Test service 'svc-1' not found in resource group 'rg-1' of subscription 'sub-1'. " +
        'Ensure the subscription, resource group and Test service name are correct ' +
        'and that the test instance exists before publishing.',
      );
    });
  });

  it.each([
    ['resource group', 404, 200],
    ['service', 200, 404],
  ])('should cancel the unread body of a 404 for the %s', async (_label, rgStatus, serviceStatus) => {
    const cancel = vi.fn();
    const get = vi.fn<PreFlightGet>(async (url: string) =>
      (url === RG_URL ? rgStatus : serviceStatus) === 404
        ? new Response(new ReadableStream({ cancel }), { status: 404 })
        : new Response('{}', { status: 200 }));

    await expect(validateServicePreFlight(context, kind, get)).rejects.toThrow(/not found/);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('should cancel the unread bodies of the resource group and service 200 responses', async () => {
    const cancel = vi.fn();
    const get = vi.fn<PreFlightGet>(async () => new Response(new ReadableStream({ cancel }), { status: 200 }));

    await expect(validateServicePreFlight(context, kind, get)).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('should report a missing resource group without checking the service', async () => {
    const get = stubGet(404, 200);

    await expect(validateServicePreFlight(context, kind, get)).rejects.toThrow(
      "Resource group 'rg-1' not found in subscription 'sub-1'. Ensure the resource group exists before publishing.",
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should report an authentication failure on the resource group without checking the service', async () => {
    const cause = armError(401);
    const get = stubGet(cause, 200);

    const error = await validateServicePreFlight(context, kind, get).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Authentication failed when checking resource group 'rg-1'. " +
      'Verify that credentials are valid and the correct tenant/subscription is targeted.',
    );
    expect((error as Error).cause).toBe(cause);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should report a missing service when the resource group exists', async () => {
    const get = stubGet(200, 404);

    await expect(validateServicePreFlight(context, kind, get)).rejects.toThrow(
      "Test service 'svc-1' not found in resource group 'rg-1'. Ensure the test instance exists before publishing.",
    );
  });

  it('should name the role target when the service read is forbidden', async () => {
    const cause = armError(403);
    const get = stubGet(200, cause);

    const error = await validateServicePreFlight(context, kind, get).catch((e: unknown) => e);

    expect((error as Error).message).toBe(
      "Insufficient permissions to read Test service 'svc-1'. " +
      'Ensure the service principal has at least Reader role on the test resource.',
    );
    expect((error as Error).cause).toBe(cause);
  });

  it('should report an authentication failure on the service', async () => {
    const get = stubGet(200, armError(401));

    await expect(validateServicePreFlight(context, kind, get)).rejects.toThrow(
      "Authentication failed when checking Test service 'svc-1'.",
    );
  });

  it.each([
    ['an HttpError with another status', () => armError(400)],
    ['a non-ARM error', () => new TypeError('fetch failed')],
    ['a non-ARM error with a status property', () => Object.assign(new Error('forbidden'), { status: 403 })],
  ])('should rethrow %s from the resource group read unchanged', async (_label, makeError) => {
    const thrown = makeError();
    const get = stubGet(thrown, 200);

    await expect(validateServicePreFlight(context, kind, get)).rejects.toBe(thrown);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should rethrow a non-ARM error from the service read unchanged', async () => {
    const thrown = new TypeError('fetch failed');
    const get = stubGet(200, thrown);

    await expect(validateServicePreFlight(context, kind, get)).rejects.toBe(thrown);
  });
});
