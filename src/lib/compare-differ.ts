/**
 * T-CMP-04: Diff engine for compare command.
 *
 * Deep-compares two normalized APIM resource objects and returns a list of
 * human-readable difference strings. Ported from Compare-NormalizedResources
 * in tests/integration/all-resource-types/Compare-ApimInstance.ps1.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single difference between source and target resources within a resource type.
 */
export interface ResourceDiff {
  /** Resource name (or positional key for auto-generated IDs). */
  name: string;
  /** Dot-notation paths of the differing fields. */
  diffs: string[];
  /** Categorized status of this difference. */
  status: 'missing' | 'extra' | 'different';
}

/**
 * Summary for a single resource type comparison.
 */
export interface ResourceTypeResult {
  /** Human-readable label for this resource type (e.g. "APIs", "API/petstore/Operations"). */
  label: string;
  /** Number of source resources compared (excluding those only in target). */
  compared: number;
  /** Differences found (missing, extra, or content mismatch). */
  differences: ResourceDiff[];
  /**
   * True when this resource type was skipped due to a fetch failure.
   * Counts toward skipped total but does not fail the comparison.
   */
  skipped: boolean;
  /** Error message when skipped is true. */
  skipReason?: string;
}

// ── Implementation ─────────────────────────────────────────────────────────

const MAX_VALUE_DISPLAY = 120;
const MAX_FULL_DISPLAY = 200;

/**
 * Deep-compare two normalized resource objects and return human-readable
 * difference strings.
 *
 * Recurses into nested objects for fine-grained diffs. Non-object values are
 * compared by JSON serialization (the same way PowerShell's ConvertTo-Json
 * comparison works).
 *
 * @param source - Normalized source resource object.
 * @param target - Normalized target resource object.
 * @param path - Dot-notation path prefix for nested recursion.
 * @returns Array of human-readable difference strings. Empty if identical.
 */
export function diffNormalizedResources(
  source: unknown,
  target: unknown,
  path = '',
): string[] {
  const srcJson = JSON.stringify(source) ?? '';
  const tgtJson = JSON.stringify(target) ?? '';

  if (srcJson === tgtJson) return [];

  const diffs: string[] = [];

  // Both are plain objects — recurse for per-key detail
  if (isPlainObject(source) && isPlainObject(target)) {
    const srcObj = source;
    const tgtObj = target;
    const allKeys = Array.from(new Set([...Object.keys(srcObj), ...Object.keys(tgtObj)])).sort();

    for (const key of allKeys) {
      const currentPath = path ? `${path}.${key}` : key;
      const inSource = Object.prototype.hasOwnProperty.call(srcObj, key);
      const inTarget = Object.prototype.hasOwnProperty.call(tgtObj, key);

      if (inSource && !inTarget) {
        diffs.push(`  MISSING in target: ${currentPath}`);
        continue;
      }
      if (!inSource && inTarget) {
        diffs.push(`  EXTRA in target:   ${currentPath}`);
        continue;
      }

      const sv = srcObj[key];
      const tv = tgtObj[key];
      const svJson = JSON.stringify(sv) ?? '';
      const tvJson = JSON.stringify(tv) ?? '';

      if (svJson !== tvJson) {
        if (isPlainObject(sv) && isPlainObject(tv)) {
          // Recurse for finer detail
          diffs.push(...diffNormalizedResources(sv, tv, currentPath));
        } else {
          const svShort = truncate(svJson, MAX_VALUE_DISPLAY);
          const tvShort = truncate(tvJson, MAX_VALUE_DISPLAY);
          diffs.push(`  DIFF at ${currentPath}\n    source: ${svShort}\n    target: ${tvShort}`);
        }
      }
    }
  }

  // Fallback: if JSON differs but no key-level diffs found (e.g. both are arrays)
  if (diffs.length === 0) {
    const pathPrefix = path ? `${path}: ` : '';
    const srcShort = truncate(srcJson, MAX_FULL_DISPLAY);
    const tgtShort = truncate(tgtJson, MAX_FULL_DISPLAY);
    diffs.push(`  ${pathPrefix}JSON differs\n    source: ${srcShort}\n    target: ${tgtShort}`);
  }

  return diffs;
}

