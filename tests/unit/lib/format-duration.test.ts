// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for formatDuration
 */

import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../../src/lib/format-duration.js';

describe('formatDuration', () => {
  it.each([
    [0, '0.0s'],
    [49, '0.0s'],
    [1175.1730686888397, '1.2s'],
    [12_345, '12.3s'],
    [59_949, '59.9s'],
    [59_950, '1m 0.0s'],
    [125_000, '2m 5.0s'],
    [-5, '0.0s'],
    [Number.NaN, '0.0s'],
  ])('formats %s ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
