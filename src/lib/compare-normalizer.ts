/**
 * T-CMP-03: Normalization module for compare command.
 *
 * Strips instance-specific and read-only fields from APIM resource JSON so
 * that two independently-managed instances can be compared on content alone.
 *
 * Ported from tests/integration/all-resource-types/Compare-ApimInstance.ps1
 * (Normalize-PropertyValue / Normalize-Resource functions).
 */

import { ApimServiceContext } from '../models/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Top-level ARM envelope fields that are always stripped before comparison. */
export const STRIP_TOP_LEVEL_FIELDS = new Set([
  'id',
  'type',
  'name',
  'systemData',
  'etag',
]);

/**
 * Read-only properties on the ROOT `properties` object that are stripped.
 * These change per publish or are APIM-internal state.
 */
export const STRIP_ROOT_PROPERTIES = new Set([
  'provisioningState',
  'createdAtUtc',
  'lastModifiedDate',
  'isCurrent',
  'isOnline',
  'stateComment',
  'createdDate',
]);

/**
 * Timestamp properties stripped at ANY depth.
 * They change on every publish and carry no semantic comparison value.
 */
export const STRIP_TIMESTAMP_PROPERTIES = new Set([
  'lastStatus',              // Key Vault named values (contains timeStampUtc)
  'specificationLastUpdated', // API specification timestamp
  'createdDateTime',          // Release/other resource creation timestamps
  'updatedDateTime',          // Release/other resource update timestamps
]);

/**
 * Properties ignored on request/response objects (those that have a
 * `representations` array), e.g. WSDL import generates varying descriptions.
 */
export const REQUEST_RESPONSE_IGNORED = new Set(['description']);

/**
 * Properties ignored on representation objects (those that have a `contentType`
 * or `schemaId` key). Spec-based publish does not re-populate these fields.
 */
export const REPRESENTATION_IGNORED = new Set(['description', 'schemaId', 'typeName']);

// ── Public API ───────────────────────────────────────────────────────────────

export interface NormalizeContext {
  /** Source APIM service context (subscription, rg, service name). */
  source: ApimServiceContext;
  /** Target APIM service context (subscription, rg, service name). */
  target: ApimServiceContext;
}

/**
 * Normalize a full ARM resource object for comparison.
 *
 * 1. Strips top-level ARM envelope fields (`id`, `type`, `name`, etc.).
 * 2. Normalizes the `properties` bag using `normalizeValue` with `isRoot=true`
 *    (strips read-only root properties).
 * 3. Normalizes all other top-level bags (e.g. `location`, `sku`).
 *
 * @param resource - Raw ARM response object (from listResources / getResource).
 * @param ctx - Source and target service contexts used for string replacement.
 * @returns A normalized plain object suitable for JSON comparison.
 */
export function normalizeResource(
  resource: Record<string, unknown>,
  ctx: NormalizeContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(resource)) {
    if (STRIP_TOP_LEVEL_FIELDS.has(key)) continue;
    if (key === 'properties') {
      out[key] = normalizeValue(value, ctx, /* isRoot */ true);
    } else {
      out[key] = normalizeValue(value, ctx, false);
    }
  }

  return out;
}

/**
 * Recursively normalize a value:
 * - Strings: replace instance-specific substrings with placeholders.
 * - Arrays: recursively normalize items, then sort for order-independent comparison.
 * - Objects: strip disallowed keys, recursively normalize values.
 * - Primitives (number, boolean, null): returned as-is.
 *
 * @param value - The value to normalize (any JSON type).
 * @param ctx - Normalization context (source/target instances).
 * @param isRoot - True when this is the root `properties` object; triggers
 *                 stripping of read-only root properties.
 */
