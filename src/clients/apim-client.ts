// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Azure REST HTTP client implementing IApimClient
 * Uses the shared ArmHttpClient (DefaultAzureCredential auth, retry, rate
 * limiting, pagination and long-running operation polling) and adds the
 * APIM-specific handling on top
 */

import { IApimClient, ApiSpecDialect } from './iapim-client.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { RESOURCE_TYPE_METADATA, ResourceType } from '../models/resource-types.js';
import { buildArmUri, buildResourceLabel } from '../lib/resource-uri.js';
import { deriveListPaths, getResourceDescriptorKey } from '../lib/resource-path.js';
import { logger } from '../lib/logger.js';
import { errorMessage } from '../lib/error-message.js';
import { isWorkspaceScope } from '../lib/workspace-link.js';
import { formatDuration } from '../lib/format-duration.js';
import { validateServicePreFlight, PreFlightServiceKind } from './preflight.js';
import { withRetryResource } from '../lib/retry-tracker.js';
import {
  ArmHttpClient,
  ArmHttpClientOptions,
  HttpError,
  ArmRequestOptions,
  AsyncOperation,
  discardBody,
  extractAsyncOperation,
  isFailedState,
  logRetry,
  paginateArm,
  pollArmOperation,
  readArmState,
  waitUntilGone,
} from './arm-http-client.js';

/** Re-exported for existing imports from this module; defined in `arm-http-client.js`. */
export { HttpError } from './arm-http-client.js';

/**
 * Returns true when the error indicates an association link already exists.
 * APIM returns HTTP 409 Conflict ("Link already exists between specified ...")
 * when an association is re-created; the desired end state is already in place,
 * so callers treat it as an idempotent success rather than a failure.
 */
export function isLinkAlreadyExistsError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 409;
}

/** Pre-flight wording for APIM services. */
const APIM_PREFLIGHT_KIND: PreFlightServiceKind = {
  label: 'APIM service',
  instance: 'APIM instance',
  roleTarget: 'the APIM resource',
};

/** Returns true when APIM reports that an association's referenced API/group is absent. */
export function isAssociationReferenceNotFoundError(error: unknown): boolean {
  if (
    !(error instanceof HttpError) ||
    ![400, 404].includes(error.status) ||
    !['ValidationError', 'ResourceNotFound'].includes(error.code ?? '')
  ) {
    return false;
  }

  const body = error.body as Record<string, unknown> | undefined;
  const armError = body?.error as Record<string, unknown> | undefined;
  const details = Array.isArray(armError?.details) ? armError.details : [];
  return details.some((detail) => {
    if (typeof detail !== 'object' || detail === null) return false;
    const target = (detail as Record<string, unknown>).target;
    return typeof target === 'string' && ['aid', 'gid'].includes(target.toLowerCase());
  });
}

/**
 * Drop the top-level ARM `id` from a write payload. Extracted artifacts carry
 * the SOURCE service's resource id; newer APIM api-versions reject bodies whose
 * id points at a different service ("Cross-service resource references are not
 * allowed"), which breaks publishing to any service other than the one extracted from.
 */
export function stripSourceArmId(
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (!Object.hasOwn(payload, 'id')) return payload;
  const { id: _omit, ...rest } = payload;
  return rest;
}

export class ApimClient implements IApimClient {
  private readonly http: ArmHttpClient;

  private static readonly MAX_POLLING_ATTEMPTS = 30;
  private static readonly POLL_INTERVAL_MS = 2000;
  /** Deadline for async (LRO) operation polling — 7.5 minutes. */
  private static readonly ASYNC_POLL_TIMEOUT_MS = 7.5 * 60 * 1000;
  /** Default interval between async operation polls when no Retry-After header. */
  private static readonly ASYNC_POLL_INTERVAL_MS = 5000;
  /** Max DELETE attempts when APIM reports an optimistic-concurrency conflict. */
  private static readonly DELETE_CONFLICT_RETRIES = 3;
  /** Base delay between DELETE conflict retries (multiplied by attempt number). */
  private static readonly DELETE_CONFLICT_RETRY_DELAY_MS = 2000;
  /**
   * APIM reports operations blocked by an API's in-progress async operation
   * as a transient 409 PessimisticConcurrencyConflict, which is retried.
   */
  private static readonly REQUEST_OPTIONS: ArmRequestOptions = {
    isRetryableError: (error) =>
      error.status === 409 && error.code === 'PessimisticConcurrencyConflict',
  };

