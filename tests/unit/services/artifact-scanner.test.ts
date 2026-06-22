// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for ArtifactScanner
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { artifactScanner } from '../../../src/services/artifact-scanner.js';
import * as fs from 'fs/promises';
import type { Dirent, Stats } from 'node:fs';

vi.mock('fs/promises');

/** Helper to create a fake Dirent */
function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: '',
    path: '',
  } as unknown as Dirent;
}

function makeStats(isDir: boolean): Stats {
  return {
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as Stats;
}

describe('artifact-scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scan', () => {
    it('should return empty result when artifact directory does not exist', async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

      const result = await artifactScanner.scan('./nonexistent');

      expect(result.apis).toEqual([]);
      expect(result.namedValues).toEqual([]);
      expect(result.backends).toEqual([]);
      expect(result.loggers).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(result.products).toEqual([]);
    });

    it('should scan APIs from apis/ subdirectories', async () => {
      vi.mocked(fs.stat).mockImplementation(async (_p) => {
        return makeStats(true);
      });
      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        const dirStr = String(dir);
        if (dirStr.endsWith('/apis') || dirStr.endsWith('\\apis')) {
          return [makeDirent('echo-api', true), makeDirent('petstore-api', true)];
        }
        return [];
      });
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await artifactScanner.scan('./artifacts');

      expect(result.apis).toEqual([{ name: 'echo-api' }, { name: 'petstore-api' }]);
    });

    it('should exclude API revision subdirectories', async () => {
      vi.mocked(fs.stat).mockResolvedValue(makeStats(true));
      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        const dirStr = String(dir);
        if (dirStr.endsWith('/apis') || dirStr.endsWith('\\apis')) {
          return [
            makeDirent('echo-api', true),
            makeDirent('echo-api;rev=2', true),
            makeDirent('echo-api;rev=3', true),
          ];
        }
        return [];
      });
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await artifactScanner.scan('./artifacts');

      expect(result.apis).toEqual([{ name: 'echo-api' }]);
    });

    it('should identify secret named values', async () => {
      vi.mocked(fs.stat).mockResolvedValue(makeStats(true));
      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        const dirStr = String(dir);
        if (dirStr.endsWith('/namedValues') || dirStr.endsWith('\\namedValues')) {
          return [makeDirent('api-key', true), makeDirent('plain-value', true)];
        }
        return [];
      });
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const fp = String(filePath);
        if (fp.includes('api-key')) {
          return JSON.stringify({ name: 'api-key', properties: { secret: true } });
        }
        if (fp.includes('plain-value')) {
          return JSON.stringify({
            name: 'plain-value',
            properties: { secret: false, value: 'hello' },
          });
        }
        throw new Error('ENOENT');
      });

      const result = await artifactScanner.scan('./artifacts');

      expect(result.namedValues).toHaveLength(2);
      const secretNv = result.namedValues.find((nv) => nv.name === 'api-key');
      expect(secretNv?.isSecret).toBe(true);
      expect(secretNv?.currentValue).toBeUndefined();

      const plainNv = result.namedValues.find((nv) => nv.name === 'plain-value');
      expect(plainNv?.isSecret).toBe(false);
      expect(plainNv?.currentValue).toBe('hello');
    });

    it('should extract backend URLs', async () => {
      vi.mocked(fs.stat).mockResolvedValue(makeStats(true));
      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        const dirStr = String(dir);
        if (dirStr.endsWith('/backends') || dirStr.endsWith('\\backends')) {
          return [makeDirent('orders-backend', true)];
        }
        return [];
      });
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).includes('orders-backend')) {
          return JSON.stringify({
            name: 'orders-backend',
            properties: { url: 'https://orders.example.com' },
          });
        }
        throw new Error('ENOENT');
      });

      const result = await artifactScanner.scan('./artifacts');

      expect(result.backends).toHaveLength(1);
      expect(result.backends[0]).toEqual({
        name: 'orders-backend',
        url: 'https://orders.example.com',
      });
    });

    it('should handle missing info files gracefully', async () => {
      vi.mocked(fs.stat).mockResolvedValue(makeStats(true));
      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        const dirStr = String(dir);
        if (dirStr.endsWith('/namedValues') || dirStr.endsWith('\\namedValues')) {
          return [makeDirent('mystery-value', true)];
        }
        return [];
      });
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await artifactScanner.scan('./artifacts');

      expect(result.namedValues).toHaveLength(1);
      expect(result.namedValues[0]).toEqual({
        name: 'mystery-value',
        isSecret: false,
        currentValue: undefined,
      });
    });

    it('should scan products', async () => {
      vi.mocked(fs.stat).mockResolvedValue(makeStats(true));
      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        const dirStr = String(dir);
        if (dirStr.endsWith('/products') || dirStr.endsWith('\\products')) {
          return [makeDirent('starter', true), makeDirent('unlimited', true)];
        }
        return [];
      });
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await artifactScanner.scan('./artifacts');

      expect(result.products).toEqual([{ name: 'starter' }, { name: 'unlimited' }]);
    });
  });
});
