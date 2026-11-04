// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for applyProxyFromEnv: requests are sent with the real global
 * fetch to local servers, so they show which proxy (if any) each request
 * used, by the Azure SDK's proxy rules.
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlobalDispatcher } from 'undici';
import { logger } from '../../../src/lib/logger.js';
import { applyProxyFromEnv, isProxyBypassed, parseNoProxy, type ProxySetupResult } from '../../../src/lib/proxy.js';

describe('parseNoProxy', () => {
  it('should split on commas, trim entries and drop empty ones', () => {
    expect(parseNoProxy(' a.example.com, .b.example.com ,,  ')).toEqual(['a.example.com', '.b.example.com']);
    expect(parseNoProxy(undefined)).toEqual([]);
  });
});

describe('isProxyBypassed', () => {
  it.each([
    ['an exact host', 'management.azure.com', ['management.azure.com'], true],
    ['a leading-dot domain, for a subdomain', 'management.azure.com', ['.azure.com'], true],
    ['a leading-dot domain, for the domain itself', 'azure.com', ['.azure.com'], true],
    ['a bare domain, for a subdomain', 'management.azure.com', ['azure.com'], false],
    ['a wildcard', 'management.azure.com', ['*'], false],
    ['a "*." pattern', 'management.azure.com', ['*.azure.com'], false],
    ['an entry with a port', 'management.azure.com', ['management.azure.com:443'], false],
    ['an entry in another case', 'management.azure.com', ['Management.Azure.com'], false],
    ['an empty list', 'management.azure.com', [], false],
  ])('should match %s as the Azure SDK does', (_label, host, noProxy, expected) => {
    expect(isProxyBypassed(host, noProxy)).toBe(expected);
  });
});

/** A local HTTP server that answers every request with `name`. */
async function startTarget(name: string): Promise<http.Server> {
  const server = http.createServer((_request, response) => response.end(name));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

interface ProxyHit {
  proxy: string;
  target: string;
  authorization?: string;
}

/**
 * Local proxies that answer forwarded HTTP requests with their name and
 * refuse CONNECT tunnels, recording each request they receive.
 */
async function startProxies(names: string[]) {
  const hits: ProxyHit[] = [];
  const servers = await Promise.all(
    names.map(async (name) => {
      const server = http.createServer((request, response) => {
        hits.push({ proxy: name, target: request.url ?? '', authorization: request.headers['proxy-authorization'] });
        response.end(`via ${name}`);
      });
      server.on('connect', (request, socket) => {
        hits.push({ proxy: name, target: request.url ?? '', authorization: request.headers['proxy-authorization'] });
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return server;
    }),
  );
  const urls = servers.map((server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  return { hits, urls, servers };
}

function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('applyProxyFromEnv', () => {
  let target: http.Server;
  let targetUrl: string;
  let proxies: Awaited<ReturnType<typeof startProxies>>;
  let result: ProxySetupResult | undefined;

  beforeEach(async () => {
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    target = await startTarget('direct');
    // "localhost" so NO_PROXY entries can name the target's host.
    targetUrl = `http://localhost:${(target.address() as AddressInfo).port}/`;
    proxies = await startProxies(['A', 'B']);
    result = undefined;
  });

  afterEach(async () => {
    if (result?.status === 'applied') {
      await result.restore();
    }
    await Promise.all([target, ...proxies.servers].map(close));
    vi.restoreAllMocks();
  });

  async function fetchTarget(): Promise<string> {
    return (await fetch(targetUrl)).text();
  }

  it('should change nothing when no proxy variable is set', async () => {
    const before = getGlobalDispatcher();

    result = applyProxyFromEnv({ NO_PROXY: 'localhost' });

    expect(result).toEqual({ status: 'none' });
    expect(getGlobalDispatcher()).toBe(before);
    expect(await fetchTarget()).toBe('direct');
  });

  it.each(['HTTPS_PROXY', 'all_proxy', 'http_proxy'])(
    'should send every request through the proxy when only %s is set',
    async (name) => {
      result = applyProxyFromEnv({ [name]: proxies.urls[0] });

      expect(await fetchTarget()).toBe('via A');
      expect(proxies.hits).toEqual([{ proxy: 'A', target: targetUrl, authorization: undefined }]);
    },
  );

  it.each([
    ['HTTPS_PROXY over ALL_PROXY', { HTTPS_PROXY: 0, ALL_PROXY: 1 }],
    ['ALL_PROXY over HTTP_PROXY', { ALL_PROXY: 0, HTTP_PROXY: 1 }],
    ['HTTPS_PROXY over https_proxy', { https_proxy: 1, HTTPS_PROXY: 0 }],
    ['https_proxy over ALL_PROXY', { ALL_PROXY: 1, https_proxy: 0 }],
  ])('should prefer %s, as the Azure SDK does', async (_label, picks) => {
    const env = Object.fromEntries(Object.entries(picks).map(([name, i]) => [name, proxies.urls[i]]));

    result = applyProxyFromEnv(env);

    expect(await fetchTarget()).toBe('via A');
  });

  it.each([
    ['the exact host', 'localhost', 'direct'],
    ['a wildcard, which the SDK does not support', '*', 'via A'],
  ])('should apply NO_PROXY set to %s as the Azure SDK does', async (_label, noProxy, expected) => {
    result = applyProxyFromEnv({ HTTPS_PROXY: proxies.urls[0], NO_PROXY: noProxy });

    expect(await fetchTarget()).toBe(expected);
  });

  it('should prefer NO_PROXY over no_proxy, as the Azure SDK does', async () => {
    result = applyProxyFromEnv({ HTTPS_PROXY: proxies.urls[0], NO_PROXY: 'localhost', no_proxy: 'example.com' });

    expect(await fetchTarget()).toBe('direct');
  });

  it.each([
    ['a user name and password', 'user:pa%40ss@', `Basic ${Buffer.from('user:pa@ss').toString('base64')}`],
    ['a password only', ':secret@', `Basic ${Buffer.from(':secret').toString('base64')}`],
  ])('should send %s from the proxy URL as the Azure SDK does', async (_label, credentials, expected) => {
    result = applyProxyFromEnv({ HTTPS_PROXY: proxies.urls[0].replace('http://', `http://${credentials}`) });

    await fetchTarget();

    expect(proxies.hits[0]?.authorization).toBe(expected);
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('secret');
  });

  it('should tunnel HTTPS requests through the proxy', async () => {
    result = applyProxyFromEnv({ HTTPS_PROXY: proxies.urls[0] });

    await expect(fetch('https://management.azure.com/')).rejects.toThrow();

    expect(proxies.hits).toEqual([{ proxy: 'A', target: 'management.azure.com:443', authorization: undefined }]);
  });

  it('should put the previous dispatcher back on restore', async () => {
    const before = getGlobalDispatcher();
    const applied = applyProxyFromEnv({ HTTPS_PROXY: proxies.urls[0] });

    expect(applied.status).toBe('applied');
    if (applied.status === 'applied') {
      await applied.restore();
    }

    expect(getGlobalDispatcher()).toBe(before);
    expect(await fetchTarget()).toBe('direct');
  });
});