  /**
   * @param authScope OAuth2 scope for ARM token requests.
   *   Defaults to the Azure public cloud scope.
   * @param httpOptions Token credential and wait function for the shared ARM
   *   client. Default to `DefaultAzureCredential` and a `setTimeout` wait.
   */
  constructor(authScope?: string, httpOptions: Omit<ArmHttpClientOptions, 'authScope'> = {}) {
    this.http = new ArmHttpClient({ ...httpOptions, authScope });
  }

  /**
   * Execute an HTTP request through the shared ARM client. APIM reports
   * operations blocked by an API's in-progress async operation as a
   * transient 409 PessimisticConcurrencyConflict, which is retried; other
   * client errors are deterministic.
   */
  private request(
    url: string,
    init: RequestInit = {},
    options: ArmRequestOptions = {}
  ): Promise<Response> {
    return this.http.request(url, init, { ...ApimClient.REQUEST_OPTIONS, ...options });
  }

  async *listResources(
    context: ApimServiceContext,
    type: ResourceType,
    parent?: ResourceDescriptor
  ): AsyncIterable<Record<string, unknown>> {
    // Build list URL based on resource type and parent
    let url: string;

    const meta = RESOURCE_TYPE_METADATA[type];
    // Use workspace-specific ARM path when context OR parent descriptor is workspace-scoped.
    // During publish the context is service-level but the parent descriptor carries the workspace.
    const isWorkspaceScoped = isWorkspaceScope(context) || !!(parent?.workspace);
    const armPath = isWorkspaceScoped && meta.workspaceArmPathSuffix
      ? meta.workspaceArmPathSuffix
      : meta.armPathSuffix;
    const { listPath, childListPath } = deriveListPaths(armPath);

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
    yield* paginateArm(this.http, url, {
      requestOptions: ApimClient.REQUEST_OPTIONS,
      shouldStopOnError: (error) => {
        // HTTP 400 with MethodNotAllowedInPricingTier means the resource type is not
        // supported by this APIM pricing tier. Skip it — do not treat as a failure.
        if (error instanceof HttpError && error.code === 'MethodNotAllowedInPricingTier') {
          logger.debug(`Skipping resource type ${type} — not available in this pricing tier.`);
          return true;
        }
        // Workspace-scoped list may return transient 500s on freshly-created workspaces.
        if (error instanceof HttpError && error.status === 500 && isWorkspaceScoped) {
          logger.warn(`Workspace list for ${type} returned 500, treating as empty list`);
          return true;
        }
        return false;
      },
      // A 404 on a list endpoint means the resource collection does not exist
      // for this service instance — treat as empty.
      onNotFound: () =>
        logger.debug(`Resource type ${type} returned HTTP 404, resource collection not found — returning empty list`),
    });
  }

  async getResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<Record<string, unknown> | undefined> {
    return withRetryResource(getResourceDescriptorKey(descriptor), () =>
      this.getResourceInternal(context, descriptor));
  }

