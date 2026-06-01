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
    const parsed = (yaml.load(content) ?? {}) as Record<string, unknown>;
    const normalized = normalizeOverrideConfig(parsed);
    
    logger.debug(`Loaded override config from ${filePath}`);
    return normalized;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug(`Override config file not found: ${filePath}`);
      return undefined;
    }

    function normalizeOverrideConfig(parsed: Record<string, unknown>): OverrideConfig {
      const normalized: OverrideConfig = {};

      const namedValues = normalizeOverrideSection(parsed.namedValues, 'namedValues');
      const backends = normalizeOverrideSection(parsed.backends, 'backends');
      const apis = normalizeOverrideSection(parsed.apis, 'apis');
      const diagnostics = normalizeOverrideSection(parsed.diagnostics, 'diagnostics');
      const loggers = normalizeOverrideSection(parsed.loggers, 'loggers');

      if (namedValues !== undefined) normalized.namedValues = namedValues as OverrideConfig['namedValues'];
      if (backends !== undefined) normalized.backends = backends as OverrideConfig['backends'];
      if (apis !== undefined) normalized.apis = apis as OverrideConfig['apis'];
      if (diagnostics !== undefined) normalized.diagnostics = diagnostics as OverrideConfig['diagnostics'];
      if (loggers !== undefined) normalized.loggers = loggers as OverrideConfig['loggers'];

      return normalized;
    }

    function normalizeOverrideSection(
      section: unknown,
      sectionName: string
    ): OverrideSection | undefined {
      if (section === undefined || section === null) {
        return undefined;
      }

      if (isPlainObject(section)) {
        return section as OverrideSection;
      }

      if (!Array.isArray(section)) {
        logger.warn(`Ignoring invalid overrides.${sectionName}; expected object or array.`);
        return undefined;
      }

      const normalized: OverrideSection = {};

      for (const item of section) {
        if (!isPlainObject(item)) {
          logger.warn(`Ignoring invalid item in overrides.${sectionName}; expected object.`);
          continue;
        }

        const itemRecord = item as Record<string, unknown>;
        const name = itemRecord.name;
        if (typeof name !== 'string' || name.trim().length === 0) {
          logger.warn(`Ignoring item in overrides.${sectionName}; "name" is required.`);
          continue;
        }

        if (isPlainObject(itemRecord.properties)) {
          normalized[name] = itemRecord.properties as Record<string, unknown>;
          continue;
        }

        normalized[name] = Object.fromEntries(
          Object.entries(itemRecord).filter(([key]) => key !== 'name')
        );
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
    throw new Error(`Failed to load override config from ${filePath}: ${(error as Error).message}`, { cause: error });
  }
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
