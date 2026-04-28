/**
 * T050: Register init command
 * Commander subcommand with --ci, --non-interactive, --artifact-dir, --environments flags
 * Wire to init-service
 */

import { Command } from 'commander';
import { InitConfig } from '../models/config.js';
import { initService } from '../services/init-service.js';
import { logger } from '../lib/logger.js';

/**
 * Interface for init command options (from CLI flags)
 */
interface InitOptions {
  ci?: string;
  nonInteractive: boolean;
  artifactDir: string;
  environments: string;
  cliPackage: string;
  force: boolean;
}

/**
 * Create and return the init command for Commander
 */
export function createInitCommand(): Command {
  const init = new Command('init')
    .description('Initialize APIM repository with CI/CD pipelines and configuration templates')
    .option('--ci <provider>', 'CI/CD provider: github-actions or azure-devops')
    .option('--non-interactive', 'Skip interactive prompts (requires --ci)', false)
    .option('--artifact-dir <dir>', 'Artifact directory path', './apim-artifacts')
    .option('--environments <list>', 'Comma-separated environment names', 'dev,prod')
    .requiredOption('--cli-package <path>', 'Path to apiops npm tarball (from npm pack)')
    .option('--force', 'Overwrite existing files without prompting', false)
    .action(async (options: InitOptions) => {
      try {
        // Use pretty log format for init (human-facing command)
        logger.setFormat('pretty');

        // Validate CI provider if specified
        if (options.ci && options.ci !== 'github-actions' && options.ci !== 'azure-devops') {
          logger.error('Invalid CI provider. Must be "github-actions" or "azure-devops"');
          process.exit(1);
        }

        // Parse environments
        const environments = options.environments
          .split(',')
          .map((env) => env.trim())
          .filter((env) => env.length > 0);

        if (environments.length === 0) {
          logger.error('At least one environment must be specified');
          process.exit(1);
        }

        // Build config
        const config: InitConfig = {
          ciProvider: options.ci as 'github-actions' | 'azure-devops' | undefined,
          nonInteractive: options.nonInteractive,
          artifactDir: options.artifactDir,
          environments,
          outputDir: process.cwd(),
          cliPackage: options.cliPackage,
          force: options.force,
        };

        // Run init service
        const generatedFiles = await initService.run(config);

        // Output file listing
        const allFiles = [
          ...generatedFiles.pipelines,
          ...generatedFiles.configs,
        ];
        logger.info(`\nGenerated ${allFiles.length} file(s):`);
        allFiles.forEach((file) => logger.info(`  - ${file.startsWith('./') ? file : './' + file}`));
        
        logger.info(`\nCreated ${generatedFiles.directories.length} directory/directories:`);
        generatedFiles.directories.forEach((dir) => logger.info(`  - ${dir.startsWith('./') ? dir : './' + dir}`));

        // Determine which CI provider was actually used by checking generated files
        const isGitHub = allFiles.some((f) => f.includes('IDENTITY-SETUP-GITHUB.md'));

        logger.info('\nNext steps:');
        logger.info('  1. Review and customize the generated configuration files');
        logger.info('  2. Commit the generated files to your repository');
        logger.info('  3. Set up CI/CD identity authentication:');
        if (isGitHub) {
          logger.info('     - Follow ./IDENTITY-SETUP-GITHUB.md for manual setup, OR');
          logger.info('     - Open ./.github/prompts/apiops-setup-identity.prompt.md with GitHub Copilot for guided setup');
        } else {
          logger.info('     - Follow ./IDENTITY-SETUP-AZDO.md for manual setup');
        }
        logger.info('');
      } catch (error) {
        if (error instanceof Error) {
          logger.error('Init failed:', error.message);
        } else {
          logger.error('Init failed with unknown error');
        }
        process.exit(1);
      }
    });

  return init;
}
