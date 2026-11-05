// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Shared Azure Resource Manager (ARM) HTTP plumbing for the APIM and API
 * Center clients and the Key Vault pre-flight check.
 *
 * Provides bearer-token acquisition with caching, a `fetch` wrapper with
 * retry/back-off for 429, 5xx and network errors, `nextLink` pagination and
 * long-running-operation (LRO) polling. URLs returned by ARM (polling URLs,
 * `nextLink`) are only followed when they are HTTPS on a known ARM host, so
 * the bearer token is never sent elsewhere.
 */

import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { getArmHostsForAuthScope, getCloudConfig } from '../lib/cloud-config.js';
import { errorMessage } from '../lib/error-message.js';
import { formatDuration } from '../lib/format-duration.js';
import { isProxyAuthenticationError } from '../lib/proxy.js';
import { logger } from '../lib/logger.js';
import { recordRetry } from '../lib/retry-tracker.js';
import { USER_AGENT } from '../lib/user-agent.js';
import type { IArmHttpClient } from './iarm-http-client.js';

/**
 * Structured HTTP error that carries the response status code, the ARM error
 * code (e.g. `MethodNotAllowedInPricingTier`) and the error body (parsed JSON,
 * or the text when it is not JSON).
 * Allows callers to branch on status without parsing the message string.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** The parts of an ARM error response body used for {@link HttpError}. */
export interface ParsedArmError {
  /** `error.code`, when it is a string. */
  code?: string;
  /** `error.message`, when it is a string. */
  message?: string;
  /** The messages of `error.details`, each after its `target` when it has one. */
  details?: string[];
  /** The parsed JSON body; absent when the body is not JSON. */
  body?: unknown;
}

/**
 * The messages of an ARM error's `details`, each after its `target` when it
 * has one, followed by the messages of that detail's own `details`. APIM says
 * what is wrong there: a "One or more fields contain incorrect values:" error
 * has one detail per field.
 */
function readErrorDetails(error: Record<string, unknown>): string[] {
  if (!Array.isArray(error.details)) {
    return [];
  }
  return error.details.flatMap((detail: unknown) => {
    if (typeof detail !== 'object' || detail === null) {
      return [];
    }
    const fields = detail as Record<string, unknown>;
    const { target, message } = fields;
    const own =
      typeof message === 'string' && message !== ''
        ? [typeof target === 'string' && target !== '' ? `${target}: ${message}` : message]
        : [];
    return [...own, ...readErrorDetails(fields)];
  });
}

/**
 * `[<code>] <message>: <detail>; <detail>` for an ARM error object, leaving
 * out the parts it doesn't have; undefined when it has none of them.
 */
function describeArmError({ code, message, details = [] }: Omit<ParsedArmError, 'body'>): string | undefined {
  let text = [code !== undefined ? `[${code}]` : undefined, message].filter(Boolean).join(' ');
  if (details.length > 0) {
    const separator = text === '' ? '' : text.endsWith(':') ? ' ' : ': ';
    text += separator + details.join('; ');
  }
  return text === '' ? undefined : text;
}

/**
 * Parse an ARM error response body. Returns the JSON body (when it is JSON)
 * and `error.code`, `error.message` and the `error.details` messages (when
 * they are strings).
 */
export function parseArmError(text: string): ParsedArmError {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return {};
  }
  const error =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).error
      : undefined;
  const fields = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  return {
    code: typeof fields.code === 'string' ? fields.code : undefined,
    message: typeof fields.message === 'string' ? fields.message : undefined,
    details: readErrorDetails(fields),
    body,
  };
}

/**
 * Longest excerpt of a response body put in an error message: a failed
 * response's body when it has no ARM error to describe, or a failed
 * operation's status body when it has no error message.
 */
const MAX_ERROR_BODY_EXCERPT_LENGTH = 500;

/** The first {@link MAX_ERROR_BODY_EXCERPT_LENGTH} characters of `text`, marked when cut. */
function excerpt(text: string): string {
  return text.length > MAX_ERROR_BODY_EXCERPT_LENGTH
    ? `${text.substring(0, MAX_ERROR_BODY_EXCERPT_LENGTH)}…`
    : text;
}

/** What a masked SAS signature reads as. */
const MASKED_SIGNATURE = '***';

