/**
 * T-CMP-01 & T-CMP-07: Compare command CLI registration and output formatting.
 *
 * Commander subcommand with:
 *   --source-resource-group, --source-service-name  (required)
 *   --target-resource-group, --target-service-name  (required)
 *
 * Subscription ID options (mutually exclusive):
 *   --subscription-id           (global) — both instances in the same subscription
 *   --source-subscription-id + --target-subscription-id — instances in different subscriptions
 *
 * Inherits global options: --subscription-id, --cloud, --format, --log-level, auth flags.
 *
 * Exit codes:
 *   0 = identical
 *   1 = differences found
 *   2 = fatal error
 */

import { Command } from 'commander';
import { CompareConfig } from '../models/config.js';
import { ApimServiceContext } from '../models/types.js';
import { runCompare, CompareResult } from '../services/compare-service.js';
import { logger, parseLogLevel } from '../lib/logger.js';
import { ApimClient } from '../clients/apim-client.js';
import { getCloudConfig, buildArmBaseUrl } from '../lib/cloud-config.js';

/**
 * Interface for compare command options (from CLI flags).
 */
interface CompareOptions {
  sourceResourceGroup: string;
  sourceServiceName: string;
  targetResourceGroup: string;
  targetServiceName: string;
  sourceSubscriptionId?: string;
  targetSubscriptionId?: string;
}

/**
 * Result of subscription ID resolution.
 *
 * On success, both IDs are populated. On failure, `error` contains a
 * human-readable message and the IDs are undefined.
 */
export type SubscriptionResolution =
  | { sourceSubscriptionId: string; targetSubscriptionId: string; error?: never }
  | { sourceSubscriptionId?: never; targetSubscriptionId?: never; error: string };

/**
 * Resolve source and target subscription IDs from CLI flags and environment.
 *
 * Two modes are mutually exclusive:
 *  A) Shared — `globalSubscriptionId` (from `--subscription-id` or env var) used for both.
 *  B) Per-side — `sourceSubscriptionId` **and** `targetSubscriptionId` each supplied explicitly.
 *
 * Mixing A and B is rejected. Using only one per-side flag (without its counterpart) is also
 * rejected.
 *
 * @param globalSubscriptionId - Value of `--subscription-id` or `AZURE_SUBSCRIPTION_ID` env var (undefined if absent).
 * @param hasGlobalFlag - Whether `--subscription-id` was explicitly set on the CLI (not just the env var).
 * @param sourceSubscriptionId - Value of `--source-subscription-id` (undefined if absent).
 * @param targetSubscriptionId - Value of `--target-subscription-id` (undefined if absent).
 */
export function resolveSubscriptionIds(
  globalSubscriptionId: string | undefined,
  hasGlobalFlag: boolean,
  sourceSubscriptionId: string | undefined,
  targetSubscriptionId: string | undefined,
): SubscriptionResolution {
  const hasSourceFlag = !!sourceSubscriptionId;
  const hasTargetFlag = !!targetSubscriptionId;

  // Reject mixed usage
  if (hasGlobalFlag && (hasSourceFlag || hasTargetFlag)) {
    return {
      error:
        '--subscription-id is mutually exclusive with --source-subscription-id / --target-subscription-id. ' +
        'Use --subscription-id when both instances are in the same subscription, ' +
        'or use --source-subscription-id and --target-subscription-id when they are in different subscriptions.',
    };
  }

  // When using per-side flags, both must be provided together
  if (hasSourceFlag && !hasTargetFlag) {
    return { error: '--target-subscription-id is required when --source-subscription-id is specified.' };
  }
  if (hasTargetFlag && !hasSourceFlag) {
    return { error: '--source-subscription-id is required when --target-subscription-id is specified.' };
  }

  // Resolve final subscription IDs.
  // At this point: either both per-side flags are set (both truthy) or neither is (both falsy).
  // So resolvedSource === resolvedTarget === globalSubscriptionId in the "neither" case.
  // The guard below catches the remaining missing-subscription case: no per-side flags AND
  // no global subscription ID (neither --subscription-id nor AZURE_SUBSCRIPTION_ID env var).
  const resolvedSource = hasSourceFlag ? sourceSubscriptionId : globalSubscriptionId;
  const resolvedTarget = hasTargetFlag ? targetSubscriptionId : globalSubscriptionId;

  if (!resolvedSource || !resolvedTarget) {
    return {
      error:
        'Subscription ID required. Use one of:\n' +
        '  --subscription-id <id>   (when both instances are in the same subscription)\n' +
        '  --source-subscription-id <id> --target-subscription-id <id>   (when in different subscriptions)\n' +
        '  AZURE_SUBSCRIPTION_ID env var   (fallback for same-subscription case)',
    };
  }

  return { sourceSubscriptionId: resolvedSource, targetSubscriptionId: resolvedTarget };
}

/**
 * Create and return the compare command for Commander.
 */
