/**
 * T-CMP-05: Compare service orchestrator.
 *
 * Coordinates hierarchical comparison of two APIM instances using the same
 * resource-type model and dependency graph as the extract and publish commands:
 *  - Top-level types are derived from TIER_1, TIER_2, and non-child TIER_3
 *    resources in dependency-graph.ts.
 *  - Child types per parent are derived from getDependencies() so that newly
 *    added resource types are automatically included without changing this file.
 *
 * Uses compare-normalizer.ts and compare-differ.ts.
 * All APIM interaction goes through IApimClient (listResources).
 */

import { IApimClient } from '../clients/iapim-client.js';
import { CompareConfig } from '../models/config.js';
import { ApimServiceContext } from '../models/types.js';
import { ResourceType } from '../models/resource-types.js';
import {
  TIER_1_RESOURCES,
  TIER_2_RESOURCES,
  TIER_3_RESOURCES,
  TIER_4_RESOURCES,
  getDependencies,
} from '../lib/dependency-graph.js';
import { isChildType } from '../lib/resource-path.js';
import { logger } from '../lib/logger.js';
import {
  NormalizeContext,
  normalizeResource,
  buildResourceMap,
} from '../lib/compare-normalizer.js';
import {
  ResourceTypeResult,
  compareResourceMaps,
} from '../lib/compare-differ.js';
import { EXIT_SUCCESS, EXIT_PARTIAL, EXIT_FATAL } from '../lib/exit-codes.js';

// ── Built-in exclusion lists ─────────────────────────────────────────────────

const EXCLUDE_GROUPS = new Set(['administrators', 'developers', 'guests']);
const EXCLUDE_PRODUCTS = new Set(['starter', 'unlimited']);
const EXCLUDE_SUBSCRIPTIONS = new Set(['master']);
const EXCLUDE_APIS = new Set(['echo-api']);

// ── Display labels for resource types in comparison output ───────────────────
//
// Maps each ResourceType to a human-readable label used in log/output lines.
// Types not present in this map fall back to the enum name (e.g. 'NamedValue').
// Labels must be manually added here when a new resource type is introduced.

const RESOURCE_TYPE_LABEL: Partial<Record<ResourceType, string>> = {
  [ResourceType.NamedValue]: 'Named Values',
  [ResourceType.Tag]: 'Tags',
  [ResourceType.Gateway]: 'Gateways',
  [ResourceType.VersionSet]: 'API Version Sets',
  [ResourceType.Backend]: 'Backends',
  [ResourceType.Logger]: 'Loggers',
  [ResourceType.Group]: 'Groups',
  [ResourceType.Diagnostic]: 'Diagnostics',
  [ResourceType.PolicyFragment]: 'Policy Fragments',
  [ResourceType.GlobalSchema]: 'Global Schemas',
  [ResourceType.ServicePolicy]: 'Service Policy',
  [ResourceType.Product]: 'Products',
  [ResourceType.Subscription]: 'Subscriptions',
  [ResourceType.Documentation]: 'Documentations',
  [ResourceType.PolicyRestriction]: 'Policy Restrictions',
  [ResourceType.Api]: 'APIs',
  // API child types
  [ResourceType.ApiOperation]: 'Operations',
  [ResourceType.ApiPolicy]: 'Policies',
  [ResourceType.ApiSchema]: 'Schemas',
  [ResourceType.ApiTag]: 'Tags',
  [ResourceType.ApiDiagnostic]: 'Diagnostics',
  [ResourceType.GraphQLResolver]: 'Resolvers',
  [ResourceType.ApiRelease]: 'Releases',
  [ResourceType.ApiWiki]: 'Wikis',
  [ResourceType.ApiTagDescription]: 'Tag Descriptions',
  [ResourceType.McpServer]: 'MCP Servers',
  [ResourceType.ApiOperationPolicy]: 'Policies',
  [ResourceType.GraphQLResolverPolicy]: 'Policies',
  // Product child types
  [ResourceType.ProductPolicy]: 'Policies',
  [ResourceType.ProductApi]: 'APIs',
  [ResourceType.ProductGroup]: 'Groups',
  [ResourceType.ProductTag]: 'Tags',
  [ResourceType.ProductWiki]: 'Wikis',
  // Gateway child types
  [ResourceType.GatewayApi]: 'APIs',
};

// ── Per-type comparison options (exclusions and skip flags) ──────────────────
//
// Types not listed here use empty defaults (no exclusions, no skip flags).

interface CompareTypeOptions {
  excludeNames?: ReadonlySet<string>;
  skipSecretValue?: boolean;
  skipLoggerCredentials?: boolean;
}

