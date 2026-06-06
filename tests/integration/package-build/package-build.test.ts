// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/// <reference types="node" />

import { exec as execCb } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execCb);
const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentFileDir, '../../..');

type RootPackageJson = {
  bin?: string | Record<string, string>;
  readme?: string;
};

type PackDryRunEntry = {
  files: Array<{ path: string }>;
};

type PackEntry = {
  files: Array<{ path: string }>;
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function runNpm(args: string[]): Promise<string> {
  // Use 'npm' with shell so .cmd resolution works on Windows and
  // plain 'npm' works on Linux/macOS.  Pass args as a single joined string
  // to avoid the Node.js v24 DEP0190 deprecation warning about passing
  // array args with shell option.
  const command = `npm ${args.join(' ')}`;
  const result = await exec(command, {
    cwd: repoRoot,
    timeout: 90_000,
  });

  return result.stdout;
}

async function collectMarkdownFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return collectMarkdownFiles(fullPath);
    }
    return entry.name.endsWith('.md') ? [fullPath] : [];
  }));

  return nested.flat();
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

  it('should include all src/templates markdown files in packed output via embedded template constants', async () => {
    await runNpm(['run', 'build']);

    const templateRoot = path.join(repoRoot, 'src/templates');
    const markdownFiles = await collectMarkdownFiles(templateRoot);
    expect(markdownFiles.length).toBeGreaterThan(0);

    const expectedTemplateContents = await Promise.all(markdownFiles.map(async (filePath) => {
      const relPath = normalizePath(path.relative(templateRoot, filePath));
      const content = await fs.readFile(filePath, 'utf8');
      return { relPath, content };
    }));

    const packDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apiops-pack-'));

    try {
      const packOutput = await runNpm([
        'pack',
        '--json',
        '--pack-destination',
        packDir,
      ]);
      const packEntries = JSON.parse(packOutput) as PackEntry[];
      expect(packEntries.length).toBeGreaterThan(0);

      const firstEntry = packEntries[0];
      const packedFilePaths = new Set(
        firstEntry.files.map((file) => normalizePath(file.path))
      );

      expect(
        packedFilePaths.has('dist/templates/generated/embedded-markdown.js'),
        'dist/templates/generated/embedded-markdown.js should be present in npm pack output'
      ).toBe(true);

      const embeddedMarkdownPath = path.join(
        repoRoot,
        'dist/templates/generated/embedded-markdown.js'
      );
      const embeddedMarkdownSource = await fs.readFile(embeddedMarkdownPath, 'utf8');

      expectedTemplateContents.forEach(({ relPath, content }) => {
        expect(
          embeddedMarkdownSource.includes(JSON.stringify(content)),
          `${relPath} should be embedded in dist/templates/generated/embedded-markdown.js`
        ).toBe(true);
      });
    } finally {
      await fs.rm(packDir, { recursive: true, force: true });
    }
  }, 300_000);
});
