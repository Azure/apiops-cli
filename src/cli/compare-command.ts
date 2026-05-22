// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Compare command - compares two APIM instances
 */

import { Command } from 'commander';
import { logger, LogLevel } from '../lib/logger.js';
import { ApimClient } from '../clients/apim-client.js';
import { ArtifactStore } from '../clients/artifact-store.js';
import { ApimServiceContext } from '../models/types.js';
import { CompareConfig } from '../models/config.js';
import {
  compareApimInstances,
  compareLocalArtifacts,
  CompareResult,
  ComparisonDifference,
} from '../services/compare-service.js';
import { getCloudConfig, buildArmBaseUrl } from '../lib/cloud-config.js';
import { loadOverrideConfig } from '../lib/config-loader.js';

interface CompareCommandOptions {
  sourceResourceGroup: string;
  sourceServiceName: string;
  sourceSubscriptionId: string;
  targetResourceGroup: string;
  targetServiceName: string;
  targetSubscriptionId: string;
  format?: string;
  cloud?: string;
  logLevel?: string;
}

interface LocalCompareCommandOptions {
  source: string;
  target: string;
  overrides?: string;
  format?: string;
  logLevel?: string;
}

export function createCompareCommand(): Command {
  const command = new Command('compare');

  command
    .description('Compare two Azure API Management instances or local artifact directories');

  // Cloud-to-cloud comparison (default action)
  const cloudCommand = new Command('cloud');
  cloudCommand
    .description('Compare two Azure API Management instances')
    .requiredOption(
      '--source-resource-group <name>',
      'Source APIM resource group name',
    )
    .requiredOption(
      '--source-service-name <name>',
      'Source APIM service name',
    )
    .requiredOption(
      '--source-subscription-id <id>',
      'Source Azure subscription ID',
    )
    .requiredOption(
      '--target-resource-group <name>',
      'Target APIM resource group name',
    )
    .requiredOption(
      '--target-service-name <name>',
      'Target APIM service name',
    )
    .requiredOption(
      '--target-subscription-id <id>',
      'Target Azure subscription ID',
    )
    .action(async (options: CompareCommandOptions) => {
      try {
        await runCompare(options, cloudCommand.optsWithGlobals());
      } catch (error) {
        logger.error(
          `Compare failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  command.addCommand(cloudCommand);

  // Add local subcommand
  const localCommand = new Command('local');
  localCommand
    .description('Compare local artifact directories (source + overrides vs target)')
    .requiredOption('--source <directory>', 'Source artifact directory path')
    .requiredOption('--target <directory>', 'Target artifact directory path')
    .option('--overrides <path>', 'Path to override YAML file to apply to source')
    .action(async (options: LocalCompareCommandOptions) => {
      try {
        await runLocalCompare(options, localCommand.optsWithGlobals());
      } catch (error) {
        logger.error(
          `Local compare failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    });

  command.addCommand(localCommand);

  return command;
}

/**
 * Parse log level string to LogLevel enum
 */
function parseLogLevel(level?: string): LogLevel | undefined {
  if (!level) return undefined;
  const upperLevel = level.toUpperCase();
  switch (upperLevel) {
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

async function runCompare(
  options: CompareCommandOptions,
  globalOpts: {
    cloud?: string;
    format?: string;
    logLevel?: string;
  },
): Promise<void> {
  // Extract required subscription IDs
  const sourceSubscriptionId = options.sourceSubscriptionId;
  const targetSubscriptionId = options.targetSubscriptionId;

  if (!sourceSubscriptionId) {
    throw new Error('Source subscription ID required (--source-subscription-id)');
  }
  if (!targetSubscriptionId) {
    throw new Error('Target subscription ID required (--target-subscription-id)');
  }

  const cloudName = globalOpts.cloud ?? 'public';
  const cloudConfig = getCloudConfig(cloudName);
  const format = (globalOpts.format ?? 'text') as 'text' | 'json' | 'table';
  const apiVersion = '2024-05-01';

  // Create source context
  const sourceClient = new ApimClient(cloudConfig.authScope);
  const sourceBaseUrl: string = buildArmBaseUrl(
    cloudName,
    sourceSubscriptionId,
    options.sourceResourceGroup,
    options.sourceServiceName,
  );
  const sourceContext: ApimServiceContext = {
    subscriptionId: sourceSubscriptionId,
    resourceGroup: options.sourceResourceGroup,
    serviceName: options.sourceServiceName,
    apiVersion,
    baseUrl: sourceBaseUrl,
  };

  // Create target context
  const targetClient = new ApimClient(cloudConfig.authScope);
  const targetBaseUrl: string = buildArmBaseUrl(
    cloudName,
    targetSubscriptionId,
    options.targetResourceGroup,
    options.targetServiceName,
  );
  const targetContext: ApimServiceContext = {
    subscriptionId: targetSubscriptionId,
    resourceGroup: options.targetResourceGroup,
    serviceName: options.targetServiceName,
    apiVersion,
    baseUrl: targetBaseUrl,
  };

  const config: CompareConfig = {
    source: sourceContext,
    target: targetContext,
    sourceClient,
    targetClient,
    format,
    logLevel: parseLogLevel(globalOpts.logLevel),
  };

  logger.info('Starting comparison...');
  logger.info(
    `  Source: ${sourceContext.serviceName} (${sourceContext.resourceGroup})`,
  );
  logger.info(
    `  Target: ${targetContext.serviceName} (${targetContext.resourceGroup})`,
  );

  const result = await compareApimInstances(config);

  // Output results
  if (format === 'json') {
    outputJson(result);
  } else if (format === 'table') {
    outputTable(result);
  } else {
    outputText(result);
  }

  // Exit code: 0 = identical, 1 = differences found
  if (result.totalDifferences > 0) {
    process.exit(1);
  }
}

function outputJson(result: CompareResult): void {
  console.log(JSON.stringify(result, null, 2));
}

function outputTable(result: CompareResult): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  APIM Instance Comparison');
  console.log('═══════════════════════════════════════════════════');

  if (result.totalDifferences === 0) {
    console.log('✅ PASS — Instances are identical');
    console.log(
      `   ${result.totalTypes} resource types compared, ${result.totalResources} resources matched`,
    );
  } else {
    console.log('❌ FAIL — Differences found');
    console.log(
      `   ${result.totalDifferences} difference(s) across ${result.totalTypes} resource types`,
    );
    console.log('');

    // Group by resource type
    const byType = new Map<string, ComparisonDifference[]>();
    for (const diff of result.differences) {
      if (!byType.has(diff.resourceType)) {
        byType.set(diff.resourceType, []);
      }
      byType.get(diff.resourceType)!.push(diff);
    }

    for (const [resourceType, diffs] of byType.entries()) {
      console.log(`─── ${resourceType} ───`);
      for (const diff of diffs) {
        if (diff.diffType === 'missing') {
          console.log(`  ❌ MISSING in target: ${diff.resourceName}`);
        } else if (diff.diffType === 'extra') {
          console.log(`  ❌ EXTRA in target:   ${diff.resourceName}`);
        } else if (diff.diffs && diff.diffs.length > 0) {
          console.log(`  ❌ ${diff.resourceName}`);
          for (const d of diff.diffs.slice(0, 5)) {
            // Limit to 5 diffs per resource
            if (d.type === 'missing') {
              console.log(`      MISSING in target: ${d.path}`);
            } else if (d.type === 'extra') {
              console.log(`      EXTRA in target:   ${d.path}`);
            } else {
              console.log(`      DIFF at ${d.path}`);
              if (d.sourceValue) {
                console.log(`        source: ${d.sourceValue}`);
              }
              if (d.targetValue) {
                console.log(`        target: ${d.targetValue}`);
              }
            }
          }
          if (diff.diffs.length > 5) {
            console.log(
              `      ... and ${diff.diffs.length - 5} more difference(s)`,
            );
          }
        }
      }
    }
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('');
}

async function runLocalCompare(
  options: LocalCompareCommandOptions,
  globalOpts: {
    format?: string;
    logLevel?: string;
  },
): Promise<void> {
  const format = (globalOpts.format ?? 'text') as 'text' | 'json' | 'table';

  // Load overrides if provided
  const overrides = options.overrides
    ? await loadOverrideConfig(options.overrides)
    : undefined;

  logger.info('Starting local artifact comparison...');
  logger.info(`  Source: ${options.source}${overrides ? ' (with overrides)' : ''}`);
  logger.info(`  Target: ${options.target}`);

  const artifactStore = new ArtifactStore();

  const result = await compareLocalArtifacts(
    artifactStore,
    options.source,
    options.target,
    overrides,
    format,
    parseLogLevel(globalOpts.logLevel),
  );

  // Output results
  if (format === 'json') {
    outputJson(result);
  } else if (format === 'table') {
    outputTable(result);
  } else {
    outputText(result);
  }

  // Exit code: 0 = identical, 1 = differences found
  if (result.totalDifferences > 0) {
    process.exit(1);
  }
}

function outputText(result: CompareResult): void {
  if (result.totalDifferences === 0) {
    logger.info(
      `✅ PASS — ${result.totalTypes} resource types compared, ${result.totalResources} resources matched`,
    );
  } else {
    logger.error(
      `❌ FAIL — ${result.totalDifferences} difference(s) found across ${result.totalTypes} resource types`,
    );
    for (const diff of result.differences) {
      if (diff.diffType === 'missing') {
        logger.error(
          `  [${diff.resourceType}] MISSING in target: ${diff.resourceName}`,
        );
      } else if (diff.diffType === 'extra') {
        logger.error(
          `  [${diff.resourceType}] EXTRA in target:   ${diff.resourceName}`,
        );
      } else if (diff.diffs && diff.diffs.length > 0) {
        logger.error(
          `  [${diff.resourceType}] ${diff.resourceName}: ${diff.diffs.length} difference(s)`,
        );
      }
    }
  }
}
