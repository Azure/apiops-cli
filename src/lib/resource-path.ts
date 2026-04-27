/**
 * T013: Resource descriptor ↔ artifact file path mapping
 * Map descriptor to directory/file paths per data-model.md artifact conventions
 */

import * as path from 'node:path';
import { ResourceDescriptor } from '../models/types.js';
import { RESOURCE_TYPE_METADATA, ResourceType, PLACEHOLDER_NAME, PLACEHOLDER_PARENT_NAME, PLACEHOLDER_GRANDPARENT_NAME } from '../models/resource-types.js';

/**
 * Association resource types that represent parent-child relationships
 * (not independently publishable resources).
 * These are handled specially during publishing via association files
 * (apis.json, groups.json) and should not be discovered as individual resources.
 */
const ASSOCIATION_TYPES = new Set<ResourceType>([
  ResourceType.ProductApi,
  ResourceType.ProductGroup,
  ResourceType.ProductTag,
  ResourceType.GatewayApi,
]);

/**
 * Builds the artifact directory path for a given descriptor.
 * Returns the directory where this resource's files should be stored.
 * 
 * @param baseDir - Root artifact directory
 * @param descriptor - Resource descriptor
 * @returns Full directory path (OS-normalized)
 */
export function buildArtifactDirectory(
  baseDir: string,
  descriptor: ResourceDescriptor
): string {
  const metadata = RESOURCE_TYPE_METADATA[descriptor.type];
  let dirPattern = metadata.artifactDirectory;

  // Handle workspace prefix
  if (descriptor.workspace) {
    dirPattern = path.join('workspaces', descriptor.workspace, dirPattern);
  }

  // Replace placeholders with descriptor fields.
  // Patterns use {name} for the resource's own name, {parent-name} for the parent resource,
  // and {grandparent-name} for the grandparent (used by grandchild types such as
  // ApiOperationPolicy and GraphQLResolverPolicy).
  dirPattern = dirPattern
    .replace(PLACEHOLDER_GRANDPARENT_NAME, descriptor.grandparent ?? '')
    .replace(PLACEHOLDER_PARENT_NAME, descriptor.parent ?? '')
    .replace(PLACEHOLDER_NAME, descriptor.name);

  return path.join(baseDir, dirPattern);
}

/**
 * Builds the full artifact file path for a given descriptor.
 * Returns the path to the info file (JSON/XML/MD).
 * 
 * @param baseDir - Root artifact directory
 * @param descriptor - Resource descriptor
 * @returns Full file path (OS-normalized), or undefined if resource has no info file
 */
export function buildArtifactFilePath(
  baseDir: string,
  descriptor: ResourceDescriptor
): string | undefined {
  const metadata = RESOURCE_TYPE_METADATA[descriptor.type];
  
  if (!metadata.infoFile) {
    return undefined;
  }

  const directory = buildArtifactDirectory(baseDir, descriptor);
  return path.join(directory, metadata.infoFile);
}

/**
 * Builds the policy file path for a resource that supports policies.
 * 
 * @param baseDir - Root artifact directory
 * @param descriptor - Resource descriptor
 * @returns Full path to policy.xml file
 */
export function buildPolicyFilePath(
  baseDir: string,
  descriptor: ResourceDescriptor
): string {
  const directory = buildArtifactDirectory(baseDir, descriptor);
  return path.join(directory, 'policy.xml');
}

/**
 * Builds the API specification file path.
 * 
 * @param baseDir - Root artifact directory
 * @param descriptor - API descriptor
 * @param format - Specification format (yaml, json, graphql, wsdl, wadl)
 * @returns Full path to specification file
 */
export function buildSpecificationFilePath(
  baseDir: string,
  descriptor: ResourceDescriptor,
  format: 'yaml' | 'json' | 'graphql' | 'wsdl' | 'wadl'
): string {
  if (descriptor.type !== ResourceType.Api) {
    throw new Error(`Specification path only valid for API resources, got ${descriptor.type}`);
  }

  const directory = buildArtifactDirectory(baseDir, descriptor);
  
  const extensionMap: Record<string, string> = {
    yaml: 'yaml',
    json: 'json',
    graphql: 'graphql',
    wsdl: 'wsdl',
    wadl: 'wadl',
  };

  const extension = extensionMap[format] ?? 'txt';
  return path.join(directory, `specification.${extension}`);
}

/**
 * Builds the association file path (apis.json or groups.json).
 * 
 * @param baseDir - Root artifact directory
 * @param descriptor - Product or Gateway descriptor
 * @param associationType - Type of association (apis or groups)
 * @returns Full path to association file
 */
