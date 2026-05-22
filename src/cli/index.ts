#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * T019: Commander program entry point
 * Sets up global options and subcommand registration pattern
 */

import { Command, Option } from 'commander';
import { logger, parseLogLevel } from '../lib/logger.js';
import { createExtractCommand } from './extract-command.js';
import { createPublishCommand } from './publish-command.js';
import { createInitCommand } from './init-command.js';
import { createCompareCommand } from './compare-command.js';
import packageJson from '../../package.json' with { type: 'json' };

const program = new Command();

// Configure program metadata
program
  .name('apiops')
  .version(packageJson.version)
  .description('CLI tool for Azure API Management configuration-as-code');

// Show global options in subcommand help (e.g. apiops extract --help)
program.configureHelp({ showGlobalOptions: true });

// Global options inherited by all subcommands
program
  .addOption(
    new Option('--log-level <level>', 'Log level: debug, info, warn, or error')
      .choices(['debug', 'info', 'warn', 'error'])
      .default('info'),
  )
  .option('--otel <path>', 'Path to OpenTelemetry config YAML')
  .option('--format <type>', 'Output format: text or json', 'text')
  .option('--cloud <name>', 'Sovereign cloud: public, china, usgov, germany', 'public')
  .option('--client-id <id>', 'Service principal client ID')
  .option('--client-secret <secret>', 'Service principal client secret')
  .option('--tenant-id <id>', 'Azure AD tenant ID');

// Configure logger and set auth environment variables before each command
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.optsWithGlobals<{
    logLevel?: string;
    clientId?: string;
    clientSecret?: string;
    tenantId?: string;
  }>();

  logger.configure({ level: parseLogLevel(opts.logLevel ?? 'info') });

  // T040: Set DefaultAzureCredential env vars from explicit auth flags.
  // This ensures the ServicePrincipal credential is tried first,
  // avoiding interactive browser prompts in CI/CD pipelines.
  if (opts.clientId) {
    process.env.AZURE_CLIENT_ID = opts.clientId;
  }
  if (opts.clientSecret) {
    process.env.AZURE_CLIENT_SECRET = opts.clientSecret;
  }
  if (opts.tenantId) {
    process.env.AZURE_TENANT_ID = opts.tenantId;
  }
});

// Subcommand registration section
program.addCommand(createExtractCommand());
program.addCommand(createPublishCommand());
program.addCommand(createInitCommand());
program.addCommand(createCompareCommand());

// Apply help configuration to all subcommands so global options are visible
program.commands.forEach((cmd) => cmd.configureHelp({ showGlobalOptions: true }));

// Handle unknown commands gracefully
program.on('command:*', (operands: string[]) => {
  const unknownCommand = operands[0] ?? 'unknown';
  logger.error(`Unknown command: ${unknownCommand}`);
  logger.info('Run "apiops --help" to see available commands');
  process.exit(1);
});

// Parse arguments and handle errors
try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof Error) {
    logger.error('Command failed:', error.message);
  } else {
    logger.error('Command failed with unknown error');
  }
  process.exit(1);
}
