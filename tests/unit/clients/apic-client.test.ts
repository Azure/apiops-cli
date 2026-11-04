// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for ApicClient.
 *
 * - validatePreFlight: resource group and API Center service existence
 *   checks, including principals without Reader on the resource group.
 * - ARM calls: URLs (with api-version and encoding), methods, headers,
 *   bodies, token caching, pagination, retry/back-off and long-running
 *   operation polling for every other ARM call the client makes. `fetch` is
 *   stubbed globally and `@azure/identity` is mocked so the tests never touch
 *   the network or a real credential; timers are faked so retry back-off and
 *   LRO polling run instantly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApicClient, ApicHttpError } from '../../../src/clients/apic-client.js';
import { ApicResourceType } from '../../../src/models/apic-resource-types.js';
import { ApicResourceDescriptor, ApicServiceContext } from '../../../src/models/apic-types.js';
import { buildApicBaseUrl } from '../../../src/lib/apic-uri.js';
import { USER_AGENT } from '../../../src/lib/user-agent.js';
import { logger } from '../../../src/lib/logger.js';

const mockGetToken = vi.hoisted(() => vi.fn());

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {
    getToken = mockGetToken;
  },
}));

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

/* ------------------------------------------------------------------ */
/*  ARM calls                                                         */
/* ------------------------------------------------------------------ */

const BASE_URL =
  'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1' +
  '/providers/Microsoft.ApiCenter/services/apic-1';
const API_VERSION = '2024-06-01-preview';
const OPERATION_URL =
  'https://management.azure.com/subscriptions/sub-1/providers/Microsoft.ApiCenter' +
  '/locations/eastus/operationStatuses/op-1?api-version=2024-06-01-preview';

const apiDescriptor: ApicResourceDescriptor = {
  type: ApicResourceType.Api,
  nameParts: ['pet store'],
  workspace: 'default',
};
const API_URL = `${BASE_URL}/workspaces/default/apis/pet%20store?api-version=${API_VERSION}`;

const definitionDescriptor: ApicResourceDescriptor = {
  type: ApicResourceType.ApiDefinition,
  nameParts: ['petstore', 'v1', 'openapi'],
  workspace: 'default',
};
const DEFINITION_PATH = `${BASE_URL}/workspaces/default/apis/petstore/versions/v1/definitions/openapi`;
const DEFINITION_URL = `${DEFINITION_PATH}?api-version=${API_VERSION}`;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : '', { status, headers });
}

