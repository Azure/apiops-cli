// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T026: Secret redaction service
 * Detect properties.secret === true on named values,
 * replace properties.value with redaction marker.
 */

import { ResourceType } from '../models/resource-types.js';
import { ResourceDescriptor } from '../models/types.js';
import { logger } from '../lib/logger.js';
import { getNamePart } from '../lib/resource-path.js';

/** Marker used to replace secret values in extracted artifacts */
export const REDACTION_MARKER = '*** REDACTED ***';

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
