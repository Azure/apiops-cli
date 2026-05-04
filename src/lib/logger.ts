/**
 * T014: Structured logger with stderr output
 * Supports log levels, timestamps, and --log-level option.
 * Sanitizes sensitive data from log output per Constitution §VIII.
 */

import anyAscii from 'any-ascii';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export type LogFormat = 'structured' | 'pretty';

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

/** Keys whose values are redacted before logging (case-insensitive match). */
const SENSITIVE_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'credential',
  'authorization',
  'apikey',
  'api_key',
  'client_secret',
  'access_token',
  'refresh_token',
];

/**
 * Determines whether a key name looks sensitive.
 * Matches if ANY sensitive pattern appears as a substring of the lower-cased key.
 * Standalone "key" is treated as sensitive (e.g. subscription keys in ARM responses)
 * but compound words like "keyName", "keyVault" are NOT matched since they are
 * non-secret APIM metadata fields.
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === 'key') return true;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively sanitize a value, replacing sensitive fields with '***'.
 * Handles objects, arrays, inline bearer tokens in strings, and Error objects.
 */
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    // Redact inline bearer tokens (e.g. "Bearer eyJ...")
    return value.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer ***');
  }
  if (value instanceof Error) {
    // Convert Error objects to a serializable form
    return {
      name: sanitize(value.name),
      message: sanitize(value.message),
      stack: value.stack === undefined ? undefined : sanitize(value.stack),
      ...(value.cause ? { cause: sanitize(value.cause) } : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  if (typeof value === 'object' && value !== null) {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      sanitized[k] = isSensitiveKey(k) ? '***' : sanitize(v);
    }
    return sanitized;
  }
  return value;
}

export class Logger {
  private level = LogLevel.INFO;
  private format: LogFormat = 'structured';

  configure(options: LoggerOptions): void {
    this.level = options.level ?? LogLevel.INFO;
    if (options.format !== undefined) {
      this.format = options.format;
    }
  }

  /**
   * Switch between structured (timestamped) and pretty (clean) output.
   * Pretty mode omits timestamps and level prefixes — ideal for
   * human-facing commands like `apiops init`.
   */
  setFormat(format: LogFormat): void {
    this.format = format;
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    // Filter messages based on configured log level
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return;
    }

    const sanitizedArgs = args.map((arg) => sanitize(arg));
    const formattedArgs =
      sanitizedArgs.length > 0 ? ' ' + JSON.stringify(sanitizedArgs) : '';

    let logLine: string;
    if (this.format === 'pretty') {
      logLine = anyAscii(`${message}${formattedArgs}`);
    } else {
      const timestamp = new Date().toISOString();
      logLine = anyAscii(
        `${timestamp} [${level}] ${message}${formattedArgs}`,
      );
    }

    // Always write to stderr, never stdout (stdout is for --format json)
    process.stderr.write(logLine + '\n');
  }
}

/**
 * Parse a log-level string into a LogLevel enum value.
 * Falls back to INFO for unrecognised values (Commander choices() prevents this in practice).
 */
export function parseLogLevel(value: string): LogLevel {
  const upper = value.toUpperCase();
  if (Object.values(LogLevel).includes(upper as LogLevel)) {
    return upper as LogLevel;
  }
  return LogLevel.INFO;
}

// Export singleton instance and class (class export enables test mocking per §VI)
export const logger = new Logger();
