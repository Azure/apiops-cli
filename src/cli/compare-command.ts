/**
 * T-CMP-01 & T-CMP-07: Compare command CLI registration and output formatting.
 *
 * Commander subcommand with:
 *   --source-subscription-id, --source-resource-group, --source-service-name  (required)
 *   --target-subscription-id, --target-resource-group, --target-service-name  (required)
 *   --format text|table|json  (optional, default: text)
 *
 * Exit codes:
 *   0 = identical
 *   1 = differences found
 *   2 = fatal error
 */

import { Command, Option } from 'commander';
import { CompareConfig } from '../models/config.js';
import { ApimServiceContext } from '../models/types.js';
import { runCompare, CompareResult } from '../services/compare-service.js';
import { parseLogLevel } from '../lib/logger.js';
import { ApimClient } from '../clients/apim-client.js';
import { getCloudConfig, buildArmBaseUrl } from '../lib/cloud-config.js';

/**
 * Interface for compare command options (from CLI flags).
 */
interface CompareOptions {
  sourceSubscriptionId: string;
  sourceResourceGroup: string;
  sourceServiceName: string;
  targetSubscriptionId: string;
  targetResourceGroup: string;
  targetServiceName: string;
  format: string;
}

/**
 * Create and return the compare command for Commander.
 */
export function createCompareCommand(): Command {
  const compare = new Command('compare')
    .description('Compare two Azure APIM instances and report differences')
    .requiredOption('--source-subscription-id <id>', 'Source Azure subscription ID')
    .requiredOption('--source-resource-group <rg>', 'Source APIM resource group')
    .requiredOption('--source-service-name <name>', 'Source APIM service instance name')
    .requiredOption('--target-subscription-id <id>', 'Target Azure subscription ID')
    .requiredOption('--target-resource-group <rg>', 'Target APIM resource group')
    .requiredOption('--target-service-name <name>', 'Target APIM service instance name')
    .addOption(
      new Option('--format <mode>', 'Output format: text, table, or json')
        .choices(['text', 'table', 'json'])
        .default('text'),
    )
    .action(async (options: CompareOptions, command: Command) => {
      const globalOpts = command.optsWithGlobals<{
        logLevel?: string;
        cloud?: string;
        apiVersion?: string;
      }>();

      await executeCompare(options, globalOpts);
    });

  return compare;
}

/**
 * Execute the compare command.
 */
async function executeCompare(
  options: CompareOptions,
  globalOpts: {
    logLevel?: string;
    cloud?: string;
    apiVersion?: string;
  },
): Promise<void> {
  const apiVersion =
    globalOpts.apiVersion ?? process.env.AZURE_API_VERSION ?? '2024-05-01';
  const cloudName = globalOpts.cloud ?? 'public';
  const cloudConfig = getCloudConfig(cloudName);

  const sourceContext: ApimServiceContext = {
    subscriptionId: options.sourceSubscriptionId,
    resourceGroup: options.sourceResourceGroup,
    serviceName: options.sourceServiceName,
    apiVersion,
    baseUrl: buildArmBaseUrl(
      cloudName,
      options.sourceSubscriptionId,
      options.sourceResourceGroup,
      options.sourceServiceName,
    ),
  };

  const targetContext: ApimServiceContext = {
    subscriptionId: options.targetSubscriptionId,
    resourceGroup: options.targetResourceGroup,
    serviceName: options.targetServiceName,
    apiVersion,
    baseUrl: buildArmBaseUrl(
      cloudName,
      options.targetSubscriptionId,
      options.targetResourceGroup,
      options.targetServiceName,
    ),
  };

  const compareConfig: CompareConfig = {
    source: sourceContext,
    target: targetContext,
    logLevel: parseLogLevel(globalOpts.logLevel ?? 'info'),
  };

  const client = new ApimClient(cloudConfig.authScope);
  const result = await runCompare(client, compareConfig);

  if (options.format === 'json') {
    outputJson(result);
  } else if (options.format === 'table') {
    outputTable(result);
  } else {
    outputText(result);
  }

  process.exit(result.exitCode);
}

/** Maximum number of diff detail entries to include in table/json Notes field. */
const MAX_DIFF_NOTES = 3;

// ── Row type for table / json output ─────────────────────────────────────────

interface CompareRow {
  resource: string;
  status: 'missing' | 'extra' | 'different' | 'skipped';
  notes: string;
}

/**
 * Flatten a CompareResult into a list of rows for table/json output.
 *
 * Each row represents one resource or one skipped resource type.
 * Matched resources are not enumerated (we only track counts, not names).
 */
