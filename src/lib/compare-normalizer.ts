// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Resource normalization for comparison
 * Strips instance-specific values (subscription IDs, resource groups, service names,
 * timestamps, auto-generated IDs) to enable deep equality checks across APIM instances.
 */

export interface NormalizeContext {
  sourceServiceName: string;
  targetServiceName: string;
  sourceSubscriptionId: string;
  targetSubscriptionId: string;
  sourceResourceGroup: string;
  targetResourceGroup: string;
}

// Fields stripped from top-level ARM envelope
const STRIP_TOP_LEVEL_FIELDS = new Set([
  'id',
  'type',
  'name',
  'systemData',
  'etag',
]);

// Read-only properties stripped at root properties level only
const STRIP_READ_ONLY_PROPERTIES = new Set([
  'provisioningState',
  'createdAtUtc',
  'lastModifiedDate',
  'isCurrent',
  'isOnline',
  'stateComment',
  'createdDate',
]);

// Timestamp properties stripped at ANY depth
const STRIP_TIMESTAMP_PROPERTIES = new Set([
  'lastStatus', // Key Vault named values (contains timeStampUtc)
  'specificationLastUpdated', // API specification timestamp
  'createdDateTime', // Release/other resource creation timestamps
  'updatedDateTime', // Release/other resource update timestamps
]);

// Properties ignored on request/response objects (have 'representations' array)
const REQUEST_RESPONSE_IGNORED_PROPERTIES = new Set(['description']);

// Properties ignored on representation objects (have 'contentType' or 'schemaId')
const REPRESENTATION_IGNORED_PROPERTIES = new Set([
  'description',
  'schemaId',
  'typeName',
]);

/**
 * Normalizes a property value recursively
 */
export function normalizePropertyValue(
  value: unknown,
  context: NormalizeContext,
  isRoot = false,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // String normalization
  if (typeof value === 'string') {
    return normalizeString(value, context);
  }

  // Array normalization
  if (Array.isArray(value)) {
    const normalized = value.map((item) =>
      normalizePropertyValue(item, context, false),
    );
    // Sort for order-independent comparison
    return normalized.sort((a, b) => {
      const aJson = JSON.stringify(a);
      const bJson = JSON.stringify(b);
      return aJson.localeCompare(bJson);
    });
  }

  // Object normalization
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    // Detect request/response objects (have 'representations' array)
    const isRequestResponse = 'representations' in obj;
    // Detect representation objects (have 'contentType' or 'schemaId')
    const isRepresentation = 'contentType' in obj || 'schemaId' in obj;

    // Sort keys for stable output
    const sortedKeys = Object.keys(obj).sort();

    for (const key of sortedKeys) {
      // Skip top-level read-only properties at root
      if (isRoot && STRIP_READ_ONLY_PROPERTIES.has(key)) {
        continue;
      }
      // Skip timestamp properties at any depth
      if (STRIP_TIMESTAMP_PROPERTIES.has(key)) {
        continue;
      }
      // Skip description on request/response objects
      if (isRequestResponse && REQUEST_RESPONSE_IGNORED_PROPERTIES.has(key)) {
        continue;
      }
      // Skip description/schemaId/typeName on representation objects
      if (isRepresentation && REPRESENTATION_IGNORED_PROPERTIES.has(key)) {
        continue;
      }

      result[key] = normalizePropertyValue(obj[key], context, false);
    }

    return result;
  }

  // Primitive (number, boolean, etc.)
  return value;
}

/**
 * Normalizes instance-specific strings
 */
