/**
 * Unit tests for T-CMP-04: compare-differ.ts
 */

import { describe, it, expect } from 'vitest';
import {
  diffNormalizedResources,
  compareResourceMaps,
} from '../../../src/lib/compare-differ.js';

// ── diffNormalizedResources ───────────────────────────────────────────────────

describe('diffNormalizedResources', () => {
  it('returns empty array for identical objects', () => {
    const obj = { a: 1, b: 'hello', c: true };
    expect(diffNormalizedResources(obj, obj)).toHaveLength(0);
  });

  it('returns empty array for equal-by-value objects', () => {
    expect(diffNormalizedResources({ a: 1 }, { a: 1 })).toHaveLength(0);
  });

  it('detects missing key in target', () => {
    const src = { a: 1, b: 2 };
    const tgt = { a: 1 };
    const diffs = diffNormalizedResources(src, tgt);
    expect(diffs.some((d) => d.includes('MISSING') && d.includes('b'))).toBe(true);
  });

  it('detects extra key in target', () => {
    const src = { a: 1 };
    const tgt = { a: 1, b: 2 };
    const diffs = diffNormalizedResources(src, tgt);
    expect(diffs.some((d) => d.includes('EXTRA') && d.includes('b'))).toBe(true);
  });

  it('detects value mismatch for primitive', () => {
    const src = { a: 'hello' };
    const tgt = { a: 'world' };
    const diffs = diffNormalizedResources(src, tgt);
    expect(diffs.some((d) => d.includes('DIFF') && d.includes('a'))).toBe(true);
  });

  it('recurses into nested objects for fine-grained diffs', () => {
    const src = { properties: { displayName: 'Source', description: 'Same' } };
    const tgt = { properties: { displayName: 'Target', description: 'Same' } };
    const diffs = diffNormalizedResources(src, tgt);
    // Should find diff at properties.displayName, not just 'properties'
    expect(diffs.some((d) => d.includes('properties.displayName'))).toBe(true);
    // Should NOT report a diff at properties level only
    expect(diffs.some((d) => d.includes('DIFF at properties\n'))).toBe(false);
  });

  it('uses dot notation for nested paths', () => {
    const src = { a: { b: { c: 1 } } };
    const tgt = { a: { b: { c: 2 } } };
    const diffs = diffNormalizedResources(src, tgt);
    expect(diffs.some((d) => d.includes('a.b.c'))).toBe(true);
  });

  it('falls back to full JSON diff for arrays', () => {
    const src = ['a', 'b'];
    const tgt = ['a', 'c'];
    const diffs = diffNormalizedResources(src, tgt);
    expect(diffs.length).toBeGreaterThan(0);
  });

  it('truncates long values in diff output', () => {
    const longStr = 'x'.repeat(200);
    const src = { a: longStr + 'source' };
    const tgt = { a: longStr + 'target' };
    const diffs = diffNormalizedResources(src, tgt);
    // Should truncate — value display limit is 120 chars
    expect(diffs.some((d) => d.includes('...'))).toBe(true);
  });

  it('includes path prefix when path is provided', () => {
    const src = { x: 1 };
    const tgt = { x: 2 };
    const diffs = diffNormalizedResources(src, tgt, 'properties');
    expect(diffs.some((d) => d.includes('properties.x'))).toBe(true);
  });

  it('handles null values', () => {
    expect(diffNormalizedResources(null, null)).toHaveLength(0);
    const diffs = diffNormalizedResources({ a: null }, { a: 'value' });
    expect(diffs.length).toBeGreaterThan(0);
  });
});

// ── compareResourceMaps ───────────────────────────────────────────────────────