const TYPE_OPTIONS: Partial<Record<ResourceType, CompareTypeOptions>> = {
  [ResourceType.NamedValue]: { skipSecretValue: true },
  [ResourceType.Logger]: { skipLoggerCredentials: true },
  [ResourceType.Group]: { excludeNames: EXCLUDE_GROUPS },
  [ResourceType.Product]: { excludeNames: EXCLUDE_PRODUCTS },
  [ResourceType.Subscription]: { excludeNames: EXCLUDE_SUBSCRIPTIONS },
  [ResourceType.Api]: { excludeNames: EXCLUDE_APIS },
};

// ── Top-level resource types ─────────────────────────────────────────────────
//
// Mirrors the extract-service pattern: TIER_1 + TIER_2 + non-child TIER_3 types.
// Non-child TIER_3 types are those whose armPathSuffix is directly under the
// service root (e.g. Subscription: 'subscriptions/{0}').

const TOP_LEVEL_TYPES: ResourceType[] = [
  ...TIER_1_RESOURCES,
  ...TIER_2_RESOURCES,
  ...TIER_3_RESOURCES.filter((t) => !isChildType(t)),
];

// ── Result types ──────────────────────────────────────────────────────────────

export interface CompareResult {
  /** Comparison results per resource type / child path. */
  typeResults: ResourceTypeResult[];
  /** Total resources deeply compared (excludes missing/extra counts). */
  totalCompared: number;
  /** Total number of differences found (missing + extra + content). */
  totalDiffs: number;
  /** Resource type labels skipped due to fetch failures. */
  skippedTypes: number;
  /** Exit code: 0=identical, 1=differences found, 2=fatal error. */
  exitCode: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the display label for a resource type, falling back to the enum name. */
function typeLabel(type: ResourceType): string {
  return RESOURCE_TYPE_LABEL[type] ?? type;
}

/**
 * Return the child resource types whose primary required parent is `parentType`.
 *
 * "Primary required parent" = the first dependency edge where `required === true`.
 * This mirrors the dependency-graph structure and ensures new resource types
 * added to the graph are automatically picked up here without code changes.
 *
 * Only considers TIER_3 + TIER_4 resources (children always live in these tiers).
 */
function getChildTypesOf(parentType: ResourceType): ResourceType[] {
  return [...TIER_3_RESOURCES, ...TIER_4_RESOURCES].filter((type) => {
    const primaryParent = getDependencies(type).find((e) => e.required)?.to;
    return primaryParent === parentType;
  });
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Run the full APIM instance comparison.
 *
 * @param client - APIM client (used for listResources).
 * @param config - Source and target service contexts plus log level.
 * @returns CompareResult with per-type results and aggregate totals.
 */
export async function runCompare(
  client: IApimClient,
  config: CompareConfig,
): Promise<CompareResult> {
  const { source, target } = config;

  const ctx: NormalizeContext = { source, target };

  const allResults: ResourceTypeResult[] = [];

  logger.info(`Comparing ${source.serviceName} → ${target.serviceName}...`);

  try {
    // ── Top-level resource types ─────────────────────────────────────────────
    // TIER_1 + TIER_2 + non-child TIER_3 (e.g. Subscription), derived from the
    // dependency graph — same approach as extract-service.ts.
    logger.debug('Comparing top-level resources...');

    for (const type of TOP_LEVEL_TYPES) {
      allResults.push(
        await compareType(
          client, ctx, source, target,
          typeLabel(type), type, TYPE_OPTIONS[type] ?? {},
        ),
      );
    }

    // ── APIs and their children ──────────────────────────────────────────────
    logger.debug('Comparing API children...');

    // Enumerate source APIs for child comparison
    const excludeApiNames = TYPE_OPTIONS[ResourceType.Api]?.excludeNames ?? new Set<string>();
    const sourceApis = await collectList(client, source, ResourceType.Api);
    const apiNames = sourceApis
      .map((a) => getResourceName(a))
      .filter((n): n is string => !!n && !excludeApiNames.has(n));

    // Direct API children (tier 3, primary required parent = Api).
    // getChildTypesOf() derives this list from the dependency graph, so newly
    // added API child types are automatically included.
    const apiDirectChildTypes = getChildTypesOf(ResourceType.Api);

    for (const apiName of apiNames) {
      logger.debug(`  API children: ${apiName}`);

      const parentDescriptor = { type: ResourceType.Api, nameParts: [apiName] };

      for (const type of apiDirectChildTypes) {
        allResults.push(
          await compareChildType(
            client, ctx, source, target,
            `API/${apiName}/${typeLabel(type)}`, type, parentDescriptor,
          ),
        );
      }

      // Tier-4 types: children of API children — derived from the dependency graph.
      // Each tier-3 type that itself has tier-4 children requires a second enumeration loop.
      for (const tier3Type of apiDirectChildTypes) {
        const grandchildTypes = getChildTypesOf(tier3Type);
        if (grandchildTypes.length === 0) continue;

        const tier3Items = await collectList(client, source, tier3Type, parentDescriptor);
        const tier3Names = tier3Items.map((o) => getResourceName(o)).filter((n): n is string => !!n);

        for (const tier3Name of tier3Names) {
          const tier3Descriptor = { type: tier3Type, nameParts: [apiName, tier3Name] };

          for (const gcType of grandchildTypes) {
            allResults.push(
              await compareChildType(
                client, ctx, source, target,
                `API/${apiName}/${typeLabel(tier3Type)}/${tier3Name}/${typeLabel(gcType)}`,
                gcType, tier3Descriptor,
              ),
            );
          }
        }
      }
    }

    // ── Products and their children ──────────────────────────────────────────
    logger.debug('Comparing product children...');

    const excludeProductNames = TYPE_OPTIONS[ResourceType.Product]?.excludeNames ?? new Set<string>();
    const sourceProducts = await collectList(client, source, ResourceType.Product);
    const productNames = sourceProducts
      .map((p) => getResourceName(p))
      .filter((n): n is string => !!n && !excludeProductNames.has(n));

    // Derive product child types from the dependency graph
    const productChildTypes = getChildTypesOf(ResourceType.Product);

    for (const productName of productNames) {
      const parentDescriptor = { type: ResourceType.Product, nameParts: [productName] };
      for (const type of productChildTypes) {
        allResults.push(
          await compareChildType(
            client, ctx, source, target,
            `Product/${productName}/${typeLabel(type)}`, type, parentDescriptor,
          ),
        );
      }
    }

    // ── Gateways and their children ──────────────────────────────────────────
    logger.debug('Comparing gateway children...');

    const sourceGateways = await collectList(client, source, ResourceType.Gateway);
    const gatewayNames = sourceGateways
      .map((g) => getResourceName(g))
      .filter((n): n is string => !!n);

    // Derive gateway child types from the dependency graph
    const gatewayChildTypes = getChildTypesOf(ResourceType.Gateway);

    for (const gwName of gatewayNames) {
      const parentDescriptor = { type: ResourceType.Gateway, nameParts: [gwName] };
      for (const type of gatewayChildTypes) {
        allResults.push(
          await compareChildType(
            client, ctx, source, target,
            `Gateway/${gwName}/${typeLabel(type)}`, type, parentDescriptor,
          ),
        );
      }
    }

    // ── Workspaces ───────────────────────────────────────────────────────────
    // Workspace-scoped resources are not yet in the dependency graph (no Workspace
    // ResourceType exists in resource-types.ts). This mirrors extract-service, which
    // handles workspaces through a dedicated workspace-extractor. When a Workspace
    // type is added to the model, getChildTypesOf(ResourceType.Workspace) will
    // automatically pick up workspace children here.
    logger.debug('Workspace child comparison skipped (Workspace type not in resource model).');
  } catch (error) {
    logger.error(`Fatal error during comparison: ${error instanceof Error ? error.message : String(error)}`);
    return {
      typeResults: allResults,
      totalCompared: 0,
      totalDiffs: 0,
      skippedTypes: 0,
      exitCode: EXIT_FATAL,
    };
  }

  // ── Aggregate totals ─────────────────────────────────────────────────────
  let totalCompared = 0;
  let totalDiffs = 0;
  let skippedTypes = 0;

  for (const r of allResults) {
    if (r.skipped) {
      skippedTypes++;
    } else {
      totalCompared += r.compared;
      totalDiffs += r.differences.length;
    }
  }

  const exitCode = totalDiffs > 0 ? EXIT_PARTIAL : EXIT_SUCCESS;

  logger.info(
    totalDiffs === 0
      ? `✅ PASS — ${allResults.length} resource types compared, ${totalCompared} resources matched`
      : `❌ FAIL — ${totalDiffs} difference(s) found across ${allResults.length} resource types`,
  );

  return { typeResults: allResults, totalCompared, totalDiffs, skippedTypes, exitCode };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Compare a top-level resource type between source and target.
 */
async function compareType(
  client: IApimClient,
  ctx: NormalizeContext,
  source: ApimServiceContext,
  target: ApimServiceContext,
  label: string,
  type: ResourceType,
  options: CompareTypeOptions = {},
): Promise<ResourceTypeResult> {
  const { excludeNames = new Set(), skipSecretValue = false, skipLoggerCredentials = false } = options;

  logger.debug(`  Comparing ${label}...`);

  let sourceItems: Record<string, unknown>[];
  let targetItems: Record<string, unknown>[];

  try {
    sourceItems = await collectList(client, source, type);
  } catch (err) {
    logger.warn(`  ⚠️  ${label}: source query failed — ${err instanceof Error ? err.message : String(err)}`);
    return { label, compared: 0, differences: [], skipped: true, skipReason: String(err) };
  }

  try {
    targetItems = await collectList(client, target, type);
  } catch (err) {
    logger.warn(`  ⚠️  ${label}: target query failed — ${err instanceof Error ? err.message : String(err)}`);
    return { label, compared: 0, differences: [], skipped: true, skipReason: String(err) };
  }

  return performComparison(label, sourceItems, targetItems, ctx, excludeNames, skipSecretValue, skipLoggerCredentials);
}

/**
 * Compare a child resource type (e.g. api operations) between source and target.
 */
async function compareChildType(
  client: IApimClient,
  ctx: NormalizeContext,
  source: ApimServiceContext,
  target: ApimServiceContext,
  label: string,
  type: ResourceType,
  parent: { type: ResourceType; nameParts: string[] },
  options: CompareTypeOptions = {},
): Promise<ResourceTypeResult> {
  const { excludeNames = new Set(), skipSecretValue = false, skipLoggerCredentials = false } = options;

  let sourceItems: Record<string, unknown>[];
  let targetItems: Record<string, unknown>[];

  try {
    sourceItems = await collectList(client, source, type, parent);
  } catch (err) {
    logger.debug(`  ⚠️  ${label}: source query failed — ${err instanceof Error ? err.message : String(err)}`);
    return { label, compared: 0, differences: [], skipped: true, skipReason: String(err) };
  }

  try {
    targetItems = await collectList(client, target, type, parent);
  } catch (err) {
    logger.debug(`  ⚠️  ${label}: target query failed — ${err instanceof Error ? err.message : String(err)}`);
    return { label, compared: 0, differences: [], skipped: true, skipReason: String(err) };
  }

  return performComparison(label, sourceItems, targetItems, ctx, excludeNames, skipSecretValue, skipLoggerCredentials);
}

/**
 * Core comparison logic: normalize, build maps, diff.
 */
function performComparison(
  label: string,
  sourceItems: Record<string, unknown>[],
  targetItems: Record<string, unknown>[],
  ctx: NormalizeContext,
  excludeNames: ReadonlySet<string>,
  skipSecretValue: boolean,
  skipLoggerCredentials: boolean,
): ResourceTypeResult {
  // Build normalized resource maps
  const sourceMap = buildNormalizedMap(sourceItems, ctx, excludeNames);
  const targetMap = buildNormalizedMap(targetItems, ctx, excludeNames);

  const { diffs, compared } = compareResourceMaps(
    sourceMap, targetMap, skipSecretValue, skipLoggerCredentials,
  );

  const srcCount = sourceItems.length;
  const tgtCount = targetItems.length;

  if (diffs.length === 0) {
    logger.debug(`    ✅ ${label} — ${sourceMap.size} resources matched [${srcCount} src, ${tgtCount} tgt]`);
  } else {
    logger.debug(`    ❌ ${label} — ${diffs.length} difference(s) [${srcCount} src, ${tgtCount} tgt]`);
  }

  return { label, compared, differences: diffs, skipped: false };
}

/**
 * Normalize a list of raw ARM items and build a name → normalized map.
 *
 * Order: extract names from ORIGINAL items (before normalization strips `id`),
 * then normalize each item's content.
 */
function buildNormalizedMap(
  items: Record<string, unknown>[],
  ctx: NormalizeContext,
  excludeNames: ReadonlySet<string>,
): Map<string, Record<string, unknown>> {
  // Build the positional map from ORIGINAL items so `id` is available for name extraction.
  const rawMap = buildResourceMap(items, ctx, excludeNames);
  // Now normalize each value in the map.
  const normalizedMap = new Map<string, Record<string, unknown>>();
  for (const [key, item] of rawMap.entries()) {
    normalizedMap.set(key, normalizeResource(item, ctx));
  }
  return normalizedMap;
}

/**
 * Collect all items for a resource type via listResources into an array.
 */
async function collectList(
  client: IApimClient,
  context: ApimServiceContext,
  type: ResourceType,
  parent?: { type: ResourceType; nameParts: string[] },
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  for await (const item of client.listResources(context, type, parent)) {
    items.push(item);
  }
  return items;
}

/**
 * Extract the resource name from the last path segment of its ARM id,
 * or fall back to the `name` property.
 */
function getResourceName(resource: Record<string, unknown>): string | undefined {
  const id = resource['id'];
  if (typeof id === 'string' && id.length > 0) {
    const parts = id.split('/');
    return parts[parts.length - 1];
  }
  const name = resource['name'];
  if (typeof name === 'string') return name;
  return undefined;
}
