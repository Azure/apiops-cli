// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * YAML config loader with validation
 * Parse filter YAML, override YAML, and OTel config files
 */

import * as fs from 'node:fs/promises';
import * as yaml from 'js-yaml';
import { FilterConfig, OverrideConfig, OverrideSection, OverrideEntry, ApiSubFilter, WorkspaceSubFilter } from '../models/config.js';
import { logger } from './logger.js';


/**
 * Assert that a value is an array of strings. Throws on type mismatch.
 */
function assertStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array, got ${typeof value}`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      throw new Error(
        `${fieldName}[${i}] must be a string, got ${typeof value[i]}`
      );
    }
  }
  return value as string[];
}

/**
 * Parse a filter array that may contain both string entries and nested object entries.
 * - String entries: resource name to include (all sub-resources included)
 * - Object entries: `{ name: { subResource: [...] } }` format (Toolkit nested filtering)
 *
 * Returns extracted names (string[]) and sub-filter map.
 */
function parseFilterArrayWithNested(
  value: unknown,
  fieldName: string
): { names: string[]; subFilters: Record<string, Record<string, string[]>> } {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array, got ${typeof value}`);
  }

  const names: string[] = [];
  const subFilters: Record<string, Record<string, string[]>> = {};

  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];

    if (typeof item === 'string') {
      names.push(item);
      continue;
    }

    if (isPlainObject(item)) {
      // Object entry: key is the resource name, value is sub-filter config
      const keys = Object.keys(item);
      if (keys.length !== 1) {
        throw new Error(
          `${fieldName}[${i}] object entry must have exactly one key (the resource name), ` +
          `got ${keys.length} keys: ${keys.join(', ')}`
        );
      }
      const name = keys[0];
      names.push(name);

      const subConfig = item[name];
      if (isPlainObject(subConfig)) {
        const subFilter: Record<string, string[]> = {};
        for (const [subKey, subValue] of Object.entries(subConfig)) {
          if (subValue === undefined || subValue === null) continue;
          subFilter[subKey] = assertStringArray(subValue, `${fieldName}[${i}].${name}.${subKey}`);
        }
        if (Object.keys(subFilter).length > 0) {
          subFilters[name] = subFilter;
        }
      } else if (subConfig !== undefined && subConfig !== null) {
        logger.warn(
          `${fieldName}[${i}]: nested value for '${name}' should be an object with sub-resource arrays; ignoring.`
        );
      }
      continue;
    }

    throw new Error(
      `${fieldName}[${i}] must be a string or object, got ${typeof item}`
    );
  }

  return { names, subFilters };
}

/**
 * Load and parse a filter configuration YAML file.
 * Returns undefined if file doesn't exist.
 */
/**
 * Mapping from FilterConfig field to its legacy alias (the old *Names key).
 * Both the Toolkit-style key and the legacy alias are accepted during parsing.
 * Only includes fields that appear as YAML keys (not internal computed fields).
 */
type FilterYamlKey = Exclude<keyof FilterConfig, 'apiSubFilters' | 'workspaceSubFilters'>;
const FILTER_KEY_ALIASES: Record<FilterYamlKey, string> = {
  apis: 'apiNames',
  backends: 'backendNames',
  products: 'productNames',
  namedValues: 'namedValueNames',
  loggers: 'loggerNames',
  diagnostics: 'diagnosticNames',
  tags: 'tagNames',
  policyFragments: 'policyFragmentNames',
  gateways: 'gatewayNames',
  versionSets: 'versionSetNames',
  groups: 'groupNames',
  subscriptions: 'subscriptionNames',
  schemas: 'schemaNames',
  policies: 'policyNames',
  policyRestrictions: 'policyRestrictionNames',
  documentations: 'documentationNames',
  workspaces: 'workspaceNames',
};

/** Fields that support nested sub-resource filtering (object entries) */
const NESTED_FILTER_FIELDS: Set<FilterYamlKey> = new Set(['apis', 'workspaces']);