export function buildAssociationFilePath(
  baseDir: string,
  descriptor: ResourceDescriptor,
  associationType: 'apis' | 'groups'
): string {
  const validTypes = [ResourceType.Product, ResourceType.Gateway];
  if (!validTypes.includes(descriptor.type)) {
    throw new Error(
      `Association path only valid for Product/Gateway resources, got ${descriptor.type}`
    );
  }

  const directory = buildArtifactDirectory(baseDir, descriptor);
  return path.join(directory, `${associationType}.json`);
}

/**
 * Parses an artifact file path back into a ResourceDescriptor.
 * Inverse of buildArtifactFilePath.
 * 
 * @param baseDir - Root artifact directory
 * @param filePath - Full path to artifact file
 * @returns ResourceDescriptor or undefined if path doesn't match known patterns
 */
export function parseArtifactPath(
  baseDir: string,
  filePath: string
): ResourceDescriptor | undefined {
  // Get relative path from base directory
  const relativePath = path.relative(baseDir, filePath);
  const parts = relativePath.split(path.sep);

  // Check for workspace prefix
  let workspace: string | undefined;
  let startIndex = 0;
  if (parts[0] === 'workspaces' && parts[1]) {
    workspace = parts[1];
    startIndex = 2;
  }

  // Get the file name
  const fileName = parts[parts.length - 1];
  if (!fileName) {
    return undefined;
  }

  // Try to match against each resource type's pattern
  for (const [typeKey, metadata] of Object.entries(RESOURCE_TYPE_METADATA)) {
    const type = typeKey as ResourceType;

    if (metadata.infoFile !== fileName) {
      continue;
    }

    // Skip association resource types — these are handled specially during publishing
    // via their parent's association files (apis.json, groups.json)
    if (ASSOCIATION_TYPES.has(type)) {
      return undefined;
    }

    // Extract resource names from path based on pattern
    const descriptor = extractNamesFromPath(
      parts.slice(startIndex, -1),
      type,
      workspace
    );

    if (descriptor) {
      return descriptor;
    }
  }

  return undefined;
}

/**
 * Helper to extract resource names from directory path parts.
 * Uses the artifact directory patterns from RESOURCE_TYPE_METADATA to match
 * all 33 resource types deterministically.
 */
function extractNamesFromPath(
  pathParts: string[],
  type: ResourceType,
  workspace?: string
): ResourceDescriptor | undefined {
  const metadata = RESOURCE_TYPE_METADATA[type];
  // Split the artifact directory pattern into its expected segments and strip trailing '/'
  const patternParts = metadata.artifactDirectory
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);

  // ServicePolicy has an empty artifactDirectory — matches zero path parts
  if (patternParts.length === 0 && pathParts.length === 0) {
    return { type, name: 'policy', workspace };
  }

  if (patternParts.length !== pathParts.length) {
    return undefined;
  }

  // Walk through each segment comparing literal text against the pattern;
  // collect placeholder values.
  const placeholders = new Map<string, string>();

  for (let i = 0; i < patternParts.length; i++) {
    const pattern = patternParts[i];
    const actual = pathParts[i];
    if (!pattern || !actual) return undefined;

    // Check if this segment is one of the known placeholder tokens
    if (
      pattern === PLACEHOLDER_NAME ||
      pattern === PLACEHOLDER_PARENT_NAME ||
      pattern === PLACEHOLDER_GRANDPARENT_NAME
    ) {
      placeholders.set(pattern, actual);
    } else if (pattern !== actual) {
      // Literal segment mismatch
      return undefined;
    }
  }

  const descriptor: ResourceDescriptor = { type, name: '', workspace };

  const namePlaceholder = placeholders.get(PLACEHOLDER_NAME);
  const parentNamePlaceholder = placeholders.get(PLACEHOLDER_PARENT_NAME);
  const grandparentNamePlaceholder = placeholders.get(PLACEHOLDER_GRANDPARENT_NAME);

  // Set descriptor.name from {name}.
  // Grandchild types (ApiOperationPolicy, GraphQLResolverPolicy) omit {name} from their
  // artifact directory patterns; fall back to {grandparent-name} (the API name) so that
  // ARM URI construction — which uses descriptor.name for the {name} slot — works correctly.
  if (namePlaceholder) {
    descriptor.name = namePlaceholder;
  } else if (grandparentNamePlaceholder) {
    descriptor.name = grandparentNamePlaceholder;
  }

  if (parentNamePlaceholder) {
    descriptor.parent = parentNamePlaceholder;
  }

  if (grandparentNamePlaceholder) {
    descriptor.grandparent = grandparentNamePlaceholder;
  }

  return descriptor.name ? descriptor : undefined;
}
