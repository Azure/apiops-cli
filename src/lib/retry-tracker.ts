// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Per-operation retry tracking.
 *
 * Callers wrap a unit of work (e.g. publishing a single resource) in
 * `trackRetries()`. HTTP retries performed anywhere inside that async call
 * chain are attributed to the enclosing scope via `recordRetry()`, even when
 * many operations run concurrently against a shared client.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface RetryScope {
  count: number;
}

const retryScopes = new AsyncLocalStorage<RetryScope>();

/**
 * Run `fn` inside a retry-tracking scope and return its value together with
 * the number of retries recorded while it executed.
 */
export async function trackRetries<T>(fn: () => Promise<T>): Promise<{ value: T; retries: number }> {
  const scope: RetryScope = { count: 0 };
  const value = await retryScopes.run(scope, fn);
  return { value, retries: scope.count };
}

/**
 * Record a retry against the current tracking scope.
 * @returns true when a tracking scope is active (the retry will be reported
 *   by the caller of `trackRetries`), false otherwise.
 */
export function recordRetry(): boolean {
  const scope = retryScopes.getStore();
  if (!scope) {
    return false;
  }
  scope.count++;
  return true;
}
