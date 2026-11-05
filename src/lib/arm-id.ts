// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Reading names and scope from APIM ARM resource IDs, such as
 * `/subscriptions/{s}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{apim}/workspaces/{ws}/loggers/{name}`,
 * or the relative form APIM also returns (`/loggers/{name}`).
 */

import type { AssociationScope } from '../models/types.js';
import { logger } from './logger.js';

const FULL_SERVICE_ID_PATTERN =
  /\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.ApiManagement\/service\/[^/]+/i;

/**
 * Decode one ARM ID segment. A malformed escape leaves the segment as it is,
 * with a warning.
 */
export function decodeArmSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    logger.warn(`Unable to decode ARM resource ID segment; using the raw value: ${String(error)}`);
    return value;
  }
}

/**
 * The part of an ARM ID below the APIM service. Segment names are matched
 * there only, so a resource group or service named `workspaces`, `products`
 * and so on is not read as one.
 */
function pathBelowService(id: string): string {
  return id.replace(FULL_SERVICE_ID_PATTERN, '');
}

/**
 * The decoded name of the `{segment}` collection's resource in an ARM ID
 * (case-insensitive), for example `armNameAfter(id, 'loggers')`. The path
 * below the service is read as collection/name pairs, so a resource named
 * like a collection (a workspace named `backends`) is not read as one.
 */
export function armNameAfter(id: string, segment: string): string | undefined {
  const parts = pathBelowService(id).split('/').filter(Boolean);
  for (let index = 0; index + 1 < parts.length; index += 2) {
    if (parts[index].toLowerCase() === segment.toLowerCase()) {
      return decodeArmSegment(parts[index + 1]);
    }
  }
  return undefined;
}

/** The decoded last segment of an ARM ID, or undefined when it has none. */
export function armLastName(id: string): string | undefined {
  const segment = id.split('/').filter(Boolean).at(-1);
  return segment ? decodeArmSegment(segment) : undefined;
}

/** `workspace` when the ARM ID is in a workspace, otherwise `service`. */
export function armScope(id: string): AssociationScope {
  return /\/workspaces\/[^/]+(?:\/|$)/i.test(pathBelowService(id)) ? 'workspace' : 'service';
}

/**
 * The workspace an ARM reference points into: the one it names, none for a
 * full service-level ID, and `fallback` (the referencing resource's
 * workspace) for a relative reference such as `/loggers/{name}`.
 */
export function armReferenceWorkspace(id: string, fallback?: string): string | undefined {
  const workspace = armNameAfter(id, 'workspaces');
  if (workspace) {
    return workspace;
  }
  return FULL_SERVICE_ID_PATTERN.test(id) ? undefined : fallback;
}