function normalizeString(value: string, context: NormalizeContext): string {
  let s = value;

  // Normalize ARM resource-ID paths (subscription, RG, service name)
  const sourceApimPath = `/subscriptions/${context.sourceSubscriptionId}/resourceGroups/${context.sourceResourceGroup}/providers/Microsoft.ApiManagement/service/${context.sourceServiceName}`;
  const targetApimPath = `/subscriptions/${context.targetSubscriptionId}/resourceGroups/${context.targetResourceGroup}/providers/Microsoft.ApiManagement/service/${context.targetServiceName}`;
  const placeholderApimPath = `/subscriptions/{{sub}}/resourceGroups/{{rg}}/providers/Microsoft.ApiManagement/service/{{apim-name}}`;

  s = s.replace(new RegExp(escapeRegex(sourceApimPath), 'g'), placeholderApimPath);
  s = s.replace(new RegExp(escapeRegex(targetApimPath), 'g'), placeholderApimPath);

  // Broader subscription/RG normalization for other resource types
  const sourceSubRg = `/subscriptions/${context.sourceSubscriptionId}/resourceGroups/${context.sourceResourceGroup}`;
  const targetSubRg = `/subscriptions/${context.targetSubscriptionId}/resourceGroups/${context.targetResourceGroup}`;
  const placeholderSubRg = `/subscriptions/{{sub}}/resourceGroups/{{rg}}`;

  s = s.replace(new RegExp(escapeRegex(sourceSubRg), 'g'), placeholderSubRg);
  s = s.replace(new RegExp(escapeRegex(targetSubRg), 'g'), placeholderSubRg);

  // Subscription-only normalization
  const sourceSub = `/subscriptions/${context.sourceSubscriptionId}`;
  const targetSub = `/subscriptions/${context.targetSubscriptionId}`;
  const placeholderSub = `/subscriptions/{{sub}}`;

  s = s.replace(new RegExp(escapeRegex(sourceSub), 'g'), placeholderSub);
  s = s.replace(new RegExp(escapeRegex(targetSub), 'g'), placeholderSub);

  // Neutralize service name in any remaining positions
  s = s.replace(
    new RegExp(escapeRegex(context.sourceServiceName), 'g'),
    '{{apim-name}}',
  );
  s = s.replace(
    new RegExp(escapeRegex(context.targetServiceName), 'g'),
    '{{apim-name}}',
  );

  // Normalize Key Vault URIs — different vault names per RG
  s = s.replace(
    /https:\/\/[a-zA-Z0-9-]+\.vault\.azure\.net/g,
    'https://{{keyvault}}.vault.azure.net',
  );

  // Normalize Key Vault secret names (src-* vs tgt-*)
  s = s.replace(/\/secrets\/(src|tgt)-/g, '/secrets/{{prefix}}-');

  // Normalize App Insights resource IDs (different AI instance names per RG)
  s = s.replace(
    /\/providers\/Microsoft\.Insights\/components\/[a-zA-Z0-9-]+/g,
    '/providers/Microsoft.Insights/components/{{appinsights}}',
  );

  // Normalize Event Hub namespace names in resource IDs
  s = s.replace(
    /\/providers\/Microsoft\.EventHub\/namespaces\/[a-zA-Z0-9-]+/g,
    '/providers/Microsoft.EventHub/namespaces/{{eventhub}}',
  );

  // Normalize auto-generated APIM IDs (24-char hex strings like schema IDs)
  s = s.replace(/\b[0-9a-f]{24}\b/g, '{{auto-id}}');

  // Normalize GUIDs
  s = s.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '{{guid}}',
  );

  return s;
}

/**
 * Normalizes a resource by stripping ARM envelope and normalizing properties
 */
export function normalizeResource(
  resource: Record<string, unknown>,
  context: NormalizeContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Strip top-level ARM envelope fields
  for (const key of Object.keys(resource).sort()) {
    if (STRIP_TOP_LEVEL_FIELDS.has(key)) {
      continue;
    }
    result[key] = resource[key];
  }

  // Normalize the properties bag with isRoot=true
  if (result.properties !== undefined) {
    result.properties = normalizePropertyValue(
      result.properties,
      context,
      true,
    );
  }

  // Normalize any other top-level bags (e.g., location, sku)
  for (const key of Object.keys(result)) {
    if (key === 'properties') {
      continue;
    }
    result[key] = normalizePropertyValue(result[key], context, false);
  }

  return result;
}

/**
 * Checks if a resource name is auto-generated (24-char hex or UUID format)
 */
export function isAutoGeneratedName(name: string): boolean {
  // 24-char lowercase hex
  if (/^[0-9a-f]{24}$/.test(name)) {
    return true;
  }
  // UUID format (8-4-4-4-12)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) {
    return true;
  }
  return false;
}

/**
 * Checks if a resource is a secret named value (skip .value comparison)
 */
export function isSecretNamedValue(
  resource: Record<string, unknown>,
): boolean {
  const props = resource.properties as Record<string, unknown> | undefined;
  if (!props) return false;
  return props.secret === true;
}

/**
 * Checks if a resource is an Event Hub or App Insights logger (skip credentials)
 */
export function isLoggerWithCredentials(
  resource: Record<string, unknown>,
): boolean {
  const props = resource.properties as Record<string, unknown> | undefined;
  if (!props) return false;
  const loggerType = props.loggerType;
  return loggerType === 'azureEventHub' || loggerType === 'applicationInsights';
}

/**
 * Escapes a string for use in a RegExp
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
