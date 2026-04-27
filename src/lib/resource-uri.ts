/**
 * T012: Resource descriptor ↔ ARM URI mapping
 * Build full ARM URL from ApimServiceContext + ResourceDescriptor
 */

import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { RESOURCE_TYPE_METADATA, ResourceType } from '../models/resource-types.js';

/**
 * Builds the full ARM resource URI for a given descriptor and service context.
 * Includes workspace prefix if descriptor.workspace is set.
 * 
 * @param context - APIM service context containing base URL
 * @param descriptor - Resource descriptor with type, name, parent, etc.
 * @returns Full ARM URL including API version query parameter
 */
export function buildArmUri(
  context: ApimServiceContext,
  descriptor: ResourceDescriptor
): string {
  const metadata = RESOURCE_TYPE_METADATA[descriptor.type];
  let path = metadata.armPathSuffix;

  // Replace placeholders with actual values
  path = path.replace('{name}', encodeURIComponent(descriptor.name));

  if (descriptor.parent) {
    path = path.replace('{apiName}', encodeURIComponent(descriptor.parent));
    path = path.replace('{productName}', encodeURIComponent(descriptor.parent));
    path = path.replace('{gatewayName}', encodeURIComponent(descriptor.parent));
  }

  if (descriptor.grandparent) {
    // For grandchild resources, replace the API name placeholder
    path = path.replace('{apiName}', encodeURIComponent(descriptor.grandparent));
  }

  // Handle child resources that need parent in path
  if (descriptor.type === ResourceType.ApiOperation) {
    path = path.replace('{opName}', encodeURIComponent(descriptor.name));
  }
  if (descriptor.type === ResourceType.ApiOperationPolicy) {
    path = path.replace('{opName}', encodeURIComponent(descriptor.parent ?? ''));
  }
  if (descriptor.type === ResourceType.GraphQLResolver) {
    path = path.replace('{resolverName}', encodeURIComponent(descriptor.name));
  }
  if (descriptor.type === ResourceType.GraphQLResolverPolicy) {
    path = path.replace('{resolverName}', encodeURIComponent(descriptor.parent ?? ''));
  }
  if (descriptor.type === ResourceType.ProductGroup) {
    path = path.replace('{groupName}', encodeURIComponent(descriptor.name));
  }
  if (descriptor.type === ResourceType.ProductTag) {
    path = path.replace('{tagName}', encodeURIComponent(descriptor.name));
  }
  if (descriptor.type === ResourceType.ApiTag) {
    path = path.replace('{tagName}', encodeURIComponent(descriptor.name));
  }
  if (descriptor.type === ResourceType.ApiDiagnostic) {
    path = path.replace('{diagName}', encodeURIComponent(descriptor.name));
  }
  if (descriptor.type === ResourceType.ApiSchema) {
    path = path.replace('{schemaName}', encodeURIComponent(descriptor.name));
  }
  if (descriptor.type === ResourceType.ApiRelease) {
    path = path.replace('{releaseName}', encodeURIComponent(descriptor.name));
  }
  if (descriptor.type === ResourceType.ApiTagDescription) {
    path = path.replace('{tagDescName}', encodeURIComponent(descriptor.name));
  }

  // Validate all placeholders were resolved
  if (path.includes('{') || path.includes('}')) {
    throw new Error(
      `Unresolved placeholder in ARM path for ${descriptor.type}: ${path}`
    );
  }

  // Add workspace prefix if workspace-scoped
  if (descriptor.workspace) {
    path = `/workspaces/${encodeURIComponent(descriptor.workspace)}${path}`;
  }

  // Construct full URL
  const url = `${context.baseUrl}${path}?api-version=${context.apiVersion}`;
  return url;
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

  // Try to match against each resource type's ARM path pattern
  for (const [typeKey, metadata] of Object.entries(RESOURCE_TYPE_METADATA)) {
    const type = typeKey as ResourceType;
    const pattern = metadata.armPathSuffix;

    // Convert ARM path pattern to regex
    const regexPattern = pattern
      .replace(/\{name\}/g, '([^/]+)')
      .replace(/\{apiName\}/g, '([^/]+)')
      .replace(/\{productName\}/g, '([^/]+)')
      .replace(/\{gatewayName\}/g, '([^/]+)')
      .replace(/\{opName\}/g, '([^/]+)')
      .replace(/\{resolverName\}/g, '([^/]+)')
      .replace(/\{groupName\}/g, '([^/]+)')
      .replace(/\{tagName\}/g, '([^/]+)')
      .replace(/\{diagName\}/g, '([^/]+)')
      .replace(/\{schemaName\}/g, '([^/]+)')
      .replace(/\{releaseName\}/g, '([^/]+)')
      .replace(/\{tagDescName\}/g, '([^/]+)');

    const regex = new RegExp(`^${regexPattern}$`);
    const match = relativePath.match(regex);

    if (match) {
      // Extract captured groups based on resource type
      const descriptor: ResourceDescriptor = {
        type,
        name: '',
        workspace,
      };

      // Parse based on specific resource type structure
      if (match[1]) {
        descriptor.name = decodeURIComponent(match[1]);
      }
      if (match[2] && match[1]) {
        // This is a child resource
        descriptor.parent = decodeURIComponent(match[1]);
        descriptor.name = decodeURIComponent(match[2]);
      }
      if (match[3] && match[2] && match[1]) {
        // This is a grandchild resource
        descriptor.grandparent = decodeURIComponent(match[1]);
        descriptor.parent = decodeURIComponent(match[2]);
        descriptor.name = decodeURIComponent(match[3]);
      }

      return descriptor;
    }
  }

  return undefined;
}

