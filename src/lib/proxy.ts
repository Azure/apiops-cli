// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Proxy support for the CLI's ARM requests.
 *
 * ARM requests use Node's global `fetch`, which ignores `HTTPS_PROXY` /
 * `HTTP_PROXY` on its own. Token requests made by `@azure/identity` go
 * through the Azure SDK's proxy policy (`proxyPolicy` in
 * `@typespec/ts-http-runtime`), which reads the variables itself. So that
 * both are routed alike on every supported Node.js version, the CLI applies
 * that policy's rules to `fetch` through an `undici` global dispatcher:
 *
 * - one proxy for every request, from `HTTPS_PROXY`, then `ALL_PROXY`, then
 *   `HTTP_PROXY`, each name read in upper case before lower case;
 * - `NO_PROXY` (then `no_proxy`) is a comma-separated list of host names; a
 *   request bypasses the proxy when its host equals an entry, or when an
 *   entry starts with `.` and the host is that domain or ends with it;
 * - a user name or password in the proxy URL is sent as Basic
 *   `Proxy-Authorization`;
 * - HTTPS requests are tunnelled through the proxy (CONNECT) and plain-HTTP
 *   requests are forwarded to it.
 */

import { Agent, getGlobalDispatcher, ProxyAgent, setGlobalDispatcher, type Dispatcher } from 'undici';
import { errorCauses } from './error-message.js';
import { logger } from './logger.js';

/** Proxy variables in the order the Azure SDK's proxy policy reads them. */
const PROXY_VARIABLES = ['HTTPS_PROXY', 'ALL_PROXY', 'HTTP_PROXY'] as const;

/**
 * The first set variable among `names`, each read in upper case before lower
 * case (as the Azure SDK reads them): its actual name and value.
 */
function readEnvironment(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): { name: string; value: string } | undefined {
  for (const upper of names) {
    for (const name of [upper, upper.toLowerCase()]) {
      const value = env[name];
      if (value) {
        return { name, value };
      }
    }
  }
  return undefined;
}

/** `NO_PROXY` entries, split and trimmed as the Azure SDK splits them. */
export function parseNoProxy(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * True when a request to `host` bypasses the proxy, by the Azure SDK's rule:
 * the host equals an entry, or an entry starts with `.` and the host ends
 * with it or equals it without the dot.
 */
export function isProxyBypassed(host: string, noProxy: readonly string[]): boolean {
  return noProxy.some((entry) =>
    entry.startsWith('.') ? host.endsWith(entry) || host === entry.slice(1) : host === entry,
  );
}

/**
 * A dispatcher that sends requests through `proxyUrl`, except to hosts that
 * `noProxy` bypasses, which go direct.
 */
function createProxyDispatcher(proxyUrl: string, noProxy: readonly string[]): {
  dispatcher: Dispatcher;
  close: () => Promise<void>;
} {
  const url = new URL(proxyUrl);
  // Send the credentials as the Azure SDK's proxy agents do: Basic auth when
  // either a user name or a password is present.
  const token =
    url.username || url.password
      ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
      : undefined;
  url.username = '';
  url.password = '';
  // Plain-HTTP requests are forwarded to the proxy rather than tunnelled, as
  // the SDK's http-proxy-agent does; HTTPS requests are tunnelled (CONNECT).
  const proxied = new ProxyAgent({ uri: url.href, proxyTunnel: false, ...(token ? { token } : {}) });
  const direct = new Agent();
  const dispatcher = proxied.compose((dispatch) => (options, handler) => {
    const host = new URL(String(options.origin)).hostname;
    return isProxyBypassed(host, noProxy) ? direct.dispatch(options, handler) : dispatch(options, handler);
  });
  return {
    dispatcher,
    close: async () => {
      await Promise.all([proxied.close(), direct.close()]);
    },
  };
}

/**
 * The messages undici fails a request with when the proxy answers 407 Proxy
 * Authentication Required: to a CONNECT for an HTTPS request, or to a
 * forwarded plain-HTTP request.
 */
const PROXY_AUTHENTICATION_FAILURES = [
  'Proxy response (407) !== 200 when HTTP Tunneling',
  'Proxy Authentication Required (407)',
];

/**
 * Whether a request failed because the proxy refused it with 407 Proxy
 * Authentication Required: the proxy URL has no credentials, or wrong ones.
 * `fetch` gives undici's error as the cause of its "fetch failed".
 */
export function isProxyAuthenticationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return [error, ...errorCauses(error)].some(({ message }) =>
    PROXY_AUTHENTICATION_FAILURES.some((failure) => message.includes(failure))
  );
}

export type ProxySetupResult =
  /** No proxy variable is set. */
  | { status: 'none' }
  /** The proxy was applied; `restore` puts the previous dispatcher back. */
  | { status: 'applied'; restore: () => Promise<void> };

/**
 * Route the CLI's requests through the proxy the Azure SDK would use (from
 * `HTTPS_PROXY`, `ALL_PROXY` or `HTTP_PROXY`), honouring `NO_PROXY` as the
 * SDK does. Call it before any request is made. The proxy URL is never
 * logged, since it may contain credentials.
 */
export function applyProxyFromEnv(env: NodeJS.ProcessEnv = process.env): ProxySetupResult {
  const proxy = readEnvironment(env, PROXY_VARIABLES);
  if (!proxy) {
    return { status: 'none' };
  }

  const noProxy = parseNoProxy(readEnvironment(env, ['NO_PROXY'])?.value);
  const { dispatcher, close } = createProxyDispatcher(proxy.value, noProxy);
  const previous = getGlobalDispatcher();
  setGlobalDispatcher(dispatcher);
  logger.debug(`Sending requests through the proxy set in ${proxy.name}`);
  return {
    status: 'applied',
    restore: async () => {
      setGlobalDispatcher(previous);
      await close();
    },
  };
}
