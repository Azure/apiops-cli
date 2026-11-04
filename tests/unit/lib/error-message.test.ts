// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for errorMessage
 */

import { describe, it, expect } from 'vitest';
import { errorMessage } from '../../../src/lib/error-message.js';

describe('errorMessage', () => {
  it('should return the message of an Error', () => {
    expect(errorMessage(new TypeError('fetch failed'))).toBe('fetch failed');
  });

  it.each([
    ['a string', 'boom', 'boom'],
    ['an object', { code: 'x' }, '[object Object]'],
  ])('should convert %s to a string', (_label, value, expected) => {
    expect(errorMessage(value)).toBe(expected);
  });
});
