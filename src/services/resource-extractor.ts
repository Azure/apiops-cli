// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T021: Resource type extractor
 * Generic extract logic: list resources via IApimClient, write each to IArtifactStore.
 * Handles all 33 types using ResourceType metadata. Preserves opaque JSON per FR-009.
 */

import { IApimClient } from '../clients/iapim-client.js';
import { IArtifactStore } from '../clients/iartifact-store.js';
import { ApimServiceContext, ResourceDescriptor } from '../models/types.js';
import { ResourceType, RESOURCE_TYPE_METADATA } from '../models/resource-types.js';
import { redactSecrets } from './secret-redactor.js';
import { shouldIncludeResource } from './filter-service.js';
import { FilterConfig } from '../models/config.js';
import { logger } from '../lib/logger.js';
import { buildResourceLabel } from '../lib/resource-uri.js';

/**
 * Check if a resource type's LIST endpoint returns shallow data that omits
 * fields required for round-trip publish. When true, extraction must issue
 * an individual GET per item to fetch the complete resource.
 */
function typeNeedsFullFetch(type: ResourceType): boolean {
  return RESOURCE_TYPE_METADATA[type].listOmitsFields === true;
}

/**
 * Result of extracting a single resource.
 */
export interface ExtractedResource {
  descriptor: ResourceDescriptor;
  json: Record<string, unknown>;
  status: 'success' | 'error';
  error?: string;
}

/**
 * Result of extracting all resources of a given type.
 */
export interface TypeExtractionResult {
  type: ResourceType;
  extracted: ExtractedResource[];
  totalCount: number;
  errorCount: number;
}

/**
 * Extract the ARM resource name from a raw JSON object.
 * ARM resources have a 'name' field at the top level.
 */
export function extractResourceName(json: Record<string, unknown>): string {
  const name = json.name as string | undefined;
  if (!name) {
    throw new Error('Resource JSON missing required "name" field');
  }
  return name;
}

/**
 * Extract all resources of a given type from APIM and write to artifact store.
 *
 * @param client - APIM REST client
 * @param store - Artifact file store
 * @param context - APIM service context
 * @param type - Resource type to extract
 * @param outputDir - Output directory
 * @param filter - Optional filter config
 * @param parent - Parent descriptor for child resources
 * @param workspace - Optional workspace name
 * @returns Extraction result
 */
