// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/// <reference types="node" />

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentFileDir, '../../..');

type RootPackageJson = {
  bin?: string | Record<string, string>;
  readme?: string;
};

type PackDryRunEntry = {
  files: Array<{ path: string }>;
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function runNpm(args: string[]): Promise<string> {
  const result = await exec(npmCommand, args, {
    cwd: repoRoot,
    timeout: 90_000,
    env: process.env,
  });

  return result.stdout;
}

describe('package build integration', () => {
  it('should build and include required files in packed output', async () => {
    const packageJsonPath = path.join(repoRoot, 'package.json');
    const packageJsonRaw = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonRaw) as RootPackageJson;

    await runNpm(['run', 'build']);

    const packOutput = await runNpm(['pack', '--json', '--dry-run']);
    const packEntries = JSON.parse(packOutput) as PackDryRunEntry[];

    expect(packEntries.length).toBeGreaterThan(0);
    const firstEntry = packEntries[0];
    const packedFilePaths = new Set(firstEntry.files.map((file) => normalizePath(file.path)));
    expect(packedFilePaths.size).toBeGreaterThan(0);

    const requiredFiles = new Set<string>(['package.json']);

    if (typeof packageJson.bin === 'string') {
      requiredFiles.add(normalizePath(packageJson.bin));
    } else if (packageJson.bin) {
      Object.values(packageJson.bin).forEach((binPath) => requiredFiles.add(normalizePath(binPath)));
    }

    if (packageJson.readme) {
      requiredFiles.add(normalizePath(packageJson.readme));
    }

    requiredFiles.forEach((requiredFile) => {
      expect(packedFilePaths.has(requiredFile), `${requiredFile} should be included in npm package`).toBe(true);
    });

    const distFiles = [...packedFilePaths].filter((filePath) => filePath.startsWith('dist/'));
    expect(distFiles.length).toBeGreaterThan(0);
  }, 240_000);
});
