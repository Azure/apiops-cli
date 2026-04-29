/**
 * Unit tests for USER_AGENT constant
 */

import { describe, it, expect } from 'vitest';
import { USER_AGENT } from '../../../src/lib/user-agent.js';

describe('USER_AGENT', () => {
  it('should be a string', () => {
    expect(typeof USER_AGENT).toBe('string');
  });

  it('should start with "apiops-cli/"', () => {
    expect(USER_AGENT).toMatch(/^apiops-cli\//);
  });

  it('should contain a semver-like version', () => {
    expect(USER_AGENT).toMatch(/\d+\.\d+\.\d+/);
  });
});
