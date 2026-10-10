// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Per-operation retry tracking.
 *
 * Callers wrap a unit of work (e.g. publishing a single resource) in
 * `trackRetries()`. HTTP retries performed anywhere inside that async call
 * chain are attributed to the enclosing scope via `recordRetry()`, even when
 * many operations run concurrently against a shared client.
 *
 * Work that targets one specific resource (e.g. a single client request) can
 * additionally wrap itself in `withRetryResource()` so retries are attributed
 * to that resource rather than to the whole scope. This matters when a task
 * publishes child resources (e.g. an API and its operations) and each result
 * must report the retries it actually incurred.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface RetryScope {
  count: number;
  byResource: Map<string, number>;
}

/** Retries recorded during one tracking scope. */
export interface RetryCounts {
  /** Total retries recorded in the scope. */
  total: number;
  /** Retries attributed to a specific resource key. */
  byResource: Map<string, number>;
}

const retryScopes = new AsyncLocalStorage<RetryScope>();
const retryResources = new AsyncLocalStorage<string>();

/**
 * Run `fn` inside a retry-tracking scope and return its value together with
 * the retries recorded while it executed.
 */
export async function trackRetries<T>(
  fn: () => Promise<T>
): Promise<{ value: T; retries: RetryCounts }> {
  const scope: RetryScope = { count: 0, byResource: new Map() };
  const value = await retryScopes.run(scope, fn);
  return { value, retries: { total: scope.count, byResource: scope.byResource } };
}

/**
 * Run `fn` with retries attributed to `resourceKey` within the active
 * tracking scope.
 */
export function withRetryResource<T>(resourceKey: string, fn: () => Promise<T>): Promise<T> {
  return retryResources.run(resourceKey, fn);
}

/**
 * Record a retry against the current tracking scope, and against the current
 * resource when one is active.
 * @returns true when a tracking scope is active (the retry will be reported
 *   by the caller of `trackRetries`), false otherwise.
 */
export function recordRetry(): boolean {
  const scope = retryScopes.getStore();
  if (!scope) {
    return false;
  }
  scope.count++;
  const resourceKey = retryResources.getStore();
  if (resourceKey !== undefined) {
    scope.byResource.set(resourceKey, (scope.byResource.get(resourceKey) ?? 0) + 1);
  }
  return true;
}