/**
 * A `sig` query parameter, also inside a URL that was percent-encoded once
 * or twice (as a link on a firewall's block page can be) or quoted in JSON
 * with its `&` escaped (`\u0026`): the separator before it, `sig` and its
 * `=`, and the value. The value runs over the characters a signature can have
 * as written: base64, `%` escapes, a `\` from JSON escaping, and the `-` and
 * `_` of URL-safe base64. It ends at the next escaped separator or at any
 * other character, so `[...?sig=abc]` and `sig=abc. Retry` keep their `]`
 * and `.`.
 */
const SIG_PARAMETER =
  /(^|[?&;\s]|%26|%3F|%2526|%253F|\\u0026)(sig(?:=|%3D|%253D))((?:(?!%26|%2526|\\u0026)[A-Za-z0-9+/=%\\_-])+)/gim;

/** Escape `text` for use as a literal in a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The ways a signature's `+`, `/` and `=` can be written in text: as they
 * are, percent-encoded once or twice, JSON-escaped, or as an HTML character
 * reference. Matched ignoring case, as the escapes can be written either way.
 */
const SIGNATURE_CHARACTER_FORMS: Readonly<Record<string, readonly string[]>> = {
  '+': ['+', '%2B', '%252B', '\\u002B', '&#43;', '&#x2B;'],
  '/': ['/', '%2F', '%252F', '\\/', '\\u002F', '&#47;', '&#x2F;'],
  '=': ['=', '%3D', '%253D', '\\u003D', '&#61;', '&#x3D;'],
};

/**
 * A pattern matching `signature` with each `+`, `/` and `=` written in any of
 * its forms, in any mix: a page can escape some characters and not others.
 */
function signaturePattern(signature: string): RegExp {
  const source = [...signature]
    .map((character) => {
      const forms = SIGNATURE_CHARACTER_FORMS[character];
      return forms ? `(?:${forms.map(escapeRegExp).join('|')})` : escapeRegExp(character);
    })
    .join('');
  return new RegExp(source, 'gi');
}

/**
 * `text` with the SAS signature masked: the value of any `sig` parameter,
 * also in a percent-encoded URL, and the request's own signature wherever
 * else it appears, with its `+`, `/` and `=` as they are, percent-encoded once
 * or twice, JSON-escaped or written as HTML character references, in any mix;
 * for example in a proxy's or firewall's page that
 * quotes or links to the URL. Azure Storage's own authentication errors (for
 * example 'Signature did not match') don't quote it, but the body is text
 * this client doesn't control. The request's signature is masked on its own
 * only when it is one: the base64 of a 32-byte HMAC-SHA256, so a short
 * hand-made value can't mask unrelated text. The rest of the body (a
 * firewall's block page, a storage error code) is kept, since it says why
 * the download failed.
 */
