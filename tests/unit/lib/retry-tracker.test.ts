// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for retry tracking scopes
 */

import { describe, it, expect } from 'vitest';
import { recordRetry, trackRetries, withRetryResource } from '../../../src/lib/retry-tracker.js';

describe('retry-tracker', () => {
  it('returns false when no tracking scope is active', () => {
    expect(recordRetry()).toBe(false);
  });

  it('counts retries recorded within the scope', async () => {
    const { value, retries } = await trackRetries(async () => {
      expect(recordRetry()).toBe(true);
      await Promise.resolve();
      recordRetry();
      return 'done';
    });

    expect(value).toBe('done');
    expect(retries.total).toBe(2);
  });

  it('attributes retries to the correct scope under concurrency', async () => {
    const work = (count: number, delayMs: number) =>
      trackRetries(async () => {
        for (let i = 0; i < count; i++) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          recordRetry();
        }
      });

    const [a, b] = await Promise.all([work(3, 1), work(1, 2)]);

    expect(a.retries.total).toBe(3);
    expect(b.retries.total).toBe(1);
  });

  it('attributes retries to the resource scope that recorded them', async () => {
    const { retries } = await trackRetries(async () => {
      await withRetryResource('api:child-a', async () => {
        recordRetry();
        recordRetry();
      });
      await withRetryResource('api:child-b', async () => {
        recordRetry();
      });
      recordRetry();
    });

    expect(retries.total).toBe(4);
    expect(retries.byResource.get('api:child-a')).toBe(2);
    expect(retries.byResource.get('api:child-b')).toBe(1);
  });
});
