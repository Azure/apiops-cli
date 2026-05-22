// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Deep comparison engine for normalized resources
 */

export interface ResourceDiff {
  path: string;
  type: 'missing' | 'extra' | 'different';
  sourceValue?: string;
  targetValue?: string;
}

/**
 * Compares two normalized resources and returns differences
 */
export function compareNormalizedResources(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  path = '',
): ResourceDiff[] {
  const diffs: ResourceDiff[] = [];

  const sourceJson = JSON.stringify(source);
  const targetJson = JSON.stringify(target);

  // Fast path: identical
  if (sourceJson === targetJson) {
    return diffs;
  }

  // Get all keys from both objects
  const allKeys = new Set<string>();
  Object.keys(source).forEach((k) => allKeys.add(k));
  Object.keys(target).forEach((k) => allKeys.add(k));

  const sortedKeys = Array.from(allKeys).sort();

  for (const key of sortedKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const hasSource = key in source;
    const hasTarget = key in target;

    if (hasSource && !hasTarget) {
      diffs.push({
        path: currentPath,
        type: 'missing',
        sourceValue: formatValue(source[key]),
      });
      continue;
    }

    if (!hasSource && hasTarget) {
      diffs.push({
        path: currentPath,
        type: 'extra',
        targetValue: formatValue(target[key]),
      });
      continue;
    }

    const sv = source[key];
    const tv = target[key];
    const svJson = JSON.stringify(sv);
    const tvJson = JSON.stringify(tv);

    if (svJson !== tvJson) {
      // If both are objects (not arrays), recurse for finer detail
      if (
        isPlainObject(sv) &&
        isPlainObject(tv) &&
        !Array.isArray(sv) &&
        !Array.isArray(tv)
      ) {
        const subDiffs = compareNormalizedResources(
          sv as Record<string, unknown>,
          tv as Record<string, unknown>,
          currentPath,
        );
        diffs.push(...subDiffs);
      } else {
        diffs.push({
          path: currentPath,
          type: 'different',
          sourceValue: formatValue(sv, 120),
          targetValue: formatValue(tv, 120),
        });
      }
    }
  }

  // Fallback: if JSON differs but no key-level diffs found
  if (diffs.length === 0) {
    diffs.push({
      path: path || '(root)',
      type: 'different',
      sourceValue: formatValue(source, 200),
      targetValue: formatValue(target, 200),
    });
  }

  return diffs;
}

/**
 * Formats a value for display in diff output
 */
function formatValue(value: unknown, maxLength = -1): string {
  const json = JSON.stringify(value);
  if (maxLength > 0 && json.length > maxLength) {
    return json.substring(0, maxLength - 3) + '...';
  }
  return json;
}

/**
 * Checks if a value is a plain object (not array, not null)
 */
function isPlainObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  );
}
