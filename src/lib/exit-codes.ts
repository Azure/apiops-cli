// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Exit code constants and aggregation
 * Provides standardised exit codes and a reusable aggregation function
 * for combining per-resource results into a single process exit code.
 */

/** All operations completed successfully. */
export const EXIT_SUCCESS = 0;

/** Some resources failed but others succeeded (partial failure). */
export const EXIT_PARTIAL = 1;

/** Cannot proceed — auth failure, invalid config, network unreachable, or total failure. */
export const EXIT_FATAL = 2;

/**
 * Outcome of a single resource operation (extract or publish).
 */
export interface ResourceResult {
  status: 'success' | 'error';
  error?: Error;
}

/**
 * Aggregate an array of per-resource results into a single exit code.
 *
 * - Returns EXIT_SUCCESS (0) if all results succeeded.
 * - Returns EXIT_PARTIAL (1) if some failed and some succeeded.
 * - Returns EXIT_FATAL   (2) if all failed or there are zero results.
 */
export function aggregateExitCode(results: ResourceResult[]): number {
  if (results.length === 0) {
    return EXIT_SUCCESS;
  }

  const successCount = results.filter((r) => r.status === 'success').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  if (errorCount === 0) {
    return EXIT_SUCCESS;
  }

  if (successCount > 0) {
    return EXIT_PARTIAL;
  }

  return EXIT_FATAL;
}
