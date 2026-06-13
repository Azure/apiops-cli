// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for Interactive prompt handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promptService } from '../../../src/services/prompt-service.js';

// Mock readline at the top level
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

import * as readline from 'readline';

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

  describe('askCIProvider', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return github-actions when user chooses 1', async () => {
      const mockClose = vi.fn();
      const mockRl = {
        question: vi.fn((prompt: string, cb: (ans: string) => void) => {
          cb('1');
        }),
        close: mockClose,
      };
      (readline.createInterface as ReturnType<typeof vi.fn>).mockReturnValue(mockRl);

      const result = await promptService.askCIProvider();

      expect(result).toBe('github-actions');
      expect(mockClose).toHaveBeenCalled();
    });

    it('should return azure-devops when user chooses 2', async () => {
      const mockClose = vi.fn();
      const mockRl = {
        question: vi.fn((prompt: string, cb: (ans: string) => void) => {
          cb('2');
        }),
        close: mockClose,
      };
      (readline.createInterface as ReturnType<typeof vi.fn>).mockReturnValue(mockRl);

      const result = await promptService.askCIProvider();

      expect(result).toBe('azure-devops');
      expect(mockClose).toHaveBeenCalled();
    });

    it('should default to github-actions for invalid input', async () => {
      const mockClose = vi.fn();
      const mockRl = {
        question: vi.fn((prompt: string, cb: (ans: string) => void) => {
          cb('9');
        }),
        close: mockClose,
      };
      (readline.createInterface as ReturnType<typeof vi.fn>).mockReturnValue(mockRl);

      const result = await promptService.askCIProvider();

      expect(result).toBe('github-actions');
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('askArtifactDir', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return user-provided path', async () => {
      const mockClose = vi.fn();
      const mockRl = {
        question: vi.fn((prompt: string, cb: (ans: string) => void) => {
          cb('my-path');
        }),
        close: mockClose,
      };
      (readline.createInterface as ReturnType<typeof vi.fn>).mockReturnValue(mockRl);

      const result = await promptService.askArtifactDir('artifacts');

      expect(result).toBe('my-path');
      expect(mockClose).toHaveBeenCalled();
    });

    it('should return default when user enters empty string', async () => {
      const mockClose = vi.fn();
      const mockRl = {
        question: vi.fn((prompt: string, cb: (ans: string) => void) => {
          cb('');
        }),
        close: mockClose,
      };
      (readline.createInterface as ReturnType<typeof vi.fn>).mockReturnValue(mockRl);

      const result = await promptService.askArtifactDir('artifacts');

      expect(result).toBe('artifacts');
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('askEnvironments', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should parse comma-separated environments', async () => {
      const mockClose = vi.fn();
      const mockRl = {
        question: vi.fn((prompt: string, cb: (ans: string) => void) => {
          cb('dev,staging,prod');
        }),
        close: mockClose,
      };
      (readline.createInterface as ReturnType<typeof vi.fn>).mockReturnValue(mockRl);

      const result = await promptService.askEnvironments(['dev']);

      expect(result).toEqual(['dev', 'staging', 'prod']);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should return default when empty answer', async () => {
      const mockClose = vi.fn();
      const mockRl = {
        question: vi.fn((prompt: string, cb: (ans: string) => void) => {
          cb('');
        }),
        close: mockClose,
      };
      (readline.createInterface as ReturnType<typeof vi.fn>).mockReturnValue(mockRl);

      const result = await promptService.askEnvironments(['dev', 'prod']);

      expect(result).toEqual(['dev', 'prod']);
      expect(mockClose).toHaveBeenCalled();
    });

    it('should trim whitespace from environment names', async () => {
      const mockClose = vi.fn();
      const mockRl = {
        question: vi.fn((prompt: string, cb: (ans: string) => void) => {
          cb(' dev , prod ');
        }),
        close: mockClose,
      };
      (readline.createInterface as ReturnType<typeof vi.fn>).mockReturnValue(mockRl);

      const result = await promptService.askEnvironments(['test']);

      expect(result).toEqual(['dev', 'prod']);
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
