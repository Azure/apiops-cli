// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for the named value reference rules
 */

import { describe, it, expect } from 'vitest';
import { NamedValueNames, namedValueNamesByScope } from '../../../src/services/named-value-names.js';

describe('NamedValueNames', () => {
  it('should match a reference by display name, ignoring case', () => {
    const names = new NamedValueNames([{ name: 'nv-1', displayName: 'Backend_Id' }]);
    expect(names.resolve('backend_id')).toBe('nv-1');
  });

  it('should not match a resource name, as APIM does not', () => {
    const names = new NamedValueNames([{ name: 'nv-1', displayName: 'Something' }]);
    expect(names.resolve('nv-1')).toBeUndefined();
  });

  it("should match another named value's display name, not a resource name", () => {
    const names = new NamedValueNames([
      { name: 'one', displayName: 'two' },
      { name: 'two', displayName: 'three' },
    ]);
    expect(names.resolve('two')).toBe('one');
    expect(names.resolve('three')).toBe('two');
  });

  it('should match a source display name an override changes, with published display names winning', () => {
    const names = new NamedValueNames([
      { name: 'key', displayName: 'prod-key', sourceDisplayName: 'key' },
      { name: 'other', displayName: 'key', sourceDisplayName: 'other' },
    ]);
    expect(names.resolve('prod-key')).toBe('key');
    expect(names.resolve('key')).toBe('other');
    expect(names.resolve('other')).toBe('other');
  });

  it('should not match a named value whose display name is unknown', () => {
    const names = new NamedValueNames([{ name: 'unread' }]);
    expect(names.resolve('unread')).toBeUndefined();
  });
});

describe('namedValueNamesByScope', () => {
  it('should match a reference only among the named values of its own scope', () => {
    const names = namedValueNamesByScope([
      { name: 'service-nv', displayName: 'key' },
      { name: 'team-nv', displayName: 'key', workspace: 'Team-A' },
    ]);
    expect(names(undefined).resolve('key')).toBe('service-nv');
    expect(names('team-a').resolve('key')).toBe('team-nv');
    expect(names('team-b').resolve('key')).toBeUndefined();
  });
});
