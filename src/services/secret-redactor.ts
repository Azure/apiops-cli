// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Secret redaction service
 * Detect properties.secret === true on named values,
 * replace properties.value with redaction marker.
 */

import { ResourceType } from '../models/resource-types.js';
import { ResourceDescriptor } from '../models/types.js';
import { logger } from '../lib/logger.js';
import { getNamePart } from '../lib/resource-path.js';
import { buildResourceLabel } from '../lib/resource-uri.js';

/** Marker used to replace secret values in extracted artifacts */
export const REDACTION_MARKER = '*** REDACTED ***';
const NAMED_VALUE_REFERENCE_PATTERN = /^\s*\{\{[^{}]+\}\}\s*$/;
// Headers where inline literal values are typically secrets and should be
// redacted when present in policy XML. Extend this allow-list when APIM adds
// new secret-bearing header conventions.
const SECRET_HEADER_NAMES = new Set([
  'authorization',
  'ocp-apim-subscription-key',
  'x-functions-key',
  'api-key',
]);
// Query parameters commonly used to carry secrets/tokens in APIM policies.
// Keep focused on secret-bearing names to avoid over-redacting non-secrets.
const SECRET_QUERY_PARAMETER_NAMES = new Set([
  'code',
  'sig',
  'subscription-key',
]);
const BEARER_TOKEN_PATTERN = /^(\s*Bearer)(\s+)(.*?)(\s*)$/i;

export interface PolicySecretFinding {
  location: string;
}

/**
 * Redact secret values from a resource's JSON payload.
 *
 * Only applies to NamedValue resources with properties.secret === true.
 * KeyVault references are preserved as-is (the URL is not itself secret).
 *
 * @param descriptor - Resource descriptor
 * @param json - Raw resource JSON (will be cloned, not mutated)
 * @returns JSON with secrets redacted
 */
export function redactSecrets(
  descriptor: ResourceDescriptor,
  json: Record<string, unknown>
): Record<string, unknown> {
  if (descriptor.type !== ResourceType.NamedValue) {
    return json;
  }

  const properties = json.properties as Record<string, unknown> | undefined;
  if (!properties) {
    return json;
  }

  // Only redact if explicitly marked as secret
  if (properties.secret !== true) {
    return json;
  }

  // Skip KeyVault-backed named values — the keyVault block is not secret
  if (properties.keyVault !== undefined && properties.keyVault !== null) {
    logger.debug(`Named value "${getNamePart(descriptor.nameParts, 0)}" is KeyVault-backed, preserving reference`);
    return json;
  }

  // Deep clone to avoid mutating the original
  const redacted = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  const redactedProps = redacted.properties as Record<string, unknown>;
  redactedProps.value = REDACTION_MARKER;

  logger.debug(`Redacted secret value for named value "${getNamePart(descriptor.nameParts, 0)}"`);
  return redacted;
}

function isApimNamedValueReference(value: string): boolean {
  return NAMED_VALUE_REFERENCE_PATTERN.test(value);
}

function shouldRedactLiteral(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === REDACTION_MARKER) {
    return false;
  }
  return !isApimNamedValueReference(trimmed);
}

function redactAuthorizationHeaderValue(
  value: string
): { redactedValue: string; wasRedacted: boolean } {
  const bearerMatch = BEARER_TOKEN_PATTERN.exec(value);
  if (bearerMatch) {
    const [, scheme, spacing, tokenValue, suffix] = bearerMatch;
    if (!shouldRedactLiteral(tokenValue)) {
      return { redactedValue: value, wasRedacted: false };
    }

    return {
      redactedValue: `${scheme}${spacing}${REDACTION_MARKER}${suffix}`,
      wasRedacted: true,
    };
  }

  if (!shouldRedactLiteral(value)) {
    return { redactedValue: value, wasRedacted: false };
  }

  return { redactedValue: REDACTION_MARKER, wasRedacted: true };
}

/**
 * Redact inline literal secrets in policy XML content.
 */