export function maskSasSignature(text: string, url: string): string {
  let masked = text.replace(SIG_PARAMETER, `$1$2${MASKED_SIGNATURE}`);
  // Read the value as sent and decode only its %XX escapes: URLSearchParams
  // would turn an unencoded '+' into a space.
  const raw = /[?&]sig=([^&#]*)/i.exec(url)?.[1];
  let signature = raw;
  if (raw) {
    try {
      signature = decodeURIComponent(raw);
    } catch {
      // A malformed escape: compare the value as sent.
    }
  }
  if (signature && /^[A-Za-z0-9+/]+={0,2}$/.test(signature) && Buffer.from(signature, 'base64').length === 32) {
    masked = masked.replace(signaturePattern(signature), MASKED_SIGNATURE);
  }
  return masked;
}

/**
 * Build the message for a failed ARM response:
 * `HTTP <status>: [<code>] <message>: <detail>; <detail>` from the parsed ARM
 * error when it has any of those, in full; otherwise the response body,
 * truncated to {@link MAX_ERROR_BODY_EXCERPT_LENGTH} characters. The full body
 * stays on {@link HttpError.body}.
 */
function formatArmErrorMessage(status: number, text: string, parsed: ParsedArmError): string {
  return `HTTP ${status}: ${describeArmError(parsed) ?? excerpt(text)}`;
}

/**
 * Headers giving a server-requested wait in milliseconds, read before
 * `Retry-After` in the same order as the Azure SDK's throttling retry strategy
 * (`throttlingRetryStrategy` in `@typespec/ts-http-runtime`).
 */
const RETRY_AFTER_MS_HEADERS = ['retry-after-ms', 'x-ms-retry-after-ms'] as const;

/** Statuses whose server-requested wait is honoured, as in the Azure SDK. */
const THROTTLING_STATUSES: readonly number[] = [429, 503];

/** A non-empty header value as a finite number, clamped at zero. */
function parseNonNegativeNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

/**
 * Parse a `Retry-After` header (delay-seconds or HTTP-date) into milliseconds,
 * as the Azure SDK does: a negative value or a date that has passed is 0.
 * Returns undefined when the header is absent or unparsable.
 */
export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const seconds = parseNonNegativeNumber(value);
  if (seconds !== undefined) {
    return seconds * 1000;
  }
  const date = Date.parse(value.trim());
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * The wait a throttling response (429 or 503) asks for, in milliseconds:
 * `retry-after-ms`, then `x-ms-retry-after-ms`, then `Retry-After`, the first
 * one that parses. 0 means retry at once. Undefined for other statuses or
 * when no header parses.
 */
function readThrottlingDelayMs(response: Response): number | undefined {
  if (!THROTTLING_STATUSES.includes(response.status)) {
    return undefined;
  }
  for (const header of RETRY_AFTER_MS_HEADERS) {
    const value = response.headers.get(header);
    const ms = value === null ? undefined : parseNonNegativeNumber(value);
    if (ms !== undefined) {
      return ms;
    }
  }
  return parseRetryAfterMs(response.headers.get('Retry-After'));
}

/**
 * A polling response's `Retry-After` in milliseconds, or undefined when it is
 * absent, unparsable or 0 (including a date that has passed), so the poll
 * keeps its current wait instead of polling at once.
 */
function readPollRetryAfterMs(response: Response): number | undefined {
  const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
  return retryAfterMs !== undefined && retryAfterMs > 0 ? retryAfterMs : undefined;
}

/**
 * True when `url` is an HTTPS URL on one of `armHosts` (or a subdomain of
 * one), i.e. safe to send the ARM bearer token to. `armHosts` is required
 * (usually the client's {@link ArmHttpClient.armHosts}) so a caller cannot
 * accept another cloud's hosts by leaving it out.
 */
export function isArmUrl(url: string, armHosts: readonly string[]): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      armHosts.some(
        (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Build a short, human-readable description of a request URL for log output.
 * ARM URLs below an APIM or API Center service are reduced to the path below
 * the service (e.g. `apis/echo/operations/get`); other URLs keep host and
 * path only. Query strings are always dropped.
 */
export function describeRequestTarget(url: string): string {
  let pathname: string;
  let host = '';
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    host = parsed.host;
  } catch {
    pathname = url.split('?')[0] ?? url;
  }

  const match =
    /\/providers\/(?:Microsoft\.ApiManagement\/service|Microsoft\.ApiCenter\/services)\/[^/]+\/?(.*)$/i
      .exec(pathname);
  if (match) {
    return safeDecode(match[1] || 'service');
  }
  return safeDecode(`${host}${pathname}`);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Minimal token credential (satisfied by `DefaultAzureCredential`). */
export interface ArmTokenCredential {
  getToken(
    scope: string,
  ): Promise<{ token: string; expiresOnTimestamp?: number; refreshAfterTimestamp?: number } | null>;
}

export interface ArmHttpClientOptions {
  /** OAuth2 scope for ARM tokens. Defaults to the Azure public cloud scope. */
  authScope?: string;
  /** Token credential. Defaults to `DefaultAzureCredential`. */
  credential?: ArmTokenCredential;
  /** Wait used for retry back-off and LRO polling. Defaults to a `setTimeout` wait. */
  delay?: (ms: number) => Promise<void>;
}

/** Per-request behaviour for {@link ArmHttpClient.request}. */
export interface ArmRequestOptions {
  /**
   * Send no ARM credentials (`Authorization`, `Proxy-Authorization`,
   * `x-ms-authorization-auxiliary`) and no Content-Type, e.g. for
   * self-authenticating SAS blob URLs. The query string is dropped from logs.
   */
  skipAuth?: boolean;
  /** Return 5xx responses immediately instead of retrying them. */
  noRetryOn5xx?: boolean;
  /** Non-OK statuses returned to the caller instead of thrown. */
  allowedNonOkStatuses?: readonly number[];
  /** Methods whose 404 is returned instead of thrown. Defaults to GET. */
  passthrough404Methods?: readonly string[];
  /** Return true for a 4xx error that is transient and should be retried. */
  isRetryableError?: (error: HttpError) => boolean;
}

/**
 * Log an intermediate retry. When the retry is attributed to an active
 * tracking scope (e.g. a publish operation that reports its retry count on
 * the final status line), the message is demoted to debug to keep normal
 * output free of interleaved retry noise.
 */
export function logRetry(message: string): void {
  if (recordRetry()) {
    logger.debug(message);
  } else {
    logger.warn(message);
  }
}

/**
 * Cancel the body of a response that will not be read (one about to be
 * retried, or a 404 the caller treats as "not found"), so its connection is
 * released now rather than when the response is garbage-collected. A failed
 * cancel is logged at debug: nothing depends on it.
 */
export async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch (error) {
    logger.debug(`Could not cancel an unread response body: ${errorMessage(error)}`);
  }
}

/** The credential type `getBearerTokenProvider` takes. */
type SdkTokenCredential = Parameters<typeof getBearerTokenProvider>[0];

/**
 * Adapt an {@link ArmTokenCredential} to the SDK's token credential: a
 * missing `expiresOnTimestamp` counts as already expired (fetched again on
 * every use), `refreshAfterTimestamp` is passed on, and a null token throws
 * with the scope named.
 */
function toSdkCredential(credential: ArmTokenCredential, authScope: string): SdkTokenCredential {
  return {
    async getToken() {
      const tokenResponse = await credential.getToken(authScope);
      if (!tokenResponse) {
        throw new Error(`Failed to acquire an ARM token for scope ${authScope}`);
      }
      const { token, expiresOnTimestamp = 0, refreshAfterTimestamp } = tokenResponse;
      return { token, expiresOnTimestamp, ...(refreshAfterTimestamp !== undefined ? { refreshAfterTimestamp } : {}) };
    },
  };
}

/** HTTP client for ARM: authentication, token caching, retry and back-off. */
export class ArmHttpClient implements IArmHttpClient {
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 1000;
  private static readonly MAX_DELAY_MS = 30000;

  readonly authScope: string;
  /**
   * ARM hosts this client follows polling URLs and `nextLink` to: the host
   * of its own cloud (from `authScope`), or every known cloud's when the
   * scope is not a known cloud's.
   */
  readonly armHosts: readonly string[];
  private readonly tokenProvider: () => Promise<string>;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(options: ArmHttpClientOptions = {}) {
    this.authScope = options.authScope ?? getCloudConfig('public').authScope;
    this.armHosts = getArmHostsForAuthScope(this.authScope);
    this.tokenProvider = getBearerTokenProvider(
      toSdkCredential(options.credential ?? new DefaultAzureCredential(), this.authScope),
      this.authScope,
    );
    this.wait = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Get a bearer token for the client's scope, through `@azure/identity`'s
   * `getBearerTokenProvider` (the Azure SDK's token cycler): the token is
   * cached and one refresh is shared by concurrent callers. From two minutes
   * before expiry (or the credential's `refreshAfterTimestamp`) it is
   * refreshed in the background while the current token is still returned;
   * within a second of expiry callers wait for the new one.
   */
  getToken(): Promise<string> {
    return this.tokenProvider();
  }

  /** Wait `ms` milliseconds (through the `delay` option when set). */
  delay(ms: number): Promise<void> {
    return this.wait(ms);
  }

  /** Exponential back-off with up to 30% jitter, capped at 30 seconds. */
  private static backoff(attempt: number): number {
    const exponentialDelay = Math.min(
      ArmHttpClient.BASE_DELAY_MS * Math.pow(2, attempt),
      ArmHttpClient.MAX_DELAY_MS,
    );
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return exponentialDelay + jitter;
  }

  /**
   * Execute an HTTP request with authentication and retries.
   *
   * Up to `MAX_RETRIES` (3) retries:
   * - 429 waits as long as the response asks: `retry-after-ms`, then
   *   `x-ms-retry-after-ms`, then `Retry-After` (seconds or an HTTP date),
   *   the first that parses. 0 or a date that has passed retries at once; with
   *   no header that parses, the waits are 1, 2 and then 4 seconds.
   * - 503 waits as long as those headers ask, when one parses; other 5xx
   *   responses, and a 503 without one, back off exponentially with jitter.
   * - Network errors back off exponentially with jitter.
   * Other non-OK responses throw {@link HttpError}, except a 404 for
   * `passthrough404Methods` and `allowedNonOkStatuses`, which are returned.
   */
  async request(
    url: string,
    init: RequestInit = {},
    options: ArmRequestOptions = {},
  ): Promise<Response> {
    const {
      skipAuth = false,
      noRetryOn5xx = false,
      allowedNonOkStatuses = [],
      passthrough404Methods = ['GET'],
      isRetryableError,
    } = options;

    const headers = new Headers(init.headers);
    if (!skipAuth) {
      const token = await this.getToken();
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('Content-Type', 'application/json');
    } else {
      headers.delete('Authorization');
      headers.delete('Proxy-Authorization');
      headers.delete('x-ms-authorization-auxiliary');
    }
    headers.set('User-Agent', USER_AGENT);

    let attempt = 0;
    // For SAS blob URLs the query string contains the sig token — strip it before logging.
    const logUrl = skipAuth ? url.split('?')[0] : url;
    const method = (init.method ?? 'GET').toUpperCase();
    const target = `${method} ${describeRequestTarget(logUrl)}`;
    const maxRetries = ArmHttpClient.MAX_RETRIES;
    const maxAttempts = maxRetries + 1;

    while (attempt <= maxRetries) {
      try {
        logger.debug(`HTTP ${method} ${logUrl}`);
        const response = await fetch(url, { ...init, headers });

        // Rate limiting (429). On the final attempt it falls through and is
        // thrown with its status. Without a usable header it waits 1, 2 and
        // then 4 seconds (the Azure SDK does not retry this case).
        if (response.status === 429 && attempt < maxRetries) {
          const delayMs = readThrottlingDelayMs(response) ?? Math.pow(2, attempt) * 1000;
          logRetry(
            `Rate limited (429) on ${target} (attempt ${attempt + 1}/${maxAttempts}), ` +
            `retrying in ${formatDuration(delayMs)}`,
          );
          await discardBody(response);
          await this.delay(delayMs);
          attempt++;
          continue;
        }

        // Transient server errors (5xx)
        if (response.status >= 500 && response.status < 600) {
          if (noRetryOn5xx) {
            return response;
          }
          if (attempt < maxRetries) {
            // A 503 that sends a wait gets that wait, as in the Azure SDK.
            const delayMs = readThrottlingDelayMs(response) ?? ArmHttpClient.backoff(attempt);
            logRetry(
              `Server error ${response.status} on ${target} (attempt ${attempt + 1}/${maxAttempts}), ` +
              `retrying in ${formatDuration(delayMs)}`,
            );
            await discardBody(response);
            await this.delay(delayMs);
            attempt++;
            continue;
          }
        }

        if (response.status === 404 && passthrough404Methods.includes(method)) {
          return response;
        }

        if (!response.ok && allowedNonOkStatuses.includes(response.status)) {
          return response;
        }

        if (!response.ok) {
          // A SAS download's error body is text the CLI doesn't control: a
          // proxy's or firewall's page can quote or link to the URL, signature
          // included. Mask it (maskSasSignature), and name the URL without its
          // query, since the body alone may not say which host failed.
          const errorText = skipAuth ? maskSasSignature(await response.text(), url) : await response.text();
          const parsed = parseArmError(errorText);
          throw new HttpError(
            response.status,
            skipAuth
              ? `HTTP ${response.status} from ${logUrl}${errorText ? `: ${excerpt(errorText)}` : ''}`
              : formatArmErrorMessage(response.status, errorText, parsed),
            parsed.code,
            // A non-JSON body is kept as text, since the message may truncate it.
            parsed.body ?? (errorText || undefined),
          );
        }

        return response;
      } catch (error) {
        // Client errors are deterministic unless the caller says otherwise.
        if (
          error instanceof HttpError &&
          error.status >= 400 &&
          error.status < 500 &&
          !isRetryableError?.(error)
        ) {
          throw error;
        }
        // Retrying with the same proxy credentials gets the same answer.
        if (isProxyAuthenticationError(error)) {
          throw new Error(
            `${target} failed: the proxy refused the request with 407 Proxy Authentication Required. ` +
            'Check the user name and password in the proxy URL (HTTPS_PROXY, ALL_PROXY or HTTP_PROXY).',
            { cause: error },
          );
        }
        if (attempt >= maxRetries) {
          // fetch's "fetch failed" says nothing on its own; name the cause.
          const message = errorMessage(error);
          throw error instanceof Error && message !== error.message ? new Error(message, { cause: error }) : error;
        }
        const delayMs = ArmHttpClient.backoff(attempt);
        logRetry(
          `Request failed on ${target} (attempt ${attempt + 1}/${maxAttempts}): ` +
          `${errorMessage(error)}, retrying in ${formatDuration(delayMs)}`,
        );
        await this.delay(delayMs);
        attempt++;
      }
    }

    // Unreachable: the final attempt either returns or throws above.
    throw new Error('Max retries exceeded');
  }
}

/* ------------------------------------------------------------------ */
/*  Pagination                                                        */
/* ------------------------------------------------------------------ */

export interface PaginateArmOptions {
  /**
   * Request options applied to every page request. Options that would return
   * an error response instead of throwing it are not accepted, so every
   * response other than a 404 is a page.
   */
  requestOptions?: Omit<ArmRequestOptions, 'allowedNonOkStatuses' | 'noRetryOn5xx'>;
  /**
   * Called when a page request throws. Return true to end the listing
   * quietly (items already yielded stand); otherwise the error is rethrown.
   */
  shouldStopOnError?: (error: unknown) => boolean;
  /** Called when a page returns 404 (collection not found) before ending the listing. */
  onNotFound?: () => void;
}

/**
 * Yield the items of an ARM list, following `nextLink`. A 404 ends the
 * listing (empty collection). A `nextLink` that is not HTTPS on the client's
 * ARM host throws instead of being followed with the bearer token.
 */
export async function* paginateArm(
  http: ArmHttpClient,
  url: string,
  options: PaginateArmOptions = {},
): AsyncIterable<Record<string, unknown>> {
  let next: string | undefined = url;

  while (next) {
    let response: Response;
    try {
      response = await http.request(next, {}, options.requestOptions);
    } catch (error) {
      if (options.shouldStopOnError?.(error)) {
        return;
      }
      throw error;
    }

    if (response.status === 404) {
      await discardBody(response);
      options.onNotFound?.();
      return;
    }

    // Other non-OK statuses were thrown by the request (requestOptions cannot
    // allow them), so this is a page.

    const data = (await response.json()) as { value?: unknown[]; nextLink?: string };
    if (Array.isArray(data.value)) {
      for (const item of data.value) {
        yield item as Record<string, unknown>;
      }
    }

    next = data.nextLink || undefined;
    if (next && !isArmUrl(next, http.armHosts)) {
      throw new Error(`Refusing to follow nextLink to a non-ARM URL: ${next.split('?')[0]}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Long-running operations                                           */
/* ------------------------------------------------------------------ */

/**
 * Read the state an ARM response body reports: `properties.provisioningState`
 * or, with `includeStatus` (async-operation status bodies), the top-level
 * `status` when it is present, else `properties.provisioningState`. Returns
 * the state as reported (compare it case-insensitively), or undefined when
 * the body is not an object or the field read is not a string.
 */
export function readArmState(body: unknown, options: { includeStatus: boolean }): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const properties = record.properties as Record<string, unknown> | undefined;
  const state = options.includeStatus
    ? record.status ?? properties?.provisioningState
    : properties?.provisioningState;
  return typeof state === 'string' ? state : undefined;
}

/** True for a lower-cased terminal failure state: `failed`, `canceled` or `cancelled`. */
export function isFailedState(state: string): boolean {
  return state === 'failed' || state === 'canceled' || state === 'cancelled';
}

/**
 * True when a Location poll body looks like an operation-status body rather
 * than the resource: it carries an `error` object, or has no non-empty
 * `properties` object (absent, null or `{}`).
 */
function looksLikeOperationStatus(body: Record<string, unknown>): boolean {
  if (typeof body.error === 'object' && body.error !== null) {
    return true;
  }
  const properties = body.properties;
  return typeof properties !== 'object' || properties === null || Object.keys(properties).length === 0;
}

/** Response header an ARM long-running operation's polling URL came from. */
export type AsyncOperationHeader = 'Azure-AsyncOperation' | 'Operation-Location' | 'Location';

/** Polling URL of an ARM long-running operation and the header it came from. */
export interface AsyncOperation {
  url: string;
  header: AsyncOperationHeader;
}

/**
 * Extract the async-operation polling URL from ARM LRO response headers.
 * Tries Azure-AsyncOperation, then Operation-Location, then (when
 * `includeLocation`, the default) Location, and returns the first header
 * with a usable URL. An empty header is skipped; a URL that is malformed,
 * not HTTPS or not on one of `armHosts` (the polling client's
 * {@link ArmHttpClient.armHosts}, required so a caller cannot widen the
 * polling client's cloud) is skipped with a warning, so the bearer token is
 * never sent to an unexpected host. Returns undefined when no header has a
 * usable URL.
 */
export function extractAsyncOperation(
  response: Response,
  options: { includeLocation?: boolean; armHosts: readonly string[] },
): AsyncOperation | undefined {
  const { includeLocation = true, armHosts } = options;
  const headers: readonly AsyncOperationHeader[] = includeLocation
    ? ['Azure-AsyncOperation', 'Operation-Location', 'Location']
    : ['Azure-AsyncOperation', 'Operation-Location'];
  for (const header of headers) {
    const url = response.headers.get(header);
    if (url && isUsablePollingUrl(url, armHosts)) {
      return { url, header };
    }
  }
  return undefined;
}

/**
 * True when `url` can be polled with the ARM bearer token: a well-formed
 * HTTPS URL on one of `armHosts`. Otherwise logs why it is ignored.
 */
function isUsablePollingUrl(url: string, armHosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logger.warn(`Ignoring malformed async operation URL: ${url}`);
    return false;
  }
  if (parsed.protocol !== 'https:') {
    logger.warn(`Ignoring non-HTTPS async operation URL: ${url}`);
    return false;
  }
  if (!isArmUrl(url, armHosts)) {
    logger.warn(`Ignoring async operation URL with unexpected host: ${parsed.hostname}`);
    return false;
  }
  return true;
}

/**
 * True when `operation` polls an async-operation status endpoint
 * (Azure-AsyncOperation or Operation-Location), whose body reports the
 * operation's `status`; a Location URL may return the resource instead.
 * {@link pollArmOperation} keeps polling a status endpoint's JSON body that
 * has no status yet.
 */
export function isOperationStatusEndpoint(operation: AsyncOperation): boolean {
  return operation.header !== 'Location';
}

export interface PollArmOperationOptions {
  /** Treat a 404 while polling as success (delete operations). Otherwise it fails. */
  treatMissingAsSuccess?: boolean;
  /** Give up after this long. */
  timeoutMs: number;
  /**
   * Wait between polls until a poll response sends a positive Retry-After;
   * from then on the last such Retry-After is used.
   */
  intervalMs: number;
  /** Wait before the first poll. Defaults to 0 (poll immediately). */
  initialDelayMs?: number;
}

/**
 * Poll an ARM long-running operation's polling URL until it reaches a
 * terminal state. The state is read case-insensitively from `status`, else
 * `properties.provisioningState`, for an async-operation status endpoint.
 * A Location URL may return the resource itself, so its state is read from
 * `properties.provisioningState`; its top-level `status` is used only to
 * detect a failure, when the body looks like an operation-status body (it
 * has an `error` object, or no non-empty `properties`) and that status is
 * `Failed`, `Canceled` or `Cancelled` (see {@link readArmState}):
 *   - `Succeeded`, or a 2xx (other than 202) without a state → resolves,
 *     except a JSON body without a state from an async-operation status
 *     endpoint (Azure-AsyncOperation or Operation-Location, see
 *     {@link isOperationStatusEndpoint}), which keeps polling since the
 *     operation has not reported a terminal state yet (an empty or non-JSON
 *     2xx still resolves);
 *   - `Failed` / `Canceled` / `Cancelled` → throws with the ARM error;
 *   - 202 or any other state → keeps polling. A positive Retry-After sets the
 *     wait before every later poll until another one replaces it; a missing,
 *     unparsable or 0 value keeps the current wait, as in `@azure/core-lro`.
 * A 404 resolves when `treatMissingAsSuccess`, otherwise throws.
 *
 * A delete without a polling URL waits for the resource itself to disappear
 * with {@link waitUntilGone} instead.
 */
export async function pollArmOperation(
  http: ArmHttpClient,
  operation: AsyncOperation,
  label: string,
  options: PollArmOperationOptions,
): Promise<void> {
  const { treatMissingAsSuccess = false, timeoutMs, intervalMs } = options;
  const operationUrl = operation.url;
  const requireStatus = isOperationStatusEndpoint(operation);
  const deadline = Date.now() + timeoutMs;
  let waitMs = options.initialDelayMs ?? 0;
  let pollIntervalMs = intervalMs;

  logger.debug(`Polling async operation for ${label}: ${operationUrl}`);

  while (Date.now() < deadline) {
    if (waitMs > 0) {
      await http.delay(waitMs);
    }

    const response = await http.request(operationUrl);
    pollIntervalMs = readPollRetryAfterMs(response) ?? pollIntervalMs;
    waitMs = pollIntervalMs;

    if (response.status === 404) {
      await discardBody(response);
      if (treatMissingAsSuccess) {
        logger.debug(`Async operation target no longer present for ${label}; treating as complete`);
        return;
      }
      throw new Error(`Async operation for ${label} not found (404).`);
    }

    // Location-style polls respond with 202 while still in progress and may
    // not have a JSON body — keep polling.
    if (response.status === 202) {
      await discardBody(response);
      logger.debug(`Async operation still in progress (HTTP 202) for ${label}`);
      continue;
    }

    const text = await response.text();
    let body: Record<string, unknown> = {};
    let isJson = false;
    if (text.trim()) {
      try {
        const parsed: unknown = JSON.parse(text);
        isJson = true;
        // JSON that is not an object (e.g. `null`) has no status.
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        // Non-JSON on an OK status — treat as complete.
      }
    }

    // A Location URL may return the resource itself, whose own top-level
    // `status` (if it has one) is not the operation's status, or an
    // operation-status body. A body that looks like the latter (see
    // looksLikeOperationStatus) and reports a failed or canceled `status`
    // means the operation failed.
    let status = readArmState(body, { includeStatus: requireStatus })?.toLowerCase();
    if (!requireStatus && status === undefined && looksLikeOperationStatus(body)) {
      const reported = readArmState(body, { includeStatus: true })?.toLowerCase();
      if (reported !== undefined && isFailedState(reported)) {
        status = reported;
      }
    }

    if (status !== undefined && isFailedState(status)) {
      const error =
        typeof body.error === 'object' && body.error !== null
          ? (body.error as Record<string, unknown>)
          : undefined;
      const code = typeof error?.code === 'string' ? error.code : 'UnknownError';
      const message =
        typeof error?.message === 'string' ? error.message : excerpt(JSON.stringify(body));
      const description = describeArmError({ code, message, details: error ? readErrorDetails(error) : [] });
      throw new Error(`Async operation ${status} for ${label}: ${description}`);
    }

    if (status === undefined && requireStatus && isJson) {
      logger.debug(`Async operation status body has no status (HTTP ${response.status}) for ${label}; still polling`);
      continue;
    }

    if (status === undefined || status === 'succeeded') {
      logger.debug(`Async operation succeeded for ${label}`);
      return;
    }

    logger.debug(`Async operation status: ${status} for ${label}`);
  }

  throw new Error(`Async operation polling timed out after ${timeoutMs / 1000}s for ${label}`);
}

export interface WaitUntilGoneOptions {
  /** Give up after this long. */
  timeoutMs: number;
  /** Wait before each probe. */
  intervalMs: number;
  /** The wait between probes (usually {@link ArmHttpClient.delay}). */
  delay: (ms: number) => Promise<void>;
}

/**
 * Wait for a resource to disappear after a DELETE that returned 202 without
 * a polling URL. `probe` either reads the resource (returning its body, or
 * undefined once it is gone) or only checks for it (returning true while it
 * exists, false once it is gone). A resource that is still there keeps the
 * wait going whatever its state, `Failed` or `Canceled` included, since a
 * resource in such a state is often the reason it is being deleted.
 *
 * Waits `intervalMs` before each probe. The last wait is shortened so the
 * final probe runs at the deadline; if the resource is still there, throws a
 * "not deleted within" error. Errors from `probe` are thrown unchanged.
 */
export async function waitUntilGone(
  probe: () => Promise<boolean | Record<string, unknown> | undefined>,
  label: string,
  options: WaitUntilGoneOptions,
): Promise<void> {
  const { timeoutMs, intervalMs, delay } = options;
  const deadline = Date.now() + timeoutMs;

  for (let remainingMs = timeoutMs; remainingMs > 0; remainingMs = deadline - Date.now()) {
    await delay(Math.min(intervalMs, remainingMs));

    const resource = await probe();
    if (resource === undefined || resource === false) {
      logger.debug(`Resource no longer present; operation completed: ${label}`);
      return;
    }

    logger.debug(
      resource === true
        ? `Waiting for ${label} to be deleted; resource still present`
        : `Waiting for ${label} to be deleted; provisioning state: ` +
          `${readArmState(resource, { includeStatus: false }) ?? 'none (resource still present)'}`,
    );
  }

  throw new Error(
    `${label} was not deleted within ${formatDuration(timeoutMs)}: ` +
    'the DELETE was accepted but the resource is still present.',
  );
}
