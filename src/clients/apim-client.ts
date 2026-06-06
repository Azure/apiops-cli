// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T016: Azure REST HTTP client implementing IApimClient
 * Uses @azure/identity DefaultAzureCredential for auth
 * Handles pagination, retry, rate limiting, and long-running operations
 */

import { DefaultAzureCredential } from '@azure/identity';
import { IApimClient } from './iapim-client.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { RESOURCE_TYPE_METADATA, ResourceType } from '../models/resource-types.js';
import { buildArmUri, buildResourceLabel } from '../lib/resource-uri.js';
import { deriveListPaths } from '../lib/resource-path.js';
import { logger } from '../lib/logger.js';
import { USER_AGENT } from '../lib/user-agent.js';

/**
 * Structured HTTP error that carries the response status code.
 * Allows callers to branch on status without parsing the message string.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string  // APIM error code, e.g. "MethodNotAllowedInPricingTier"
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class ApimClient implements IApimClient {
  private credential: DefaultAzureCredential;
  private readonly authScope: string;
  private tokenCache: { token: string; expiresOn: number } | null = null;
  private tokenPromise: Promise<string> | null = null;

  private static readonly TOKEN_CACHE_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 1000;
  private static readonly MAX_DELAY_MS = 30000;
  private static readonly MAX_POLLING_ATTEMPTS = 30;
  private static readonly POLL_INTERVAL_MS = 2000;
  /** Deadline for async (LRO) operation polling — 7.5 minutes. */
  private static readonly ASYNC_POLL_TIMEOUT_MS = 7.5 * 60 * 1000;
  /** Default interval between async operation polls when no Retry-After header. */
  private static readonly ASYNC_POLL_INTERVAL_MS = 5000;
  /** Known ARM management plane host suffixes for URL validation. */
  private static readonly ARM_HOSTS = [
    'management.azure.com',
    'management.chinacloudapi.cn',
    'management.usgovcloudapi.net',
    'management.microsoftazure.de',
  ];
  /** Stable ARM API version for Resource Group existence checks */
  private static readonly RESOURCE_GROUP_API_VERSION = '2021-04-01';

  /**
   * @param authScope OAuth2 scope for ARM token requests.
   *   Defaults to the Azure public cloud scope.
   */
  constructor(authScope = 'https://management.azure.com/.default') {
    this.credential = new DefaultAzureCredential();
    this.authScope = authScope;
  }

  /**
   * Get bearer token for Azure Management API.
   * Uses a promise cache to prevent duplicate token requests under concurrency.
   */
  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresOn > Date.now() + ApimClient.TOKEN_CACHE_BUFFER_MS) {
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

  /**
   * Execute HTTP request with retry logic and rate limiting.
   * @param noRetryOn5xx - When true, 5xx responses are returned immediately
   *   without retrying (e.g. wiki endpoints that return 500 for missing wikis).
   * @param skipAuth - When true, skip adding Authorization/Content-Type headers
   *   (e.g. blob SAS URLs that are self-authenticating).
   * @param allowedNonOkStatuses - Status codes the caller will handle itself
   *   (response returned instead of throwing). 404 is always allowed for GETs.
   */
  private async request(
    url: string,
    options: RequestInit = {},
    noRetryOn5xx = false,
    skipAuth = false,
    allowedNonOkStatuses: readonly number[] = []
  ): Promise<Response> {
    const headers = new Headers(options.headers);
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

    while (attempt <= ApimClient.MAX_RETRIES) {
      try {
        logger.debug(`HTTP ${options.method ?? 'GET'} ${logUrl}`);
        const response = await fetch(url, { ...options, headers });

        // Handle rate limiting (429)
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : Math.pow(2, attempt);
          logger.warn(`Rate limited (429), retrying after ${delaySeconds}s`);
          await this.delay(delaySeconds * 1000);
          attempt++;
          continue;
        }

        // Handle transient errors (5xx)
        if (response.status >= 500 && response.status < 600) {
          if (noRetryOn5xx) {
            // Caller has opted out of 5xx retries — return the raw response so
            // getResource can treat it as "not found" (e.g. wiki endpoints that
            // return 500 when the API/product has no wiki).
            return response;
          }
          if (attempt < ApimClient.MAX_RETRIES) {
            const delayMs = this.exponentialBackoffWithJitter(attempt);
            logger.warn(`Server error ${response.status}, retrying after ${delayMs}ms`);
            await this.delay(delayMs);
            attempt++;
            continue;
          }
        }

        // Handle 404 gracefully for GET operations (default method is GET when unspecified)
        if (response.status === 404 && (options.method === 'GET' || !options.method)) {
          return response;
        }

        // Caller-opt-in: return specific non-OK statuses instead of throwing
        // (e.g. 406 from GraphQL `graphql-link` export when the API has no
        // downloadable SDL — a valid "no spec available" signal, not an error).
        if (!response.ok && allowedNonOkStatuses.includes(response.status)) {
          return response;
        }

        // Check for error responses
        if (!response.ok) {
          const errorText = await response.text();
          let errorCode: string | undefined;
          try {
            const errorBody: unknown = JSON.parse(errorText);
            if (
              typeof errorBody === 'object' && errorBody !== null &&
              'error' in errorBody &&
              typeof (errorBody as Record<string, unknown>)['error'] === 'object' &&
              (errorBody as Record<string, unknown>)['error'] !== null &&
              'code' in ((errorBody as Record<string, unknown>)['error'] as Record<string, unknown>) &&
              typeof ((errorBody as Record<string, unknown>)['error'] as Record<string, unknown>)['code'] === 'string'
            ) {
              errorCode = ((errorBody as Record<string, unknown>)['error'] as Record<string, unknown>)['code'] as string;
            }
          } catch {
            // Response body is not JSON — no error code available
          }
          throw new HttpError(response.status, `HTTP ${response.status}: ${errorText}`, errorCode);
        }

        return response;
      } catch (error) {
        // Do not retry client errors (4xx) — they are deterministic, not transient.
        // 429 rate-limiting is already handled above and never reaches here.
        if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
          throw error;
        }
        if (attempt >= ApimClient.MAX_RETRIES) {
          throw error;
        }
        const delayMs = this.exponentialBackoffWithJitter(attempt);
        logger.warn(`Request failed: ${(error as Error).message}, retrying after ${delayMs}ms`);
        await this.delay(delayMs);
        attempt++;
      }
    }

    throw new Error('Max retries exceeded');
  }

  private exponentialBackoffWithJitter(attempt: number): number {
    const exponentialDelay = Math.min(
      ApimClient.BASE_DELAY_MS * Math.pow(2, attempt),
      ApimClient.MAX_DELAY_MS
    );
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return exponentialDelay + jitter;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async *listResources(
    context: ApimServiceContext,
    type: ResourceType,
    parent?: ResourceDescriptor
  ): AsyncIterable<Record<string, unknown>> {
    // Build list URL based on resource type and parent
    let url: string;

    const meta = RESOURCE_TYPE_METADATA[type];
    const { listPath, childListPath } = deriveListPaths(meta.armPathSuffix);

    if (parent) {
      // For child resources, use parent's ARM URI as base.
      // buildArmUri already appends ?api-version=..., so strip the query string
      // before appending the child path to avoid a malformed double-query URL.
      if (!childListPath) {
        throw new Error(
          `Resource type ${type} is a singleton — listResources() cannot be called on it with a parent`
        );
      }
      const parentUri = buildArmUri(context, parent);
      const parentUriBase = parentUri.split('?')[0];
      url = `${parentUriBase}${childListPath}?api-version=${context.apiVersion}`;
    } else {
      // For top-level resources
      if (!listPath) {
        throw new Error(
          `Resource type ${type} is a singleton — listResources() cannot be called on it`
        );
      }
      url = `${context.baseUrl}${listPath}?api-version=${context.apiVersion}`;
    }

    // Handle pagination with nextLink
    while (url) {
      let response: Response;
      try {
        response = await this.request(url);
      } catch (error) {
        // HTTP 400 with MethodNotAllowedInPricingTier means the resource type is not
        // supported by this APIM pricing tier. Skip it — do not treat as a failure.
        if (error instanceof HttpError && error.code === 'MethodNotAllowedInPricingTier') {
          logger.debug(`Skipping resource type ${type} — not available in this pricing tier.`);
          return;
        }
        throw error;
      }

      // request() returns 404 GET responses directly (non-throwing).
      // A 404 on a list endpoint means the resource collection does not exist
      // for this service instance — treat as empty.
      if (!response.ok) {
        if (response.status === 404) {
          logger.debug(`Resource type ${type} returned HTTP 404, resource collection not found — returning empty list`);
          return;
        }

        throw new HttpError(
          response.status,
          `Request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
        );
      }

      const data = await response.json() as { value?: unknown[]; nextLink?: string };

      if (data.value && Array.isArray(data.value)) {
        for (const item of data.value) {
          yield item as Record<string, unknown>;
        }
      }

      url = data.nextLink ?? '';
    }
  }

  async getResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<Record<string, unknown> | undefined> {
    // Some association resources (ProductGroup, ProductApi, GatewayApi) only
    // support PUT/DELETE. Short-circuit before making a network call.
    const metadata = RESOURCE_TYPE_METADATA[descriptor.type];
    if (!metadata.supportsGet) {
      logger.debug(`Resource type ${descriptor.type} does not support GET, returning undefined`);
      return undefined;
    }

    const url = buildArmUri(context, descriptor);
    // Azure APIM returns HTTP 500 (not 404) when an API or product has no wiki.
    // Suppress retries for wiki types so the extractor silently skips them.
    const isWiki =
      descriptor.type === ResourceType.ApiWiki ||
      descriptor.type === ResourceType.ProductWiki;

    try {
      const response = await this.request(url, { method: 'GET' }, isWiki);

      if (response.status === 404 || (isWiki && response.status >= 500 && response.status < 600)) {
        return undefined;
      }

      const body = await response.text();
      const contentType = response.headers.get('Content-Type') ?? '';

      // Some APIM policy endpoints return raw XML instead of JSON-wrapped XML.
      // Detect by Content-Type header or body sniffing, and wrap in the expected
      // ARM envelope so callers can access properties.value as normal.
      if (contentType.includes('xml') || body.trimStart().startsWith('<')) {
        return { properties: { value: body, format: 'rawxml' } };
      }

      return JSON.parse(body) as Record<string, unknown>;
    } catch (error) {
      // Some APIM association endpoints (ProductGroup, ProductApi, GatewayApi) only
      // support PUT/DELETE and return HTTP 405 on GET. Return undefined so callers
      // (e.g. dry-run reporter) treat them as "not found" rather than an error.
      if (error instanceof HttpError && error.status === 405) {
        logger.debug(`Resource does not support GET (HTTP 405), treating as not found: ${url}`);
        return undefined;
      }
      logger.error(`Failed to get resource: ${(error as Error).message}`);
      throw error;
    }
  }

  async putResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = buildArmUri(context, descriptor);
    
    const response = await this.request(url, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    // Poll for long-running operations (201/202 responses).
    // Skip polling for association resources that don't support GET (supportsGet: false in metadata).
    // Check status BEFORE reading the body so the body stream is not consumed
    // unnecessarily — and to avoid JSON-parsing failures when the 201/202 body
    // is XML (e.g. policy endpoints that echo back raw XML on creation).
    if (response.status === 201 || response.status === 202) {
      const metadata = RESOURCE_TYPE_METADATA[descriptor.type];
      if (!metadata.supportsGet) {
        // Association resources don't support GET - return empty on success
        logger.debug(`Skipping provisioning poll for association resource: ${buildResourceLabel(descriptor)}`);
        return {};
      }

      // Prefer ARM async operation polling when the service provides an
      // Azure-AsyncOperation or Location header — these long-running operations
      // (e.g. large API spec imports) may take minutes to complete.
      const asyncUrl = this.extractAsyncOperationUrl(response);
      if (asyncUrl) {
        return await this.pollAsyncOperation(asyncUrl, context, descriptor);
      }

      return await this.pollProvisioningState(context, descriptor);
    }

    // Some APIM endpoints (e.g. policy) return raw XML in the response body
    // instead of JSON.  Parse safely and wrap XML in the standard ARM envelope
    // so callers always receive a uniform object.
    const responseText = await response.text();
    if (!responseText.trim()) {
      return {};
    }

    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      if (responseText.trimStart().startsWith('<')) {
        // Policy endpoints may respond with raw XML — normalise to ARM envelope
        return { properties: { value: responseText, format: 'rawxml' } };
      }
      throw new SyntaxError(`Non-JSON response from APIM PUT ${url}: ${responseText.substring(0, 200)}`);
    }
  }

  async patchResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = buildArmUri(context, descriptor);

    const response = await this.request(url, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    if (!responseText.trim()) {
      return {};
    }

    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      throw new SyntaxError(`Non-JSON response from APIM PATCH ${url}: ${responseText.substring(0, 200)}`);
    }
  }

  async deleteResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<boolean> {
    const url = buildArmUri(context, descriptor);
    
    try {
      const response = await this.request(url, { method: 'DELETE' });
      
      if (response.status === 404) {
        return false; // Already deleted
      }

      // Poll for long-running operations
      if (response.status === 202) {
        const asyncUrl = this.extractAsyncOperationUrl(response);
        if (asyncUrl) {
          await this.pollAsyncOperation(asyncUrl, context, descriptor, { treatMissingAsSuccess: true });
        } else {
          await this.pollProvisioningState(context, descriptor, {
            treatMissingAsSuccess: true,
          });
        }
      }

      return true;
    } catch (error) {
      if ((error as Error).message.includes('404')) {
        return false;
      }
      throw error;
    }
  }

  async *listApiRevisions(
    context: ApimServiceContext,
    apiName: string
  ): AsyncIterable<Record<string, unknown>> {
    const url = `${context.baseUrl}/apis/${encodeURIComponent(apiName)}/revisions?api-version=${context.apiVersion}`;
    
    const response = await this.request(url);
    const data = await response.json() as { value?: unknown[] };

    if (data.value && Array.isArray(data.value)) {
      for (const item of data.value) {
        yield item as Record<string, unknown>;
      }
    }
  }

  async getApiSpecification(
    context: ApimServiceContext,
    apiName: string,
    apiType?: string
  ): Promise<{ content: string; format: 'yaml' | 'json' | 'graphql' | 'wsdl' | 'wadl' } | undefined> {
    const exportFormat = this.getExportFormat(apiType);
    if (exportFormat === undefined) {
      return undefined;
    }
    const buildExportUrl = (format: string): string =>
      `${context.baseUrl}/apis/${encodeURIComponent(apiName)}?export=true&format=${format}&api-version=${context.apiVersion}`;

    // APIM's wsdl-link / wadl-link emitters frequently return HTTP 500 on
    // real-world APIs. When the link variant fails, fall back to the inline
    // (non-link) export which returns the raw XML in the response body. We
    // must preserve WSDL/WADL fidelity so the spec can be re-imported on
    // publish (the Azure/apiops reference tool skips on 500; we cannot —
    // these APIs must round-trip).
    const isXmlExport = exportFormat === 'wsdl-link' || exportFormat === 'wadl-link';
    const inlineFormat: 'wsdl' | 'wadl' | undefined =
      exportFormat === 'wsdl-link' ? 'wsdl' :
      exportFormat === 'wadl-link' ? 'wadl' :
      undefined;

    // GraphQL APIs without a downloadable SDL link return HTTP 406 — handle it
    // as a valid "no spec available" signal rather than an error.
    const isGraphQLLink = exportFormat === 'graphql-link';
    const allowedNonOkStatuses = isGraphQLLink ? [406] : [];

    try {
      // Suppress the default 5xx retry loop for XML exports so we can fall
      // back to the inline export instead of burning retries on a broken path.
      const response = await this.request(
        buildExportUrl(exportFormat),
        {},
        isXmlExport,
        false,
        allowedNonOkStatuses
      );

      if (response.status === 404) {
        return undefined;
      }

      if (isGraphQLLink && response.status === 406) {
        logger.debug(
          `No graphql-link specification available for ${apiName} (HTTP 406); ` +
          `GraphQL schema will be sourced from /schemas instead.`
        );
        return undefined;
      }

      if (isXmlExport && inlineFormat && response.status >= 500 && response.status < 600) {
        logger.warn(
          `APIM returned HTTP ${response.status} exporting ${exportFormat} for ${apiName}; ` +
          `falling back to inline ${inlineFormat} export.`
        );
        return await this.getInlineXmlSpecification(buildExportUrl(inlineFormat), inlineFormat, apiName);
      }

      const data = await response.json() as { format?: string; link?: string; value?: { link?: string } };

      // APIM returns the SAS link at `data.link` (top-level) in api-version 2024-05-01.
      const blobLink = data.link ?? data.value?.link;
      if (!blobLink) {
        return undefined;
      }

      // Fetch the actual spec content from the blob SAS URL (no auth header needed — SAS token is self-authenticating)
      const blobResponse = await this.request(blobLink, {}, false, true);
      if (!blobResponse.ok) {
        logger.warn(`Failed to fetch specification blob for ${apiName}: HTTP ${blobResponse.status}`);
        return undefined;
      }

      const content = await blobResponse.text();

      // Detect format from API metadata or content
      const format = this.detectSpecificationFormat(data.format ?? '', content);

      return {
        content,
        format,
      };
    } catch (error) {
      logger.warn(`Failed to get API specification for ${apiName}: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * Fall back to the non-link (inline) WSDL/WADL export when wsdl-link / wadl-link
   * returns HTTP 500. APIM returns the XML in `properties.value` as a JSON-escaped
   * string. The extracted content is suitable for re-import via PUT ?import=true
   * with the matching non-link format (e.g. format=wsdl for SOAP APIs), so SOAP
   * round-tripping is preserved.
   */
  private async getInlineXmlSpecification(
    url: string,
    inlineFormat: 'wsdl' | 'wadl',
    apiName: string
  ): Promise<{ content: string; format: 'wsdl' | 'wadl' } | undefined> {
    try {
      const response = await this.request(url);
      if (response.status === 404) {
        return undefined;
      }
      if (!response.ok) {
        logger.warn(
          `Inline ${inlineFormat} export for ${apiName} failed: HTTP ${response.status}. Specification will be skipped.`
        );
        return undefined;
      }

      // APIM's inline export endpoint is inconsistent: depending on the
      // api-version and the API's internal representation, the body may be
      // (a) raw XML (e.g. `<?xml ...><wsdl:definitions ...>`), or
      // (b) a JSON wrapper `{ properties: { value: "<wsdl...>" } }` / `{ value: "<wsdl...>" }`,
      // or (c) a plain-text error like "Unable to export ...".
      // We read as text first and sniff, which is robust to all three shapes.
      const text = await response.text();
      const trimmed = text.trimStart();

      let content: string | undefined;
      if (trimmed.startsWith('<')) {
        // Raw XML response — use the body directly.
        content = text;
      } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const body = JSON.parse(text) as {
            properties?: { value?: unknown };
            value?: unknown;
          };
          const raw = body.properties?.value ?? body.value;
          content = typeof raw === 'string' ? raw : undefined;
        } catch {
          // Fall through to the "unexpected body" path below.
        }
      }

      if (!content || content.length === 0) {
        const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
        logger.warn(
          `Inline ${inlineFormat} export for ${apiName} returned an unexpected body; skipping. Preview: ${preview}`
        );
        return undefined;
      }

      const format: 'wsdl' | 'wadl' = inlineFormat;
      return { content, format };
    } catch (error) {
      logger.warn(
        `Inline ${inlineFormat} export for ${apiName} threw: ${(error as Error).message}. Specification will be skipped.`
      );
      return undefined;
    }
  }

  /**
   * Map APIM API type to the appropriate export format query parameter.
   * All APIM export formats return a SAS blob link (link-based, not inline content).
   *
   * APIM properties.type values and their export format mappings:
   *   graphql-link          – GraphQL SDL blob        (type=graphql)
   *   wsdl-link             – WSDL blob               (type=soap)
   *   openapi-link          – OpenAPI 3.0 YAML        (type=http, default)
   *   undefined             –                         (type=websocket|a2a — no spec; callers should skip)
   *
   * SOAP APIs use wsdl-link so the exported specification can be re-imported
   * faithfully on publish (matches the Azure/apiops reference tool). APIM's
   * wsdl-link emitter occasionally returns HTTP 500 on real-world SOAP APIs;
   * getApiSpecification handles that by falling back to the inline (non-link)
   * `format=wsdl` export, which returns the raw WSDL in the response body.
   * The inline WSDL is re-importable via PUT ?import=true&format=wsdl, so SOAP
   * round-tripping is preserved even when the link variant is broken.
   *
   * Additional export formats supported by APIM for type=http REST APIs:
   *   swagger-link          – Swagger 2.0 YAML
   *   openapi+json-link     – OpenAPI 3.0 JSON
   *   wadl-link             – WADL
   * These cannot be auto-selected from properties.type alone because all REST APIs
   * (whether originally imported as Swagger 2.0, OpenAPI 3.0, or WADL) share
   * type=http in APIM. openapi-link is used as the preferred modern default.
   *
   * Returns undefined for WebSocket APIs — they have no traditional API specification.
   * getApiSpecification will return undefined early when this method returns undefined.
   */
  private getExportFormat(apiType?: string): string | undefined {
    switch (apiType?.toLowerCase()) {
      case 'graphql':   return 'graphql-link';
      case 'soap':      return 'wsdl-link';
      case 'websocket': return undefined;
      case 'a2a':       return undefined;
      default:          return 'openapi-link';
    }
  }

  async validatePreFlight(context: ApimServiceContext): Promise<void> {
    // Check resource group exists
    const rgUrl = `https://management.azure.com/subscriptions/${encodeURIComponent(context.subscriptionId)}/resourceGroups/${encodeURIComponent(context.resourceGroup)}?api-version=${ApimClient.RESOURCE_GROUP_API_VERSION}`;
    let rgResponse: Response;
    try {
      rgResponse = await this.request(rgUrl, { method: 'GET' });
    } catch (error) {
      this.throwPreFlightHttpError(error, `resource group '${context.resourceGroup}'`, `the subscription or resource group`);
    }
    if (rgResponse.status === 404) {
      throw new Error(
        `Resource group '${context.resourceGroup}' not found in subscription '${context.subscriptionId}'. ` +
        `Ensure the resource group exists before publishing.`
      );
    }

    // Check APIM service instance exists
    const apimUrl = `${context.baseUrl}?api-version=${context.apiVersion}`;
    let apimResponse: Response;
    try {
      apimResponse = await this.request(apimUrl, { method: 'GET' });
    } catch (error) {
      this.throwPreFlightHttpError(error, `APIM service '${context.serviceName}'`, `the APIM resource`);
    }
    if (apimResponse.status === 404) {
      throw new Error(
        `APIM service '${context.serviceName}' not found in resource group '${context.resourceGroup}'. ` +
        `Ensure the APIM instance exists before publishing.`
      );
    }
  }

  /**
   * Rethrows HttpError 401/403 responses from pre-flight checks as actionable errors.
   * Non-HTTP errors and other status codes are re-thrown unchanged.
   */
  private throwPreFlightHttpError(error: unknown, resourceLabel: string, roleTarget: string): never {
    if (error instanceof HttpError && error.status === 403) {
      throw new Error(
        `Insufficient permissions to read ${resourceLabel}. ` +
        `Ensure the service principal has at least Reader role on ${roleTarget}.`,
        { cause: error }
      );
    }
    if (error instanceof HttpError && error.status === 401) {
      throw new Error(
        `Authentication failed when checking ${resourceLabel}. ` +
        `Verify that credentials are valid and the correct tenant/subscription is targeted.`,
        { cause: error }
      );
    }
    throw error as Error;
  }

  private detectSpecificationFormat(
    formatHint: string,
    content: string
  ): 'yaml' | 'json' | 'graphql' | 'wsdl' | 'wadl' {
    const lowerFormat = formatHint.toLowerCase();
    
    if (lowerFormat.includes('graphql')) return 'graphql';
    if (lowerFormat.includes('wsdl')) return 'wsdl';
    if (lowerFormat.includes('wadl')) return 'wadl';
    if (lowerFormat.includes('json')) return 'json';
    
    // Try to detect from content
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    if (trimmed.startsWith('<?xml')) {
      if (content.includes('wsdl:')) return 'wsdl';
      if (content.includes('wadl:')) return 'wadl';
    }
    if (trimmed.includes('type Query') || trimmed.includes('type Mutation')) return 'graphql';
    
    // Default to YAML for OpenAPI
    return 'yaml';
  }

  /**
   * Extract the async operation URL from ARM LRO response headers.
   * Prefers Azure-AsyncOperation over Location.
   * Validates the URL points to a known ARM management endpoint to prevent
   * leaking the bearer token to an unexpected host.
   */
  private extractAsyncOperationUrl(response: Response): string | undefined {
    const asyncOpUrl = response.headers.get('Azure-AsyncOperation')
      ?? response.headers.get('Operation-Location')
      ?? response.headers.get('Location');

    if (!asyncOpUrl) return undefined;

    // Validate URL host is a known ARM management endpoint
    try {
      const parsed = new URL(asyncOpUrl);
      const isArmHost = ApimClient.ARM_HOSTS.some(
        (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
      );
      if (!isArmHost) {
        logger.warn(
          `Ignoring async operation URL with unexpected host: ${parsed.hostname}`
        );
        return undefined;
      }
    } catch {
      logger.warn(`Ignoring malformed async operation URL: ${asyncOpUrl}`);
      return undefined;
    }

    return asyncOpUrl;
  }

  /**
   * Poll an ARM async operation URL until terminal state.
   * Used for long-running operations like large API spec imports.
   *
   * The operation status endpoint returns:
   *   { "status": "InProgress" | "Succeeded" | "Failed" | "Canceled", ... }
   *
   * On success, GETs the original resource to return the final state.
   */
  private async pollAsyncOperation(
    operationUrl: string,
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    options: { treatMissingAsSuccess?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    const { treatMissingAsSuccess = false } = options;
    const label = buildResourceLabel(descriptor);
    const deadline = Date.now() + ApimClient.ASYNC_POLL_TIMEOUT_MS;
    let pollInterval = ApimClient.ASYNC_POLL_INTERVAL_MS;

    logger.debug(`Polling async operation for ${label}: ${operationUrl}`);

    while (Date.now() < deadline) {
      await this.delay(pollInterval);

      const response = await this.request(operationUrl);

      // Honour Retry-After if the service provides it
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed) && parsed > 0) {
          pollInterval = parsed * 1000;
        }
      }

      // Some Location-style polls respond with 202 (still in progress)
      // and may not have a JSON body — keep polling.
      if (response.status === 202) {
        logger.debug(`Async operation still in progress (HTTP 202) for ${label}`);
        continue;
      }

      // Try to parse the status body
      const text = await response.text();
      if (!text.trim()) {
        // Empty body on 200/204 — treat as complete
        if (response.ok) {
          return treatMissingAsSuccess
            ? {}
            : await this.getResource(context, descriptor) ?? {};
        }
        throw new Error(`Async operation returned empty body with status ${response.status} for ${label}`);
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Non-JSON on an OK status — treat as complete
        if (response.ok) {
          return treatMissingAsSuccess
            ? {}
            : await this.getResource(context, descriptor) ?? {};
        }
        throw new Error(`Async operation returned non-JSON with status ${response.status} for ${label}`);
      }

      const status = (body.status as string | undefined)?.toLowerCase();

      if (status === 'succeeded') {
        logger.debug(`Async operation succeeded for ${label}`);
        if (treatMissingAsSuccess) return {};
        // GET the final resource state
        return await this.getResource(context, descriptor) ?? {};
      }

      if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
        const error = body.error as Record<string, unknown> | undefined;
        const code = (error?.code as string) ?? 'UnknownError';
        const message = (error?.message as string) ?? JSON.stringify(body);
        throw new Error(`Async operation ${status} for ${label}: [${code}] ${message}`);
      }

      // InProgress or other intermediate status — keep polling
      logger.debug(`Async operation status: ${status ?? 'unknown'} for ${label}`);
    }

    throw new Error(
      `Async operation polling timed out after ${ApimClient.ASYNC_POLL_TIMEOUT_MS / 1000}s for ${label}`
    );
  }

  private async pollProvisioningState(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    options: { treatMissingAsSuccess?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    const { treatMissingAsSuccess = false } = options;

    for (let attempt = 0; attempt < ApimClient.MAX_POLLING_ATTEMPTS; attempt++) {
      await this.delay(ApimClient.POLL_INTERVAL_MS);
      
      const resource = await this.getResource(context, descriptor);
      
      if (!resource) {
        if (treatMissingAsSuccess) {
          logger.debug(
            `Resource no longer present; operation completed: ${buildResourceLabel(descriptor)}`
          );
          return {};
        }

        // APIM can transiently return 404 while asynchronously provisioning a
        // resource (e.g. a Key Vault-backed named value). Treat a missing resource
        // as "not yet visible" and continue polling rather than aborting — the
        // resource will either appear on a subsequent poll or we time out after
        // MAX_POLLING_ATTEMPTS.
        logger.debug(
          `Resource not yet visible during provisioning poll (attempt ${attempt + 1}/${ApimClient.MAX_POLLING_ATTEMPTS}): ${buildResourceLabel(descriptor)}`
        );
        continue;
      }

      const properties = resource.properties as Record<string, unknown> | undefined;
      const provisioningState = properties?.provisioningState as string | undefined;
      
      if (!provisioningState || provisioningState === 'Succeeded') {
        return resource;
      }
      
      if (provisioningState === 'Failed') {
        throw new Error(`Resource provisioning failed: ${JSON.stringify(properties)}`);
      }
      
      logger.debug(`Polling provisioning state: ${provisioningState} (attempt ${attempt + 1}/${ApimClient.MAX_POLLING_ATTEMPTS})`);
    }
    
    throw new Error('Provisioning state polling timed out');
  }

}
