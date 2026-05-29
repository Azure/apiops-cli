// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T012: Resource descriptor ↔ ARM URI mapping
 * Build full ARM URL from ApimServiceContext + ResourceDescriptor
 */

import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { RESOURCE_TYPE_METADATA, ResourceType } from '../models/resource-types.js';
import { formatTemplatePath, parseTemplatePath, countTemplatePlaceholders, makeFullPath, makeRelativePath } from './resource-path.js';

/**
 * Builds the full ARM resource URI for a given descriptor and service context.
 * Includes workspace prefix if descriptor.workspace is set.
 *
 * @param context - APIM service context containing base URL
 * @param descriptor - Resource descriptor with type and nameParts
 * @returns Full ARM URL including API version query parameter
 */
export function buildArmUri(
  context: ApimServiceContext,
  descriptor: ResourceDescriptor
): string {
  const metadata = RESOURCE_TYPE_METADATA[descriptor.type];

  // Validate that all positional placeholders have a corresponding name-part
  const placeholderCount = countTemplatePlaceholders(metadata.armPathSuffix);
  if (descriptor.nameParts.length < placeholderCount) {
    throw new Error(
      `Unresolved placeholder in ARM path for ${descriptor.type}: expected ${placeholderCount} name-parts, got ${descriptor.nameParts.length}`
    );
  }

  // URL-encode each name part before filling the ARM path template
  const armPath = formatTemplatePath(metadata.armPathSuffix, descriptor.nameParts.map(encodeURIComponent));

  // Add workspace prefix if workspace-scoped; prepend '/' to produce an absolute path
  const fullPath = descriptor.workspace
    ? makeFullPath(`workspaces/${encodeURIComponent(descriptor.workspace)}/${armPath}`)
    : makeFullPath(armPath);

  return `${context.baseUrl}${fullPath}?api-version=${context.apiVersion}`;
}

/**
 * Parses an ARM resource URI into a ResourceDescriptor.
 * Inverse of buildArmUri.
 *
 * @param uri - Full ARM resource URI
 * @param context - APIM service context for validation
 * @returns ResourceDescriptor or undefined if URI doesn't match expected pattern
 */
export function parseArmUri(
  uri: string,
  context: ApimServiceContext
): ResourceDescriptor | undefined {
  // Remove query parameters
  const urlWithoutQuery = uri.split('?')[0];

  // Remove base URL to get relative path
  if (!urlWithoutQuery?.startsWith(context.baseUrl)) {
    return undefined;
  }

  let relativePath = urlWithoutQuery.substring(context.baseUrl.length);

  // Extract workspace if present
  let workspace: string | undefined;
  const workspaceMatch = relativePath.match(/^\/workspaces\/([^/]+)(.*)/);
  if (workspaceMatch && workspaceMatch[1] && workspaceMatch[2]) {
    workspace = decodeURIComponent(workspaceMatch[1]);
    relativePath = workspaceMatch[2];
  }

  // Strip the leading '/' — armPathSuffix templates have no leading slash
  relativePath = makeRelativePath(relativePath);

  // Try to match against each resource type's ARM path pattern
  for (const [typeKey, metadata] of Object.entries(RESOURCE_TYPE_METADATA)) {
    const type = typeKey as ResourceType;

    // Use the shared parseTemplatePath helper — no direct regex construction here
    const nameParts = parseTemplatePath(metadata.armPathSuffix, relativePath);

    if (nameParts) {
      return { type, nameParts: nameParts.map((m) => decodeURIComponent(m)), workspace };
    }
  }

  return undefined;
}

/**
 * Builds a human-readable ARM-path-style label for log output.
 *
 * Fills every `{i}` placeholder in `armPathSuffix` with `nameParts[i]`
 * (no encoding — this is for display only).
 *
 * Examples:
 *   NamedValue ['mySecret']                 → 'namedValues/mySecret'
 *   ApiOperation ['petstore', 'get-user']   → 'apis/petstore/operations/get-user'
 *   ApiOperationPolicy ['petstore', 'get']  → 'apis/petstore/operations/get/policies/policy'
 *   ServicePolicy []                        → 'policies/policy'
 *
 * @param descriptor - Resource descriptor
 * @returns ARM-path-style label string
 */
export function buildResourceLabel(descriptor: ResourceDescriptor): string {
  const metadata = RESOURCE_TYPE_METADATA[descriptor.type];
  // armPathSuffix has no leading slash, so the result is already relative
  return formatTemplatePath(metadata.armPathSuffix, descriptor.nameParts);
}
