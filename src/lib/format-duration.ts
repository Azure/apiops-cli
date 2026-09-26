// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Human-readable duration formatting for CLI output.
 */

/**
 * Format a duration in milliseconds as a short human-readable string,
 * e.g. `0.4s`, `12.3s`, `2m 5.0s`.
 */
export function formatDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.round(safeMs / 100) / 10;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1)}s`;
}
