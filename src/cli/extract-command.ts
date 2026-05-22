// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T028 & T029: Extract command CLI registration
 * Commander subcommand with --resource-group, --service-name, --output,
 * --filter, --no-transitive, --spec-format flags.
 * Includes --format json: machine-readable JSON output mode.
 */

import { Command } from 'commander';
import { ExtractConfig } from '../models/config.js';
import { ApimServiceContext } from '../models/types.js';
import { runExtraction, ExtractionResult } from '../services/extract-service.js';
import { loadFilterConfig } from '../lib/config-loader.js';
import { logger, parseLogLevel } from '../lib/logger.js';
import { ApimClient } from '../clients/apim-client.js';
import { ArtifactStore } from '../clients/artifact-store.js';
import { getCloudConfig, buildArmBaseUrl } from '../lib/cloud-config.js';

/**
 * Interface for extract command options (from CLI flags).
 */
interface ExtractOptions {
  resourceGroup: string;
  serviceName: string;
  output: string;
  filter?: string;
  transitive: boolean;
  specFormat?: string;
}

/**
 * Create and return the extract command for Commander.
 */
export function createExtractCommand(): Command {
  const extract = new Command('extract')
    .description('Extract APIM configuration to local artifact files')
    .requiredOption('--resource-group <rg>', 'Azure resource group name')
    .requiredOption('--service-name <name>', 'APIM service instance name')
    .option('--output <dir>', 'Output directory path', './apim-artifacts')
    .option('--filter <path>', 'Filter configuration YAML file')
    .option('--no-transitive', 'Disable transitive dependency inclusion')
    .option('--spec-format <format>', 'API specification format (openapi-v2-json, openapi-v3-json, openapi-v3-yaml)')
    .action(async (options: ExtractOptions, command: Command) => {
      const globalOpts = command.optsWithGlobals<{
        logLevel?: string;
        subscriptionId?: string;
        cloud?: string;
        format?: string;
        apiVersion?: string;
      }>();

      await executeExtract(options, globalOpts);
    });

  return extract;
}

/**
 * Execute the extract command.
 */
async function executeExtract(
  options: ExtractOptions,
  globalOpts: {
    logLevel?: string;
    subscriptionId?: string;
    cloud?: string;
    format?: string;
    apiVersion?: string;
  }
): Promise<void> {
  const subscriptionId = globalOpts.subscriptionId ?? process.env.AZURE_SUBSCRIPTION_ID;

  if (!subscriptionId) {
    logger.error('Subscription ID required: use --subscription-id or set AZURE_SUBSCRIPTION_ID');
    process.exit(2);
  }

  // Build service context
  // Default to 2025-09-01-preview so newer resource types (e.g. MCP-typed
  // APIs) are returned by ARM list endpoints. Older versions (e.g. 2024-05-01)
  // can silently omit MCP APIs from /apis.
  const apiVersion = globalOpts.apiVersion ?? process.env.AZURE_API_VERSION ?? '2025-09-01-preview';
  const cloudName = globalOpts.cloud ?? 'public';
  const cloudConfig = getCloudConfig(cloudName);
  const baseUrl = buildArmBaseUrl(cloudName, subscriptionId, options.resourceGroup, options.serviceName);

  const context: ApimServiceContext = {
    subscriptionId,
    resourceGroup: options.resourceGroup,
    serviceName: options.serviceName,
    apiVersion,
    baseUrl,
  };

  // Load filter config if specified
  let filterConfig;
  if (options.filter) {
    filterConfig = await loadFilterConfig(options.filter);
    if (!filterConfig) {
      logger.error(`Filter file not found: ${options.filter}`);
      process.exit(2);
    }
  }

  // Build extract config
  const extractConfig: ExtractConfig = {
    service: context,
    outputDir: options.output,
    filter: filterConfig,
    includeTransitive: options.transitive,
    specFormat: options.specFormat,
    logLevel: parseLogLevel(globalOpts.logLevel ?? 'info'),
  };

  // Create client and store
  const client = new ApimClient(cloudConfig.authScope);
  const store = new ArtifactStore();

  // Run extraction
  const result = await runExtraction(client, store, extractConfig);

  // Output results
  if (globalOpts.format === 'json') {
    outputJson(result);
  } else {
    outputText(result);
  }

  process.exit(result.exitCode);
}

/**
 * T029: JSON output mode for extract.
 * Machine-readable JSON to stdout with resource counts and file paths.
 */
function outputJson(result: ExtractionResult): void {
  const output = {
    status: result.exitCode === 0 ? 'success' : result.exitCode === 1 ? 'partial' : 'error',
    exitCode: result.exitCode,
    summary: {
      totalExtracted: result.totalExtracted,
      totalErrors: result.totalErrors,
      typeBreakdown: result.typeResults.map((tr) => ({
        type: tr.type,
        extracted: tr.extracted.filter((r) => r.status === 'success').length,
        errors: tr.errorCount,
      })),
    },
    resources: result.extractedDescriptors.map((d) => ({
      type: d.type,
      nameParts: d.nameParts,
      workspace: d.workspace,
    })),
    apis: result.apiResults.map((ar) => ({
      name: ar.apiName,
      revisions: ar.revisions.filter((r) => r.status === 'success').length,
      specification: ar.specification,
      operations: ar.operations.filter((r) => r.status === 'success').length,
      tags: ar.tags.filter((r) => r.status === 'success').length,
    })),
    workspaces: result.workspaceResults.map((wr) => ({
      name: wr.workspaceName,
      resources: wr.resourceCount,
      errors: wr.errorCount,
    })),
  };

  // JSON output goes to stdout (not stderr)
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

/**
 * Text output mode (default) — per-resource status lines.
 */
function outputText(result: ExtractionResult): void {
  // Per-type summary
  for (const tr of result.typeResults) {
    const successCount = tr.extracted.filter((r) => r.status === 'success').length;
    if (successCount > 0) {
      process.stdout.write(`Extracted ${successCount} ${tr.type}(s)\n`);
    }
    if (tr.errorCount > 0) {
      process.stdout.write(`Failed ${tr.errorCount} ${tr.type}(s)\n`);
    }
  }

  // API details
  for (const ar of result.apiResults) {
    const details: string[] = [];
    if (ar.specification) details.push('spec');
    if (ar.operations.length > 0) details.push(`${ar.operations.length} ops`);
    if (ar.revisions.length > 0) details.push(`${ar.revisions.length} revisions`);
    if (details.length > 0) {
      process.stdout.write(`  API "${ar.apiName}": ${details.join(', ')}\n`);
    }
  }

  // Workspace details
  for (const wr of result.workspaceResults) {
    process.stdout.write(`Workspace "${wr.workspaceName}": ${wr.resourceCount} resources\n`);
  }

  // Summary
  process.stdout.write(
    `\nTotal: ${result.totalExtracted} resources extracted, ${result.totalErrors} errors\n`
  );
}