export function normalizeValue(
  value: unknown,
  ctx: NormalizeContext,
  isRoot = false,
): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return normalizeString(value, ctx);
  }

  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeValue(item, ctx, false));
    // Sort for order-independent comparison (same as PowerShell Sort-Object)
    return normalized.slice().sort((a, b) => {
      const aJson = JSON.stringify(a) ?? '';
      const bJson = JSON.stringify(b) ?? '';
      return aJson < bJson ? -1 : aJson > bJson ? 1 : 0;
    });
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Detect request/response objects (have 'representations' array)
    const isRequestResponse = 'representations' in obj && Array.isArray(obj['representations']);
    // Detect representation objects (have 'contentType' or 'schemaId')
    const isRepresentation = 'contentType' in obj || 'schemaId' in obj;

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (STRIP_TIMESTAMP_PROPERTIES.has(key)) continue;
      if (isRoot && STRIP_ROOT_PROPERTIES.has(key)) continue;
      if (isRequestResponse && REQUEST_RESPONSE_IGNORED.has(key)) continue;
      if (isRepresentation && REPRESENTATION_IGNORED.has(key)) continue;
      out[key] = normalizeValue(val, ctx, false);
    }
    return out;
  }

  // Primitive (number, boolean)
  return value;
}

// ── String normalization ─────────────────────────────────────────────────────

/**
 * Replace all instance-specific substrings in a string with stable placeholders.
 *
 * Order matters — most-specific patterns first to avoid partial replacements.
 */
export function normalizeString(s: string, ctx: NormalizeContext): string {
  const { source: src, target: tgt } = ctx;

  // Derive the APIM service ARM path from context.baseUrl (built by buildArmBaseUrl
  // in cloud-config.ts using the cloud endpoint configuration and resource-types model).
  // This avoids hardcoding 'Microsoft.ApiManagement/service' in the normalizer.
  const srcApimPath = getArmPathFromBaseUrl(src.baseUrl);
  const tgtApimPath = getArmPathFromBaseUrl(tgt.baseUrl);

  // Extract subscription+RG path = everything before /providers/ in the APIM path
  const srcSubRgPath = splitAtProviders(srcApimPath);
  const tgtSubRgPath = splitAtProviders(tgtApimPath);

  // Full APIM ARM path (most specific — do first)
  s = replaceAll(s, srcApimPath, '/subscriptions/{{sub}}/resourceGroups/{{rg}}/providers/Microsoft.ApiManagement/service/{{apim-name}}');
  s = replaceAll(s, tgtApimPath, '/subscriptions/{{sub}}/resourceGroups/{{rg}}/providers/Microsoft.ApiManagement/service/{{apim-name}}');

  // Broader subscription+RG (no provider suffix)
  if (srcSubRgPath) {
    s = replaceAll(s, srcSubRgPath, '/subscriptions/{{sub}}/resourceGroups/{{rg}}');
  }
  if (tgtSubRgPath) {
    s = replaceAll(s, tgtSubRgPath, '/subscriptions/{{sub}}/resourceGroups/{{rg}}');
  }

  // Subscription only
  s = replaceAll(s, `/subscriptions/${src.subscriptionId}`, '/subscriptions/{{sub}}');
  s = replaceAll(s, `/subscriptions/${tgt.subscriptionId}`, '/subscriptions/{{sub}}');

  // Service name in any remaining position
  s = replaceAll(s, src.serviceName, '{{apim-name}}');
  s = replaceAll(s, tgt.serviceName, '{{apim-name}}');

  // Key Vault URIs — different vault names per resource group
  s = s.replace(/https:\/\/[a-zA-Z0-9-]+\.vault\.azure\.net/g, 'https://{{keyvault}}.vault.azure.net');

  // Key Vault secret name prefixes (src-* vs tgt-*)
  s = s.replace(/\/secrets\/(src|tgt)-/g, '/secrets/{{prefix}}-');

  // App Insights resource IDs (different instance names per RG)
  s = s.replace(
    /\/providers\/Microsoft\.Insights\/components\/[a-zA-Z0-9-]+/g,
    '/providers/Microsoft.Insights/components/{{appinsights}}',
  );

  // Event Hub namespace names in resource IDs
  s = s.replace(
    /\/providers\/Microsoft\.EventHub\/namespaces\/[a-zA-Z0-9-]+/g,
    '/providers/Microsoft.EventHub/namespaces/{{eventhub}}',
  );

  // Auto-generated APIM IDs (24-char lowercase hex)
  s = s.replace(/\b[0-9a-f]{24}\b/g, '{{auto-id}}');

  // GUIDs (8-4-4-4-12 hex)
  s = s.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '{{guid}}',
  );

  return s;
}

// ── Auto-ID resource keying ──────────────────────────────────────────────────

