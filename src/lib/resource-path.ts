/**
 * T013: Resource descriptor ↔ artifact file path mapping
 * Map descriptor to directory/file paths per data-model.md artifact conventions
 */

import * as path from 'node:path';
import { ResourceDescriptor } from '../models/types.js';
import { RESOURCE_TYPE_METADATA, ResourceType } from '../models/resource-types.js';

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
 * Fills all positional `{i}` tokens in a template string with `nameParts[i]`.
 * Throws if a placeholder index has no corresponding entry in `nameParts`.
 *
 * Examples:
 *   formatTemplatePath('apis/{0}/operations/{1}', ['petstore', 'get-user'])
 *     → 'apis/petstore/operations/get-user'
 *   formatTemplatePath('', []) → ''
 */
export function formatTemplatePath(template: string, nameParts: string[]): string {
  return template.replace(/\{(\d+)\}/g, (_match, idx: string) => {
    const i = +idx;
    const value = nameParts[i];
    if (value === undefined) {
      throw new Error(
        `formatTemplatePath: nameParts[${i}] is undefined for template "${template}" ` +
        `(nameParts has ${nameParts.length} entries)`
      );
    }
    return value;
  });
}

/**
 * Returns the number of positional `{i}` placeholders in a template string.
 *
 * Used by callers that need to validate that enough name-parts have been
 * supplied before filling a template — without performing regex matching
 * themselves.
 *
 * Example:
 *   countTemplatePlaceholders('apis/{0}/operations/{1}') → 2
 *   countTemplatePlaceholders('policies/policy')         → 0
 */
export function countTemplatePlaceholders(template: string): number {
  return (template.match(/\{\d+\}/g) ?? []).length;
}

/**
 * Ensures a path starts with a single leading slash.
 *
 * Example:
 *   makeFullPath('namedValues/my-nv') → '/namedValues/my-nv'
 *   makeFullPath('/namedValues/my-nv') → '/namedValues/my-nv'
 */
export function makeFullPath(relativePath: string): string {
  return relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
}

/**
 * Strips a single leading slash from a path, if present.
 *
 * Example:
 *   makeRelativePath('/namedValues/my-nv') → 'namedValues/my-nv'
 *   makeRelativePath('namedValues/my-nv')  → 'namedValues/my-nv'
 */
export function makeRelativePath(absolutePath: string): string {
  return absolutePath.startsWith('/') ? absolutePath.substring(1) : absolutePath;
}

/**
 * Returns the resource's own name — the last element of `nameParts`.
 *
 * For 1-part types (e.g. Api, Product) `nameParts` contains only the own
 * name, so this is equivalent to `nameParts[0]`.  For 2-part types (e.g.
 * ApiOperation, ProductTag) the own name is always the final element, with
 * the parent name preceding it.  Using this helper instead of a hard-coded
 * index guards against future arity changes and avoids accidentally
 * returning the parent name.
 *
 * Throws a `RangeError` if `nameParts` is empty.
 *
 * Examples:
 *   getNameFromNameParts(['petstore'])                   → 'petstore'
 *   getNameFromNameParts(['petstore', 'get-user'])       → 'get-user'
 *   getNameFromNameParts([])                             → throws RangeError
 */
export function getNameFromNameParts(nameParts: string[]): string {
  const value = nameParts[nameParts.length - 1];
  if (value === undefined) {
    throw new RangeError('getNameFromNameParts: nameParts is empty');
  }
  return value;
}

/**
 * Returns `nameParts[index]`, throwing a descriptive `RangeError` if the
 * index is out of range.
 *
 * Prefer this over direct bracket access (`nameParts[0]`) so that missing
 * name-parts surface as an explicit error rather than a silent `undefined`.
 *
 * Examples:
 *   getNamePart(['petstore', 'get-user'], 0)  → 'petstore'
 *   getNamePart(['petstore', 'get-user'], 1)  → 'get-user'
 *   getNamePart([], 0)                        → throws RangeError
 */
export function getNamePart(nameParts: string[], index: number): string {
  const value = nameParts[index];
  if (value === undefined) {
    throw new RangeError(
      `getNamePart: nameParts[${index}] is out of range ` +
      `(nameParts has ${nameParts.length} ${nameParts.length === 1 ? 'entry' : 'entries'})`
    );
  }
  return value;
}

