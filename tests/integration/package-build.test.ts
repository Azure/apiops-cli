// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const repoRoot = path.resolve('.');

type RootPackageJson = {
  main?: string;
  types?: string;
  bin?: string | Record<string, string>;
  readme?: string;
};

type PackDryRunEntry = {
  files: Array<{ path: string }>;
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

async function runNpm(args: string[]): Promise<string> {
  const result = await exec(npmCommand, args, {
    cwd: repoRoot,
    timeout: 180_000,
    env: { ...process.env, NODE_ENV: 'test' },
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
    const packedFilePaths = new Set(packEntries[0]?.files.map((file) => normalizePath(file.path)));

    expect(packEntries.length).toBeGreaterThan(0);
    expect(packedFilePaths.size).toBeGreaterThan(0);

    const requiredFiles = new Set<string>(['package.json']);

    if (packageJson.main) {
      requiredFiles.add(normalizePath(packageJson.main));
    }

    if (packageJson.types) {
      requiredFiles.add(normalizePath(packageJson.types));
    }

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