/**
 * Await a promise while running fake timers until it settles, so retry
 * back-off and polling delays complete instantly.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const outcome = promise.then(
    (value) => {
      done = true;
      return { ok: true as const, value };
    },
    (error: unknown) => {
      done = true;
      return { ok: false as const, error };
    },
  );
  for (let i = 0; i < 1000 && !done; i++) {
    await vi.runAllTimersAsync();
  }
  const result = await outcome;
  if (!result.ok) throw result.error;
  return result.value;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe('ApicClient ARM calls', () => {
  let client: ApicClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  /** URL, method, headers and body of the n-th (0-based) fetch call. */
  function call(n: number): { url: string; method: string; headers: Headers; body: unknown } {
    const [url, init] = fetchSpy.mock.calls[n] as [string, RequestInit | undefined];
    return {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    };
  }

  function urls(): string[] {
    return fetchSpy.mock.calls.map((c) => c[0] as string);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockGetToken.mockReset();
    mockGetToken.mockImplementation(async () => ({
      token: 'fake-token',
      expiresOnTimestamp: Date.now() + 60 * 60 * 1000,
    }));
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    client = new ApicClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /* ------------------------------------------------------------------ */
  /*  Authentication and common headers                                 */
  /* ------------------------------------------------------------------ */

  describe('authentication', () => {
    it('requests a token for the public ARM scope by default', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, {}));

      await settle(client.getResource(testContext, apiDescriptor));

      expect(mockGetToken).toHaveBeenCalledWith('https://management.azure.com/.default');
    });

    it('requests a token for the scope passed to the constructor', async () => {
      const scoped = new ApicClient('https://management.usgovcloudapi.net/.default');
      fetchSpy.mockResolvedValueOnce(json(200, {}));

      await settle(scoped.getResource(testContext, apiDescriptor));

      expect(mockGetToken).toHaveBeenCalledWith('https://management.usgovcloudapi.net/.default');
    });

    it('sends Authorization, Content-Type and User-Agent on ARM requests', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, {}));

      await settle(client.getResource(testContext, apiDescriptor));

      const { headers } = call(0);
      expect(headers.get('Authorization')).toBe('Bearer fake-token');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('User-Agent')).toBe(USER_AGENT);
    });

    it('caches the token across requests', async () => {
      fetchSpy.mockImplementation(async () => json(200, {}));

      await settle(client.getResource(testContext, apiDescriptor));
      await settle(client.getResource(testContext, apiDescriptor));
      await settle(client.putResource(testContext, apiDescriptor, {}));

      expect(mockGetToken).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('shares one in-flight token request between concurrent requests', async () => {
      fetchSpy.mockImplementation(async () => json(200, {}));

      await settle(
        Promise.all([
          client.getResource(testContext, apiDescriptor),
          client.getResource(testContext, definitionDescriptor),
        ]),
      );

      expect(mockGetToken).toHaveBeenCalledTimes(1);
    });

    it('refreshes the token once it is within five minutes of expiry', async () => {
      const start = Date.now();
      mockGetToken
        .mockResolvedValueOnce({ token: 'token-1', expiresOnTimestamp: start + 10 * 60 * 1000 })
        .mockResolvedValueOnce({ token: 'token-2', expiresOnTimestamp: start + 70 * 60 * 1000 });
      fetchSpy.mockImplementation(async () => json(200, {}));

      await settle(client.getResource(testContext, apiDescriptor));
      vi.setSystemTime(start + 4 * 60 * 1000);
      await settle(client.getResource(testContext, apiDescriptor));
      vi.setSystemTime(start + 6 * 60 * 1000);
      await settle(client.getResource(testContext, apiDescriptor));

      expect(mockGetToken).toHaveBeenCalledTimes(2);
      expect(call(0).headers.get('Authorization')).toBe('Bearer token-1');
      expect(call(1).headers.get('Authorization')).toBe('Bearer token-1');
      expect(call(2).headers.get('Authorization')).toBe('Bearer token-2');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  listResources                                                     */
  /* ------------------------------------------------------------------ */

  describe('listResources', () => {
    it('lists a service-scoped collection', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, { value: [{ name: 'schema-a' }] }));

      const items = await settle(
        collect(client.listResources(testContext, ApicResourceType.MetadataSchema, [])),
      );

      expect(items).toEqual([{ name: 'schema-a' }]);
      expect(call(0).url).toBe(`${BASE_URL}/metadataSchemas?api-version=${API_VERSION}`);
      expect(call(0).method).toBe('GET');
      expect(call(0).headers.get('Authorization')).toBe('Bearer fake-token');
    });

    it('lists a workspace-scoped collection under the encoded workspace', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, { value: [] }));

      await settle(
        collect(client.listResources(testContext, ApicResourceType.Environment, [], 'my ws')),
      );

      expect(call(0).url).toBe(
        `${BASE_URL}/workspaces/my%20ws/environments?api-version=${API_VERSION}`,
      );
    });

    it('lists a child collection with encoded parent name-parts', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, { value: [{ name: 'openapi' }] }));

      await settle(
        collect(
          client.listResources(
            testContext,
            ApicResourceType.ApiDefinition,
            ['pet store', 'v1'],
            'default',
          ),
        ),
      );

      expect(call(0).url).toBe(
        `${BASE_URL}/workspaces/default/apis/pet%20store/versions/v1/definitions` +
        `?api-version=${API_VERSION}`,
      );
    });

    it('follows nextLink until it is absent', async () => {
      const page2 = `${BASE_URL}/workspaces/default/apis?api-version=${API_VERSION}&$skipToken=2`;
      const page3 = `${BASE_URL}/workspaces/default/apis?api-version=${API_VERSION}&$skipToken=3`;
      fetchSpy
        .mockResolvedValueOnce(json(200, { value: [{ name: 'a' }], nextLink: page2 }))
        .mockResolvedValueOnce(json(200, { value: [{ name: 'b' }], nextLink: page3 }))
        .mockResolvedValueOnce(json(200, { value: [{ name: 'c' }] }));

      const items = await settle(
        collect(client.listResources(testContext, ApicResourceType.Api, [], 'default')),
      );

      expect(items).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
      expect(urls()).toEqual([
        `${BASE_URL}/workspaces/default/apis?api-version=${API_VERSION}`,
        page2,
        page3,
      ]);
      expect(call(1).headers.get('Authorization')).toBe('Bearer fake-token');
    });

    it('returns an empty list when the collection returns 404', async () => {
      fetchSpy.mockResolvedValueOnce(
        json(404, { error: { code: 'ResourceNotFound', message: 'missing' } }),
      );

      const items = await settle(
        collect(client.listResources(testContext, ApicResourceType.Api, [], 'default')),
      );

      expect(items).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('tolerates a page without a value array', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, {}));

      const items = await settle(
        collect(client.listResources(testContext, ApicResourceType.Api, [], 'default')),
      );

      expect(items).toEqual([]);
    });

    it('throws ApicHttpError with status and ARM code on 403', async () => {
      fetchSpy.mockResolvedValueOnce(
        json(403, { error: { code: 'AuthorizationFailed', message: 'denied' } }),
      );

      const error = await settle(
        collect(client.listResources(testContext, ApicResourceType.Api, [], 'default')),
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApicHttpError);
      expect(error).toMatchObject({ status: 403, code: 'AuthorizationFailed' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getResource                                                       */
  /* ------------------------------------------------------------------ */

  describe('getResource', () => {
    it('GETs the encoded resource URL and returns the parsed body', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, { name: 'pet store', properties: { title: 'Pets' } }));

      const result = await settle(client.getResource(testContext, apiDescriptor));

      expect(result).toEqual({ name: 'pet store', properties: { title: 'Pets' } });
      expect(call(0).url).toBe(API_URL);
      expect(call(0).method).toBe('GET');
      expect(call(0).body).toBeUndefined();
    });

    it('builds a service-scoped resource URL without a workspace segment', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, {}));

      await settle(
        client.getResource(testContext, { type: ApicResourceType.MetadataSchema, nameParts: ['schema a'] }),
      );

      expect(call(0).url).toBe(`${BASE_URL}/metadataSchemas/schema%20a?api-version=${API_VERSION}`);
    });

    it('returns undefined on 404', async () => {
      fetchSpy.mockResolvedValueOnce(json(404, { error: { code: 'ResourceNotFound' } }));

      await expect(settle(client.getResource(testContext, apiDescriptor))).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns an empty object for an empty 200 body', async () => {
      fetchSpy.mockResolvedValueOnce(empty(200));

      await expect(settle(client.getResource(testContext, apiDescriptor))).resolves.toEqual({});
    });
  });

  /* ------------------------------------------------------------------ */
  /*  putResource                                                       */
  /* ------------------------------------------------------------------ */

  describe('putResource', () => {
    const payload = { properties: { title: 'Pets', kind: 'rest' } };

    it.each([200, 201])('PUTs the JSON payload and returns the %i body', async (status) => {
      fetchSpy.mockResolvedValueOnce(json(status, { name: 'pet store', ...payload }));

      const result = await settle(client.putResource(testContext, apiDescriptor, payload));

      expect(result).toEqual({ name: 'pet store', ...payload });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const put = call(0);
      expect(put.url).toBe(API_URL);
      expect(put.method).toBe('PUT');
      expect(JSON.parse(put.body as string)).toEqual(payload);
      expect(put.headers.get('Content-Type')).toBe('application/json');
      expect(put.headers.get('Authorization')).toBe('Bearer fake-token');
      expect(put.headers.get('User-Agent')).toBe(USER_AGENT);
    });

    it('returns an empty object for an empty 200 body', async () => {
      fetchSpy.mockResolvedValueOnce(empty(200));

      await expect(settle(client.putResource(testContext, apiDescriptor, payload))).resolves.toEqual({});
    });

    it('polls Azure-AsyncOperation on 201 and returns the settled resource', async () => {
      fetchSpy
        .mockResolvedValueOnce(json(201, { name: 'pet store' }, { 'Azure-AsyncOperation': OPERATION_URL }))
        .mockResolvedValueOnce(json(200, { status: 'InProgress' }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
        .mockResolvedValueOnce(json(200, { name: 'pet store', properties: { title: 'Settled' } }));

      const result = await settle(client.putResource(testContext, apiDescriptor, payload));

      expect(result).toEqual({ name: 'pet store', properties: { title: 'Settled' } });
      expect(urls()).toEqual([API_URL, OPERATION_URL, OPERATION_URL, API_URL]);
      expect(call(1).method).toBe('GET');
      expect(call(1).headers.get('Authorization')).toBe('Bearer fake-token');
      expect(call(3).method).toBe('GET');
    });

    it('polls the Location header on 202 and reads provisioningState from the poll body', async () => {
      const location = `${API_URL}&operation=1`;
      fetchSpy
        .mockResolvedValueOnce(empty(202, { Location: location }))
        .mockResolvedValueOnce(empty(202))
        .mockResolvedValueOnce(json(200, { properties: { provisioningState: 'Succeeded' } }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      const result = await settle(client.putResource(testContext, apiDescriptor, payload));

      expect(result).toEqual({ name: 'pet store' });
      expect(urls()).toEqual([API_URL, location, location, API_URL]);
    });

    it('throws ApicHttpError without retrying a 400', async () => {
      fetchSpy.mockResolvedValueOnce(
        json(400, { error: { code: 'ValidationError', message: 'bad title' } }),
      );

      const error = await settle(client.putResource(testContext, apiDescriptor, payload)).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ApicHttpError);
      expect(error).toMatchObject({ status: 400, code: 'ValidationError' });
      expect((error as Error).message).toContain('bad title');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('throws ApicHttpError without a code for a non-JSON error body', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Conflict', { status: 409 }));

      const error = await settle(client.putResource(testContext, apiDescriptor, payload)).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ApicHttpError);
      expect(error).toMatchObject({ status: 409, code: undefined });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  deleteResource                                                    */
  /* ------------------------------------------------------------------ */

  describe('deleteResource', () => {
    it.each([200, 204])('DELETEs the resource URL and returns true on %i', async (status) => {
      fetchSpy.mockResolvedValueOnce(empty(status));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).resolves.toBe(true);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(call(0).url).toBe(API_URL);
      expect(call(0).method).toBe('DELETE');
      expect(call(0).headers.get('Authorization')).toBe('Bearer fake-token');
    });

    it('returns false on 404', async () => {
      fetchSpy.mockResolvedValueOnce(json(404, { error: { code: 'ResourceNotFound' } }));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).resolves.toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('polls Azure-AsyncOperation on 202 until Succeeded', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(202, { 'Azure-AsyncOperation': OPERATION_URL }))
        .mockResolvedValueOnce(json(200, { status: 'InProgress' }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).resolves.toBe(true);

      expect(urls()).toEqual([API_URL, OPERATION_URL, OPERATION_URL]);
    });

    it('treats a 404 while polling a delete as success', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(202, { Location: OPERATION_URL }))
        .mockResolvedValueOnce(empty(404));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).resolves.toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  exportSpecification                                               */
  /* ------------------------------------------------------------------ */

  describe('exportSpecification', () => {
    const EXPORT_URL = `${DEFINITION_PATH}/exportSpecification?api-version=${API_VERSION}`;
    const definition = {
      name: 'openapi',
      properties: { specification: { name: 'openapi', version: '3.0.1' } },
    };

    it('POSTs the export action and returns inline content with the spec name/version', async () => {
      fetchSpy
        .mockResolvedValueOnce(json(200, { format: 'inline', value: 'openapi: 3.0.1' }))
        .mockResolvedValueOnce(json(200, definition));

      const spec = await settle(client.exportSpecification(testContext, definitionDescriptor));

      expect(spec).toEqual({ content: 'openapi: 3.0.1', name: 'openapi', version: '3.0.1' });
      expect(urls()).toEqual([EXPORT_URL, DEFINITION_URL]);
      const post = call(0);
      expect(post.method).toBe('POST');
      expect(post.body).toBeUndefined();
      expect(post.headers.get('Authorization')).toBe('Bearer fake-token');
      expect(post.headers.get('Content-Type')).toBe('application/json');
      expect(post.headers.get('User-Agent')).toBe(USER_AGENT);
    });

    it('fetches a link export without ARM credentials', async () => {
      const link = 'https://blob.example.net/specs/petstore.yaml?sv=2024&sig=secret';
      fetchSpy
        .mockResolvedValueOnce(json(200, { format: 'link', value: link }))
        .mockResolvedValueOnce(new Response('openapi: 3.0.1', { status: 200 }))
        .mockResolvedValueOnce(json(200, definition));

      const spec = await settle(client.exportSpecification(testContext, definitionDescriptor));

      expect(spec).toEqual({ content: 'openapi: 3.0.1', name: 'openapi', version: '3.0.1' });
      expect(urls()).toEqual([EXPORT_URL, link, DEFINITION_URL]);
      const blob = call(1);
      expect(blob.method).toBe('GET');
      expect(blob.headers.get('Authorization')).toBeNull();
      expect(blob.headers.get('Content-Type')).toBeNull();
      expect(blob.headers.get('User-Agent')).toBe(USER_AGENT);
    });

    it('retries a link export that fails with a transient 5xx', async () => {
      const link = 'https://blob.example.net/specs/petstore.yaml?sig=secret';
      fetchSpy
        .mockResolvedValueOnce(json(200, { format: 'link', value: link }))
        .mockResolvedValueOnce(new Response('busy', { status: 503 }))
        .mockResolvedValueOnce(new Response('openapi: 3.0.1', { status: 200 }))
        .mockResolvedValueOnce(json(200, definition));

      const spec = await settle(client.exportSpecification(testContext, definitionDescriptor));

      expect(spec?.content).toBe('openapi: 3.0.1');
      expect(urls()).toEqual([EXPORT_URL, link, link, DEFINITION_URL]);
    });

    it('returns undefined when the link export returns 404', async () => {
      const link = 'https://blob.example.net/specs/missing.yaml?sig=secret';
      fetchSpy
        .mockResolvedValueOnce(json(200, { format: 'link', value: link }))
        .mockResolvedValueOnce(new Response('', { status: 404 }));

      await expect(
        settle(client.exportSpecification(testContext, definitionDescriptor)),
      ).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('defaults the spec name to openapi when the definition has none', async () => {
      fetchSpy
        .mockResolvedValueOnce(json(200, { format: 'inline', value: '{}' }))
        .mockResolvedValueOnce(json(404, { error: { code: 'ResourceNotFound' } }));

      const spec = await settle(client.exportSpecification(testContext, definitionDescriptor));

      expect(spec).toEqual({ content: '{}', name: 'openapi', version: undefined });
    });

    it('returns undefined when the export action returns 404', async () => {
      fetchSpy.mockResolvedValueOnce(json(404, { error: { code: 'ResourceNotFound' } }));

      await expect(
        settle(client.exportSpecification(testContext, definitionDescriptor)),
      ).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('warns and returns undefined when the export action fails', async () => {
      fetchSpy.mockResolvedValueOnce(json(400, { error: { code: 'BadRequest' } }));

      await expect(
        settle(client.exportSpecification(testContext, definitionDescriptor)),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to export specification for workspaces/default/apis/petstore'),
      );
    });

    it.each([
      ['an empty body', empty(200)],
      ['no value', json(200, { format: 'inline' })],
    ])('returns undefined for %s', async (_label, response) => {
      fetchSpy.mockResolvedValueOnce(response);

      await expect(
        settle(client.exportSpecification(testContext, definitionDescriptor)),
      ).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  importSpecification                                               */
  /* ------------------------------------------------------------------ */

  describe('importSpecification', () => {
    const IMPORT_URL = `${DEFINITION_PATH}/importSpecification?api-version=${API_VERSION}`;

    it('POSTs the inline spec with its name and version', async () => {
      fetchSpy.mockResolvedValueOnce(empty(200));

      await settle(
        client.importSpecification(testContext, definitionDescriptor, {
          content: 'openapi: 3.0.1',
          name: 'openapi',
          version: '3.0.1',
        }),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const post = call(0);
      expect(post.url).toBe(IMPORT_URL);
      expect(post.method).toBe('POST');
      expect(JSON.parse(post.body as string)).toEqual({
        value: 'openapi: 3.0.1',
        format: 'inline',
        specification: { name: 'openapi', version: '3.0.1' },
      });
      expect(post.headers.get('Authorization')).toBe('Bearer fake-token');
      expect(post.headers.get('Content-Type')).toBe('application/json');
    });

    it('omits the version when the spec has none', async () => {
      fetchSpy.mockResolvedValueOnce(empty(200));

      await settle(
        client.importSpecification(testContext, definitionDescriptor, { content: 'x', name: 'graphql' }),
      );

      expect(JSON.parse(call(0).body as string).specification).toEqual({ name: 'graphql' });
    });

    it('polls the operation when the import returns 202', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(202, { 'Azure-AsyncOperation': OPERATION_URL }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

      await settle(
        client.importSpecification(testContext, definitionDescriptor, { content: 'x', name: 'openapi' }),
      );

      expect(urls()).toEqual([IMPORT_URL, OPERATION_URL]);
    });

    it('surfaces a failed import operation', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(202, { 'Azure-AsyncOperation': OPERATION_URL }))
        .mockResolvedValueOnce(
          json(200, { status: 'Failed', error: { code: 'InvalidSpec', message: 'Spec is invalid' } }),
        );

      await expect(
        settle(
          client.importSpecification(testContext, definitionDescriptor, { content: 'x', name: 'openapi' }),
        ),
      ).rejects.toThrow(/workspaces\/default\/apis\/petstore\/versions\/v1\/definitions\/openapi.*spec import/);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Retry and rate limiting                                           */
  /* ------------------------------------------------------------------ */

  describe('retries', () => {
    it('retries a 5xx and then succeeds', async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response('busy', { status: 503 }))
        .mockResolvedValueOnce(new Response('oops', { status: 500 }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      await expect(settle(client.getResource(testContext, apiDescriptor))).resolves.toEqual({
        name: 'pet store',
      });
      expect(urls()).toEqual([API_URL, API_URL, API_URL]);
    });

    it('gives up after three retries and throws the last 5xx as ApicHttpError', async () => {
      fetchSpy.mockImplementation(async () => new Response('down', { status: 502 }));

      const error = await settle(client.getResource(testContext, apiDescriptor)).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ApicHttpError);
      expect(error).toMatchObject({ status: 502 });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('retries a network error and then succeeds', async () => {
      fetchSpy
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      await expect(settle(client.getResource(testContext, apiDescriptor))).resolves.toEqual({
        name: 'pet store',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it.each([400, 401, 403, 409])('does not retry a %i', async (status) => {
      fetchSpy.mockResolvedValueOnce(json(status, { error: { code: 'Nope' } }));

      await expect(
        settle(client.putResource(testContext, apiDescriptor, {})),
      ).rejects.toMatchObject({ status, code: 'Nope' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('waits for a numeric Retry-After after a 429 and then succeeds', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(429, { 'Retry-After': '2' }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      const result = client.getResource(testContext, apiDescriptor);
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await expect(result).resolves.toEqual({ name: 'pet store' });
    });

    it('backs off after a 429 without Retry-After and then succeeds', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(429))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      await expect(settle(client.getResource(testContext, apiDescriptor))).resolves.toEqual({
        name: 'pet store',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Long-running operation polling                                    */
  /* ------------------------------------------------------------------ */

  describe('long-running operation polling', () => {
    function acceptedPut(): void {
      fetchSpy.mockResolvedValueOnce(empty(202, { 'Azure-AsyncOperation': OPERATION_URL }));
    }

    it('keeps polling while the operation is in progress', async () => {
      acceptedPut();
      fetchSpy
        .mockResolvedValueOnce(json(200, { status: 'Accepted' }))
        .mockResolvedValueOnce(json(200, { status: 'InProgress' }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      await expect(
        settle(client.putResource(testContext, apiDescriptor, {})),
      ).resolves.toEqual({ name: 'pet store' });
      expect(urls()).toEqual([API_URL, OPERATION_URL, OPERATION_URL, OPERATION_URL, API_URL]);
    });

    it('waits for a numeric Retry-After between polls', async () => {
      acceptedPut();
      fetchSpy
        .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'Retry-After': '7' }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      const result = client.putResource(testContext, apiDescriptor, {});
      await vi.advanceTimersByTimeAsync(0);
      const pollsBefore = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(6999);
      expect(fetchSpy).toHaveBeenCalledTimes(pollsBefore);
      await vi.advanceTimersByTimeAsync(1);
      await settle(result);

      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it.each(['Failed', 'Canceled'])('throws with the label and error message when %s', async (status) => {
      acceptedPut();
      fetchSpy.mockResolvedValueOnce(
        json(200, { status, error: { code: 'Boom', message: 'Spec is invalid' } }),
      );

      const error = (await settle(client.putResource(testContext, apiDescriptor, {})).catch(
        (e: unknown) => e,
      )) as Error;

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(new RegExp(status, 'i'));
      expect(error.message).toContain('workspaces/default/apis/pet store');
      expect(error.message).toContain('Spec is invalid');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws when the operation disappears (404) while polling a PUT', async () => {
      acceptedPut();
      fetchSpy.mockResolvedValueOnce(empty(404));

      await expect(settle(client.putResource(testContext, apiDescriptor, {}))).rejects.toThrow(
        /workspaces\/default\/apis\/pet store.*(not found|404)/,
      );
    });

    it('treats an empty 200 poll response as success', async () => {
      acceptedPut();
      fetchSpy
        .mockResolvedValueOnce(empty(200))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      await expect(
        settle(client.putResource(testContext, apiDescriptor, {})),
      ).resolves.toEqual({ name: 'pet store' });
    });

    it('times out after ten minutes of polling', async () => {
      acceptedPut();
      fetchSpy.mockImplementation(async () => json(200, { status: 'InProgress' }));
      const start = Date.now();

      await expect(settle(client.putResource(testContext, apiDescriptor, {}))).rejects.toThrow(
        /timed out/,
      );
      expect(Date.now() - start).toBeGreaterThanOrEqual(10 * 60 * 1000);
    });

    it.each([
      ['succeeded', true],
      ['SUCCEEDED', true],
      ['failed', false],
      ['canceled', false],
      ['Cancelled', false],
    ])('matches the terminal status %s case-insensitively', async (status, succeeds) => {
      acceptedPut();
      fetchSpy
        .mockResolvedValueOnce(json(200, { status, error: { message: 'Spec is invalid' } }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      const outcome = settle(client.putResource(testContext, apiDescriptor, {}));

      if (succeeds) {
        await expect(outcome).resolves.toEqual({ name: 'pet store' });
        expect(fetchSpy).toHaveBeenCalledTimes(3);
      } else {
        await expect(outcome).rejects.toThrow(new RegExp(`${status}.*Spec is invalid`, 'i'));
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      }
    });

    it('waits until an HTTP-date Retry-After between polls', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      acceptedPut();
      fetchSpy
        .mockResolvedValueOnce(
          json(200, { status: 'InProgress' }, { 'Retry-After': 'Thu, 01 Jan 2026 00:00:08 GMT' }),
        )
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      const result = client.putResource(testContext, apiDescriptor, {});
      await vi.advanceTimersByTimeAsync(7999);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await settle(result);

      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('falls back to the default interval for an unparsable Retry-After', async () => {
      acceptedPut();
      fetchSpy
        .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'Retry-After': 'soon' }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      const result = client.putResource(testContext, apiDescriptor, {});
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await settle(result);

      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('polls Azure-AsyncOperation when a PUT update returns 200', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          json(200, { properties: { provisioningState: 'Updating' } }, { 'Azure-AsyncOperation': OPERATION_URL }),
        )
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }))
        .mockResolvedValueOnce(json(200, { name: 'pet store', properties: { title: 'Settled' } }));

      const result = await settle(client.putResource(testContext, apiDescriptor, {}));

      expect(result).toEqual({ name: 'pet store', properties: { title: 'Settled' } });
      expect(urls()).toEqual([API_URL, OPERATION_URL, API_URL]);
    });

    it('does not poll a Location header on a PUT that returns 200', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, { name: 'pet store' }, { Location: OPERATION_URL }));

      await expect(
        settle(client.putResource(testContext, apiDescriptor, {})),
      ).resolves.toEqual({ name: 'pet store' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('polls the resource when a DELETE returns 202 without a polling header', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(202))
        .mockResolvedValueOnce(json(200, { name: 'pet store', properties: { provisioningState: 'Deleting' } }))
        .mockResolvedValueOnce(empty(404));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).resolves.toBe(true);

      expect(urls()).toEqual([API_URL, API_URL, API_URL]);
      expect(call(0).method).toBe('DELETE');
      expect(call(1).method).toBe('GET');
      expect(call(2).method).toBe('GET');
    });

    it('fails a DELETE without a polling header when the resource reports Failed', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(202))
        .mockResolvedValueOnce(json(200, { properties: { provisioningState: 'Failed' } }));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).rejects.toThrow(
        /workspaces\/default\/apis\/pet store.*failed/i,
      );
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Rate limiting hardening                                           */
  /* ------------------------------------------------------------------ */

  describe('rate limiting', () => {
    it('throws ApicHttpError 429 once the retries are exhausted', async () => {
      fetchSpy.mockImplementation(async () =>
        json(429, { error: { code: 'TooManyRequests', message: 'slow down' } }, { 'Retry-After': '1' }),
      );

      const error = await settle(client.getResource(testContext, apiDescriptor)).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ApicHttpError);
      expect(error).toMatchObject({ status: 429, code: 'TooManyRequests' });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('does not wait again after the final 429', async () => {
      fetchSpy.mockImplementation(async () => empty(429, { 'Retry-After': '10' }));

      const result = client.getResource(testContext, apiDescriptor).catch((e: unknown) => e);
      // Three retries wait 10s each; the fourth 429 must fail without a fourth wait.
      await vi.advanceTimersByTimeAsync(30_000);

      expect(fetchSpy).toHaveBeenCalledTimes(4);
      await expect(result).resolves.toMatchObject({ status: 429 });
    });

    it('waits until an HTTP-date Retry-After after a 429', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      fetchSpy
        .mockResolvedValueOnce(empty(429, { 'Retry-After': 'Thu, 01 Jan 2026 00:00:03 GMT' }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      const result = client.getResource(testContext, apiDescriptor);
      await vi.advanceTimersByTimeAsync(2999);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await expect(result).resolves.toEqual({ name: 'pet store' });
    });

    it('backs off exponentially for an unparsable Retry-After after a 429', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(429, { 'Retry-After': 'later' }))
        .mockResolvedValueOnce(json(200, { name: 'pet store' }));

      const result = client.getResource(testContext, apiDescriptor);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await expect(result).resolves.toEqual({ name: 'pet store' });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  ARM host validation                                               */
  /* ------------------------------------------------------------------ */

  describe('ARM host validation', () => {
    it.each([
      ['a non-HTTPS URL', 'http://management.azure.com/operations/op-1'],
      ['an unknown host', 'https://attacker.example.com/operations/op-1'],
      ['a look-alike host', 'https://management.azure.com.attacker.example.com/operations/op-1'],
    ])('does not poll (or send the token to) %s from a PUT', async (_label, operationUrl) => {
      fetchSpy.mockResolvedValueOnce(
        json(201, { name: 'pet store' }, { 'Azure-AsyncOperation': operationUrl }),
      );

      await expect(
        settle(client.putResource(testContext, apiDescriptor, {})),
      ).resolves.toEqual({ name: 'pet store' });
      expect(urls()).toEqual([API_URL]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring'));
    });

    it('does not poll an unknown host from a DELETE and polls the resource instead', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(202, { Location: 'https://attacker.example.com/op' }))
        .mockResolvedValueOnce(empty(404));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).resolves.toBe(true);
      expect(urls()).toEqual([API_URL, API_URL]);
    });

    it.each([
      'https://management.usgovcloudapi.net/operations/op-1',
      'https://eastus.management.azure.com/operations/op-1',
    ])('polls an operation on the known ARM host %s', async (operationUrl) => {
      fetchSpy
        .mockResolvedValueOnce(empty(202, { 'Azure-AsyncOperation': operationUrl }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).resolves.toBe(true);
      expect(urls()).toEqual([API_URL, operationUrl]);
    });

    it('polls Operation-Location', async () => {
      fetchSpy
        .mockResolvedValueOnce(empty(202, { 'Operation-Location': OPERATION_URL }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).resolves.toBe(true);
      expect(urls()).toEqual([API_URL, OPERATION_URL]);
    });

    it('prefers Azure-AsyncOperation over Location', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          empty(202, { 'Azure-AsyncOperation': OPERATION_URL, Location: `${API_URL}&location=1` }),
        )
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

      await expect(settle(client.deleteResource(testContext, apiDescriptor))).resolves.toBe(true);
      expect(urls()).toEqual([API_URL, OPERATION_URL]);
    });

    it.each([
      ['an unknown host', 'https://attacker.example.com/apis?page=2'],
      ['a non-HTTPS URL', 'http://management.azure.com/apis?page=2'],
    ])('refuses to follow a nextLink to %s', async (_label, nextLink) => {
      fetchSpy.mockResolvedValueOnce(json(200, { value: [{ name: 'a' }], nextLink }));

      const items: unknown[] = [];
      const error = await settle(
        (async () => {
          for await (const item of client.listResources(testContext, ApicResourceType.Api, [], 'default')) {
            items.push(item);
          }
        })(),
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/nextLink/);
      expect(items).toEqual([{ name: 'a' }]);
      expect(urls()).toEqual([`${BASE_URL}/workspaces/default/apis?api-version=${API_VERSION}`]);
    });
  });
});