function buildRows(result: CompareResult): CompareRow[] {
  const rows: CompareRow[] = [];

  for (const r of result.typeResults) {
    if (r.skipped) {
      rows.push({
        resource: r.label,
        status: 'skipped',
        notes: r.skipReason ?? 'unknown',
      });
      continue;
    }

    for (const diff of r.differences) {
      rows.push({
        resource: `${r.label}/${diff.name}`,
        status: diff.status,
        notes: diff.status === 'different'
          ? diff.diffs.slice(0, MAX_DIFF_NOTES).join('; ')
          : '',
      });
    }
  }

  return rows;
}

/**
 * T-CMP-07: JSON output mode — table-structured data in JSON form.
 */
function outputJson(result: CompareResult): void {
  const output = {
    exitCode: result.exitCode,
    summary: {
      totalDiffs: result.totalDiffs,
      totalCompared: result.totalCompared,
      skippedTypes: result.skippedTypes,
    },
    resources: buildRows(result),
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

/**
 * Table output mode — ASCII table with Resource, Status, Notes columns.
 */
function outputTable(result: CompareResult): void {
  const rows = buildRows(result);

  const COL_RESOURCE = 'Resource';
  const COL_STATUS = 'Status';
  const COL_NOTES = 'Notes';

  const maxResource = Math.max(COL_RESOURCE.length, ...rows.map((r) => r.resource.length));
  const maxStatus = Math.max(COL_STATUS.length, ...rows.map((r) => r.status.length));
  const maxNotes = Math.max(COL_NOTES.length, ...rows.map((r) => r.notes.length));

  const sep = `+-${'-'.repeat(maxResource)}-+-${'-'.repeat(maxStatus)}-+-${'-'.repeat(maxNotes)}-+`;
  const header =
    `| ${COL_RESOURCE.padEnd(maxResource)} | ${COL_STATUS.padEnd(maxStatus)} | ${COL_NOTES.padEnd(maxNotes)} |`;

  process.stdout.write(`${sep}\n${header}\n${sep}\n`);

  for (const row of rows) {
    const line =
      `| ${row.resource.padEnd(maxResource)} | ${row.status.padEnd(maxStatus)} | ${row.notes.padEnd(maxNotes)} |`;
    process.stdout.write(`${line}\n`);
  }

  process.stdout.write(`${sep}\n`);

  const summaryLine = result.totalDiffs === 0
    ? `${result.typeResults.length} type(s) compared, ${result.totalCompared} matched, 0 differences, ${result.skippedTypes} skipped`
    : `${result.typeResults.length} type(s) compared, ${result.totalCompared} matched, ${result.totalDiffs} difference(s), ${result.skippedTypes} skipped`;
  process.stdout.write(`\n${summaryLine}\n`);
}

/**
 * Text output mode (default) — per-resource-type summary with difference details.
 */
function outputText(result: CompareResult): void {
  process.stdout.write('\n');
  process.stdout.write('==============================\n');
  process.stdout.write(' APIM Instance Comparison\n');
  process.stdout.write('==============================\n');

  for (const r of result.typeResults) {
    if (r.skipped) {
      process.stdout.write(`  SKIPPED  ${r.label}: ${r.skipReason ?? 'unknown'}\n`);
      continue;
    }

    if (r.differences.length === 0) {
      process.stdout.write(`  PASS     ${r.label}: ${r.compared} resource(s) matched\n`);
    } else {
      process.stdout.write(`  FAIL     ${r.label}: ${r.differences.length} difference(s)\n`);
      for (const diff of r.differences) {
        process.stdout.write(`     ${diff.name} [${diff.status}]\n`);
        for (const line of diff.diffs) {
          process.stdout.write(`       ${line}\n`);
        }
      }
    }
  }

  process.stdout.write('\n------------------------------\n');

  if (result.exitCode === 2) {
    process.stdout.write('ERROR: fatal error during comparison\n');
  } else if (result.totalDiffs === 0) {
    process.stdout.write(
      `PASS: ${result.typeResults.length} resource type(s) compared, ${result.totalCompared} resource(s) matched\n`,
    );
  } else {
    process.stdout.write(
      `FAIL: ${result.totalDiffs} difference(s) found across ${result.typeResults.length} resource type(s) (${result.totalCompared} compared)\n`,
    );
  }

  if (result.skippedTypes > 0) {
    process.stdout.write(
      `   (${result.skippedTypes} type(s) skipped due to query failures)\n`,
    );
  }
}