export async function extractResourceType(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  type: ResourceType,
  outputDir: string,
  filter?: FilterConfig,
  parent?: ResourceDescriptor,
  workspace?: string
): Promise<TypeExtractionResult> {
  const result: TypeExtractionResult = {
    type,
    extracted: [],
    totalCount: 0,
    errorCount: 0,
  };

  try {
    const loggerTokenMap =
      type === ResourceType.Logger
        ? await loadNamedValueDisplayNameMap(client, context)
        : undefined;

    const resources = client.listResources(context, type, parent);

    for await (const listJson of resources) {
      result.totalCount++;

      let descriptor: ResourceDescriptor | undefined;
      try {
        const name = extractResourceName(listJson);
        descriptor = buildDescriptor(type, name, parent, workspace);

        // Apply filter
        if (!shouldIncludeResource(descriptor, filter)) {
          logger.debug(`Filtered out ${buildResourceLabel(descriptor)}`);
          continue;
        }

        // Some APIM list endpoints return a shallow response that omits the
        // heavyweight payload we need for round-trip publish. ApiSchema list
        // omits `properties.document` (the GraphQL SDL / XSD / JSON-schema
        // body); an individual GET returns it. Fetch the full resource so the
        // extract captures what publish requires. Falls back to the list
        // payload if the GET returns undefined (shouldn't normally happen —
        // we just listed it).
        let json: Record<string, unknown> = listJson;
        if (typeNeedsFullFetch(type)) {
          const full = await client.getResource(context, descriptor);
          if (full) {
            json = full;
          }
        }

        if (type === ResourceType.Logger && loggerTokenMap && loggerTokenMap.size > 0) {
          json = normalizeLoggerCredentialPlaceholders(json, loggerTokenMap);
        }

        // Apply secret redaction
        const safeJson = redactSecrets(descriptor, json);

        // Write to artifact store (preserves opaque JSON per FR-009)
        await store.writeResource(outputDir, descriptor, safeJson);

        result.extracted.push({
          descriptor,
          json: safeJson,
          status: 'success',
        });

        logger.info(`Extracted ${buildResourceLabel(descriptor)}`);
      } catch (error) {
        result.errorCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (descriptor) {
          logger.error(`Failed to extract ${buildResourceLabel(descriptor)}: ${errorMessage}`);
          result.extracted.push({
            descriptor,
            json: {},
            status: 'error',
            error: errorMessage,
          });
        } else {
          logger.error(`Failed to extract ${type} resource: ${errorMessage}`);
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to list ${type}: ${errorMessage}`);
    result.errorCount++;
  }

  return result;
}

async function loadNamedValueDisplayNameMap(
  client: IApimClient,
  context: ApimServiceContext
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for await (const namedValue of client.listResources(context, ResourceType.NamedValue)) {
    const name = namedValue.name;
    const properties = namedValue.properties as Record<string, unknown> | undefined;
    const displayName = properties?.displayName;

    if (typeof name === 'string' && typeof displayName === 'string' && displayName.length > 0) {
      map.set(displayName, name);
    }
  }

  return map;
}

function normalizeLoggerCredentialPlaceholders(
  json: Record<string, unknown>,
  displayNameToName: Map<string, string>
): Record<string, unknown> {
  const properties = json.properties as Record<string, unknown> | undefined;
  const credentials = properties?.credentials;

  if (!properties || credentials === undefined) {
    return json;
  }

  const normalizeValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replace(/\{\{([^}]+)\}\}/g, (match, tokenName: string) => {
        const mappedName = displayNameToName.get(tokenName);
        return mappedName ? `{{${mappedName}}}` : match;
      });
    }

    if (Array.isArray(value)) {
      return value.map(normalizeValue);
    }

    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        out[key] = normalizeValue(child);
      }
      return out;
    }

    return value;
  };

  return {
    ...json,
    properties: {
      ...properties,
      credentials: normalizeValue(credentials),
    },
  };
}

/**
 * Extract a single resource by descriptor and write to artifact store.
 */
export async function extractSingleResource(
  client: IApimClient,
  store: IArtifactStore,
  context: ApimServiceContext,
  descriptor: ResourceDescriptor,
  outputDir: string
): Promise<ExtractedResource> {
  try {
    const json = await client.getResource(context, descriptor);

    if (!json) {
      return {
        descriptor,
        json: {},
        status: 'error',
        error: `Resource not found: ${buildResourceLabel(descriptor)}`,
      };
    }

    // Apply secret redaction
    const safeJson = redactSecrets(descriptor, json);

    // Write to artifact store
    await store.writeResource(outputDir, descriptor, safeJson);

    logger.info(`Extracted ${buildResourceLabel(descriptor)}`);

    return { descriptor, json: safeJson, status: 'success' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to extract ${buildResourceLabel(descriptor)}: ${errorMessage}`);
    return { descriptor, json: {}, status: 'error', error: errorMessage };
  }
}

/**
 * Build a ResourceDescriptor for a given type, name, optional parent, and workspace.
 *
 * The nameParts array is derived generically using the count of positional
 * placeholders in armPathSuffix:
 *   - placeholderCount === parent.nameParts.length → singleton child (policy, wiki):
 *       nameParts = parent.nameParts  (own fixed name not encoded in path)
 *   - placeholderCount > parent.nameParts.length → named child:
 *       nameParts = [...parent.nameParts, name]
 *   - no parent → top-level: nameParts = [name]  (or [] for zero-placeholder types)
 */
function buildDescriptor(
  type: ResourceType,
  name: string,
  parent?: ResourceDescriptor,
  workspace?: string
): ResourceDescriptor {
  const metadata = RESOURCE_TYPE_METADATA[type];
  const placeholderCount = (metadata.armPathSuffix.match(/\{\d+\}/g) ?? []).length;

  let nameParts: string[];
  if (!parent) {
    nameParts = placeholderCount === 0 ? [] : [name];
  } else if (parent.nameParts.length >= placeholderCount) {
    // Singleton child (policy, wiki): identified solely by parent's name-parts
    nameParts = [...parent.nameParts];
  } else {
    // Named child: has its own distinct position in the ARM path
    nameParts = [...parent.nameParts, name];
  }

  return { type, nameParts, workspace };
}