/**
 * Converts a positional template string to a capturing regex.
 * Each `{i}` placeholder becomes a `([^/]+)` capture group; all other
 * regex-special characters are escaped.  A trailing slash (if present)
 * is stripped before building the pattern.
 *
 * This function is intentionally **not exported** — callers should use the
 * higher-level `parseTemplatePath` helper rather than constructing regexes
 * directly.
 */
function templateToRegex(template: string): RegExp {
  const source = template
    .replace(/\/+$/, '') // strip any trailing slash
    .replace(/[.+^${}()|[\]\\]/g, (ch) => (ch === '{' || ch === '}' ? ch : `\\${ch}`))
    .replace(/\{\d+\}/g, '([^/]+)');
  return new RegExp(`^${source}$`);
}

/**
 * Matches a positional template against a slash-delimited path string and
 * returns the captured name-part values in positional order, or `undefined`
 * if the path does not match the template.
 *
 * Both artifact-directory paths and ARM path suffixes use the same
 * `{0}`, `{1}` placeholder syntax, so this single function handles both.
 * Callers are not required to know anything about regexes.
 *
 * Examples:
 *   parseTemplatePath('apis/{0}/operations/{1}', 'apis/petstore/operations/get')
 *     → ['petstore', 'get']
 *   parseTemplatePath('policies/policy', 'policies/policy')
 *     → []
 *   parseTemplatePath('apis/{0}', 'backends/b1')
 *     → undefined
 */
export function parseTemplatePath(template: string, path: string): string[] | undefined {
  const match = templateToRegex(template).exec(path);
  if (!match) return undefined;
  // Captures correspond directly to {0}, {1}, … positions in the template
  return match.slice(1);
}

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

  let resolvedDir = formatTemplatePath(metadata.artifactDirectory, descriptor.nameParts);

  // Handle workspace prefix
  if (descriptor.workspace) {
    resolvedDir = path.join('workspaces', descriptor.workspace, resolvedDir);
  }

  return path.join(baseDir, resolvedDir);
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
 * @param associationType - Type of association (apis, groups, or tags)
 * @returns Full path to association file
 */
export function buildAssociationFilePath(
  baseDir: string,
  descriptor: ResourceDescriptor,
  associationType: 'apis' | 'groups' | 'tags'
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
 * Derives the list URL path segment(s) from an ARM path suffix template.
 *
 * The list path is structurally derivable from `armPathSuffix`:
 * - Last segment is a fixed word (no placeholder) → singleton; neither path is present.
 * - Exactly one `{N}` placeholder and it is the last segment → top-level resource;
 *   `listPath` = the path before the placeholder (with a leading '/').
 * - Two or more `{N}` placeholders and the last segment is the highest-index one →
 *   child resource; `childListPath` = the collection segment immediately before the
 *   last placeholder (with a leading '/').
 *
 * Examples:
 *   deriveListPaths('namedValues/{0}')            → { listPath: '/namedValues' }
 *   deriveListPaths('apis/{0}/operations/{1}')    → { childListPath: '/operations' }
 *   deriveListPaths('policies/policy')            → {}  (singleton)
 *   deriveListPaths('apis/{0}/policies/policy')   → {}  (singleton)
 */
export function deriveListPaths(template: string): {
  listPath?: string;
  childListPath?: string;
} {
  const segments = template.split('/');
  const lastSeg = segments[segments.length - 1];

  // Singleton: last segment is a fixed word (not a `{N}` placeholder)
  if (!lastSeg || !/^\{\d+\}$/.test(lastSeg)) {
    return {};
  }

  const placeholderCount = countTemplatePlaceholders(template);

  if (placeholderCount === 1) {
    // Top-level resource: list path = everything before the placeholder
    const listBase = segments.slice(0, -1).join('/');
    return { listPath: `/${listBase}` };
  }

  // Child resource: child-list path = collection segment immediately before the last placeholder
  const collectionSeg = segments[segments.length - 2];
  return { childListPath: `/${collectionSeg}` };
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

    const nameParts = parseTemplatePath(
      metadata.artifactDirectory,
      parts.slice(startIndex, -1).join('/')
    );

    if (nameParts !== undefined) {
      return { type, nameParts, workspace };
    }
  }

  return undefined;
}

