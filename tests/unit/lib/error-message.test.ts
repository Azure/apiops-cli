// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for errorMessage
 */

import { describe, it, expect } from 'vitest';
import { errorCauses, errorMessage } from '../../../src/lib/error-message.js';

describe('errorMessage', () => {
  it('should return the message of an Error', () => {
    expect(errorMessage(new TypeError('fetch failed'))).toBe('fetch failed');
  });

  it('should add the messages of the errors it was caused by', () => {
    const error = new TypeError('fetch failed', {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:8080', { cause: new Error('socket closed') }),
    });

    expect(errorMessage(error)).toBe('fetch failed (connect ECONNREFUSED 127.0.0.1:8080: socket closed)');
  });

  it('should leave out a cause the message already says, and stop at a cycle', () => {
    const error = new Error('HTTP 400: bad', { cause: new Error('bad') });
    const cyclic = new Error('outer');
    cyclic.cause = cyclic;

    expect(errorMessage(error)).toBe('HTTP 400: bad');
    expect(errorMessage(cyclic)).toBe('outer');
  });

  it('should follow a long chain of causes and stop at a cycle further down', () => {
    const deepest = new Error('level 7');
    let error = deepest;
    for (let level = 6; level >= 1; level--) {
      error = new Error(`level ${level}`, { cause: error });
    }
    const top = new Error('top', { cause: error });
    deepest.cause = error;

    expect(errorMessage(top)).toBe('top (level 1: level 2: level 3: level 4: level 5: level 6: level 7)');
    expect([...errorCauses(top)].map((cause) => cause.message)).toHaveLength(7);
  });

  it.each([
    ['a string', 'boom', 'boom'],
    ['an object', { code: 'x' }, '[object Object]'],
  ])('should convert %s to a string', (_label, value, expected) => {
    expect(errorMessage(value)).toBe(expected);
  });
});
