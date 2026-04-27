/**
 * Unit tests for T049: Interactive prompt handler
 */

import { describe, it, expect } from 'vitest';
import { promptService } from '../../../src/services/prompt-service.js';

describe('prompt-service', () => {
  describe('isTTY', () => {
    it('should return true when both stdin and stdout are TTY', () => {
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;

      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      expect(promptService.isTTY()).toBe(true);

      // Restore
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    });

    it('should return false when stdin is not TTY', () => {
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;

      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      expect(promptService.isTTY()).toBe(false);

      // Restore
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    });

    it('should return false when stdout is not TTY', () => {
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;

      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      expect(promptService.isTTY()).toBe(false);

      // Restore
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    });

    it('should return false when neither is TTY', () => {
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;

      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      expect(promptService.isTTY()).toBe(false);

      // Restore
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    });
  });

  // Note: Testing actual readline interactions requires mocking stdin/stdout
  // which is complex in unit tests. These methods are better tested in integration tests.
  // We can still test the logic of parsing responses.

  describe('method contracts', () => {
    it('should have askCIProvider method', () => {
      expect(typeof promptService.askCIProvider).toBe('function');
    });

    it('should have askArtifactDir method', () => {
      expect(typeof promptService.askArtifactDir).toBe('function');
    });

    it('should have askEnvironments method', () => {
      expect(typeof promptService.askEnvironments).toBe('function');
    });
  });
});