describe('compareResourceMaps', () => {
  function makeMap(entries: Array<[string, Record<string, unknown>]>): Map<string, Record<string, unknown>> {
    return new Map(entries);
  }

  it('returns no diffs for identical maps', () => {
    const resource = { properties: { displayName: 'API' } };
    const src = makeMap([['petstore', resource]]);
    const tgt = makeMap([['petstore', resource]]);
    const { diffs, compared } = compareResourceMaps(src, tgt);
    expect(diffs).toHaveLength(0);
    expect(compared).toBe(1);
  });

  it('detects resource missing in target', () => {
    const src = makeMap([['petstore', {}]]);
    const tgt = makeMap([]);
    const { diffs } = compareResourceMaps(src, tgt);
    expect(diffs.some((d) => d.name === 'petstore')).toBe(true);
    expect(diffs.some((d) => d.diffs.some((line) => line.includes('MISSING')))).toBe(true);
  });

  it('detects resource extra in target', () => {
    const src = makeMap([]);
    const tgt = makeMap([['petstore', {}]]);
    const { diffs } = compareResourceMaps(src, tgt);
    expect(diffs.some((d) => d.name === 'petstore')).toBe(true);
    expect(diffs.some((d) => d.diffs.some((line) => line.includes('EXTRA')))).toBe(true);
  });

  it('detects content diff for matched resource', () => {
    const src = makeMap([['petstore', { properties: { displayName: 'Source' } }]]);
    const tgt = makeMap([['petstore', { properties: { displayName: 'Target' } }]]);
    const { diffs, compared } = compareResourceMaps(src, tgt);
    expect(compared).toBe(1);
    expect(diffs.some((d) => d.name === 'petstore')).toBe(true);
  });

  it('strips .properties.value when skipSecretValue=true for secret named values', () => {
    const src = makeMap([[
      'mySecret',
      { properties: { secret: true, value: 'src-secret', displayName: 'My Secret' } },
    ]]);
    const tgt = makeMap([[
      'mySecret',
      { properties: { secret: true, value: 'tgt-secret', displayName: 'My Secret' } },
    ]]);
    const { diffs } = compareResourceMaps(src, tgt, /* skipSecretValue */ true);
    // value is different but should be stripped → no diff
    expect(diffs).toHaveLength(0);
  });

  it('does NOT strip .properties.value for non-secret named values', () => {
    const src = makeMap([['myNv', { properties: { secret: false, value: 'src-val' } }]]);
    const tgt = makeMap([['myNv', { properties: { secret: false, value: 'tgt-val' } }]]);
    const { diffs } = compareResourceMaps(src, tgt, /* skipSecretValue */ true);
    // secret is false → value is NOT stripped → diff found
    expect(diffs.length).toBeGreaterThan(0);
  });

  it('strips .properties.credentials for EventHub loggers when skipLoggerCredentials=true', () => {
    const src = makeMap([[
      'myLogger',
      {
        properties: {
          loggerType: 'azureEventHub',
          credentials: { connectionString: 'Endpoint=sb://src-ns.servicebus.windows.net/' },
          description: 'Same',
        },
      },
    ]]);
    const tgt = makeMap([[
      'myLogger',
      {
        properties: {
          loggerType: 'azureEventHub',
          credentials: { connectionString: 'Endpoint=sb://tgt-ns.servicebus.windows.net/' },
          description: 'Same',
        },
      },
    ]]);
    const { diffs } = compareResourceMaps(src, tgt, false, /* skipLoggerCreds */ true);
    expect(diffs).toHaveLength(0);
  });

  it('strips .properties.credentials for AppInsights loggers when skipLoggerCredentials=true', () => {
    const src = makeMap([[
      'myLogger',
      {
        properties: {
          loggerType: 'applicationInsights',
          credentials: { instrumentationKey: 'src-key' },
        },
      },
    ]]);
    const tgt = makeMap([[
      'myLogger',
      {
        properties: {
          loggerType: 'applicationInsights',
          credentials: { instrumentationKey: 'tgt-key' },
        },
      },
    ]]);
    const { diffs } = compareResourceMaps(src, tgt, false, true);
    expect(diffs).toHaveLength(0);
  });

  it('does NOT strip credentials for non-EventHub/AppInsights loggers', () => {
    const src = makeMap([[
      'myLogger',
      { properties: { loggerType: 'azureMonitor', credentials: { key: 'src-key' } } },
    ]]);
    const tgt = makeMap([[
      'myLogger',
      { properties: { loggerType: 'azureMonitor', credentials: { key: 'tgt-key' } } },
    ]]);
    const { diffs } = compareResourceMaps(src, tgt, false, true);
    // azureMonitor is NOT in the skip list → credentials compared → diff found
    expect(diffs.length).toBeGreaterThan(0);
  });

  it('returns zero compared for empty maps', () => {
    const { diffs, compared } = compareResourceMaps(new Map(), new Map());
    expect(diffs).toHaveLength(0);
    expect(compared).toBe(0);
  });
});