/**
 * Compare two resource maps (source and target) and return a list of
 * `ResourceDiff` entries for all differences.
 *
 * Handles:
 * - Resources present in source but missing in target (MISSING).
 * - Resources present in target but missing in source (EXTRA).
 * - Resources present in both — deep content diff via `diffNormalizedResources`.
 *
 * @param sourceMap - name → normalized resource for source APIM.
 * @param targetMap - name → normalized resource for target APIM.
 * @param skipSecretValue - When true, strips `.properties.value` before comparing
 *   (used for secret named values whose value is not extractable).
 * @param skipLoggerCredentials - When true, strips `.properties.credentials`
 *   before comparing (connection strings differ per instance for EventHub/AppInsights loggers).
 * @returns Array of ResourceDiff entries; empty if all resources match.
 */
export function compareResourceMaps(
  sourceMap: Map<string, Record<string, unknown>>,
  targetMap: Map<string, Record<string, unknown>>,
  skipSecretValue = false,
  skipLoggerCredentials = false,
): { diffs: ResourceDiff[]; compared: number } {
  const diffs: ResourceDiff[] = [];
  let compared = 0;

  // Missing in target
  for (const name of sourceMap.keys()) {
    if (!targetMap.has(name)) {
      diffs.push({ name, diffs: [`MISSING in target: ${name}`], status: 'missing' });
    }
  }

  // Extra in target
  for (const name of targetMap.keys()) {
    if (!sourceMap.has(name)) {
      diffs.push({ name, diffs: [`EXTRA in target: ${name}`], status: 'extra' });
    }
  }

  // Compare matched resources
  for (const [name, srcResource] of sourceMap.entries()) {
    const tgtResource = targetMap.get(name);
    if (!tgtResource) continue;

    compared++;

    let srcNorm = srcResource;
    let tgtNorm = tgtResource;

    // Strip secret named value's .value property
    if (skipSecretValue && isSecretNamedValue(srcResource)) {
      srcNorm = stripNestedProperty(srcNorm, 'properties', 'value');
      tgtNorm = stripNestedProperty(tgtNorm, 'properties', 'value');
    }

    // Strip EventHub/AppInsights logger credentials
    if (skipLoggerCredentials && isEventHubOrAppInsightsLogger(srcResource)) {
      srcNorm = stripNestedProperty(srcNorm, 'properties', 'credentials');
      tgtNorm = stripNestedProperty(tgtNorm, 'properties', 'credentials');
    }

    const fieldDiffs = diffNormalizedResources(srcNorm, tgtNorm);
    if (fieldDiffs.length > 0) {
      diffs.push({ name, diffs: fieldDiffs, status: 'different' });
    }
  }

  return { diffs, compared };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max - 3) + '...' : s;
}

/**
 * Returns true if the resource is a secret named value
 * (properties.secret === true).
 */
function isSecretNamedValue(resource: Record<string, unknown>): boolean {
  const props = resource['properties'];
  if (!isPlainObject(props)) return false;
  return props['secret'] === true;
}

/**
 * Returns true if the resource is an EventHub or ApplicationInsights logger.
 */
function isEventHubOrAppInsightsLogger(resource: Record<string, unknown>): boolean {
  const props = resource['properties'];
  if (!isPlainObject(props)) return false;
  const lt = props['loggerType'];
  return lt === 'azureEventHub' || lt === 'applicationInsights';
}

/**
 * Returns a shallow copy of the resource with a specific nested property removed.
 * E.g. stripNestedProperty(r, 'properties', 'value') removes r.properties.value.
 */
function stripNestedProperty(
  resource: Record<string, unknown>,
  parentKey: string,
  childKey: string,
): Record<string, unknown> {
  const parent = resource[parentKey];
  if (!isPlainObject(parent)) return resource;
  const newParent = { ...parent };
  delete newParent[childKey];
  return { ...resource, [parentKey]: newParent };
}
