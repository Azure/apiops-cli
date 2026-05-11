import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const exec = promisify(execFile);
const cliPath = path.resolve('src/cli/index.ts');

/** Run CLI via node --import tsx and capture stdout/stderr. */
async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec(process.execPath, ['--import', 'tsx', cliPath, ...args], {
      timeout: 15000,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

async function getPackageVersion(): Promise<string> {
  const pkg = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf-8')) as { version: string };
  return pkg.version;
}

describe('CLI entry point', () => {
  it('should display version with --version', async () => {
    const [result, expectedVersion] = await Promise.all([runCli(['--version']), getPackageVersion()]);
    expect(result.stdout.trim()).toBe(expectedVersion);
    expect(result.exitCode).toBe(0);
  }, 15_000);

  it('should display help with --help', async () => {
    const result = await runCli(['--help']);
    expect(result.stdout).toContain('apiops');
    expect(result.stdout).toContain('--log-level');
    expect(result.stdout).toContain('--format');
    expect(result.stdout).toContain('--cloud');
    expect(result.stdout).toContain('--otel');
    expect(result.exitCode).toBe(0);
  });

  it('should accept --log-level flag without error', async () => {
    const result = await runCli(['--log-level', 'debug', '--help']);
    expect(result.exitCode).toBe(0);
  });

  it('should report error for unknown commands', async () => {
    const result = await runCli(['nonexistent-command']);
    expect(result.stderr).toContain('Unknown command');
    expect(result.exitCode).toBe(1);
  });

  it('should default --format to text', async () => {
    const result = await runCli(['--help']);
    expect(result.stdout).toContain('text');
  });

  it('should default --cloud to public', async () => {
    const result = await runCli(['--help']);
    expect(result.stdout).toContain('public');
  });

  it('should show global options in extract subcommand help', async () => {
    const result = await runCli(['extract', '--help']);
    expect(result.stdout).toContain('--subscription-id');
    expect(result.stdout).toContain('--log-level');
    expect(result.stdout).toContain('--format');
    expect(result.stdout).toContain('--cloud');
    expect(result.exitCode).toBe(0);
  });

  describe('auth flags', () => {
    it('should include --client-id, --client-secret, --tenant-id in --help output', async () => {
      const result = await runCli(['--help']);
      expect(result.stdout).toContain('--client-id');
      expect(result.stdout).toContain('--client-secret');
      expect(result.stdout).toContain('--tenant-id');
      expect(result.exitCode).toBe(0);
    });

    it('should show auth flags in extract subcommand help', async () => {
      const result = await runCli(['extract', '--help']);
      expect(result.stdout).toContain('--client-id');
      expect(result.stdout).toContain('--client-secret');
      expect(result.stdout).toContain('--tenant-id');
      expect(result.exitCode).toBe(0);
    });

    it('should show auth flags in publish subcommand help', async () => {
      const result = await runCli(['publish', '--help']);
      expect(result.stdout).toContain('--client-id');
      expect(result.stdout).toContain('--client-secret');
      expect(result.stdout).toContain('--tenant-id');
      expect(result.exitCode).toBe(0);
    });
  });
});