/**
 * Builds a human-readable ARM-path-style label for log output.
 *
 * Takes the resource type's armPathSuffix, strips the leading '/', then fills
 * every {placeholder} token using only the descriptor's available fields —
 * no per-type hard-coding required.
 *
 * Algorithm:
 *   1. Strip the leading '/' from armPathSuffix.
 *   2. Collect all {placeholder} tokens in order of appearance.
 *   3. Detect whether the path ends with a fixed segment after the last
 *      placeholder (singleton resources such as /policies/policy or
 *      /wikis/default).
 *   4. Build a value list to substitute right-to-left:
 *      - Named resources (path ends with a placeholder):
 *          [descriptor.name, descriptor.parent, descriptor.grandparent]
 *      - Singleton resources (path ends with a fixed segment):
 *          [descriptor.parent ?? descriptor.name, descriptor.name, ...]
 *        (The nearest ancestor fills the last placeholder, then the next
 *        ancestor fills the one before it.)
 *   5. Replace placeholders right-to-left with the value list.
 *
 * Examples:
 *   namedValues/my-secret
 *   apis/petstore/operations/get-user
 *   apis/petstore/operations/get-user/policies/policy
 *
 * @param descriptor - Resource descriptor
 * @returns ARM-path-style label string
 */
export function buildResourceLabel(descriptor: ResourceDescriptor): string {
  const metadata = RESOURCE_TYPE_METADATA[descriptor.type];
  let label = metadata.armPathSuffix.substring(1); // strip leading '/'

  // Collect all {placeholder} tokens in appearance order.
  const placeholders = [...label.matchAll(/\{[^}]+\}/g)];
  if (placeholders.length === 0) {
    return label; // Fixed-path singleton with no variable segments (e.g. ServicePolicy)
  }

  const lastMatch = placeholders[placeholders.length - 1];
  const lastEnd = lastMatch.index + lastMatch[0].length;
  const hasFixedSuffix = lastEnd < label.length; // e.g. ".../policies/policy" after last {…}

  // Value list to consume right-to-left into the placeholders.
  //
  // For named resources the rightmost placeholder IS the resource's own name, so
  // descriptor.name goes first.  For singleton resources (fixed suffix) the
  // rightmost placeholder is the nearest named ancestor (the operation or resolver
  // that owns the policy/wiki), so descriptor.parent goes first instead.
  const values: string[] = hasFixedSuffix
    ? [
        descriptor.parent ?? descriptor.name, // nearest ancestor → last placeholder
        descriptor.name,                       // next ancestor  → second-to-last
        ...(descriptor.grandparent !== undefined ? [descriptor.grandparent] : []),
      ]
    : [
        descriptor.name,                       // own name → last placeholder
        ...(descriptor.parent !== undefined ? [descriptor.parent] : []),
        ...(descriptor.grandparent !== undefined ? [descriptor.grandparent] : []),
      ];

  // Substitute placeholders from right to left.
  let valueIdx = 0;
  for (let i = placeholders.length - 1; i >= 0 && valueIdx < values.length; i--) {
    label = label.replace(placeholders[i][0], values[valueIdx++]);
  }

  return label;
}
