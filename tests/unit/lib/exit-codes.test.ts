/**
 * Unit tests for exit-codes module (T041).
 */

import { describe, it, expect } from 'vitest';
import {
  EXIT_SUCCESS,
  EXIT_PARTIAL,
  EXIT_FATAL,
  aggregateExitCode,
  type ResourceResult,
} from '../../../src/lib/exit-codes.js';

describe('exit code constants', () => {
  it('EXIT_SUCCESS should be 0', () => {
    expect(EXIT_SUCCESS).toBe(0);
  });

  it('EXIT_PARTIAL should be 1', () => {
    expect(EXIT_PARTIAL).toBe(1);
  });

  it('EXIT_FATAL should be 2', () => {
    expect(EXIT_FATAL).toBe(2);
  });

  it('all exit codes should be distinct', () => {
    const codes = new Set([EXIT_SUCCESS, EXIT_PARTIAL, EXIT_FATAL]);
    expect(codes.size).toBe(3);
  });
});

describe('aggregateExitCode', () => {
  it('should return EXIT_SUCCESS for empty results', () => {
    expect(aggregateExitCode([])).toBe(EXIT_SUCCESS);
  });

  it('should return EXIT_SUCCESS when all succeed', () => {
    const results: ResourceResult[] = [
      { status: 'success' },
      { status: 'success' },
      { status: 'success' },
    ];
    expect(aggregateExitCode(results)).toBe(EXIT_SUCCESS);
  });

  it('should return EXIT_PARTIAL when some fail and some succeed', () => {
    const results: ResourceResult[] = [
      { status: 'success' },
      { status: 'error', error: new Error('fail') },
      { status: 'success' },
    ];
    expect(aggregateExitCode(results)).toBe(EXIT_PARTIAL);
  });

  it('should return EXIT_FATAL when all fail', () => {
    const results: ResourceResult[] = [
      { status: 'error', error: new Error('fail 1') },
      { status: 'error', error: new Error('fail 2') },
    ];
    expect(aggregateExitCode(results)).toBe(EXIT_FATAL);
  });

  it('should return EXIT_PARTIAL with one success among many errors', () => {
    const results: ResourceResult[] = [
      { status: 'error', error: new Error('fail') },
      { status: 'error', error: new Error('fail') },
      { status: 'success' },
      { status: 'error', error: new Error('fail') },
    ];
    expect(aggregateExitCode(results)).toBe(EXIT_PARTIAL);
  });

  it('should return EXIT_FATAL with single error result', () => {
    const results: ResourceResult[] = [
      { status: 'error', error: new Error('fatal') },
    ];
    expect(aggregateExitCode(results)).toBe(EXIT_FATAL);
  });

  it('should return EXIT_SUCCESS with single success result', () => {
    const results: ResourceResult[] = [{ status: 'success' }];
    expect(aggregateExitCode(results)).toBe(EXIT_SUCCESS);
  });

  it('should return EXIT_PARTIAL with many successes and one error', () => {
    const results: ResourceResult[] = [
      { status: 'success' },
      { status: 'success' },
      { status: 'success' },
      { status: 'error', error: new Error('one bad apple') },
    ];
    expect(aggregateExitCode(results)).toBe(EXIT_PARTIAL);
  });

  it('should handle results without optional error field', () => {
    const errorNoDetail: ResourceResult = { status: 'error' };
    expect(aggregateExitCode([errorNoDetail])).toBe(EXIT_FATAL);
    expect(aggregateExitCode([{ status: 'success' }, errorNoDetail])).toBe(EXIT_PARTIAL);
  });
});
