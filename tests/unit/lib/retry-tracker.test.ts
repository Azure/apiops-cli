// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for retry tracking scopes
 */

import { describe, it, expect } from 'vitest';
import { recordRetry, trackRetries } from '../../../src/lib/retry-tracker.js';

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
    expect(retries).toBe(2);
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

    expect(a.retries).toBe(3);
    expect(b.retries).toBe(1);
  });
});
