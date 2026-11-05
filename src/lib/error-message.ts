// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Message text of a caught value for log and error output.
 */

/**
 * The errors `error` was caused by, in order, following `cause` while it is an
 * `Error`. Stops at an error already seen, so a cycle of causes ends.
 */
export function* errorCauses(error: Error): Generator<Error> {
  const seen = new Set<Error>([error]);
  for (let cause = error.cause; cause instanceof Error && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    yield cause;
  }
}

/**
 * The `message` of an `Error`, or the value converted to a string otherwise.
 * The messages of the errors it was caused by follow in parentheses: `fetch`
 * rejects with just "fetch failed" and gives the reason (a refused
 * connection, the proxy's answer) as its `cause`.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const causes: string[] = [];
  for (const cause of errorCauses(error)) {
    if (cause.message && !error.message.includes(cause.message) && !causes.includes(cause.message)) {
      causes.push(cause.message);
    }
  }
  return causes.length > 0 ? `${error.message} (${causes.join(': ')})` : error.message;
}
