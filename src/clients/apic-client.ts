// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Azure API Center control-plane REST client.
 *
 * Implements {@link IApicClient} using `@azure/identity` DefaultAzureCredential.
 * Handles pagination, retry/back-off, rate limiting, long-running operations
 * (Azure-AsyncOperation/Location polling), and the API definition
 * export/import specification actions.
 */

import { DefaultAzureCredential } from '@azure/identity';
import { IApicClient, ApicSpecification } from './iapic-client.js';
import { ApicResourceType } from '../models/apic-resource-types.js';
import { ApicResourceDescriptor, ApicServiceContext } from '../models/apic-types.js';
import {
  buildApicArmUri,
  buildApicListUri,
  buildApicLabel,
} from '../lib/apic-uri.js';
import { logger } from '../lib/logger.js';
import { USER_AGENT } from '../lib/user-agent.js';
import { validateServicePreFlight, PreFlightServiceKind } from './preflight.js';

/** HTTP error carrying the response status code and optional ARM error code. */
export class ApicHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApicHttpError';
  }
}

/** Terminal states for an ARM long-running operation. */
const TERMINAL_SUCCESS = 'Succeeded';
const TERMINAL_FAILURES = new Set(['Failed', 'Canceled']);

/** Pre-flight wording for API Center services. */
const APIC_PREFLIGHT_KIND: PreFlightServiceKind = {
  label: 'API Center service',
  instance: 'API Center service',
  roleTarget: 'the API Center resource',
};

export class ApicClient implements IApicClient {
  private readonly credential: DefaultAzureCredential;
  private readonly authScope: string;
  private tokenCache: { token: string; expiresOn: number } | null = null;
  private tokenPromise: Promise<string> | null = null;

  private static readonly TOKEN_CACHE_BUFFER_MS = 5 * 60 * 1000;
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 1000;
  private static readonly MAX_DELAY_MS = 30000;
  /** Deadline for LRO polling — 10 minutes. */
  private static readonly ASYNC_POLL_TIMEOUT_MS = 10 * 60 * 1000;
  /** Default interval between LRO polls when no Retry-After header is present. */
  private static readonly ASYNC_POLL_INTERVAL_MS = 5000;

  constructor(authScope = 'https://management.azure.com/.default') {
    this.credential = new DefaultAzureCredential();
    this.authScope = authScope;
  }

