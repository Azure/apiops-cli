// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Azure API Center control-plane REST client.
 *
 * Implements {@link IApicClient} on top of the shared {@link ArmHttpClient}
 * (DefaultAzureCredential auth, retry/back-off, rate limiting, pagination and
 * long-running operation polling) and adds the API definition export/import
 * specification actions.
 */

import { IApicClient, ApicSpecification } from './iapic-client.js';
import { ApicResourceType } from '../models/apic-resource-types.js';
import { ApicResourceDescriptor, ApicServiceContext } from '../models/apic-types.js';
import {
  buildApicArmUri,
  buildApicListUri,
  buildApicLabel,
} from '../lib/apic-uri.js';
import { logger } from '../lib/logger.js';
import { errorMessage } from '../lib/error-message.js';
import { validateServicePreFlight, PreFlightServiceKind } from './preflight.js';
import {
  ArmHttpClient,
  ArmHttpClientOptions,
  HttpError,
  ArmClientRequestOptions,
  discardBody,
  AsyncOperation,
  extractAsyncOperation,
  paginateArm,
  pollArmOperation,
  PollArmOperationOptions,
  waitUntilGone,
} from './arm-http-client.js';

/**
 * @deprecated Use {@link HttpError} from `arm-http-client.js`. Kept for
 * existing imports and `instanceof` checks.
 */
export { HttpError as ApicHttpError } from './arm-http-client.js';

/** Pre-flight wording for API Center services. */
const APIC_PREFLIGHT_KIND: PreFlightServiceKind = {
  label: 'API Center service',
  instance: 'API Center service',
  roleTarget: 'the API Center resource',
};

export class ApicClient implements IApicClient {
  private readonly http: ArmHttpClient;

  /** Deadline for LRO polling — 10 minutes. */
  private static readonly ASYNC_POLL_TIMEOUT_MS = 10 * 60 * 1000;
  /** Default interval between LRO polls when no Retry-After header is present. */
  private static readonly ASYNC_POLL_INTERVAL_MS = 5000;
  /** API Center returns (rather than throws) a 404 for GET and DELETE. */
  private static readonly REQUEST_OPTIONS: ArmClientRequestOptions = {
    passthrough404Methods: ['GET', 'DELETE'],
  };

  /**
   * @param authScope OAuth2 scope for ARM token requests.
   *   Defaults to the Azure public cloud scope.
   * @param httpOptions Token credential and wait function for the shared ARM
   *   client. Default to `DefaultAzureCredential` and a `setTimeout` wait.
   */
  constructor(authScope?: string, httpOptions: Omit<ArmHttpClientOptions, 'authScope'> = {}) {
    this.http = new ArmHttpClient({ ...httpOptions, authScope, requestOptions: ApicClient.REQUEST_OPTIONS });
  }

  async *listResources(
    context: ApicServiceContext,
    type: ApicResourceType,
    parentNameParts: string[],
    workspace?: string,
  ): AsyncIterable<Record<string, unknown>> {
    // A missing collection (404) is an empty list, not a failure.
    yield* paginateArm(this.http, buildApicListUri(context, type, parentNameParts, workspace));
  }

  async getResource(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
  ): Promise<Record<string, unknown> | undefined> {
    const url = buildApicArmUri(context, descriptor);
    const response = await this.http.request(url, { method: 'GET' });
    if (response.status === 404) {
      await discardBody(response);
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
    const response = await this.http.request(url, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    // Poll any async-operation header, including updates that return 200 while
    // provisioning continues. A Location header on a 200 is not a polling URL.
    const operation = extractAsyncOperation(response, {
      includeLocation: response.status !== 200,
      armHosts: this.http.armHosts,
    });
    if (operation) {
      // The final state comes from polling, so the PUT body is not read.
      await discardBody(response);
      await this.pollAsyncOperation(operation, buildApicLabel(descriptor));
      const settled = await this.getResource(context, descriptor);
      return settled ?? {};
    }

    const text = await response.text();
    return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  async deleteResource(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
  ): Promise<boolean> {
    const url = buildApicArmUri(context, descriptor);
    const response = await this.http.request(url, { method: 'DELETE' });
    // Only the status and headers of a DELETE response are used.
    await discardBody(response);
    if (response.status === 404) {
      return false;
    }
    if (response.status === 202) {
      const operation = extractAsyncOperation(response, { armHosts: this.http.armHosts });
      if (operation) {
        await this.pollAsyncOperation(operation, buildApicLabel(descriptor), { treatMissingAsSuccess: true });
      } else {
        // Without a (valid) polling header, wait until the resource itself is
        // gone: one that is still returned keeps the wait going, whatever its
        // state or body, Failed included. The probe checks presence only.
        await waitUntilGone(() => this.resourceExists(context, descriptor), buildApicLabel(descriptor), {
          timeoutMs: ApicClient.ASYNC_POLL_TIMEOUT_MS,
          intervalMs: ApicClient.ASYNC_POLL_INTERVAL_MS,
          delay: (ms) => this.http.delay(ms),
        });
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
      response = await this.http.request(actionUrl, { method: 'POST' });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return undefined;
      }
      logger.warn(
        `Failed to export specification for ${buildApicLabel(descriptor)}: ${errorMessage(error)}`,
      );
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
      const blob = await this.http.request(body.value, {}, { skipAuth: true });
      if (!blob.ok) {
        await discardBody(blob);
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
    const response = await this.http.request(actionUrl, {
      method: 'POST',
      body: JSON.stringify({
        value: spec.content,
        format: 'inline',
        specification: { name: spec.name, ...(spec.version ? { version: spec.version } : {}) },
      }),
    });
    // Only the status and headers of the import response are used.
    await discardBody(response);

    if (response.status === 202) {
      const operation = extractAsyncOperation(response, { armHosts: this.http.armHosts });
      if (operation) {
        await this.pollAsyncOperation(operation, `${buildApicLabel(descriptor)} (spec import)`);
      }
    }
  }

  async validatePreFlight(context: ApicServiceContext): Promise<void> {
    await validateServicePreFlight(context, APIC_PREFLIGHT_KIND, (url) =>
      this.http.request(url, { method: 'GET' }),
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

  /**
   * GET the resource and report whether it exists: false on 404, true on any
   * other response the client returns. The body is released unread, so a
   * body that is not JSON still counts as present.
   */
  private async resourceExists(
    context: ApicServiceContext,
    descriptor: ApicResourceDescriptor,
  ): Promise<boolean> {
    const response = await this.http.request(buildApicArmUri(context, descriptor), { method: 'GET' });
    await discardBody(response);
    return response.status !== 404;
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

  /**
   * Poll an ARM long-running operation until it reaches a terminal state.
   * @param options `treatMissingAsSuccess` for delete operations.
   */
  private pollAsyncOperation(
    operation: AsyncOperation,
    label: string,
    options: Pick<PollArmOperationOptions, 'treatMissingAsSuccess'> = {},
  ): Promise<void> {
    return pollArmOperation(this.http, operation, label, {
      ...options,
      timeoutMs: ApicClient.ASYNC_POLL_TIMEOUT_MS,
      intervalMs: ApicClient.ASYNC_POLL_INTERVAL_MS,
    });
  }
}