export function redactPolicySecrets(
  policyContent: string
): { redactedContent: string; findings: PolicySecretFinding[] } {
  const findings: PolicySecretFinding[] = [];
  const addFinding = (location: string): void => {
    findings.push({ location });
  };

  let redacted = policyContent;

  redacted = redacted.replace(/<set-header\b[\s\S]*?<\/set-header>/gi, (setHeaderBlock) => {
    const nameMatch = /\bname\s*=\s*["']([^"']+)["']/i.exec(setHeaderBlock);
    const headerName = nameMatch?.[1]?.toLowerCase();
    if (!headerName || !SECRET_HEADER_NAMES.has(headerName)) {
      return setHeaderBlock;
    }

    return setHeaderBlock.replace(
      /(<value\b[^>]*>)([\s\S]*?)(<\/value>)/gi,
      (_full, openTag: string, value: string, closeTag: string) => {
        const shouldRedactHeaderValue = shouldRedactLiteral(value);
        const { redactedValue, wasRedacted } = headerName === 'authorization'
          ? redactAuthorizationHeaderValue(value)
          : {
              redactedValue: shouldRedactHeaderValue ? REDACTION_MARKER : value,
              wasRedacted: shouldRedactHeaderValue,
            };
        if (!wasRedacted) {
          return `${openTag}${value}${closeTag}`;
        }

        addFinding(`set-header[${headerName}]`);
        return `${openTag}${redactedValue}${closeTag}`;
      }
    );
  });

  redacted = redacted.replace(/<set-query-parameter\b[\s\S]*?<\/set-query-parameter>/gi, (setQueryBlock) => {
    const nameMatch = /\bname\s*=\s*["']([^"']+)["']/i.exec(setQueryBlock);
    const parameterName = nameMatch?.[1]?.toLowerCase();
    if (!parameterName || !SECRET_QUERY_PARAMETER_NAMES.has(parameterName)) {
      return setQueryBlock;
    }

    return setQueryBlock.replace(
      /(<value\b[^>]*>)([\s\S]*?)(<\/value>)/gi,
      (_full, openTag: string, value: string, closeTag: string) => {
        if (!shouldRedactLiteral(value)) {
          return `${openTag}${value}${closeTag}`;
        }

        addFinding(`set-query-parameter[${parameterName}]`);
        return `${openTag}${REDACTION_MARKER}${closeTag}`;
      }
    );
  });

  redacted = redacted.replace(/<authentication-basic\b[^>]*>/gi, (tag) => {
    return tag.replace(/(\bpassword\s*=\s*["'])([^"']*)(["'])/i, (_full, prefix: string, value: string, suffix: string) => {
      if (!shouldRedactLiteral(value)) {
        return `${prefix}${value}${suffix}`;
      }

      addFinding('authentication-basic@password');
      return `${prefix}${REDACTION_MARKER}${suffix}`;
    });
  });

  redacted = redacted.replace(/<authentication-certificate\b[^>]*>/gi, (tag) => {
    return tag.replace(/(\bbody\s*=\s*["'])([^"']*)(["'])/i, (_full, prefix: string, value: string, suffix: string) => {
      if (!shouldRedactLiteral(value)) {
        return `${prefix}${value}${suffix}`;
      }

      addFinding('authentication-certificate@body');
      return `${prefix}${REDACTION_MARKER}${suffix}`;
    });
  });

  redacted = redacted.replace(/<authentication-certificate\b[\s\S]*?<\/authentication-certificate>/gi, (certificateBlock) => {
    return certificateBlock.replace(
      /(<certificate\b[^>]*>)([\s\S]*?)(<\/certificate>)/gi,
      (_full, openTag: string, value: string, closeTag: string) => {
        if (!shouldRedactLiteral(value)) {
          return `${openTag}${value}${closeTag}`;
        }

        addFinding('authentication-certificate/certificate');
        return `${openTag}${REDACTION_MARKER}${closeTag}`;
      }
    );
  });

  for (const keySection of ['issuer-signing-keys', 'decryption-keys']) {
    const sectionRegex = new RegExp(`<${keySection}\\b[\\s\\S]*?<\\/${keySection}>`, 'gi');
    redacted = redacted.replace(sectionRegex, (sectionBlock) => {
      return sectionBlock.replace(
        /(<key\b[^>]*>)([\s\S]*?)(<\/key>)/gi,
        (_full, openTag: string, value: string, closeTag: string) => {
          if (!shouldRedactLiteral(value)) {
            return `${openTag}${value}${closeTag}`;
          }

          addFinding(`validate-jwt ${keySection}/key`);
          return `${openTag}${REDACTION_MARKER}${closeTag}`;
        }
      );
    });
  }

  // AccountKey/SharedAccessKey fragments are used by storage/service-bus style
  // connection strings. App Insights connection strings use InstrumentationKey
  // and therefore do not match this pattern (allow-listed by design).
  // Value exclusions:
  // - ';' stops at the next connection-string key/value delimiter
  // - whitespace/newlines avoid over-capturing adjacent text
  // - '<' and '"' avoid crossing into XML tags/attributes
  redacted = redacted.replace(/(AccountKey|SharedAccessKey)\s*=\s*([^;\r\n<"\s]+)/gi, (_full, key: string, value: string) => {
    if (!shouldRedactLiteral(value)) {
      return `${key}=${value}`;
    }

    addFinding(`connection-string[${key}]`);
    return `${key}=${REDACTION_MARKER}`;
  });

  return {
    redactedContent: redacted,
    findings,
  };
}

/**
 * Redact inline literal secrets in policy XML content and emit a warning log
 * for every finding. This is the entry point services should use so that
 * redaction and warning always happen together; the underlying
 * {@link redactPolicySecrets} (pure, exported) and `warnPolicySecretRedactions`
 * (private) helpers stay separate for testability.
 */
export function redactAndWarnPolicySecrets(
  descriptor: ResourceDescriptor,
  policyContent: string
): string {
  const { redactedContent, findings } = redactPolicySecrets(policyContent);
  warnPolicySecretRedactions(descriptor, findings);
  return redactedContent;
}

/**
 * Emit warning logs for policy secret redaction findings.
 */
function warnPolicySecretRedactions(
  descriptor: ResourceDescriptor,
  findings: PolicySecretFinding[]
): void {
  const label = buildResourceLabel(descriptor);
  for (const finding of findings) {
    logger.warn(
      `Found and redacted inline secret in ${label} (${finding.location}). ` +
      `Publish will fail while '${REDACTION_MARKER}' remains. ` +
      'Update the policy to use a named value: ' +
      'https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-properties'
    );
  }
}
