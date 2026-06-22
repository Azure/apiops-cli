// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Register configure command
 * Commander subcommand that scans extracted APIM artifacts and generates
 * configuration files (extractor filter + per-environment overrides).
 */

import { Command } from 'commander';
import { ConfigureConfig } from '../models/config.js';
import { configureService } from '../services/configure-service.js';
import { logger } from '../lib/logger.js';

/**
 * Interface for configure command options (from CLI flags)
 */
interface ConfigureOptions {
  artifactDir: string;
  environments: string;
  output: string;
  nonInteractive: boolean;
  force: boolean;
}

/**
 * Create and return the configure command for Commander
 */
export function createConfigureCommand(): Command {
  const configure = new Command('configure')
    .description(
      'Generate filter and override configuration files from extracted APIM artifacts'
    )
    .option(
      '--artifact-dir <dir>',
      'Directory containing extracted APIM artifacts',
      './apim-artifacts'
    )
    .option(
      '--environments <list>',
      'Comma-separated environment names to generate override files for',
      'dev,prod'
    )
    .option(
      '--output <dir>',
      'Directory where configuration files will be written',
      '.'
    )
    .option('--non-interactive', 'Skip interactive prompts; use best-effort defaults', false)
    .option('--force', 'Overwrite existing configuration files without prompting', false)
    .action(async (options: ConfigureOptions) => {
      try {
        // Use pretty log format for configure (human-facing command)
        logger.setFormat('pretty');

        // Parse environments
        const environments = options.environments
          .split(',')
          .map((env) => env.trim())
          .filter((env) => env.length > 0);

        if (environments.length === 0) {
          logger.error('At least one environment must be specified');
          process.exit(1);
        }

        const config: ConfigureConfig = {
          artifactDir: options.artifactDir,
          environments,
          outputDir: options.output === '.' ? process.cwd() : options.output,
          nonInteractive: options.nonInteractive,
          force: options.force,
        };

        const result = await configureService.run(config);

        logger.info(`\nGenerated ${result.writtenFiles.length} configuration file(s):`);
        result.writtenFiles.forEach((file) =>
          logger.info(`  - ${file.startsWith('./') ? file : './' + file}`)
        );

        logger.info('\nNext steps:');
        logger.info('  1. Review the generated configuration files');
        logger.info(
          '  2. For files containing {#[TOKEN]#} placeholders: set the corresponding'
        );
        logger.info(
          '     pipeline variables / Key Vault secrets to the real values before publishing'
        );
        logger.info(
          '  3. Run "apiops publish --overrides configuration.<env>.yaml" to deploy with overrides'
        );
        logger.info('');
      } catch (error) {
        if (error instanceof Error) {
          logger.error('Configure failed:', error.message);
        } else {
          logger.error('Configure failed with unknown error');
        }
        process.exit(1);
      }
    });

  return configure;
}
