// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for the shared ARM HTTP client: error parsing, Retry-After,
 * host validation, token caching, request retries, pagination and
 * long-running operation polling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ArmHttpClient,
  HttpError,
  maskSasSignature,
  ArmTokenCredential,
  describeRequestTarget,
  extractAsyncOperation,
  isArmUrl,
  paginateArm,
  parseArmError,
  parseRetryAfterMs,
  pollArmOperation,
  readArmState,
  waitUntilGone,
} from '../../../src/clients/arm-http-client.js';
import { HttpError as ApimHttpError } from '../../../src/clients/apim-client.js';
import { getArmHosts } from '../../../src/lib/cloud-config.js';
import { ApicHttpError } from '../../../src/clients/apic-client.js';
import { logger } from '../../../src/lib/logger.js';
import { trackRetries } from '../../../src/lib/retry-tracker.js';
import { USER_AGENT } from '../../../src/lib/user-agent.js';

const ARM = 'https://management.azure.com';
const URL_1 = `${ARM}/subscriptions/sub-1/resourceGroups/rg-1?api-version=2021-04-01`;
const OPERATION_URL = `${ARM}/subscriptions/sub-1/providers/Microsoft.ApiCenter/operationStatuses/op-1`;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : '', { status, headers });
}

/** A response with the given status whose body records whether it was cancelled. */
function unread(status: number, cancel: () => void): Response {
  return new Response(new ReadableStream({ cancel }), { status });
}

function credential(token = 'fake-token', ttlMs = 60 * 60 * 1000): ArmTokenCredential & {
  getToken: ReturnType<typeof vi.fn>;
} {
  return {
    getToken: vi.fn(async () => ({ token, expiresOnTimestamp: Date.now() + ttlMs })),
  };
}

describe('HttpError', () => {
  it('should carry status, code and body', () => {
    const error = new HttpError(409, 'HTTP 409: conflict', 'Conflict', { error: {} });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ status: 409, code: 'Conflict', body: { error: {} }, name: 'HttpError' });
  });

  it('should be the class the APIM client exports and ApicHttpError aliases', () => {
    expect(ApimHttpError).toBe(HttpError);
    expect(new ApicHttpError(400, 'x')).toBeInstanceOf(HttpError);
    expect(new HttpError(400, 'x')).toBeInstanceOf(ApicHttpError);
  });
});

describe('parseArmError', () => {
  it('should return the ARM error code, message and body', () => {
    const text = JSON.stringify({ error: { code: 'ValidationError', message: 'bad' } });
    expect(parseArmError(text)).toEqual({
      code: 'ValidationError',
      message: 'bad',
      details: [],
      body: { error: { code: 'ValidationError', message: 'bad' } },
    });
  });

  it('should return the messages of the error details, after their target', () => {
    const body = {
      error: {
        code: 'ValidationError',
        message: 'One or more fields contain incorrect values:',
        details: [
          { code: 'ValidationError', target: 'representation', message: 'Content type is invalid' },
          { code: 'ValidationError', message: 'Value is required' },
          { code: 'ValidationError', target: 'ignored' },
          'not an object',
        ],
      },
    };
    expect(parseArmError(JSON.stringify(body)).details).toEqual([
      'representation: Content type is invalid',
      'Value is required',
    ]);
  });

  it.each([
    ['no error object', { message: 'x' }],
    ['a non-string code and message', { error: { code: 42, message: { text: 'x' } } }],
    ['a null error', { error: null }],
  ])('should return the body without a code or message for %s', (_label, body) => {
    expect(parseArmError(JSON.stringify(body))).toEqual({
      code: undefined,
      message: undefined,
      details: [],
      body,
    });
  });

  it('should return nothing for a non-JSON body', () => {
    expect(parseArmError('Service Unavailable')).toEqual({});
  });
});

describe('parseRetryAfterMs', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['5', 5000],
    ['1.5', 1500],
    ['-1', 0],
  ])('should parse delay-seconds %j as the Azure SDK does', (value, expected) => {
    expect(parseRetryAfterMs(value)).toBe(expected);
  });

  it('should parse an HTTP-date relative to now', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:30 GMT')).toBe(30_000);
  });

  it('should not bound an HTTP-date or delay-seconds', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 01:00:00 GMT')).toBe(3_600_000);
    expect(parseRetryAfterMs('3600')).toBe(3_600_000);
  });

  it('should clamp an HTTP-date in the past to zero', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(parseRetryAfterMs('Wed, 31 Dec 2025 23:59:00 GMT')).toBe(0);
  });

  it.each([null, '', 'soon', 'Infinity'])('should return undefined for %j', (value) => {
    expect(parseRetryAfterMs(value)).toBeUndefined();
  });
});

describe('isArmUrl', () => {
  it.each([
    'https://management.azure.com/subscriptions/x',
    'https://eastus.management.azure.com/x',
    'https://MANAGEMENT.AZURE.COM/x',
  ])('should accept %s on a public-cloud ARM host', (url) => {
    expect(isArmUrl(url, getArmHosts())).toBe(true);
  });

  it.each([
    'http://management.azure.com/x',
    'https://management.azure.com.attacker.example/x',
    'https://notmanagement.azure.com/x',
    'https://blob.core.windows.net/x',
    'not a url',
  ])('should reject %s', (url) => {
    expect(isArmUrl(url, getArmHosts())).toBe(false);
  });

  it('should accept only the given hosts', () => {
    const hosts = ['management.usgovcloudapi.net'];

    expect(isArmUrl('https://management.usgovcloudapi.net/x', hosts)).toBe(true);
    expect(isArmUrl('https://management.azure.com/x', hosts)).toBe(false);
  });
});