/** Regex matching 24-char lowercase hex auto-generated APIM IDs. */
const AUTO_ID_24_HEX = /^[0-9a-f]{24}$/;
/** Regex matching UUID-format auto-generated IDs. */
const AUTO_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true if the resource name is auto-generated by APIM (24-char hex or UUID).
 * Auto-generated names are recreated on every publish and cannot be matched by name.
 */
export function isAutoGeneratedName(name: string): boolean {
  return AUTO_ID_24_HEX.test(name) || AUTO_ID_UUID.test(name);
}

/**
 * Build a name → resource map from an ARM resource list, handling exclusions
 * and auto-generated IDs.
 *
 * Resources with auto-generated names (24-char hex or UUID) are keyed by their
 * sorted normalized content as `{{auto-id-0}}`, `{{auto-id-1}}`, … so that
 * equivalent resources from source and target receive the same positional key.
 *
 * @param items - Raw ARM resource objects (from listResources).
 * @param ctx - Normalization context for string replacement.
 * @param excludeNames - Resource names to exclude (case-sensitive).
 * @returns Ordered map of resource name → resource object.
 */
export function buildResourceMap(
  items: Record<string, unknown>[],
  ctx: NormalizeContext,
  excludeNames: ReadonlySet<string> = new Set(),
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const autoIdItems: Record<string, unknown>[] = [];

  for (const item of items) {
    const name = getResourceName(item);
    if (!name) continue;
    if (excludeNames.has(name)) continue;

    if (isAutoGeneratedName(name)) {
      autoIdItems.push(item);
    } else {
      map.set(name, item);
    }
  }

  // Sort auto-ID items by their normalized JSON content so equivalent
  // resources receive the same positional key across source and target.
  if (autoIdItems.length > 0) {
    const sorted = autoIdItems.slice().sort((a, b) => {
      const aJson = JSON.stringify(normalizeValue(a, ctx, false));
      const bJson = JSON.stringify(normalizeValue(b, ctx, false));
      return aJson < bJson ? -1 : aJson > bJson ? 1 : 0;
    });
    for (let i = 0; i < sorted.length; i++) {
      map.set(`{{auto-id-${i}}}`, sorted[i]);
    }
  }

  return map;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the resource name from an ARM resource object.
 * Uses the last path segment of the `id` field, falling back to `name`.
 */
export function getResourceName(resource: Record<string, unknown>): string | undefined {
  const id = resource['id'];
  if (typeof id === 'string' && id.length > 0) {
    const parts = id.split('/');
    return parts[parts.length - 1];
  }
  const name = resource['name'];
  if (typeof name === 'string') return name;
  return undefined;
}

/**
 * Simple global string replace (no regex special chars in needle).
 */
function replaceAll(s: string, needle: string, replacement: string): string {
  if (!needle) return s;
  return s.split(needle).join(replacement);
}

// ── URL path helpers ─────────────────────────────────────────────────────────

/**
 * Extracts the path component from an ARM base URL string.
 *
 * `context.baseUrl` is built by `buildArmBaseUrl` in cloud-config.ts and has
 * the form: `https://{management-host}/subscriptions/{sub}/resourceGroups/{rg}/providers/...`
 *
 * Stripping the protocol + host yields the path starting from `/subscriptions/`.
 * URL.pathname is used so sovereign-cloud endpoints (China, USGov, Germany) are
 * handled transparently without any hardcoded host names.
 *
 * @param baseUrl - Full ARM base URL for an APIM service instance.
 * @returns Path component, e.g. `/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/name`
 */
export function getArmPathFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).pathname;
  } catch {
    // Fallback: strip everything up to (and including) the first occurrence of "://" then the host
    const match = /^https?:\/\/[^/]+(\/.*)/i.exec(baseUrl);
    return match?.[1] ?? '';
  }
}

/**
 * Returns the portion of an APIM ARM path before the `/providers/` segment.
 *
 * E.g. `/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ApiManagement/service/name`
 * → `/subscriptions/sub/resourceGroups/rg`
 *
 * Returns an empty string if `/providers/` is not found.
 */
export function splitAtProviders(armPath: string): string {
  const idx = armPath.indexOf('/providers/');
  return idx >= 0 ? armPath.slice(0, idx) : '';
}