export async function loadFilterConfig(filePath: string): Promise<FilterConfig | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = (yaml.load(content) ?? {}) as Record<string, unknown>;
    
    // Validate structure — each field must be an array of strings (or nested objects for apis/workspaces).
    // Accept both Toolkit-style keys (e.g. "apis") and legacy aliases (e.g. "apiNames").
    const config: FilterConfig = {};

    for (const [field, legacyAlias] of Object.entries(FILTER_KEY_ALIASES)) {
      const key = field as FilterYamlKey;
      const toolkitValue = parsed[field];
      const legacyValue = parsed[legacyAlias];

      if (toolkitValue !== undefined && legacyValue !== undefined) {
        throw new Error(
          `Filter config contains both '${field}' and '${legacyAlias}'. ` +
          `Use '${field}' (the APIOps Toolkit format).`
        );
      }

      const rawValue = toolkitValue ?? legacyValue;
      const sourceKey = toolkitValue !== undefined ? field : legacyAlias;

      if (rawValue === undefined) continue;

      if (legacyValue !== undefined) {
        logger.warn(
          `Filter key '${legacyAlias}' is deprecated; use '${field}' instead ` +
          `(APIOps Toolkit format).`
        );
      }

      if (NESTED_FILTER_FIELDS.has(key) && key === 'apis') {
        const { names, subFilters } = parseFilterArrayWithNested(rawValue, sourceKey);
        config.apis = names;
        if (Object.keys(subFilters).length > 0) {
          config.apiSubFilters = {};
          const validApiSubKeys = ['operations', 'diagnostics', 'schemas', 'releases'] as const;
          for (const [apiName, sf] of Object.entries(subFilters)) {
            const apiSub: ApiSubFilter = {};
            for (const subKey of validApiSubKeys) {
              if (subKey in sf) {
                apiSub[subKey] = sf[subKey];
              }
            }
            // Warn about unsupported sub-filter keys
            for (const k of Object.keys(sf)) {
              if (!(validApiSubKeys as readonly string[]).includes(k)) {
                logger.warn(`Unknown API sub-filter key '${k}' for API '${apiName}'; ignoring.`);
              }
            }
            config.apiSubFilters[apiName] = apiSub;
          }
        }
      } else if (NESTED_FILTER_FIELDS.has(key) && key === 'workspaces') {
        const { names, subFilters } = parseFilterArrayWithNested(rawValue, sourceKey);
        config.workspaces = names;
        if (Object.keys(subFilters).length > 0) {
          config.workspaceSubFilters = {};
          const validWsSubKeys = ['apis', 'backends', 'diagnostics', 'groups', 'loggers',
            'namedValues', 'policyFragments', 'products', 'schemas', 'subscriptions', 'tags', 'versionSets'] as const;
          for (const [wsName, sf] of Object.entries(subFilters)) {
            const wsSub: WorkspaceSubFilter = {};
            for (const wsField of validWsSubKeys) {
              if (wsField in sf) {
                (wsSub as Record<string, string[]>)[wsField] = sf[wsField];
              }
            }
            for (const k of Object.keys(sf)) {
              if (!(validWsSubKeys as readonly string[]).includes(k)) {
                logger.warn(`Unknown workspace sub-filter key '${k}' for workspace '${wsName}'; ignoring.`);
              }
            }
            config.workspaceSubFilters[wsName] = wsSub;
          }
        }
      } else {
        (config as Record<string, unknown>)[key] = assertStringArray(rawValue, sourceKey);
      }
    }

    // Warn about unknown top-level keys
    const knownKeys = new Set([
      ...Object.keys(FILTER_KEY_ALIASES),
      ...Object.values(FILTER_KEY_ALIASES),
    ]);
    for (const key of Object.keys(parsed)) {
      if (!knownKeys.has(key)) {
        logger.warn(`Unknown filter config key '${key}'; ignoring. Did you mean one of: ${Object.keys(FILTER_KEY_ALIASES).join(', ')}?`);
      }
    }
    
    logger.debug(`Loaded filter config from ${filePath}`);
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug(`Filter config file not found: ${filePath}`);
      return undefined;
    }
    throw new Error(`Failed to load filter config from ${filePath}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * Load and parse an override configuration YAML file.
 * Returns undefined if file doesn't exist.
 */
export async function loadOverrideConfig(filePath: string): Promise<OverrideConfig | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const loaded = yaml.load(content);
    if (loaded !== null && loaded !== undefined && !isPlainObject(loaded)) {
      throw new Error(
        `Override file at ${filePath} must be a YAML mapping (key: value pairs) at the top level, ` +
        `but got ${Array.isArray(loaded) ? 'an array' : typeof loaded}.`
      );
    }
    const parsed = isPlainObject(loaded) ? loaded : {};
    const normalized = normalizeOverrideConfig(parsed);
    
    logger.debug(`Loaded override config from ${filePath}`);
    return normalized;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug(`Override config file not found: ${filePath}`);
      return undefined;
    }
    throw new Error(`Failed to load override config from ${filePath}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * Normalize toolkit-format override sections into the internal keyed-map shape.
 * Supports all Toolkit override sections with nested sub-resource overrides.
 * Ignores `apimServiceName` (Toolkit uses it for target APIM instance; CLI uses --service-name flag instead).
 */
function normalizeOverrideConfig(parsed: Record<string, unknown>): OverrideConfig {
  const normalized: OverrideConfig = {};

  // Log and ignore apimServiceName — Toolkit uses this for target APIM instance,
  // but CLI uses --service-name flag instead.
  if (parsed.apimServiceName !== undefined) {
    const serviceName = typeof parsed.apimServiceName === 'string'
      ? parsed.apimServiceName
      : JSON.stringify(parsed.apimServiceName);
    logger.info(
      `Override config contains 'apimServiceName' ("${serviceName}"). ` +
      `The CLI uses --service-name instead; this field will be ignored.`
    );
  }

  // All supported Toolkit override sections
  const ALL_OVERRIDE_SECTIONS: (keyof OverrideConfig)[] = [
    'namedValues', 'backends', 'apis', 'diagnostics', 'loggers',
    'policies', 'gateways', 'versionSets', 'groups', 'subscriptions',
    'products', 'tags', 'policyFragments', 'workspaces',
  ];

  for (const sectionName of ALL_OVERRIDE_SECTIONS) {
    const rawSection: unknown = parsed[sectionName];
    const section = normalizeOverrideSectionRecursive(rawSection, sectionName);
    if (section !== undefined) {
      normalized[sectionName] = section;
    }
  }

  // Warn about unknown top-level keys
  const knownKeys = new Set<string>([...ALL_OVERRIDE_SECTIONS, 'apimServiceName']);
  for (const key of Object.keys(parsed)) {
    if (!knownKeys.has(key)) {
      logger.warn(`Unknown override config key '${key}'; ignoring.`);
    }
  }

  return normalized;
}

/**
 * Known child section keys for each parent override type.
 * Used to distinguish nested sub-resource overrides from regular properties.
 */
const OVERRIDE_CHILD_SECTIONS: Record<string, Set<string>> = {
  apis: new Set(['diagnostics', 'operations', 'policies', 'releases']),
  workspaces: new Set([
    'apis', 'backends', 'diagnostics', 'groups', 'loggers',
    'namedValues', 'policyFragments', 'products', 'subscriptions', 'tags', 'versionSets',
  ]),
  products: new Set(['policies']),
  operations: new Set(['policies']),
};

/**
 * Normalize one override section into OverrideSection format.
 * Supports Toolkit list format: `[{ name, properties, ...childSections }]`
 * Recursively parses nested child sections.
 *
 * @param section - The raw YAML value for this section
 * @param displayPath - Full dotted path for error messages (e.g., "apis.my-api.operations")
 * @param sectionKind - Bare section key for child lookup (e.g., "operations")
 */
function normalizeOverrideSectionRecursive(
  section: unknown,
  displayPath: string,
  sectionKind?: string
): OverrideSection | undefined {
  // Use sectionKind for child lookup; fall back to displayPath for top-level calls
  const lookupKey = sectionKind ?? displayPath;

  if (section === undefined || section === null) {
    return undefined;
  }

  if (!Array.isArray(section)) {
    throw new Error(
      `Invalid overrides.${displayPath}: expected an array in toolkit format ` +
      `([ { name, properties } ]), got ${typeof section}.`
    );
  }

  const normalized: OverrideSection = {};
  const childKeys = OVERRIDE_CHILD_SECTIONS[lookupKey] ?? new Set<string>();

  for (const item of section) {
    if (!isPlainObject(item)) {
      logger.warn(`Ignoring invalid item in overrides.${displayPath}; expected object.`);
      continue;
    }

    const name = item.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      logger.warn(`Ignoring item in overrides.${displayPath}; "name" is required.`);
      continue;
    }

    // Extract properties
    let properties: Record<string, unknown>;
    if (item.properties !== undefined && item.properties !== null) {
      if (!isPlainObject(item.properties)) {
        logger.warn(
          `Ignoring item '${name}' in overrides.${displayPath}; ` +
          `"properties" must be an object, got ${typeof item.properties}.`
        );
        continue;
      }
      properties = item.properties;
    } else {
      // Fallback: use fields directly (excluding 'name' and known child sections)
      const fallbackFields = Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== 'name' && key !== 'properties' && !childKeys.has(key))
      );
      if (Object.keys(fallbackFields).length > 0) {
        logger.debug(
          `Item '${name}' in overrides.${displayPath} is missing 'properties'; using fields directly.`
        );
        properties = fallbackFields;
      } else {
        properties = {};
      }
    }

    // Parse nested child sections
    let children: Record<string, OverrideSection> | undefined;
    for (const childKey of childKeys) {
      const childValue: unknown = item[childKey];
      if (childValue !== undefined) {
        const childSection = normalizeOverrideSectionRecursive(
          childValue,
          `${displayPath}.${name}.${childKey}`,
          childKey
        );
        if (childSection !== undefined) {
          if (!children) children = {};
          children[childKey] = childSection;
        }
      }
    }

    const entry: OverrideEntry = { properties };
    if (children) entry.children = children;

    // Only add entry if it has properties or children
    if (Object.keys(properties).length > 0 || children) {
      if (normalized[name] !== undefined) {
        logger.warn(`Duplicate name '${name}' in overrides.${displayPath}; later entry overwrites earlier one.`);
      }
      normalized[name] = entry;
    } else {
      logger.warn(`Ignoring item '${name}' in overrides.${displayPath}; no override properties or child sections.`);
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

/**
 * Load and parse an OpenTelemetry configuration YAML file.
 * Returns undefined if file doesn't exist.
 */
export async function loadOTelConfig(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = (yaml.load(content) ?? {}) as Record<string, unknown>;
    
    logger.debug(`Loaded OTel config from ${filePath}`);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug(`OTel config file not found: ${filePath}`);
      return undefined;
    }
    throw new Error(`Failed to load OTel config from ${filePath}: ${(error as Error).message}`, { cause: error });
  }
}