describe('describeRequestTarget', () => {
  const APIM_BASE_URL =
    `${ARM}/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.ApiManagement/service/apim-1`;

  it('should reduce API Center URLs to the path below the service', () => {
    expect(
      describeRequestTarget(
        `${ARM}/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiCenter/services/apic-1` +
        '/workspaces/default/apis/pet%20store?api-version=2024-06-01-preview',
      ),
    ).toBe('workspaces/default/apis/pet store');
  });

  it('should describe an API Center service root as the service', () => {
    expect(
      describeRequestTarget(
        `${ARM}/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiCenter/services/apic-1?api-version=x`,
      ),
    ).toBe('service');
  });

  it('should keep host and path for other ARM URLs', () => {
    expect(describeRequestTarget(URL_1)).toBe('management.azure.com/subscriptions/sub-1/resourceGroups/rg-1');
  });

  it('should reduce APIM URLs to the path below the service', () => {
    expect(
      describeRequestTarget(`${APIM_BASE_URL}/namedValues/nv%201?api-version=2024-05-01`),
    ).toBe('namedValues/nv 1');
  });

  it('should describe an APIM service root as the service', () => {
    expect(describeRequestTarget(`${APIM_BASE_URL}?api-version=2024-05-01`)).toBe('service');
  });

  it('should read a value that is not an absolute URL as a path', () => {
    expect(
      describeRequestTarget(
        '/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiManagement/service/a/apis/echo%20api?sig=secret',
      ),
    ).toBe('apis/echo api');
  });

  it('should keep a path with broken percent-encoding as it is', () => {
    expect(describeRequestTarget(`${APIM_BASE_URL}/apis/bad%E0%A4%A`)).toBe('apis/bad%E0%A4%A');
  });

  it('should keep host and path for non-ARM URLs and drop the query string', () => {
    expect(describeRequestTarget('https://blob.example.net/container/spec.json?sig=secret')).toBe(
      'blob.example.net/container/spec.json',
    );
  });
});

// Shared by the ArmHttpClient, pagination and LRO polling tests below: fetch
// is stubbed, the credential is a stub and delays are recorded, not waited.
let fetchSpy: ReturnType<typeof vi.fn>;
let delays: number[];
let cred: ReturnType<typeof credential>;

function client(): ArmHttpClient {
  return new ArmHttpClient({
    credential: cred,
    delay: async (ms) => {
      delays.push(ms);
    },
  });
}

function headersOf(n: number): Headers {
  return new Headers((fetchSpy.mock.calls[n][1] as RequestInit).headers);
}

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  delays = [];
  cred = credential();
  // No jitter: back-off is exactly 1s, 2s, 4s.
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ArmHttpClient.getToken', () => {
  it('should default to the public cloud scope', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, {}));

    await client().request(URL_1);

    expect(cred.getToken).toHaveBeenCalledWith('https://management.azure.com/.default');
  });

  it('should use the configured scope', async () => {
    const http = new ArmHttpClient({
      authScope: 'https://management.usgovcloudapi.net/.default',
      credential: cred,
    });

    await http.getToken();

    expect(cred.getToken).toHaveBeenCalledWith('https://management.usgovcloudapi.net/.default');
  });

  it("should refresh after the credential's refreshAfterTimestamp", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    cred.getToken
      .mockResolvedValueOnce({
        token: 't1',
        expiresOnTimestamp: start + 60 * 60 * 1000,
        refreshAfterTimestamp: start + 30 * 60 * 1000,
      })
      .mockResolvedValueOnce({ token: 't2', expiresOnTimestamp: start + 120 * 60 * 1000 });
    const http = client();

    await http.getToken();
    vi.setSystemTime(start + 31 * 60 * 1000);
    expect(await http.getToken()).toBe('t1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(await http.getToken()).toBe('t2');
  });

  it('should not cache a token without an expiry', async () => {
    cred.getToken.mockResolvedValue({ token: 't' });
    const http = client();

    await http.getToken();
    await http.getToken();

    expect(cred.getToken).toHaveBeenCalledTimes(2);
  });

  it('should throw when the credential returns no token', async () => {
    cred.getToken.mockResolvedValue(null);

    await expect(client().getToken()).rejects.toThrow('Failed to acquire an ARM token');
  });
});

describe('ArmHttpClient.request headers', () => {
  it('should send Authorization, Content-Type and User-Agent', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, {}));

    await client().request(URL_1, { method: 'PUT', body: '{}' });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_1);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{}');
    const headers = headersOf(0);
    expect(headers.get('Authorization')).toBe('Bearer fake-token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('User-Agent')).toBe(USER_AGENT);
  });

  it('should strip all credentials and skip the token with skipAuth', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('spec', { status: 200 }));

    await client().request(
      'https://blob.example.net/spec.yaml?sig=secret',
      {
        headers: {
          Authorization: 'Bearer leaked',
          'Proxy-Authorization': 'Basic leaked',
          'x-ms-authorization-auxiliary': 'Bearer leaked',
          Accept: 'text/plain',
        },
      },
      { skipAuth: true },
    );

    const headers = headersOf(0);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Proxy-Authorization')).toBeNull();
    expect(headers.get('x-ms-authorization-auxiliary')).toBeNull();
    expect(headers.get('Content-Type')).toBeNull();
    expect(headers.get('Accept')).toBe('text/plain');
    expect(headers.get('User-Agent')).toBe(USER_AGENT);
    expect(cred.getToken).not.toHaveBeenCalled();
  });
});

