// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Message text of a caught value for log and error output.
 */

/** The `message` of an `Error`, or the value converted to a string otherwise. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
