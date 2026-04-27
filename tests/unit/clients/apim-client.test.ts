/**
 * Unit tests for ApimClient.listResources — graceful handling of
 * HTTP errors when a resource type is not available on the service tier.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApimClient, HttpError } from '../../../src/clients/apim-client.js';
import { ResourceType } from '../../../src/models/resource-types.js';
import { ApimServiceContext } from '../../../src/models/types.js';

const testContext: ApimServiceContext = {
  subscriptionId: 'sub-1',
  resourceGroup: 'rg-1',
  serviceName: 'apim-1',
  apiVersion: '2024-05-01',
  baseUrl:
    'https://management.azure.com/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1',
};

function makeResponse(
  status: number,
  body: unknown,
  contentType = 'application/json'
): Response {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(json, {
    status,
    headers: { 'Content-Type': contentType },
  });
}

describe('ApimClient.listResources', () => {
  let client: ApimClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new ApimClient();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // @azure/identity is mocked via credential; stub getToken on the instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'getToken').mockResolvedValue('fake-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should yield items from a successful 200 response', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, {
        value: [
          { name: 'gw-1' },
          { name: 'gw-2' },
        ],
      })
    );

    const results: unknown[] = [];
    for await (const item of client.listResources(testContext, ResourceType.Gateway)) {
      results.push(item);
    }

    expect(results).toHaveLength(2);
    expect((results[0] as { name: string }).name).toBe('gw-1');
  });

  it('should return empty list and not throw on HTTP 404 (resource type not found)', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(404, { error: { code: 'ResourceNotFound', message: 'Not found' } })
    );

    const results: unknown[] = [];
    for await (const item of client.listResources(testContext, ResourceType.Gateway)) {
      results.push(item);
    }

    expect(results).toHaveLength(0);
  });

  it('should return empty list and not throw on HTTP 404 with empty body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', { status: 404, headers: { 'Content-Type': 'text/plain' } })
    );

    const results: unknown[] = [];
    for await (const item of client.listResources(testContext, ResourceType.Gateway)) {
      results.push(item);
    }

    expect(results).toHaveLength(0);
  });

  it('should return empty list and not throw on HTTP 400 with MethodNotAllowedInPricingTier', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        makeResponse(400, {
          error: {
            code: 'MethodNotAllowedInPricingTier',
            message: "Operation not allowed - feature 'Gateway' is not available in the 'Basic' tier.",
          },
        })
      )
    );

    const results: unknown[] = [];
    for await (const item of client.listResources(testContext, ResourceType.Gateway)) {
      results.push(item);
    }

    expect(results).toHaveLength(0);
  });

  it('should throw on HTTP 400 with a non-MethodNotAllowedInPricingTier error code', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(400, {
        error: {
          code: 'ValidationError',
          message: 'The request parameters are invalid.',
        },
      })
    );

    await expect(
      (async () => {
        for await (const _item of client.listResources(testContext, ResourceType.Gateway)) {
          // should not reach here
        }
      })()
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('should throw on HTTP 400 with non-JSON error body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Bad Request', { status: 400, headers: { 'Content-Type': 'text/plain' } })
    );

    await expect(
      (async () => {
        for await (const _item of client.listResources(testContext, ResourceType.Gateway)) {
          // should not reach here
        }
      })()
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('should throw on HTTP 400 with JSON error body missing error.code field', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(400, {
        error: {
          message: 'Some error message without a code field.',
        },
      })
    );

    await expect(
      (async () => {
        for await (const _item of client.listResources(testContext, ResourceType.Gateway)) {
          // should not reach here
        }
      })()
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('should populate HttpError.code from JSON error body', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(400, {
        error: {
          code: 'ValidationError',
          message: 'Invalid parameters.',
        },
      })
    );

    let caughtError: unknown;
    try {
      for await (const _item of client.listResources(testContext, ResourceType.Api)) {
        // should not reach here
      }
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(HttpError);
    expect((caughtError as HttpError).code).toBe('ValidationError');
    expect((caughtError as HttpError).status).toBe(400);
  });

  it('should skip any resource type that returns MethodNotAllowedInPricingTier (generic)', async () => {
    // Test with VersionSet resource type — demonstrates the behavior is generic, not gateway-specific
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        makeResponse(400, {
          error: {
            code: 'MethodNotAllowedInPricingTier',
            message: "Operation not allowed - feature 'ApiVersionSet' is not available in the 'Consumption' tier.",
          },
        })
      )
    );

    const results: unknown[] = [];
    for await (const item of client.listResources(testContext, ResourceType.VersionSet)) {
      results.push(item);
    }

    expect(results).toHaveLength(0);
  });

  it('should throw on HTTP 401 (unauthorized)', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(401, { error: { code: 'Unauthorized', message: 'Unauthorized' } })
    );

    await expect(
      (async () => {
        for await (const _item of client.listResources(testContext, ResourceType.Gateway)) {
          // should not reach here
        }
      })()
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('should throw on HTTP 403 (forbidden)', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(403, { error: { code: 'Forbidden', message: 'Access denied' } })
    );

    await expect(
      (async () => {
        for await (const _item of client.listResources(testContext, ResourceType.Gateway)) {
          // should not reach here
        }
      })()
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('should follow nextLink pagination', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeResponse(200, {
          value: [{ name: 'gw-1' }],
          nextLink: `${testContext.baseUrl}/gateways?api-version=2024-05-01&$skip=1`,
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          value: [{ name: 'gw-2' }],
        })
      );

    const results: unknown[] = [];
    for await (const item of client.listResources(testContext, ResourceType.Gateway)) {
      results.push(item);
    }

    expect(results).toHaveLength(2);
  });

  it('should build a well-formed URL for child resources (no double ?api-version)', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { value: [{ name: 'op-1' }] })
    );

    const parentDescriptor = {
      type: ResourceType.Api,
      name: 'my-api',
    };

    const results: unknown[] = [];
    for await (const item of client.listResources(testContext, ResourceType.ApiOperation, parentDescriptor)) {
      results.push(item);
    }

    expect(results).toHaveLength(1);

    // The URL sent to fetch must contain exactly one occurrence of "?api-version="
    // and must NOT embed "api-version=..." inside another query value.
    const calledUrl: string = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/\/operations\?api-version=2024-05-01$/);
    expect(calledUrl.split('?')).toHaveLength(2); // exactly one query separator
  });
});

describe('ApimClient.getResource', () => {
  let client: ApimClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new ApimClient();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'getToken').mockResolvedValue('fake-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should return JSON response as-is for standard resources', async () => {
    const mockJson = {
      id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1/policies/policy',
      name: 'policy',
      type: 'Microsoft.ApiManagement/service/policies',
      properties: {
        value: '<policies><inbound /></policies>',
        format: 'xml',
      },
    };

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockJson), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const descriptor = {
      type: ResourceType.ServicePolicy,
      name: 'policy',
    };

    const result = await client.getResource(testContext, descriptor);

    expect(result).toEqual(mockJson);
  });

  it('should wrap raw XML response (via Content-Type header) in JSON envelope', async () => {
    const xmlBody = '<!-- Copyright (c) Microsoft Corporation. -->\n<policies><inbound /></policies>';

    fetchSpy.mockResolvedValueOnce(
      new Response(xmlBody, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      })
    );

    const descriptor = {
      type: ResourceType.ServicePolicy,
      name: 'policy',
    };

    const result = await client.getResource(testContext, descriptor);

    expect(result).toEqual({
      properties: {
        value: xmlBody,
        format: 'rawxml',
      },
    });
  });

  it('should wrap raw XML response (via body sniffing) when Content-Type is not xml', async () => {
    const xmlBody = '<!--\n    Copyright notice\n-->\n<policies>\n  <inbound />\n</policies>';

    fetchSpy.mockResolvedValueOnce(
      new Response(xmlBody, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    const descriptor = {
      type: ResourceType.ApiPolicy,
      name: 'policy',
    };

    const result = await client.getResource(testContext, descriptor);

    expect(result).toEqual({
      properties: {
        value: xmlBody,
        format: 'rawxml',
      },
    });
  });

  it('should return undefined on 404 response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const descriptor = {
      type: ResourceType.ServicePolicy,
      name: 'policy',
    };

    const result = await client.getResource(testContext, descriptor);

    expect(result).toBeUndefined();
  });

  it('should return undefined on 405 (association endpoints that do not support GET)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ Message: "The requested resource does not support http method 'GET'." }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const descriptor = {
      type: ResourceType.ProductGroup,
      name: 'my-group',
      parent: 'my-product',
    };

    const result = await client.getResource(testContext, descriptor);

    expect(result).toBeUndefined();
  });

  it('should return undefined on HTTP 500 for ApiWiki without retrying', async () => {
    // Azure APIM returns 500 (not 404) for APIs that have no wiki.
    // getResource must treat this as "not found" and must NOT retry.
    fetchSpy.mockResolvedValueOnce(
      new Response('The page cannot be displayed because an internal server error has occurred.', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    const descriptor = {
      type: ResourceType.ApiWiki,
      name: 'my-api',
    };

    const result = await client.getResource(testContext, descriptor);

    expect(result).toBeUndefined();
    // Must not retry — fetch called exactly once
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should return undefined on HTTP 500 for ProductWiki without retrying', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('The page cannot be displayed because an internal server error has occurred.', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    const descriptor = {
      type: ResourceType.ProductWiki,
      name: 'my-product',
    };

    const result = await client.getResource(testContext, descriptor);

    expect(result).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should retry HTTP 500 for non-wiki resource types', async () => {
    // Non-wiki 500s are transient server errors and must still be retried.
    fetchSpy
      .mockResolvedValueOnce(new Response('error', { status: 500, headers: { 'Content-Type': 'text/plain' } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'policy' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const descriptor = {
      type: ResourceType.ServicePolicy,
      name: 'policy',
    };

    const result = await client.getResource(testContext, descriptor);

    expect(result).toEqual({ name: 'policy' });
    // Retried once after the initial 500
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('ApimClient.putResource provisioning polling', () => {
  let client: ApimClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new ApimClient();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    vi.spyOn(client as any, 'getToken').mockResolvedValue('fake-token');
    // Suppress polling delay to keep tests fast
    vi.spyOn(client as any, 'delay').mockResolvedValue(undefined);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const descriptor = { type: ResourceType.NamedValue, name: 'my-nv' };
  const succeededResource = { name: 'my-nv', properties: { provisioningState: 'Succeeded' } };

  it('should poll when PUT returns 201 and eventually return the resource', async () => {
    fetchSpy
      // Initial PUT → 201
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'my-nv' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      // First poll GET → 404 (transient — still provisioning)
      .mockResolvedValueOnce(
        new Response('', { status: 404, headers: { 'Content-Type': 'application/json' } })
      )
      // Second poll GET → 200 Succeeded
      .mockResolvedValueOnce(
        new Response(JSON.stringify(succeededResource), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const result = await client.putResource(testContext, descriptor, { name: 'my-nv' });

    expect(result).toEqual(succeededResource);
    // PUT + 2 GET polls = 3 fetch calls
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('should continue polling when resource is transiently unavailable (404) and succeed later', async () => {
    // Simulate multiple consecutive 404s before the resource appears
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'my-nv' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      // Three consecutive 404s (transient)
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      // Finally succeeds
      .mockResolvedValueOnce(
        new Response(JSON.stringify(succeededResource), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const result = await client.putResource(testContext, descriptor, {});

    expect(result).toEqual(succeededResource);
  });

  it('should return normalised JSON envelope when PUT 200 response body is raw XML', async () => {
    // Some APIM policy endpoints return raw XML (not JSON) after a successful PUT.
    // The client must not throw and should wrap the XML in a standard ARM envelope.
    const xmlBody = '<!-- Copyright (c) Contoso. -->\n<policies><inbound><base /></inbound></policies>';

    fetchSpy.mockResolvedValueOnce(
      new Response(xmlBody, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.ms-azure-apim.policy.raw+xml' },
      })
    );

    const policyDescriptor = { type: ResourceType.ServicePolicy, name: 'policy' };
    const result = await client.putResource(testContext, policyDescriptor, {
      properties: { value: xmlBody, format: 'rawxml' },
    });

    expect(result).toEqual({ properties: { value: xmlBody, format: 'rawxml' } });
    // No polling — only the initial PUT call
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should return normalised JSON envelope when PUT 200 response body starts with XML comment', async () => {
    // Regression test: "Unexpected token '<', \"<!-- \\n    \"... is not valid JSON"
    // XML bodies that start with an XML comment (<!-- ... -->) must be handled gracefully.
    const xmlBody = '<!--\n    Some copyright notice\n-->\n<policies><inbound /></policies>';

    fetchSpy.mockResolvedValueOnce(
      new Response(xmlBody, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    );

    const policyDescriptor = { type: ResourceType.ProductPolicy, name: 'my-product' };
    const result = await client.putResource(testContext, policyDescriptor, {
      properties: { value: xmlBody, format: 'rawxml' },
    });

    expect(result).toEqual({ properties: { value: xmlBody, format: 'rawxml' } });
  });

  it('should return empty object when PUT 200 response body is empty', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await client.putResource(testContext, descriptor, {});

    expect(result).toEqual({});
  });

  it('should return parsed JSON when PUT 200 response body is valid JSON', async () => {
    const jsonBody = { name: 'my-nv', properties: { value: 'hello' } };

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(jsonBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await client.putResource(testContext, descriptor, {});

    expect(result).toEqual(jsonBody);
  });
});

describe('ApimClient HTTP 429 rate limiting', () => {
  let client: ApimClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new ApimClient();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    vi.spyOn(client as any, 'getToken').mockResolvedValue('fake-token');
    // Suppress delay to keep tests fast
    vi.spyOn(client as any, 'delay').mockResolvedValue(undefined);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should retry on HTTP 429 with Retry-After header', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response('', { 
          status: 429, 
          headers: { 'Retry-After': '2' },
        })
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          value: [{ name: 'gw-1' }],
        })
      );

    const results: unknown[] = [];
    for await (const item of client.listResources(testContext, ResourceType.Gateway)) {
      results.push(item);
    }

    expect(results).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should retry on HTTP 429 without Retry-After header using exponential backoff', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response('', { status: 429 })
      )
      .mockResolvedValueOnce(
        makeResponse(200, { name: 'nv-1', properties: { value: 'test' } })
      );

    const descriptor = {
      type: ResourceType.NamedValue,
      name: 'nv-1',
    };

    const result = await client.getResource(testContext, descriptor);

    expect(result).toEqual({ name: 'nv-1', properties: { value: 'test' } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should fail after max retries on repeated 429 responses', async () => {
    fetchSpy.mockResolvedValue(
      new Response('', { status: 429, headers: { 'Retry-After': '1' } })
    );

    const descriptor = {
      type: ResourceType.NamedValue,
      name: 'nv-1',
    };

    await expect(client.getResource(testContext, descriptor)).rejects.toThrow();
    // MAX_RETRIES is 3, so we expect 4 attempts (initial + 3 retries)
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('should retry 429 on PUT operations', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '1' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'my-nv' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const descriptor = {
      type: ResourceType.NamedValue,
      name: 'my-nv',
    };

    const result = await client.putResource(testContext, descriptor, { value: 'test' });

    expect(result).toEqual({ name: 'my-nv' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('ApimClient.getApiSpecification', () => {
  let client: ApimClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new ApimClient();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'getToken').mockResolvedValue('fake-token');
    // Suppress delays to keep tests fast
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'delay').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should fetch spec content from blob link and return YAML format', async () => {
    const exportResponse = {
      id: '/subscriptions/sub-1/providers/Microsoft.ApiManagement/service/apim-1/apis/pet-store',
      format: 'openapi-link',
      value: { link: 'https://blob.storage.example.com/specs/pet-store.yaml?sv=2021-01-01&sig=abc' },
    };
    const yamlContent = 'openapi: "3.0.0"\ninfo:\n  title: Pet Store\n  version: "1.0"';

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exportResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(yamlContent, {
          status: 200,
          headers: { 'Content-Type': 'text/yaml' },
        })
      );

    const result = await client.getApiSpecification(testContext, 'pet-store');

    expect(result).toEqual({ content: yamlContent, format: 'yaml' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // First call should be the authenticated ARM export request
    const armCall = fetchSpy.mock.calls[0];
    expect((armCall[1] as RequestInit).headers).toBeDefined();
    expect((armCall[1] as RequestInit & { headers: Headers }).headers.get('Authorization')).toBe('Bearer fake-token');
    // Second call should be directly to the blob URL — no Authorization header (SAS token is self-authenticating)
    const blobCall = fetchSpy.mock.calls[1];
    expect(blobCall[0]).toBe(exportResponse.value.link);
    expect((blobCall[1] as RequestInit & { headers: Headers }).headers.get('Authorization')).toBeNull();
  });

  it('should return JSON format when spec content is JSON', async () => {
    const exportResponse = {
      format: 'openapi-link',
      value: { link: 'https://blob.storage.example.com/specs/api.json?sv=2021-01-01' },
    };
    const jsonContent = '{"openapi":"3.0.0","info":{"title":"My API","version":"1.0"}}';

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exportResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(jsonContent, { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

    const result = await client.getApiSpecification(testContext, 'my-api');

    expect(result).toEqual({ content: jsonContent, format: 'json' });
  });

  it('should use wsdl-link format and return WSDL for soap APIs', async () => {
    const exportResponse = {
      format: 'wsdl-link',
      value: { link: 'https://blob.storage.example.com/specs/service.wsdl?sv=2021' },
    };
    const wsdlContent = '<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"></wsdl:definitions>';

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exportResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(wsdlContent, { status: 200, headers: { 'Content-Type': 'application/xml' } })
      );

    const result = await client.getApiSpecification(testContext, 'soap-api', 'soap');

    expect(result).toEqual({ content: wsdlContent, format: 'wsdl' });
    const armCallUrl = fetchSpy.mock.calls[0][0] as string;
    expect(armCallUrl).toContain('format=wsdl-link');
  });

  it('should use graphql-link format and return GraphQL SDL for graphql APIs', async () => {
    const blobLink = 'https://blob.storage.example.com/specs/schema.graphql?sv=2021';
    const exportResponse = {
      format: 'graphql-link',
      value: { link: blobLink },
    };
    const sdlContent = 'type Query {\n  pets: [Pet]\n}\ntype Pet {\n  id: ID!\n  name: String\n}';

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exportResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(sdlContent, { status: 200, headers: { 'Content-Type': 'text/plain' } })
      );

    const result = await client.getApiSpecification(testContext, 'gql-api', 'graphql');

    expect(result).toEqual({ content: sdlContent, format: 'graphql' });
    const armCallUrl = fetchSpy.mock.calls[0][0] as string;
    expect(armCallUrl).toContain('format=graphql-link');
    // Blob URL should be fetched without auth header
    expect(fetchSpy.mock.calls[1][0]).toBe(blobLink);
    expect((fetchSpy.mock.calls[1][1] as RequestInit & { headers: Headers }).headers.get('Authorization')).toBeNull();
  });

  it('should return undefined when APIM export returns 404', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    );

    const result = await client.getApiSpecification(testContext, 'nonexistent-api');

    expect(result).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should return undefined when export response has no value.link', async () => {
    // Old/wrong response shape — should return undefined gracefully
    const exportResponse = { properties: { value: 'some-spec', format: 'openapi' } };

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(exportResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await client.getApiSpecification(testContext, 'my-api');

    expect(result).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should return undefined when blob fetch returns non-retriable 4xx', async () => {
    const exportResponse = {
      format: 'openapi-link',
      value: { link: 'https://blob.storage.example.com/specs/api.yaml?sv=2021' },
    };

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exportResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } })
      );

    const result = await client.getApiSpecification(testContext, 'my-api');

    expect(result).toBeUndefined();
    // 403 is not retried — only 1 blob fetch attempt
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should retry blob fetch on transient 5xx and succeed', async () => {
    const blobLink = 'https://blob.storage.example.com/specs/api.yaml?sv=2021';
    const exportResponse = { format: 'openapi-link', value: { link: blobLink } };
    const yamlContent = 'openapi: "3.0.0"\ninfo:\n  title: My API\n  version: "1.0"';

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exportResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      // First blob attempt: transient 503
      .mockResolvedValueOnce(
        new Response('Service Unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      )
      // Second blob attempt: success
      .mockResolvedValueOnce(
        new Response(yamlContent, { status: 200, headers: { 'Content-Type': 'text/yaml' } })
      );

    const result = await client.getApiSpecification(testContext, 'my-api');

    expect(result).toEqual({ content: yamlContent, format: 'yaml' });
    // 1 ARM call + 2 blob calls (1 retry after 503)
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    // Both blob calls go to the same URL without an Authorization header
    expect(fetchSpy.mock.calls[1][0]).toBe(blobLink);
    expect((fetchSpy.mock.calls[1][1] as RequestInit & { headers: Headers }).headers.get('Authorization')).toBeNull();
    expect(fetchSpy.mock.calls[2][0]).toBe(blobLink);
    expect((fetchSpy.mock.calls[2][1] as RequestInit & { headers: Headers }).headers.get('Authorization')).toBeNull();
  });

  it('should use openapi-link format by default (no apiType)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await client.getApiSpecification(testContext, 'pet-store');

    expect(result).toBeUndefined();
    const apimCallUrl = fetchSpy.mock.calls[0][0] as string;
    expect(apimCallUrl).toContain('/apis/pet-store');
    expect(apimCallUrl).toContain('export=true');
    expect(apimCallUrl).toContain('format=openapi-link');
    expect(apimCallUrl).toContain(`api-version=${testContext.apiVersion}`);
  });

  it('should use openapi-link format for explicit http apiType', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await client.getApiSpecification(testContext, 'rest-api', 'http');

    const apimCallUrl = fetchSpy.mock.calls[0][0] as string;
    expect(apimCallUrl).toContain('format=openapi-link');
  });

  it('should return undefined for websocket apiType without making an HTTP request', async () => {
    // WebSocket APIs have no traditional API specification. getExportFormat returns
    // undefined for websocket, causing getApiSpecification to short-circuit.
    const result = await client.getApiSpecification(testContext, 'ws-api', 'websocket');

    expect(result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should handle top-level link format (api-version 2024-05-01)', async () => {
    // APIM 2024-05-01 returns { link: "..." } at the top level, not nested under value
    const exportResponse = {
      link: 'https://apigblstorageprdmwh.blob.core.windows.net/api-export/My%20API.yaml?sv=2024-08-04&sig=abc',
    };
    const yamlContent = 'openapi: "3.0.0"\ninfo:\n  title: My API\n  version: "1.0"';

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exportResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(yamlContent, {
          status: 200,
          headers: { 'Content-Type': 'text/yaml' },
        })
      );

    const result = await client.getApiSpecification(testContext, 'my-api');

    expect(result).toEqual({ content: yamlContent, format: 'yaml' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe(exportResponse.link);
  });
});
