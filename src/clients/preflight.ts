// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Publish pre-flight checks shared by the APIM and API Center clients.
 *
 * Both clients confirm that the resource group and the target service exist
 * before publishing so that a wrong name fails fast with a clear message. The
 * resource group check only improves that message; publish itself needs no
 * access to the resource group, so a principal scoped to the service only
 * (no Reader on the resource group) skips it and the service check decides.
 */

import { logger } from '../lib/logger.js';
import { HttpError, discardBody } from './arm-http-client.js';

/** ARM api-version for the resource group GET. */
const RESOURCE_GROUP_API_VERSION = '2021-04-01';

/** The service fields the pre-flight check needs (APIM or API Center context). */
export interface PreFlightContext {
  readonly subscriptionId: string;
  readonly resourceGroup: string;
  readonly serviceName: string;
  readonly apiVersion: string;
  /** Fully-qualified service base URL (`https://<arm>/subscriptions/.../{name}`). */
  readonly baseUrl: string;
}

/** Wording that differs between the services, e.g. "APIM service" / "APIM instance". */
export interface PreFlightServiceKind {
  /** Service noun used in messages, e.g. `APIM service`. */
  readonly label: string;
  /** Instance noun used in "Ensure the ... exists", e.g. `APIM instance`. */
  readonly instance: string;
  /** Role assignment target named in permission errors, e.g. `the APIM resource`. */
  readonly roleTarget: string;
}

/**
 * Issue a GET and return the response. Must return 404 responses and throw
 * an {@link HttpError} for other non-2xx responses.
 */
export type PreFlightGet = (url: string) => Promise<Response>;

/**
 * Check that the resource group and service exist.
 *
 * A 403 on the resource group read skips that check (logged at debug); the
 * service check still runs, and its 404 message then also names the
 * subscription and resource group as possibly wrong.
 */
export async function validateServicePreFlight(
  context: PreFlightContext,
  kind: PreFlightServiceKind,
  get: PreFlightGet
): Promise<void> {
  const armEndpoint = new URL(context.baseUrl).origin;
  const rgUrl =
    `${armEndpoint}/subscriptions/${encodeURIComponent(context.subscriptionId)}` +
    `/resourceGroups/${encodeURIComponent(context.resourceGroup)}` +
    `?api-version=${RESOURCE_GROUP_API_VERSION}`;
  let rgResponse: Response | undefined;
  try {
    rgResponse = await get(rgUrl);
    // Only the status is used.
    await discardBody(rgResponse);
  } catch (error) {
    if (getHttpStatus(error) === 403) {
      logger.debug(
        `No permission to read resource group '${context.resourceGroup}' (HTTP 403) — ` +
        `skipping resource group pre-flight check and checking the ${kind.label} directly.`
      );
    } else {
      throwPreFlightHttpError(error, `resource group '${context.resourceGroup}'`, 'the subscription or resource group');
    }
  }
  if (rgResponse?.status === 404) {
    throw new Error(
      `Resource group '${context.resourceGroup}' not found in subscription '${context.subscriptionId}'. ` +
      `Ensure the resource group exists before publishing.`
    );
  }

  const serviceLabel = `${kind.label} '${context.serviceName}'`;
  let serviceResponse: Response;
  try {
    serviceResponse = await get(`${context.baseUrl}?api-version=${context.apiVersion}`);
  } catch (error) {
    throwPreFlightHttpError(error, serviceLabel, kind.roleTarget);
  }
  // Only the status is used.
  await discardBody(serviceResponse);
  if (serviceResponse.status === 404) {
    if (!rgResponse) {
      // The resource group check was skipped, so a 404 here can also mean
      // the resource group (or subscription) is wrong.
      throw new Error(
        `${serviceLabel} not found in resource group '${context.resourceGroup}' ` +
        `of subscription '${context.subscriptionId}'. ` +
        `Ensure the subscription, resource group and ${kind.label} name are correct and that the ${kind.instance} exists before publishing.`
      );
    }
    throw new Error(
      `${serviceLabel} not found in resource group '${context.resourceGroup}'. ` +
      `Ensure the ${kind.instance} exists before publishing.`
    );
  }
}

/**
 * Rethrows HTTP 401/403 errors from pre-flight checks as actionable errors.
 * Non-HTTP errors and other status codes are re-thrown unchanged.
 */
function throwPreFlightHttpError(error: unknown, resourceLabel: string, roleTarget: string): never {
  const status = getHttpStatus(error);
  if (status === 403) {
    throw new Error(
      `Insufficient permissions to read ${resourceLabel}. ` +
      `Ensure the service principal has at least Reader role on ${roleTarget}.`,
      { cause: error }
    );
  }
  if (status === 401) {
    throw new Error(
      `Authentication failed when checking ${resourceLabel}. ` +
      `Verify that credentials are valid and the correct tenant/subscription is targeted.`,
      { cause: error }
    );
  }
  throw error;
}

/** Status code of an {@link HttpError} (thrown by both clients), else undefined. */
function getHttpStatus(error: unknown): number | undefined {
  return error instanceof HttpError ? error.status : undefined;
}