  private async getResourceInternal(
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
    // Azure APIM returns HTTP 500 (not 404) for wiki endpoints.
    // Suppress retries and treat 500 as "not found" for these cases.
    const isWiki =
      descriptor.type === ResourceType.ApiWiki ||
      descriptor.type === ResourceType.ProductWiki;
    const suppress500 = isWiki;

    try {
      const response = await this.request(url, { method: 'GET' }, { noRetryOn5xx: suppress500 });

      if (response.status === 404 || (suppress500 && response.status >= 500 && response.status < 600)) {
        await discardBody(response);
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
      logger.error(`Failed to get resource: ${errorMessage(error)}`);
      throw error;
    }
  }

  async putResource(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return withRetryResource(getResourceDescriptorKey(descriptor), () =>
      this.putResourceInternal(context, descriptor, payload));
  }

  private async putResourceInternal(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = buildArmUri(context, descriptor);

    const response = await this.request(url, {
      method: 'PUT',
      body: JSON.stringify(stripSourceArmId(payload)),
    });

    // Poll for long-running operations signaled by ARM response headers, including
    // updates that return 200 while provisioning continues asynchronously.
    // Skip polling for association resources that don't support GET (supportsGet: false in metadata).
    const metadata = RESOURCE_TYPE_METADATA[descriptor.type];
    const operation = extractAsyncOperation(response, {
      includeLocation: response.status !== 200,
      armHosts: this.http.armHosts,
    });
    if (operation && metadata.supportsGet) {
      // The final state comes from polling, so the PUT body is not read.
      await discardBody(response);
      return await this.pollAsyncOperation(operation, context, descriptor);
    }

    // Headerless creates may still provision asynchronously. Check status before
    // reading the body to avoid consuming XML returned by policy endpoints.
    if (response.status === 201 || response.status === 202) {
      await discardBody(response);
      if (!metadata.supportsGet) {
        logger.debug(`Skipping provisioning poll for association resource: ${buildResourceLabel(descriptor)}`);
        return {};
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
    return withRetryResource(getResourceDescriptorKey(descriptor), () =>
      this.patchResourceInternal(context, descriptor, payload));
  }

  private async patchResourceInternal(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = buildArmUri(context, descriptor);

    const response = await this.request(url, {
      method: 'PATCH',
      body: JSON.stringify(stripSourceArmId(payload)),
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
    return withRetryResource(getResourceDescriptorKey(descriptor), () =>
      this.deleteResourceInternal(context, descriptor));
  }

  private async deleteResourceInternal(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<boolean> {
    let url = buildArmUri(context, descriptor);

    // Deleting an API that has revisions requires deleteRevisions=true; without it
    // APIM refuses the base (current-revision) delete with "Cannot delete the
    // current revision of an API." This also removes all revisions in one call,
    // so callers skip the individual ;rev=N deletes.
    if (
      descriptor.type === ResourceType.Api &&
      !(descriptor.nameParts[0] ?? '').includes(';rev=')
    ) {
      url += '&deleteRevisions=true';
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.request(url, { method: 'DELETE' });
        // Only the status and headers of a DELETE response are used.
        await discardBody(response);

        if (response.status === 404) {
          return false; // Already deleted
        }

        // Poll for long-running operations
        if (response.status === 202) {
          const operation = extractAsyncOperation(response, { armHosts: this.http.armHosts });
          if (operation) {
            await this.pollAsyncOperation(operation, context, descriptor, { treatMissingAsSuccess: true });
          } else {
            await this.waitForDeletion(context, descriptor);
          }
        }

        return true;
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          return false;
        }
        // Transient optimistic-concurrency conflict: cascade deletes of related
        // resources (subscriptions, product/gateway associations) can modify
        // the resource while its async DELETE is in flight. Retry the DELETE.
        const isConflict =
          error instanceof HttpError &&
          (error.status === 412 || error.code === 'PreconditionFailed');
        if (isConflict && attempt < ApimClient.DELETE_CONFLICT_RETRIES) {
          const delayMs = ApimClient.DELETE_CONFLICT_RETRY_DELAY_MS * attempt;
          logRetry(
            `Delete conflict for ${buildResourceLabel(descriptor)} ` +
            `(attempt ${attempt}/${ApimClient.DELETE_CONFLICT_RETRIES}), retrying in ${formatDuration(delayMs)}`
          );
          await this.http.delay(delayMs);
          continue;
        }
        throw error;
      }
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
    apiType?: string,
    specDialect?: ApiSpecDialect
  ): Promise<{ content: string; format: 'yaml' | 'json' | 'graphql' | 'wsdl' | 'wadl' } | undefined> {
    const exportFormat = this.getExportFormat(apiType, specDialect);
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
        { noRetryOn5xx: isXmlExport, allowedNonOkStatuses }
      );

      if (response.status === 404) {
        await discardBody(response);
        return undefined;
      }

      if (isGraphQLLink && response.status === 406) {
        await discardBody(response);
        logger.debug(
          `No graphql-link specification available for ${apiName} (HTTP 406); ` +
          `GraphQL schema will be sourced from /schemas instead.`
        );
        return undefined;
      }

      if (isXmlExport && inlineFormat && response.status >= 500 && response.status < 600) {
        await discardBody(response);
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
      const blobResponse = await this.request(blobLink, {}, { skipAuth: true });
      if (!blobResponse.ok) {
        await discardBody(blobResponse);
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
      logger.warn(`Failed to get API specification for ${apiName}: ${errorMessage(error)}`);
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
        await discardBody(response);
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
        `Inline ${inlineFormat} export for ${apiName} threw: ${errorMessage(error)}. Specification will be skipped.`
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
   *   swagger-link          – Swagger 2.0 JSON
   *   openapi+json-link     – OpenAPI 3.0 JSON
   *   wadl-link             – WADL
   * These cannot be auto-selected from properties.type alone because all REST APIs
   * (whether originally imported as Swagger 2.0, OpenAPI 3.0, or WADL) share
   * type=http in APIM. The caller passes `specDialect` so the export format
   * matches the API's native source format: 'swagger2' exports via `swagger-link`,
   * 'openapi3' (default) via `openapi-link`. This preserves the original format
   * (and its schema/operation metadata) instead of converting Swagger 2.0 to
   * OpenAPI 3.0 on export.
   *
   * Returns undefined for WebSocket APIs — they have no traditional API specification.
   * getApiSpecification will return undefined early when this method returns undefined.
   */
  private getExportFormat(apiType?: string, specDialect?: ApiSpecDialect): string | undefined {
    switch (apiType?.toLowerCase()) {
      case 'graphql':   return 'graphql-link';
      case 'soap':      return 'wsdl-link';
      case 'websocket': return undefined;
      case 'a2a':       return undefined;
      // REST (http / odata / grpc / undefined): match the source dialect —
      // export Swagger 2.0 when the API was natively Swagger 2.0, else OpenAPI 3.0.
      default:          return specDialect === 'swagger2' ? 'swagger-link' : 'openapi-link';
    }
  }

  async validatePreFlight(context: ApimServiceContext): Promise<void> {
    await validateServicePreFlight(context, APIM_PREFLIGHT_KIND, (url) =>
      this.request(url, { method: 'GET' })
    );
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
   * Poll an ARM async operation URL until terminal state.
   * Used for long-running operations like large API spec imports. An
   * Azure-AsyncOperation or Operation-Location status body without a status
   * keeps polling.
   *
   * On success, GETs the original resource to return the final state
   * (unless `treatMissingAsSuccess`, used for deletes).
   */
  private async pollAsyncOperation(
    operation: AsyncOperation,
    context: ApimServiceContext,
    descriptor: ResourceDescriptor,
    options: { treatMissingAsSuccess?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    const { treatMissingAsSuccess = false } = options;
    await pollArmOperation(this.http, operation, buildResourceLabel(descriptor), {
      treatMissingAsSuccess,
      timeoutMs: ApimClient.ASYNC_POLL_TIMEOUT_MS,
      intervalMs: ApimClient.ASYNC_POLL_INTERVAL_MS,
      initialDelayMs: ApimClient.ASYNC_POLL_INTERVAL_MS,
    });
    if (treatMissingAsSuccess) return {};
    // GET the final resource state
    return await this.getResource(context, descriptor) ?? {};
  }

  /**
   * Poll the resource (through getResource, so types without GET and wiki
   * 500s read as missing) after a PUT until its provisioningState is
   * terminal, for up to MAX_POLLING_ATTEMPTS polls. The state is compared
   * case-insensitively: a resource without a state or with Succeeded
   * completes, and Failed, Canceled and Cancelled throw. A missing resource
   * keeps polling, since APIM can briefly return 404 while provisioning.
   */
  private async pollProvisioningState(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < ApimClient.MAX_POLLING_ATTEMPTS; attempt++) {
      await this.http.delay(ApimClient.POLL_INTERVAL_MS);
      
      const resource = await this.getResource(context, descriptor);
      
      if (!resource) {
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

      const provisioningState = readArmState(resource, { includeStatus: false });
      const state = provisioningState?.toLowerCase();

      if (state !== undefined && isFailedState(state)) {
        throw new Error(`Resource provisioning ${state}: ${JSON.stringify(resource.properties)}`);
      }

      if (state === undefined || state === 'succeeded') {
        return resource;
      }

      logger.debug(
        `Polling provisioning state: ${provisioningState} ` +
        `(attempt ${attempt + 1}/${ApimClient.MAX_POLLING_ATTEMPTS})`
      );
    }
    
    throw new Error('Provisioning state polling timed out');
  }

  /**
   * Wait for the resource to disappear after a DELETE that returned 202
   * without a polling header (see {@link waitUntilGone}): it is read through
   * getResource, so types without GET and wiki 500s read as missing. Gives
   * up after MAX_POLLING_ATTEMPTS polls POLL_INTERVAL_MS apart, the limit of
   * the provisioning-state poll.
   */
  private waitForDeletion(
    context: ApimServiceContext,
    descriptor: ResourceDescriptor
  ): Promise<void> {
    return waitUntilGone(() => this.getResource(context, descriptor), buildResourceLabel(descriptor), {
      timeoutMs: ApimClient.MAX_POLLING_ATTEMPTS * ApimClient.POLL_INTERVAL_MS,
      intervalMs: ApimClient.POLL_INTERVAL_MS,
      delay: (ms) => this.http.delay(ms),
    });
  }

}