/**
 * Check if a resource type is a singleton (no list, only get).
 * Singletons have armPathSuffix ending with a fixed segment (no `{n}` placeholder).
 * E.g., ServicePolicy (`policies/policy`), ApiWiki (`apis/{0}/wikis/default`).
 */
export function isSingletonType(type: ResourceType): boolean {
  const meta = RESOURCE_TYPE_METADATA[type];
  // Singleton if the last segment doesn't contain a placeholder
  const lastSegment = meta.armPathSuffix.split('/').pop() ?? '';
  return !lastSegment.includes('{');
}

/**
 * Check if a resource type is a child type requiring a parent.
 * Child types have armPathSuffix with more path segments after the first placeholder.
 * E.g., `apis/{0}/tags/{1}` or `apis/{0}/policies/policy`.
 */
export function isChildType(type: ResourceType): boolean {
  const meta = RESOURCE_TYPE_METADATA[type];
  const placeholderCount = countTemplatePlaceholders(meta.armPathSuffix);
  // 2+ placeholders means it's definitely a child (e.g., apis/{0}/tags/{1})
  if (placeholderCount >= 2) return true;
  // Check for nested fixed-name resources under a parent (e.g., apis/{0}/policies/policy)
  const parts = meta.armPathSuffix.split('/');
  const firstPlaceholderIdx = parts.findIndex(p => p.includes('{'));
  return firstPlaceholderIdx >= 0 && firstPlaceholderIdx < parts.length - 1;
}

/**
 * Compute the publish tier for a resource type based on ARM path structure.
 * Resources are published from lowest tier to highest; same tier runs in parallel.
 *
 * Tier formula: `placeholderCount * 2 + (hasSegmentsAfterLastPlaceholder ? 1 : 0)`
 *
 * This ensures:
 * - Fewer placeholders = earlier tier (parents before children)
 * - Within same placeholder count, resources ending at a placeholder come
 *   before those with fixed segments after (e.g., operations before operation policies)
 *
 * Examples:
 *   `apis/{0}`                              → tier 2 (1 placeholder, ends at placeholder)
 *   `apis/{0}/policies/policy`              → tier 3 (1 placeholder, has suffix)
 *   `apis/{0}/operations/{1}`               → tier 4 (2 placeholders, ends at placeholder)
 *   `apis/{0}/operations/{1}/policies/policy` → tier 5 (2 placeholders, has suffix)
 */
export function getPublishTier(type: ResourceType): number {
  const meta = RESOURCE_TYPE_METADATA[type];
  const parts = meta.armPathSuffix.split('/');
  const placeholderCount = countTemplatePlaceholders(meta.armPathSuffix);

  // Find the index of the last segment containing a placeholder
  let lastPlaceholderIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].includes('{')) {
      lastPlaceholderIdx = i;
    }
  }

  // Check if there are segments after the last placeholder
  const hasSegmentsAfter = lastPlaceholderIdx >= 0 && lastPlaceholderIdx < parts.length - 1;

  return placeholderCount * 2 + (hasSegmentsAfter ? 1 : 0);
}

/**
 * Check if a resource type is a "grandchild" - has path segments after the last placeholder.
 * These types depend on an intermediate parent that must exist first.
 *
 * @deprecated Use getPublishTier() for N-tier ordering instead
 */
export function hasNestedParent(type: ResourceType): boolean {
  const meta = RESOURCE_TYPE_METADATA[type];
  const parts = meta.armPathSuffix.split('/');

  // Find the index of the last segment containing a placeholder
  let lastPlaceholderIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].includes('{')) {
      lastPlaceholderIdx = i;
    }
  }

  // No placeholders = top-level singleton (ServicePolicy), not a grandchild
  if (lastPlaceholderIdx === -1) return false;

  // Grandchild if there are segments after the last placeholder
  // AND there are at least 2 placeholders (meaning there's an intermediate parent)
  const hasSegmentsAfter = lastPlaceholderIdx < parts.length - 1;
  const placeholderCount = countTemplatePlaceholders(meta.armPathSuffix);

  return hasSegmentsAfter && placeholderCount >= 2;
}