  private async getToken(): Promise<string> {
    if (
      this.tokenCache &&
      this.tokenCache.expiresOn > Date.now() + ApicClient.TOKEN_CACHE_BUFFER_MS
    ) {
      return this.tokenCache.token;
    }
    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  private async fetchToken(): Promise<string> {
    const tokenResponse = await this.credential.getToken(this.authScope);
    this.tokenCache = {
      token: tokenResponse.token,
      expiresOn: tokenResponse.expiresOnTimestamp,
    };
    return tokenResponse.token;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private backoff(attempt: number): number {
    const exp = Math.min(
      ApicClient.BASE_DELAY_MS * Math.pow(2, attempt),
      ApicClient.MAX_DELAY_MS,
    );
    return exp + Math.random() * 0.3 * exp;
  }

  /**
   * Execute an HTTP request with auth, retry on 429/5xx, and graceful 404 for
   * GET. `skipAuth` is used for self-authenticating SAS/link URLs.
   */
  private async request(
    url: string,
    options: RequestInit = {},
    skipAuth = false,
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    if (skipAuth) {
      headers.delete('Authorization');
    } else {
      headers.set('Authorization', `Bearer ${await this.getToken()}`);
      headers.set('Content-Type', 'application/json');
    }
    headers.set('User-Agent', USER_AGENT);

    let attempt = 0;
    const method = options.method ?? 'GET';
    // Strip SAS query before logging.
    const logUrl = skipAuth ? url.split('?')[0] : url;

    while (attempt <= ApicClient.MAX_RETRIES) {
      try {
        logger.debug(`HTTP ${method} ${logUrl}`);
        const response = await fetch(url, { ...options, headers });

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : Math.pow(2, attempt);
          logger.warn(`Rate limited (429), retrying after ${delaySeconds}s`);
          await this.delay(delaySeconds * 1000);
          attempt++;
          continue;
        }

        if (response.status >= 500 && response.status < 600) {
          if (attempt < ApicClient.MAX_RETRIES) {
            const ms = this.backoff(attempt);
            logger.warn(`Server error ${response.status}, retrying after ${Math.round(ms)}ms`);
            await this.delay(ms);
            attempt++;
            continue;
          }
        }

        if (response.status === 404 && (method === 'GET' || method === 'DELETE')) {
          return response;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new ApicHttpError(
            response.status,
            `HTTP ${response.status}: ${errorText}`,
            this.parseErrorCode(errorText),
          );
        }

        return response;
      } catch (error) {
        if (error instanceof ApicHttpError && error.status >= 400 && error.status < 500) {
          throw error;
        }
        if (attempt >= ApicClient.MAX_RETRIES) {
          throw error;
        }
        const ms = this.backoff(attempt);
        logger.warn(`Request failed: ${(error as Error).message}, retrying after ${Math.round(ms)}ms`);
        await this.delay(ms);
        attempt++;
      }
    }
    throw new Error('Max retries exceeded');
  }

  private parseErrorCode(errorText: string): string | undefined {
    try {
      const body = JSON.parse(errorText) as { error?: { code?: unknown } };
      const code = body.error?.code;
      return typeof code === 'string' ? code : undefined;
    } catch {
      return undefined;
    }
  }

  async *listResources(
    context: ApicServiceContext,
    type: ApicResourceType,
    parentNameParts: string[],
    workspace?: string,
  ): AsyncIterable<Record<string, unknown>> {
    let url = buildApicListUri(context, type, parentNameParts, workspace);

    while (url) {
      let response: Response;
      try {
        response = await this.request(url);
      } catch (error) {
        // A missing collection (404) is an empty list, not a failure.
        if (error instanceof ApicHttpError && error.status === 404) {
          return;
        }
        throw error;
      }

      if (response.status === 404) {
        return;
      }

      const data = (await response.json()) as { value?: unknown[]; nextLink?: string };
      if (Array.isArray(data.value)) {
        for (const item of data.value) {
          yield item as Record<string, unknown>;
        }
      }
      url = data.nextLink ?? '';
    }
  }

  async getResource(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
  ): Promise<Record<string, unknown> | undefined> {
    const url = buildApicArmUri(context, descriptor);
    const response = await this.request(url, { method: 'GET' });
    if (response.status === 404) {
      return undefined;
    }
    const text = await response.text();
    return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  async putResource(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = buildApicArmUri(context, descriptor);
    const response = await this.request(url, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (response.status === 201 || response.status === 202) {
      const asyncUrl = this.asyncOperationUrl(response);
      if (asyncUrl) {
        await this.pollAsyncOperation(asyncUrl, buildApicLabel(descriptor));
        const settled = await this.getResource(context, descriptor);
        return settled ?? {};
      }
    }

    const text = await response.text();
    return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  async deleteResource(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
  ): Promise<boolean> {
    const url = buildApicArmUri(context, descriptor);
    const response = await this.request(url, { method: 'DELETE' });
    if (response.status === 404) {
      return false;
    }
    if (response.status === 202) {
      const asyncUrl = this.asyncOperationUrl(response);
      if (asyncUrl) {
        await this.pollAsyncOperation(asyncUrl, buildApicLabel(descriptor), true);
      }
    }
    return true;
  }

  async exportSpecification(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
  ): Promise<ApicSpecification | undefined> {
    const actionUrl = this.actionUrl(context, descriptor, 'exportSpecification');
    let response: Response;
    try {
      response = await this.request(actionUrl, { method: 'POST' });
    } catch (error) {
      if (error instanceof ApicHttpError && error.status === 404) {
        return undefined;
      }
      logger.warn(
        `Failed to export specification for ${buildApicLabel(descriptor)}: ${(error as Error).message}`,
      );
      return undefined;
    }

    if (response.status === 404) {
      return undefined;
    }

    const text = await response.text();
    if (!text.trim()) {
      return undefined;
    }
    const body = JSON.parse(text) as { format?: string; value?: string };
    if (!body.value) {
      return undefined;
    }

    // `format: 'link'` returns a SAS URL; fetch the actual content. `inline`
    // returns the content directly.
    let content = body.value;
    if (body.format === 'link') {
      const blob = await this.request(body.value, {}, true);
      if (!blob.ok) {
        logger.warn(`Failed to fetch specification link for ${buildApicLabel(descriptor)}`);
        return undefined;
      }
      content = await blob.text();
    }

    const specName = this.readSpecName(context, descriptor);
    return { content, name: await specName.name, version: await specName.version };
  }

  async importSpecification(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
    spec: ApicSpecification,
  ): Promise<void> {
    const actionUrl = this.actionUrl(context, descriptor, 'importSpecification');
    const response = await this.request(actionUrl, {
      method: 'POST',
      body: JSON.stringify({
        value: spec.content,
        format: 'inline',
        specification: { name: spec.name, ...(spec.version ? { version: spec.version } : {}) },
      }),
    });

    if (response.status === 202) {
      const asyncUrl = this.asyncOperationUrl(response);
      if (asyncUrl) {
        await this.pollAsyncOperation(asyncUrl, `${buildApicLabel(descriptor)} (spec import)`);
      }
    }
  }

  async validatePreFlight(context: ApicServiceContext): Promise<void> {
    await validateServicePreFlight(context, APIC_PREFLIGHT_KIND, (url) =>
      this.request(url, { method: 'GET' }),
    );
  }

  /**
   * Read the specification name/version from the definition resource so that
   * export produces a spec that can be re-imported with the correct format.
   */
  private readSpecName(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
  ): { name: Promise<string>; version: Promise<string | undefined> } {
    const definition = this.getResource(context, descriptor);
    const spec = definition.then((d) => {
      const props = (d?.properties ?? {}) as { specification?: { name?: string; version?: string } };
      return props.specification ?? {};
    });
    return {
      name: spec.then((s) => s.name ?? 'openapi'),
      version: spec.then((s) => s.version),
    };
  }

  /** Build an action URL (`.../{resource}/{action}?api-version=...`). */
  private actionUrl(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
    action: string,
  ): string {
    const [base, query] = buildApicArmUri(context, descriptor).split('?');
    return `${base}/${action}?${query}`;
  }

  /** Extract the LRO polling URL from response headers, if any. */
  private asyncOperationUrl(response: Response): string | undefined {
    return (
      response.headers.get('Azure-AsyncOperation') ??
      response.headers.get('Location') ??
      undefined
    );
  }

  /**
   * Poll an ARM async-operation URL until it reaches a terminal state.
   * @param treatMissingAsSuccess when true, a 404 during polling (resource gone)
   *   is treated as success — used for delete operations.
   */
  private async pollAsyncOperation(
    asyncUrl: string,
    label: string,
    treatMissingAsSuccess = false,
  ): Promise<void> {
    const deadline = Date.now() + ApicClient.ASYNC_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const response = await this.request(asyncUrl, { method: 'GET' });
      if (response.status === 404) {
        if (treatMissingAsSuccess) {
          return;
        }
        throw new Error(`Async operation for ${label} not found (404).`);
      }

      const retryAfter = response.headers.get('Retry-After');
      const text = await response.text();
      const status = this.readOperationStatus(text, response.status);

      if (status === TERMINAL_SUCCESS) {
        return;
      }
      if (TERMINAL_FAILURES.has(status)) {
        throw new Error(`Async operation for ${label} ${status}: ${text.substring(0, 500)}`);
      }

      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : ApicClient.ASYNC_POLL_INTERVAL_MS;
      await this.delay(waitMs);
    }
    throw new Error(`Async operation for ${label} timed out after ${ApicClient.ASYNC_POLL_TIMEOUT_MS}ms.`);
  }

  /**
   * Resolve the operation status from a polling response. ARM async operations
   * report `{ status }`; provisioning-style responses report
   * `{ properties: { provisioningState } }`. A bare 200 with no status is
   * treated as success.
   */
  private readOperationStatus(text: string, httpStatus: number): string {
    if (!text.trim()) {
      return httpStatus === 200 ? TERMINAL_SUCCESS : 'InProgress';
    }
    try {
      const body = JSON.parse(text) as {
        status?: string;
        properties?: { provisioningState?: string };
      };
      const state = body.status ?? body.properties?.provisioningState;
      return state ?? (httpStatus === 200 ? TERMINAL_SUCCESS : 'InProgress');
    } catch {
      return httpStatus === 200 ? TERMINAL_SUCCESS : 'InProgress';
    }
  }
}
