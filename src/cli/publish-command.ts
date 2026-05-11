/**
 * T037 & T038: Publish command CLI registration
 * Commander subcommand with --resource-group, --service-name, --source,
 * --overrides, --dry-run, --delete-unmatched flags.
 * Includes --format json: machine-readable JSON output mode (T038).
 */

import { Command, Option } from 'commander';
import { PublishConfig } from '../models/config.js';
import { ApimServiceContext } from '../models/types.js';
import { runPublish, PublishResult } from '../services/publish-service.js';
import { loadOverrideConfig } from '../lib/config-loader.js';
import { logger, parseLogLevel } from '../lib/logger.js';
import { ApimClient } from '../clients/apim-client.js';
import { ArtifactStore } from '../clients/artifact-store.js';
import { getCloudConfig, buildArmBaseUrl } from '../lib/cloud-config.js';

/**
 * Interface for publish command options (from CLI flags).
 */
interface PublishOptions {
  subscriptionId: string;
  resourceGroup: string;
  serviceName: string;
  source: string;
  overrides?: string;
  dryRun: boolean;
  deleteUnmatched: boolean;
}

/**
 * Create and return the publish command for Commander.
 */
export function createPublishCommand(): Command {
  const publish = new Command('publish')
    .description('Publish local APIM artifacts to Azure APIM service')
    .addOption(
      new Option('--subscription-id <id>', 'Azure subscription ID')
        .env('AZURE_SUBSCRIPTION_ID')
        .makeOptionMandatory(true),
    )
    .requiredOption('--resource-group <rg>', 'Azure resource group name')
    .requiredOption('--service-name <name>', 'APIM service instance name')
    .option('--source <dir>', 'Source directory with artifacts', './apim-artifacts')
    .option('--overrides <path>', 'Override configuration YAML file')
    .option('--dry-run', 'Preview changes without applying them', false)
    .option(
      '--delete-unmatched',
      'Delete resources in APIM not present in source',
      false
    )
    .action(async (options: PublishOptions, command: Command) => {
      const globalOpts = command.optsWithGlobals<{
        logLevel?: string;
        cloud?: string;
        format?: string;
        apiVersion?: string;
      }>();

      await executePublish(options, globalOpts);
    });

  return publish;
}

/**
 * Execute the publish command.
 */
async function executePublish(
  options: PublishOptions,
  globalOpts: {
    logLevel?: string;
    cloud?: string;
    format?: string;
    apiVersion?: string;
  }
): Promise<void> {
  const { subscriptionId } = options;

  // Build service context
  const apiVersion =
    globalOpts.apiVersion ?? process.env.AZURE_API_VERSION ?? '2024-05-01';
  const cloudName = globalOpts.cloud ?? 'public';
  const cloudConfig = getCloudConfig(cloudName);
  const baseUrl = buildArmBaseUrl(
    cloudName,
    subscriptionId,
    options.resourceGroup,
    options.serviceName,
  );

  const context: ApimServiceContext = {
    subscriptionId,
    resourceGroup: options.resourceGroup,
    serviceName: options.serviceName,
    apiVersion,
    baseUrl,
  };

  // Load override config if specified
  let overrideConfig;
  if (options.overrides) {
    overrideConfig = await loadOverrideConfig(options.overrides);
    if (!overrideConfig) {
      logger.error(`Override file not found: ${options.overrides}`);
      process.exit(2);
    }
  }

  // Get commit ID from environment (for incremental publish)
  const commitId = process.env.COMMIT_ID;
  if (commitId) {
    logger.debug(`Using incremental publish with commit ID: ${commitId}`);
  }

  // Build publish config
  const publishConfig: PublishConfig = {
    service: context,
    sourceDir: options.source,
    overrides: overrideConfig,
    dryRun: options.dryRun,
    deleteUnmatched: options.deleteUnmatched,
    commitId,
    logLevel: parseLogLevel(globalOpts.logLevel ?? 'info'),
  };

  // Create client and store
  const client = new ApimClient(cloudConfig.authScope);
  const store = new ArtifactStore();

  // Run publish
  const result = await runPublish(client, store, publishConfig);

  // Output results
  if (globalOpts.format === 'json') {
    outputJson(result);
  } else {
    outputText(result, options.dryRun);
  }

  process.exit(result.exitCode);
}

/**
 * T038: JSON output mode for publish.
 * Machine-readable JSON to stdout with action list and summary.
 */
function outputJson(result: PublishResult): void {
  const output: {
    status: string;
    exitCode: number;
    summary: {
      totalPuts: number;
      totalDeletes: number;
      totalErrors: number;
      totalSkipped: number;
    };
    actions: Array<{
      action: string;
      type: string;
      nameParts: string[];
      status: string;
      error?: string;
    }>;
    dryRun?: {
      actions: Array<{
        operation: string;
        type: string;
        name: string;
      }>;
      summary: {
        creates: number;
        deletes: number;
        skips: number;
      };
    };
  } = {
    status:
      result.exitCode === 0
        ? 'success'
        : result.exitCode === 1
          ? 'partial'
          : 'error',
    exitCode: result.exitCode,
    summary: {
      totalPuts: result.totalPuts,
      totalDeletes: result.totalDeletes,
      totalErrors: result.totalErrors,
      totalSkipped: result.totalSkipped,
    },
    actions: result.actions.map((action) => ({
      action: action.action,
      type: action.descriptor.type,
      nameParts: action.descriptor.nameParts,
      status: action.status,
      error: action.error?.message,
    })),
  };

  // Add dry-run report if present
  if (result.dryRunReport) {
    output.dryRun = {
      actions: result.dryRunReport.actions.map((a) => ({
        operation: a.operation,
        type: a.type,
        name: a.name,
      })),
      summary: result.dryRunReport.summary,
    };
  }

  // JSON output goes to stdout (not stderr)
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

/**
 * Text output mode (default) — per-resource status lines and summary.
 */
function outputText(result: PublishResult, dryRun: boolean): void {
  // Per-resource status lines are already output by publish-service
  // Just output the summary here

  if (dryRun && result.dryRunReport) {
    // Dry-run mode output
    process.stdout.write('\n--- Dry-Run Report ---\n');
    process.stdout.write(
      `${result.dryRunReport.summary.creates} creates/updates\n`
    );
    process.stdout.write(`${result.dryRunReport.summary.deletes} deletes\n`);
    process.stdout.write(`${result.dryRunReport.summary.skips} skipped\n`);

    if (result.dryRunReport.actions.length > 0) {
      process.stdout.write('\nPlanned actions:\n');
      for (const action of result.dryRunReport.actions) {
        process.stdout.write(
          `  ${action.operation} ${action.type}/${action.name}\n`
        );
      }
    }
  } else {
    // Regular publish mode summary
    process.stdout.write('\n--- Summary ---\n');
    process.stdout.write(
      `${result.totalPuts} creates/updates, ${result.totalDeletes} deletes, ${result.totalSkipped} skipped\n`
    );

    if (result.totalErrors > 0) {
      process.stdout.write(`${result.totalErrors} errors\n`);
    }
  }
}