export function createCompareCommand(): Command {
  const compare = new Command('compare')
    .description('Compare two Azure APIM instances and report differences')
    .requiredOption('--source-resource-group <rg>', 'Source APIM resource group')
    .requiredOption('--source-service-name <name>', 'Source APIM service instance name')
    .requiredOption('--target-resource-group <rg>', 'Target APIM resource group')
    .requiredOption('--target-service-name <name>', 'Target APIM service instance name')
    .option(
      '--source-subscription-id <id>',
      'Source subscription ID — use with --target-subscription-id when instances are in different subscriptions (mutually exclusive with --subscription-id)',
    )
    .option(
      '--target-subscription-id <id>',
      'Target subscription ID — use with --source-subscription-id when instances are in different subscriptions (mutually exclusive with --subscription-id)',
    )
    .action(async (options: CompareOptions, command: Command) => {
      const globalOpts = command.optsWithGlobals<{
        logLevel?: string;
        subscriptionId?: string;
        cloud?: string;
        format?: string;
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
    subscriptionId?: string;
    cloud?: string;
    format?: string;
    apiVersion?: string;
  },
): Promise<void> {
  // ── Subscription ID resolution ────────────────────────────────────────────
  //
  // Two mutually exclusive modes:
  //   A) --subscription-id (or AZURE_SUBSCRIPTION_ID env) — both instances share one subscription
  //   B) --source-subscription-id + --target-subscription-id — instances in different subscriptions
  //
  // Mixing A and B is not allowed: it creates ambiguity about which value takes precedence.

  const globalSubscriptionId =
    globalOpts.subscriptionId ?? process.env.AZURE_SUBSCRIPTION_ID;

  const resolution = resolveSubscriptionIds(
    globalSubscriptionId,
    !!globalOpts.subscriptionId,
    options.sourceSubscriptionId,
    options.targetSubscriptionId,
  );

  if (resolution.error) {
    logger.error(resolution.error);
    process.exit(2);
  }

  const { sourceSubscriptionId, targetSubscriptionId } = resolution;

  const apiVersion =
    globalOpts.apiVersion ?? process.env.AZURE_API_VERSION ?? '2024-05-01';
  const cloudName = globalOpts.cloud ?? 'public';
  const cloudConfig = getCloudConfig(cloudName);

  const sourceContext: ApimServiceContext = {
    subscriptionId: sourceSubscriptionId,
    resourceGroup: options.sourceResourceGroup,
    serviceName: options.sourceServiceName,
    apiVersion,
    baseUrl: buildArmBaseUrl(
      cloudName,
      sourceSubscriptionId,
      options.sourceResourceGroup,
      options.sourceServiceName,
    ),
  };

  const targetContext: ApimServiceContext = {
    subscriptionId: targetSubscriptionId,
    resourceGroup: options.targetResourceGroup,
    serviceName: options.targetServiceName,
    apiVersion,
    baseUrl: buildArmBaseUrl(
      cloudName,
      targetSubscriptionId,
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

  if (globalOpts.format === 'json') {
    outputJson(result);
  } else {
    outputText(result);
  }

  process.exit(result.exitCode);
}

/**
 * T-CMP-07: JSON output mode for compare.
 * Machine-readable JSON to stdout with per-type results and summary.
 */
function outputJson(result: CompareResult): void {
  const output = {
    status:
      result.exitCode === 0
        ? 'identical'
        : result.exitCode === 1
          ? 'differences'
          : 'error',
    exitCode: result.exitCode,
    summary: {
      totalDiffs: result.totalDiffs,
      totalCompared: result.totalCompared,
      skippedTypes: result.skippedTypes,
    },
    resourceTypes: result.typeResults.map((r) => ({
      label: r.label,
      compared: r.compared,
      skipped: r.skipped,
      skipReason: r.skipReason,
      differences: r.differences.map((d) => ({
        name: d.name,
        diffs: d.diffs,
      })),
    })),
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

/**
 * Text output mode (default) — per-resource-type summary with difference details.
 */
function outputText(result: CompareResult): void {
  process.stdout.write('\n');
  process.stdout.write('╔══════════════════════════════════════════════════════════════╗\n');
  process.stdout.write('║         APIM Instance Comparison                             ║\n');
  process.stdout.write('╚══════════════════════════════════════════════════════════════╝\n');

  for (const r of result.typeResults) {
    if (r.skipped) {
      process.stdout.write(`  ⚠️  ${r.label}: SKIPPED (${r.skipReason ?? 'unknown'})\n`);
      continue;
    }

    if (r.differences.length === 0) {
      process.stdout.write(`  ✅ ${r.label}: ${r.compared} resource(s) matched\n`);
    } else {
      process.stdout.write(`  ❌ ${r.label}: ${r.differences.length} difference(s)\n`);
      for (const diff of r.differences) {
        process.stdout.write(`     ${diff.name}\n`);
        for (const line of diff.diffs) {
          process.stdout.write(`       ${line}\n`);
        }
      }
    }
  }

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');

  if (result.exitCode === 2) {
    process.stdout.write('💥 ERROR — fatal error during comparison\n');
  } else if (result.totalDiffs === 0) {
    process.stdout.write(
      `✅ PASS — ${result.typeResults.length} resource type(s) compared, ${result.totalCompared} resource(s) matched\n`,
    );
  } else {
    process.stdout.write(
      `❌ FAIL — ${result.totalDiffs} difference(s) found across ${result.typeResults.length} resource type(s) (${result.totalCompared} compared)\n`,
    );
  }

  if (result.skippedTypes > 0) {
    process.stdout.write(
      `   (${result.skippedTypes} type(s) skipped due to query failures)\n`,
    );
  }
}