describe('maskSasSignature', () => {
  // A signature of the real form (base64 of a 32-byte HMAC-SHA256).
  const signature = '++++QUJD++++QUJD++++QUJD++++QUJD++++QUJD++8=';
  const encoded = encodeURIComponent(signature);
  const url = `https://blob.example.net/a?sv=1&sig=${encoded}&se=2`;

  it.each([
    ['as sent', `x ${encoded} y`, 'x *** y'],
    ['as sent, with lower-case escapes', `x ${encoded.toLowerCase()} y`, 'x *** y'],
    ['decoded', `blocked (${signature})`, 'blocked (***)'],
    ['with HTML character references', `<p>${signature.replace(/\+/g, '&#43;').replace('=', '&#x3d;')}</p>`, '<p>***</p>'],
    ['with only some characters escaped', `{"sig":"${signature.replace('+', '\\u002B').replace('=', '%3D')}"}`, '{"sig":"***"}'],
    [
      'in a link to the percent-encoded URL',
      `href="https%3A%2F%2Fblob.example.net%2Fa%3Fsv%3D1%26sig%3D${encodeURIComponent(encoded)}%26se%3D2"`,
      'href="https%3A%2F%2Fblob.example.net%2Fa%3Fsv%3D1%26sig%3D***%26se%3D2"',
    ],
    ['in another sig= parameter', 'GET /a?sv=1&sig=other123&se=2', 'GET /a?sv=1&sig=***&se=2'],
    ['in an HTML-escaped link', 'href="/a?sv=1&amp;sig=other123&amp;se=2"', 'href="/a?sv=1&amp;sig=***&amp;se=2"'],
    ['at the start of a line', 'line\nsig=zzz', 'line\nsig=***'],
    // Another sig value, so only the parameter rule can mask these.
    [
      'with sig first in a percent-encoded URL',
      encodeURIComponent('https://blob.example.net/a?sig=other123&se=2'),
      'https%3A%2F%2Fblob.example.net%2Fa%3Fsig%3D***%26se%3D2',
    ],
    [
      'in a URL percent-encoded twice',
      encodeURIComponent(encodeURIComponent('https://blob.example.net/a?sv=1&sig=other123&se=2')),
      'https%253A%252F%252Fblob.example.net%252Fa%253Fsv%253D1%2526sig%253D***%2526se%253D2',
    ],
    [
      'with sig first in a URL percent-encoded twice',
      encodeURIComponent(encodeURIComponent('https://blob.example.net/a?sig=other123&se=2')),
      'https%253A%252F%252Fblob.example.net%252Fa%253Fsig%253D***%2526se%253D2',
    ],
    ['ending at a semicolon', 'GET /a?sv=1;sig=abc;se=2', 'GET /a?sv=1;sig=***;se=2'],
    ['ending at a bracket or full stop', '[/a?sig=abc] and sig=def. Retry', '[/a?sig=***] and sig=***. Retry'],
    [
      'in a JSON-escaped URL',
      '{"url":"https://blob.example.net/a?sv=1\\u0026sig=other123\\u0026se=2"}',
      '{"url":"https://blob.example.net/a?sv=1\\u0026sig=***\\u0026se=2"}',
    ],
  ])('should mask the signature %s', (_label, text, expected) => {
    expect(maskSasSignature(text, url)).toBe(expected);
  });

  it('should mask a signature with HTML character references in a sig= parameter', () => {
    const startsWithLetter = 'QUJD++++QUJD++++QUJD++++QUJD++++QUJD++++++8=';
    const sasUrl = `https://blob.example.net/a?sv=1&sig=${encodeURIComponent(startsWithLetter)}&se=2`;
    const text = `href="/a?sv=1&amp;sig=${startsWithLetter.replace(/\+/g, '&#43;')}&amp;se=2"`;

    expect(maskSasSignature(text, sasUrl)).toBe('href="/a?sv=1&amp;sig=***&amp;se=2"');
  });

  it("should mask a signature sent with an unencoded '+'", () => {
    const unencoded = `https://blob.example.net/a?sv=1&sig=${signature}&se=2`;

    expect(maskSasSignature(`blocked (${signature})`, unencoded)).toBe('blocked (***)');
  });

  it('should mask the signature quoted JSON-escaped', () => {
    // '/' and '+' too, which JSON encoders can escape as \\/ and \\u002B.
    const slashed = '+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/8=';
    const jsonUrl = `https://blob.example.net/a?sig=${encodeURIComponent(slashed)}`;
    const slashEscaped = slashed.replace(/\//g, '\\/');
    const bothEscaped = slashEscaped.replace(/\+/g, '\\u002B');

    expect(maskSasSignature(`{"detail":"bad ${slashEscaped}"}`, jsonUrl)).toBe('{"detail":"bad ***"}');
    expect(maskSasSignature(`{"detail":"bad ${bothEscaped}"}`, jsonUrl)).toBe('{"detail":"bad ***"}');
    expect(maskSasSignature(`{"detail":"bad ${bothEscaped.toLowerCase()}"}`, jsonUrl)).not.toContain('u002b');
  });

  it('should mask a short hand-made signature only as a sig parameter', () => {
    expect(maskSasSignature('a banana at /a?sig=a', 'https://blob.example.net/a?sig=a')).toBe('a banana at /a?sig=***');
  });

  it('should leave text without a signature alone', () => {
    expect(maskSasSignature('<Error><Code>BlobNotFound</Code></Error>', url)).toBe('<Error><Code>BlobNotFound</Code></Error>');
  });
});

describe('ArmHttpClient.request errors and retries', () => {
  it('should ask for the token again before each retry', async () => {
    const http = client();
    vi.spyOn(http, 'getToken').mockResolvedValueOnce('t1').mockResolvedValueOnce('t2');
    const sent: (string | null)[] = [];
    const responses = [empty(429, { 'Retry-After': '3600' }), json(200, {})];
    fetchSpy.mockImplementation(async (_url, init) => {
      sent.push(new Headers(init?.headers).get('Authorization'));
      return responses.shift()!;
    });

    await http.request(URL_1);

    expect(sent).toEqual(['Bearer t1', 'Bearer t2']);
  });

  it('should mask the signature in a failed SAS download, naming the URL without its query', async () => {
    const signature = '++++QUJD++++QUJD++++QUJD++++QUJD++++QUJD++8=';
    // A proxy's block page that quotes the request URL, signature and all.
    const blockPage =
      '<html><body>Request to https://blob.example.net/spec.yaml?sv=2024-01-01&amp;' +
      `sig=${encodeURIComponent(signature)} was blocked (${signature})</body></html>`;
    fetchSpy.mockResolvedValueOnce(new Response(blockPage, { status: 403 }));

    const error = await client()
      .request(`https://blob.example.net/spec.yaml?sv=2024-01-01&sig=${encodeURIComponent(signature)}`, {}, { skipAuth: true })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    const { message, body } = error as HttpError;
    expect(message).toMatch(/^HTTP 403 from https:\/\/blob\.example\.net\/spec\.yaml: <html>.*was blocked/);
    expect(message).toContain('&amp;sig=*** was blocked (***)');
    for (const text of [message, String(body)]) {
      expect(text).not.toContain('QUJD');
    }
  });

  it("should keep a firewall's block page for a failed SAS download", async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Access to blob.example.net is blocked by policy', { status: 403 }));

    const error = await client()
      .request('https://blob.example.net/spec.yaml?sig=abc', {}, { skipAuth: true })
      .catch((e: unknown) => e);

    expect((error as Error).message).toBe(
      'HTTP 403 from https://blob.example.net/spec.yaml: Access to blob.example.net is blocked by policy'
    );
  });

  it('should throw HttpError with code and body for a 4xx without retrying', async () => {
    fetchSpy.mockResolvedValueOnce(json(400, { error: { code: 'ValidationError', message: 'bad' } }));

    const error = await client().request(URL_1, { method: 'PUT' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 400,
      code: 'ValidationError',
      body: { error: { code: 'ValidationError', message: 'bad' } },
    });
    expect((error as Error).message).toBe('HTTP 400: [ValidationError] bad');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a code only', { error: { code: 'Conflict' } }, 'HTTP 409: [Conflict]'],
    ['a message only', { error: { message: 'busy' } }, 'HTTP 409: busy'],
    ['no ARM error object', { detail: 'x' }, 'HTTP 409: {"detail":"x"}'],
    [
      'details after a message ending in a colon',
      { error: { code: 'ValidationError', message: 'One or more fields contain incorrect values:', details: [{ target: 'name', message: 'Too long' }, { message: 'Bad' }] } },
      'HTTP 409: [ValidationError] One or more fields contain incorrect values: name: Too long; Bad',
    ],
    ['details after a message', { error: { message: 'Invalid', details: [{ message: 'Bad' }] } }, 'HTTP 409: Invalid: Bad'],
    ['details only', { error: { details: [{ message: 'Bad' }] } }, 'HTTP 409: Bad'],
    [
      'nested details',
      { error: { code: 'InvalidTemplate', message: 'Failed:', details: [{ code: 'Outer', details: [{ target: 'body', message: 'Missing' }] }, { message: 'Second', details: [{ message: 'Inner' }] }] } },
      'HTTP 409: [InvalidTemplate] Failed: body: Missing; Second; Inner',
    ],
  ])('should build the message from %s', async (_label, body, message) => {
    fetchSpy.mockResolvedValueOnce(json(409, body));

    const error = await client().request(URL_1, { method: 'PUT' }).catch((e: unknown) => e);

    expect((error as Error).message).toBe(message);
    expect((error as HttpError).body).toEqual(body);
  });

  it('should truncate a long body in the message and keep it in full on body', async () => {
    const text = 'x'.repeat(2000);
    fetchSpy.mockResolvedValueOnce(new Response(text, { status: 400 }));

    const error = await client().request(URL_1, { method: 'PUT' }).catch((e: unknown) => e);

    expect((error as Error).message).toBe(`HTTP 400: ${'x'.repeat(500)}…`);
    expect((error as HttpError).body).toBe(text);
  });

  it('should keep a long ARM error message and its details in full', async () => {
    const longMessage = 'y'.repeat(2000);
    fetchSpy.mockResolvedValueOnce(
      json(400, { error: { code: 'Bad', message: longMessage, details: [{ message: 'z'.repeat(800) }] } })
    );

    const error = await client().request(URL_1, { method: 'PUT' }).catch((e: unknown) => e);

    expect((error as Error).message).toBe(`HTTP 400: [Bad] ${longMessage}: ${'z'.repeat(800)}`);
  });

  it('should retry a 4xx the caller marks as retryable', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(409, { error: { code: 'Busy' } }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    const response = await client().request(URL_1, { method: 'PUT' }, {
      isRetryableError: (error) => error.code === 'Busy',
    });

    expect(response.status).toBe(200);
    expect(delays).toEqual([1000]);
  });

  it('should return a 404 for GET by default and throw it for other methods', async () => {
    fetchSpy.mockResolvedValueOnce(empty(404)).mockResolvedValueOnce(empty(404));
    const http = client();

    await expect(http.request(URL_1)).resolves.toMatchObject({ status: 404 });
    await expect(http.request(URL_1, { method: 'DELETE' })).rejects.toMatchObject({ status: 404 });
  });

  it('should return a 404 for the configured passthrough methods', async () => {
    fetchSpy.mockResolvedValueOnce(empty(404));

    await expect(
      client().request(URL_1, { method: 'DELETE' }, { passthrough404Methods: ['GET', 'DELETE'] }),
    ).resolves.toMatchObject({ status: 404 });
  });

  it('should return allowed non-OK statuses', async () => {
    fetchSpy.mockResolvedValueOnce(empty(406));

    await expect(
      client().request(URL_1, {}, { allowedNonOkStatuses: [406] }),
    ).resolves.toMatchObject({ status: 406 });
  });

  it('should retry 5xx with back-off, then throw the last one', async () => {
    fetchSpy.mockImplementation(async () => new Response('down', { status: 503 }));

    const error = await client().request(URL_1).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 503 });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('should add up to 30% jitter to the back-off', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    fetchSpy.mockImplementation(async () => new Response('down', { status: 503 }));

    await client().request(URL_1).catch(() => undefined);

    expect(delays).toEqual([1300, 2600, 5200]);
  });

  it('should return a 5xx immediately with noRetryOn5xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('wiki', { status: 500 }));

    await expect(client().request(URL_1, {}, { noRetryOn5xx: true })).resolves.toMatchObject({
      status: 500,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should retry a network error', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(200, {}));

    await expect(client().request(URL_1)).resolves.toMatchObject({ status: 200 });
    expect(delays).toEqual([1000]);
  });

  it('should name the cause of a network error that outlasts the retries', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND example.test') }));

    const error = await client().request(URL_1).catch((e: unknown) => e);

    expect((error as Error).message).toBe('fetch failed (getaddrinfo ENOTFOUND example.test)');
    expect((error as Error).cause).toBeInstanceOf(TypeError);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('should not retry a request the proxy refuses with 407', async () => {
    fetchSpy.mockRejectedValue(
      new TypeError('fetch failed', { cause: new Error('Proxy response (407) !== 200 when HTTP Tunneling') }),
    );

    const error = await client().request(URL_1).catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/failed: the proxy refused the request with 407 Proxy Authentication Required\. Check the user name and password/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('should wait for numeric and HTTP-date Retry-After on 429', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    fetchSpy
      .mockResolvedValueOnce(empty(429, { 'Retry-After': '4' }))
      .mockResolvedValueOnce(empty(429, { 'Retry-After': 'Thu, 01 Jan 2026 00:00:09 GMT' }))
      .mockResolvedValueOnce(json(200, {}));

    await client().request(URL_1);

    expect(delays).toEqual([4000, 9000]);
  });

  it('should retry at once for a Retry-After of 0 or an HTTP-date in the past, as the Azure SDK does', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    fetchSpy
      .mockResolvedValueOnce(empty(429, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(empty(429, { 'Retry-After': 'Wed, 31 Dec 2025 23:59:00 GMT' }))
      .mockResolvedValueOnce(json(200, {}));

    await client().request(URL_1);

    expect(delays).toEqual([0, 0]);
  });

  it('should read retry-after-ms, then x-ms-retry-after-ms, before Retry-After', async () => {
    fetchSpy
      .mockResolvedValueOnce(empty(429, { 'retry-after-ms': '1500', 'x-ms-retry-after-ms': '2500', 'Retry-After': '9' }))
      .mockResolvedValueOnce(empty(429, { 'retry-after-ms': 'soon', 'x-ms-retry-after-ms': '2500', 'Retry-After': '9' }))
      .mockResolvedValueOnce(empty(429, { 'x-ms-retry-after-ms': '', 'Retry-After': '9' }))
      .mockResolvedValueOnce(json(200, {}));

    await client().request(URL_1);

    expect(delays).toEqual([1500, 2500, 9000]);
  });

  it('should wait for the Retry-After of a 503 and back off without one', async () => {
    fetchSpy
      .mockResolvedValueOnce(empty(503, { 'Retry-After': '7' }))
      .mockResolvedValueOnce(empty(503, { 'x-ms-retry-after-ms': '0' }))
      .mockResolvedValueOnce(empty(503))
      .mockResolvedValueOnce(json(200, {}));

    await client().request(URL_1);

    expect(delays).toEqual([7000, 0, 4000]);
  });

  it('should ignore Retry-After on a 5xx other than 503', async () => {
    fetchSpy
      .mockResolvedValueOnce(empty(500, { 'Retry-After': '7' }))
      .mockResolvedValueOnce(json(200, {}));

    await client().request(URL_1);

    expect(delays).toEqual([1000]);
  });

  it('should wait 1, 2 and 4 seconds for a missing or unparsable Retry-After, then throw the 429', async () => {
    fetchSpy
      .mockResolvedValueOnce(empty(429))
      .mockResolvedValueOnce(empty(429, { 'Retry-After': 'later' }))
      .mockResolvedValueOnce(empty(429))
      .mockResolvedValueOnce(json(429, { error: { code: 'TooManyRequests' } }, { 'Retry-After': '60' }));

    const error = await client().request(URL_1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 429, code: 'TooManyRequests' });
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it.each([429, 503])('should cancel the body of a %i response before retrying it', async (status) => {
    const cancel = vi.fn();
    fetchSpy
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status }))
      .mockResolvedValueOnce(json(200, {}));

    await client().request(URL_1);

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('should still retry when cancelling the body fails', async () => {
    const cancel = vi.fn(() => {
      throw new Error('locked');
    });
    fetchSpy
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
      .mockResolvedValueOnce(json(200, {}));

    await expect(client().request(URL_1)).resolves.toMatchObject({ status: 200 });
  });

  it('should warn with the target and attempt outside a tracking scope', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(json(200, {}));

    vi.spyOn(Math, 'random').mockReturnValue(2 / 3);
    await client().request(
      `${ARM}/subscriptions/s/resourceGroups/r/providers/Microsoft.ApiCenter/services/a/apis/x?api-version=1`,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      'Server error 503 on GET apis/x (attempt 1/4), retrying in 1.2s',
    );
  });

  it('should count retries and log them at debug inside a tracking scope', async () => {
    fetchSpy
      .mockResolvedValueOnce(empty(429, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(json(200, {}));

    const { retries } = await trackRetries(() =>
      client().request(URL_1),
    );

    expect(retries.total).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Rate limited (429)'));
  });
});

describe('paginateArm', () => {
  async function collect(iterable: AsyncIterable<Record<string, unknown>>): Promise<unknown[]> {
    const items: unknown[] = [];
    for await (const item of iterable) items.push(item);
    return items;
  }

  it('should follow nextLink across pages', async () => {
    const page2 = `${URL_1}&$skipToken=2`;
    fetchSpy
      .mockResolvedValueOnce(json(200, { value: [{ n: 1 }], nextLink: page2 }))
      .mockResolvedValueOnce(json(200, { value: [{ n: 2 }] }));

    await expect(collect(paginateArm(client(), URL_1))).resolves.toEqual([{ n: 1 }, { n: 2 }]);
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([URL_1, page2]);
  });

  it('should end quietly on 404 and call onNotFound', async () => {
    const onNotFound = vi.fn();
    fetchSpy.mockResolvedValueOnce(empty(404));

    await expect(collect(paginateArm(client(), URL_1, { onNotFound }))).resolves.toEqual([]);
    expect(onNotFound).toHaveBeenCalledTimes(1);
  });

  it('should cancel the body of a 404 that ends the listing', async () => {
    const cancel = vi.fn();
    fetchSpy.mockResolvedValueOnce(unread(404, cancel));

    await expect(collect(paginateArm(client(), URL_1))).resolves.toEqual([]);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('should end quietly when shouldStopOnError returns true', async () => {
    fetchSpy.mockResolvedValueOnce(json(400, { error: { code: 'MethodNotAllowedInPricingTier' } }));

    await expect(
      collect(
        paginateArm(client(), URL_1, {
          shouldStopOnError: (error) => (error as HttpError).code === 'MethodNotAllowedInPricingTier',
        }),
      ),
    ).resolves.toEqual([]);
  });

  it('should rethrow when shouldStopOnError returns false', async () => {
    fetchSpy.mockResolvedValueOnce(json(403, { error: { code: 'AuthorizationFailed' } }));

    await expect(
      collect(paginateArm(client(), URL_1, { shouldStopOnError: () => false })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('should pass request options to every page request', async () => {
    fetchSpy.mockResolvedValueOnce(json(409, { error: { code: 'Busy' } })).mockResolvedValueOnce(
      json(200, { value: [] }),
    );

    await collect(
      paginateArm(client(), URL_1, {
        requestOptions: { isRetryableError: (e) => e.code === 'Busy' },
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([
    'https://attacker.example.com/list?page=2',
    'http://management.azure.com/list?page=2',
  ])('should refuse to follow nextLink %s', async (nextLink) => {
    fetchSpy.mockResolvedValueOnce(json(200, { value: [{ n: 1 }], nextLink }));

    await expect(collect(paginateArm(client(), URL_1))).rejects.toThrow(
      /Refusing to follow nextLink/,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should follow a nextLink only on the client\'s own cloud', async () => {
    const usgovList = 'https://management.usgovcloudapi.net/subscriptions/s/list';
    const usgov = new ArmHttpClient({
      authScope: 'https://management.usgovcloudapi.net/.default',
      credential: cred,
    });
    fetchSpy
      .mockResolvedValueOnce(json(200, { value: [{ n: 1 }], nextLink: `${usgovList}?page=2` }))
      .mockResolvedValueOnce(json(200, { value: [{ n: 2 }], nextLink: `${ARM}/list?page=3` }));

    await expect(collect(paginateArm(usgov, usgovList))).rejects.toThrow(/Refusing to follow nextLink/);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('extractAsyncOperation', () => {
  const armHosts = ['management.azure.com'];

  it('should prefer Azure-AsyncOperation, then Operation-Location, then Location and name the header', () => {
    const a = `${ARM}/a`;
    const o = `${ARM}/o`;
    const l = `${ARM}/l`;
    expect(
      extractAsyncOperation(
        empty(202, { 'Azure-AsyncOperation': a, 'Operation-Location': o, Location: l }),
        { armHosts },
      ),
    ).toEqual({ url: a, header: 'Azure-AsyncOperation' });
    expect(extractAsyncOperation(empty(202, { 'Operation-Location': o, Location: l }), { armHosts })).toEqual({
      url: o,
      header: 'Operation-Location',
    });
    expect(extractAsyncOperation(empty(202, { Location: l }), { armHosts })).toEqual({ url: l, header: 'Location' });
    expect(extractAsyncOperation(empty(202), { armHosts })).toBeUndefined();
  });

  it('should fall back to a valid Location when Azure-AsyncOperation is rejected', () => {
    const response = empty(202, {
      'Azure-AsyncOperation': 'https://attacker.example.com/op?sig=secret',
      Location: `${ARM}/l`,
    });

    expect(extractAsyncOperation(response, { armHosts })).toEqual({ url: `${ARM}/l`, header: 'Location' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring'));
  });

  it('should fall back to Operation-Location when Azure-AsyncOperation is empty', () => {
    const response = empty(202, { 'Azure-AsyncOperation': '', 'Operation-Location': `${ARM}/o` });

    expect(extractAsyncOperation(response, { armHosts })).toEqual({ url: `${ARM}/o`, header: 'Operation-Location' });
  });

  it('should return undefined with a warning per header when every header is rejected', () => {
    const response = empty(202, {
      'Azure-AsyncOperation': 'not a url',
      'Operation-Location': 'http://management.azure.com/o?api-version=1',
      Location: 'https://management.usgovcloudapi.net/l',
    });

    expect(extractAsyncOperation(response, { armHosts })).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it('should not fall back to Location when includeLocation is false', () => {
    const response = empty(200, { 'Azure-AsyncOperation': 'not a url', Location: `${ARM}/l` });

    expect(extractAsyncOperation(response, { includeLocation: false, armHosts })).toBeUndefined();
  });
});

describe('readArmState', () => {
  it.each([
    ['nothing for null', null, true, undefined],
    ['nothing for a string', 'Succeeded', true, undefined],
  ])('should read %s', (_label, body, includeStatus, expected) => {
    expect(readArmState(body, { includeStatus })).toBe(expected);
  });
});

describe('pollArmOperation', () => {
  const options = { timeoutMs: 60_000, intervalMs: 5000 };
  /** A Location polling URL, which may return the resource rather than a status. */
  const LOCATION_OPERATION = { url: OPERATION_URL, header: 'Location' } as const;
  /** An async-operation status endpoint, whose body reports the operation's `status`. */
  const STATUS_OPERATION = { url: OPERATION_URL, header: 'Azure-AsyncOperation' } as const;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  /** Client whose delays advance the (fake) clock. */
  function clockClient(): ArmHttpClient {
    return new ArmHttpClient({
      credential: cred,
      delay: async (ms) => {
        delays.push(ms);
        vi.setSystemTime(Date.now() + ms);
      },
    });
  }

  it('should poll immediately by default and resolve on Succeeded', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

    await pollArmOperation(clockClient(), STATUS_OPERATION, 'thing', options);

    expect(delays).toEqual([]);
    expect(fetchSpy.mock.calls[0][0]).toBe(OPERATION_URL);
    expect(headersOf(0).get('Authorization')).toBe('Bearer fake-token');
  });

  it('should wait initialDelayMs before the first poll', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

    await pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', { ...options, initialDelayMs: 5000 });

    expect(delays).toEqual([5000]);
  });

  it('should keep the last positive Retry-After until another replaces it, as @azure/core-lro does', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json(200, { status: 'Running' }, { 'Retry-After': 'Thu, 01 Jan 2026 00:00:12 GMT' }))
      .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'Retry-After': 'soon' }))
      .mockResolvedValueOnce(json(200, { status: 'InProgress' }))
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

    await pollArmOperation(clockClient(), STATUS_OPERATION, 'thing', options);

    expect(delays).toEqual([2000, 10_000, 10_000, 10_000]);
  });

  it('should keep the current wait for a Retry-After of 0 or a past date after a positive one', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'Retry-After': '8' }))
      .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'Retry-After': 'Wed, 31 Dec 2025 23:00:00 GMT' }))
      .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

    await pollArmOperation(clockClient(), STATUS_OPERATION, 'thing', options);

    expect(delays).toEqual([8000, 8000, 8000, 3000]);
  });

  it('should use the interval for a Retry-After of 0 between polls', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(200, { status: 'InProgress' }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

    await pollArmOperation(clockClient(), STATUS_OPERATION, 'thing', options);

    expect(delays).toEqual([5000]);
  });

  it('should accept a status in upper case', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { status: 'SUCCEEDED' }));

    await expect(
      pollArmOperation(clockClient(), STATUS_OPERATION, 'thing', options),
    ).resolves.toBeUndefined();
  });

  it.each(['Failed', 'canceled', 'Cancelled'])('should throw with code and message on %s', async (status) => {
    fetchSpy.mockResolvedValueOnce(
      json(200, { status, error: { code: 'InvalidSpec', message: 'Spec is invalid' } }),
    );

    await expect(pollArmOperation(clockClient(), STATUS_OPERATION, 'thing', options)).rejects.toThrow(
      `Async operation ${status.toLowerCase()} for thing: [InvalidSpec] Spec is invalid`,
    );
  });

  it('should fall back to UnknownError and the body when the error code and message are not strings', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { status: 'Failed', error: { code: 42, message: { text: 'x' } } }));

    await expect(pollArmOperation(clockClient(), STATUS_OPERATION, 'thing', options)).rejects.toThrow(
      'Async operation failed for thing: [UnknownError] {"status":"Failed","error":{"code":42,"message":{"text":"x"}}}',
    );
  });

  it('should read properties.provisioningState when there is no status', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(200, { properties: { provisioningState: 'Deleting' } }))
      .mockResolvedValueOnce(json(200, { properties: { provisioningState: 'Failed' } }));

    await expect(pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options)).rejects.toThrow(
      /Async operation failed for thing: \[UnknownError\] .*provisioningState/,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should keep polling a 202 and treat a 2xx without a state as success', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(202, { status: 'Succeeded' }))
      .mockResolvedValueOnce(empty(202))
      .mockResolvedValueOnce(json(200, { name: 'resource' }));

    await pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['an empty 200', () => empty(200)],
    ['a 204', () => empty(204)],
    ['a non-JSON 200', () => new Response('done', { status: 200 })],
  ])('should treat %s as success', async (_label, response) => {
    fetchSpy.mockResolvedValueOnce(response());

    await expect(
      pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
  ])('should treat a 2xx body of JSON %s as complete without a status', async (_label, text) => {
    fetchSpy.mockResolvedValueOnce(new Response(text, { status: 200 }));

    await expect(
      pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options),
    ).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  describe('for a Location URL', () => {
    it.each([
      ['without a provisioningState', { name: 'resource', status: 'Active' }],
      ['with a Succeeded provisioningState', { name: 'resource', status: 'Active', properties: { provisioningState: 'Succeeded' } }],
      ['whose status is Failed but provisioningState Succeeded', { status: 'Failed', properties: { provisioningState: 'Succeeded' } }],
    ])('should resolve on a resource %s, ignoring its own top-level status', async (_label, body) => {
      fetchSpy.mockResolvedValueOnce(json(200, body));

      await expect(
        pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options),
      ).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should keep polling a resource whose provisioningState is not terminal, whatever its status', async () => {
      fetchSpy
        .mockResolvedValueOnce(json(200, { status: 'Succeeded', properties: { provisioningState: 'Updating' } }))
        .mockResolvedValueOnce(json(200, { status: 'Active', properties: { provisioningState: 'Succeeded' } }));

      await pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should throw on an operation-status body that reports Canceled', async () => {
      fetchSpy.mockResolvedValueOnce(
        json(200, { status: 'Canceled', error: { code: 'ProvisioningFailed', message: 'boom' } }),
      );

      await expect(
        pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options),
      ).rejects.toThrow('Async operation canceled for thing: [ProvisioningFailed] boom');
    });

    it('should throw on a Failed operation-status body with properties and an error object', async () => {
      fetchSpy.mockResolvedValueOnce(
        json(200, { status: 'Failed', properties: { name: 'x' }, error: { code: 'Conflict', message: 'boom' } }),
      );

      await expect(
        pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options),
      ).rejects.toThrow('Async operation failed for thing: [Conflict] boom');
    });

    it("should include the error details in a failed operation's message", async () => {
      fetchSpy.mockResolvedValueOnce(json(200, {
        status: 'Failed',
        error: { code: 'ValidationError', message: 'One or more fields contain incorrect values:', details: [{ target: 'value', message: 'Too long' }] },
      }));

      await expect(
        pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options),
      ).rejects.toThrow('Async operation failed for thing: [ValidationError] One or more fields contain incorrect values: value: Too long');
    });

    it('should resolve on a resource with properties whose own top-level status is Failed', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, { status: 'Failed', properties: { displayName: 'x' } }));

      await expect(
        pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options),
      ).resolves.toBeUndefined();
    });

    it('should resolve on an operation-status body that reports Succeeded', async () => {
      fetchSpy.mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

      await expect(
        pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options),
      ).resolves.toBeUndefined();
    });
  });

  describe('for an Operation-Location status endpoint', () => {
    const statusOperation = { url: OPERATION_URL, header: 'Operation-Location' as const };

    it('should read the operation status before provisioningState', async () => {
      fetchSpy
        .mockResolvedValueOnce(json(200, { status: 'InProgress', properties: { provisioningState: 'Succeeded' } }))
        .mockResolvedValueOnce(json(200, { status: 'Failed', properties: { provisioningState: 'Succeeded' } }));

      await expect(pollArmOperation(clockClient(), statusOperation, 'thing', options)).rejects.toThrow(
        /^Async operation failed for thing: \[UnknownError\]/,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should keep polling a JSON null status body until it reports a status', async () => {
      fetchSpy
        .mockResolvedValueOnce(new Response('null', { status: 200 }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

      await pollArmOperation(clockClient(), statusOperation, 'thing', options);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should keep polling a JSON body without a status until it reports one', async () => {
      fetchSpy
        .mockResolvedValueOnce(json(200, { id: 'op-1', name: 'op-1' }))
        .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

      await pollArmOperation(clockClient(), statusOperation, 'thing', options);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(delays).toEqual([5000]);
    });

    it('should time out when the status body never reports a status', async () => {
      fetchSpy.mockImplementation(async () => json(200, { id: 'op-1' }));

      await expect(
        pollArmOperation(clockClient(), statusOperation, 'thing', options),
      ).rejects.toThrow('Async operation polling timed out after 60s for thing');
    });

    it('should treat an empty 200 as success', async () => {
      fetchSpy.mockResolvedValueOnce(empty(200));

      await expect(
        pollArmOperation(clockClient(), statusOperation, 'thing', options),
      ).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('should treat a 404 as success when treatMissingAsSuccess', async () => {
    fetchSpy.mockResolvedValueOnce(json(404, { error: { code: 'NotFound' } }));

    await expect(
      pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', { ...options, treatMissingAsSuccess: true }),
    ).resolves.toBeUndefined();
  });

  it('should cancel the body of a 404 poll response that counts as success', async () => {
    const cancel = vi.fn();
    fetchSpy.mockResolvedValueOnce(unread(404, cancel));

    await pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', { ...options, treatMissingAsSuccess: true });

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('should cancel the body of a 202 poll response before polling again', async () => {
    const cancel = vi.fn();
    fetchSpy
      .mockResolvedValueOnce(unread(202, cancel))
      .mockResolvedValueOnce(json(200, { status: 'Succeeded' }));

    await pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options);

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('should fail on a 404 otherwise instead of polling until the timeout', async () => {
    fetchSpy.mockResolvedValueOnce(json(404, { error: { code: 'NotFound' } }));

    await expect(pollArmOperation(clockClient(), LOCATION_OPERATION, 'thing', options)).rejects.toThrow(
      'Async operation for thing not found (404).',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should time out after timeoutMs', async () => {
    fetchSpy.mockImplementation(async () => json(200, { status: 'InProgress' }));

    await expect(pollArmOperation(clockClient(), STATUS_OPERATION, 'thing', options)).rejects.toThrow(
      'Async operation polling timed out after 60s for thing',
    );
    // Polls at 0s, 5s, ..., 60s: the poll after the last wait still runs.
    expect(fetchSpy).toHaveBeenCalledTimes(13);
  });
});

describe('waitUntilGone', () => {
  const PRESENT = { name: 'resource', properties: {} };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  /** Wait that records each delay and advances the (fake) clock. */
  async function clockDelay(ms: number): Promise<void> {
    delays.push(ms);
    vi.setSystemTime(Date.now() + ms);
  }

  /** Probe that returns each value in turn, then undefined (gone). */
  function probeOf(...values: unknown[]): ReturnType<typeof vi.fn> {
    const probe = vi.fn();
    for (const value of values) probe.mockResolvedValueOnce(value);
    return probe.mockResolvedValue(undefined);
  }

  it('should wait the same interval before each probe until the resource is gone', async () => {
    const probe = probeOf(PRESENT, PRESENT, PRESENT);

    await waitUntilGone(probe, 'thing', { timeoutMs: 600_000, intervalMs: 2000, delay: clockDelay });

    expect(probe).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([2000, 2000, 2000, 2000]);
  });

  it('should accept a presence-only probe that returns true while the resource exists', async () => {
    const probe = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);

    await waitUntilGone(probe, 'thing', { timeoutMs: 600_000, intervalMs: 2000, delay: clockDelay });

    expect(probe).toHaveBeenCalledTimes(3);
  });

  it.each(['Failed', 'Canceled', 'Succeeded', 'no state'])('should keep waiting while the resource reports %s', async (state) => {
    const resource = state === 'no state' ? PRESENT : { properties: { provisioningState: state } };
    const probe = probeOf(resource);

    await expect(
      waitUntilGone(probe, 'thing', { timeoutMs: 60_000, intervalMs: 5000, delay: clockDelay }),
    ).resolves.toBeUndefined();

    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('should probe at the deadline, shortening the last wait, then throw', async () => {
    const probe = vi.fn().mockResolvedValue(PRESENT);
    const start = Date.now();

    await expect(
      waitUntilGone(probe, 'apis/x', { timeoutMs: 12_000, intervalMs: 5000, delay: clockDelay }),
    ).rejects.toThrow('apis/x was not deleted within 12.0s: the DELETE was accepted but the resource is still present.');

    expect(delays).toEqual([5000, 5000, 2000]);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(Date.now() - start).toBe(12_000);
  });

  it('should throw a probe error unchanged', async () => {
    const error = new HttpError(403, 'HTTP 403: denied');
    const probe = vi.fn().mockRejectedValue(error);

    await expect(
      waitUntilGone(probe, 'thing', { timeoutMs: 60_000, intervalMs: 5000, delay: clockDelay }),
    ).rejects.toBe(error);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
