// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T015: YAML config loader with validation
 * Parse filter YAML, override YAML, and OTel config files
 */

import * as fs from 'node:fs/promises';
import * as yaml from 'js-yaml';
import { FilterConfig, OverrideConfig } from '../models/config.js';
import { logger } from './logger.js';

/** Internal normalized override shape keyed by resource name. */
type OverrideSection = Record<string, Record<string, unknown>>;

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
 * Load and parse a filter configuration YAML file.
 * Returns undefined if file doesn't exist.
 */
export async function loadFilterConfig(filePath: string): Promise<FilterConfig | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = (yaml.load(content) ?? {}) as Record<string, unknown>;
    
    // Validate structure — each field must be an array of strings
    const config: FilterConfig = {};

    if (parsed.apiNames !== undefined) {
      config.apiNames = assertStringArray(parsed.apiNames, 'apiNames');
    }
    if (parsed.backendNames !== undefined) {
      config.backendNames = assertStringArray(parsed.backendNames, 'backendNames');
    }
    if (parsed.productNames !== undefined) {
      config.productNames = assertStringArray(parsed.productNames, 'productNames');
    }
    if (parsed.namedValueNames !== undefined) {
      config.namedValueNames = assertStringArray(parsed.namedValueNames, 'namedValueNames');
    }
    if (parsed.loggerNames !== undefined) {
      config.loggerNames = assertStringArray(parsed.loggerNames, 'loggerNames');
    }
    if (parsed.diagnosticNames !== undefined) {
      config.diagnosticNames = assertStringArray(parsed.diagnosticNames, 'diagnosticNames');
    }
    if (parsed.tagNames !== undefined) {
      config.tagNames = assertStringArray(parsed.tagNames, 'tagNames');
    }
    if (parsed.policyFragmentNames !== undefined) {
      config.policyFragmentNames = assertStringArray(parsed.policyFragmentNames, 'policyFragmentNames');
    }
    if (parsed.gatewayNames !== undefined) {
      config.gatewayNames = assertStringArray(parsed.gatewayNames, 'gatewayNames');
    }
    if (parsed.versionSetNames !== undefined) {
      config.versionSetNames = assertStringArray(parsed.versionSetNames, 'versionSetNames');
    }
    if (parsed.groupNames !== undefined) {
      config.groupNames = assertStringArray(parsed.groupNames, 'groupNames');
    }
    if (parsed.subscriptionNames !== undefined) {
      config.subscriptionNames = assertStringArray(parsed.subscriptionNames, 'subscriptionNames');
    }
    if (parsed.schemaNames !== undefined) {
      config.schemaNames = assertStringArray(parsed.schemaNames, 'schemaNames');
    }
    if (parsed.policyRestrictionNames !== undefined) {
      config.policyRestrictionNames = assertStringArray(parsed.policyRestrictionNames, 'policyRestrictionNames');
    }
    if (parsed.documentationNames !== undefined) {
      config.documentationNames = assertStringArray(parsed.documentationNames, 'documentationNames');
    }
    if (parsed.workspaceNames !== undefined) {
      config.workspaceNames = assertStringArray(parsed.workspaceNames, 'workspaceNames');
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
 */
function normalizeOverrideConfig(parsed: Record<string, unknown>): OverrideConfig {
  const normalized: OverrideConfig = {};

  const namedValues = normalizeOverrideSection(parsed.namedValues, 'namedValues');
  const backends = normalizeOverrideSection(parsed.backends, 'backends');
  const apis = normalizeOverrideSection(parsed.apis, 'apis');
  const diagnostics = normalizeOverrideSection(parsed.diagnostics, 'diagnostics');
  const loggers = normalizeOverrideSection(parsed.loggers, 'loggers');

  if (namedValues !== undefined) normalized.namedValues = namedValues;
  if (backends !== undefined) normalized.backends = backends;
  if (apis !== undefined) normalized.apis = apis;
  if (diagnostics !== undefined) normalized.diagnostics = diagnostics;
  if (loggers !== undefined) normalized.loggers = loggers;

  return normalized;
}

/**
 * Normalize one override section into keyed-map format.
 * Supports toolkit list format only:
 * - `{ backends: [{ name: myBackend, properties: { url: ... } }] }`
 */
function normalizeOverrideSection(
  section: unknown,
  sectionName: string
): OverrideSection | undefined {
  if (section === undefined || section === null) {
    return undefined;
  }

  if (!Array.isArray(section)) {
    throw new Error(
      `Invalid overrides.${sectionName}: expected an array in toolkit format ` +
      `([ { name, properties } ]), got ${typeof section}.`
    );
  }

  const normalized: OverrideSection = {};

  for (const item of section) {
    if (!isPlainObject(item)) {
      logger.warn(`Ignoring invalid item in overrides.${sectionName}; expected object.`);
      continue;
    }

    const name = item.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      logger.warn(`Ignoring item in overrides.${sectionName}; "name" is required.`);
      continue;
    }

    if (isPlainObject(item.properties)) {
      normalized[name] = item.properties;
      continue;
    }

    logger.debug(
      `Item in overrides.${sectionName} is missing a 'properties' object; using fields directly.`,
      { name }
    );
    const fallbackFields = Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== 'name' && key !== 'properties')
    );
    if (Object.keys(fallbackFields).length === 0) {
      logger.warn(`Ignoring item in overrides.${sectionName}; no override fields were provided.`, { name });
      continue;
    }

    normalized[name] = fallbackFields;
  }

  return normalized;
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
