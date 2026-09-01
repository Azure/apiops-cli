// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ResourceType } from '../models/resource-types.js';
import type { ResourceDescriptor } from '../models/types.js';
import type { OverrideConfig, PublishConfig } from '../models/config.js';
import {
  buildEnvMappingFromOverrides,
  NON_AFFIXABLE_TYPES,
  type EnvMapping,
} from './env-mapper.js';
import { logger } from '../lib/logger.js';

/** Only alphanumeric and hyphens are safe in APIM resource names. */
const VALID_AFFIX_RE = /^[A-Za-z0-9-]*$/;
const VALID_PATH_PREFIX_RE = /^[A-Za-z0-9/_-]*$/;

/** Maps OverrideConfig section keys (that carry named entries) to their ResourceType. */
const OVERRIDE_SECTION_TYPES = new Map<keyof OverrideConfig, ResourceType>([
  ['apis', ResourceType.Api],
  ['backends', ResourceType.Backend],
  ['diagnostics', ResourceType.Diagnostic],
  ['gateways', ResourceType.Gateway],
  ['groups', ResourceType.Group],
  ['loggers', ResourceType.Logger],
  ['namedValues', ResourceType.NamedValue],
  ['policyFragments', ResourceType.PolicyFragment],
  ['products', ResourceType.Product],
  ['subscriptions', ResourceType.Subscription],
  ['tags', ResourceType.Tag],
  ['versionSets', ResourceType.VersionSet],
  ['workspaces', ResourceType.Workspace],
]);

/**
 * Validate the environment block in overrides, build an EnvMapping, and store it on config.
 * Throws on mis-configuration; warns on likely-but-not-fatal issues.
 * Exported for isolated unit testing.
 */
export function validateAndBuildEnvMapping(
  overrides: OverrideConfig | undefined,
  artifactDescriptors: ResourceDescriptor[],
  config: PublishConfig
): void {
  if (overrides?.environment === undefined) return;

  const env = overrides.environment;

  // --- Require at least one name affix ------------------------------------
  // A path-only environment block is unsafe: canonical resource names would
  // collide across environments on a shared APIM instance, and
  // `apiops publish --delete-unmatched` would treat every other environment's
  // resources as stale and delete them. Block this misconfiguration up front
  // with a clear message rather than let the user trash a shared instance.
  const prefix = env.namePrefix?.trim() ?? '';
  const suffix = env.nameSuffix?.trim() ?? '';
  if (prefix === '' && suffix === '') {
    throw new Error(
      `[publish] The 'environment' block requires at least one of 'namePrefix' or 'nameSuffix' (both may be set). ` +
        `Path-only isolation via 'apiPathPrefix' alone is not supported because resource names would collide ` +
        `across environments on a shared APIM instance, and 'publish --delete-unmatched' would delete resources ` +
        `belonging to other environments. Either add a name affix, or remove the 'environment' block entirely.`
    );
  }

  // --- Validate appliesTo entries ----------------------------------------
  if (env.appliesTo !== undefined) {
    const validTypes = new Set(Object.values(ResourceType));
    const unknownTypes: string[] = [];
    const nonAffixableFound: string[] = [];

    for (const typeName of env.appliesTo) {
      if (!validTypes.has(typeName as ResourceType)) {
        unknownTypes.push(typeName);
      } else if (NON_AFFIXABLE_TYPES.has(typeName as ResourceType)) {
        nonAffixableFound.push(typeName);
      }
    }

    if (unknownTypes.length > 0) {
      throw new Error(
        `[publish] environment.appliesTo contains unknown resource type(s): ${unknownTypes.join(', ')}. ` +
          `Valid types are: ${[...validTypes].join(', ')}`
      );
    }

    if (nonAffixableFound.length > 0) {
      throw new Error(
        `[publish] environment.appliesTo contains non-affixable type(s): ${nonAffixableFound.join(', ')}. ` +
          `These are singleton or child resources whose names are fixed or derived from their parent. ` +
          `Remove them from appliesTo.`
      );
    }
  }

  // Build the mapping (may still be undefined if all values are blank/unset)
  const mapping: EnvMapping | undefined = buildEnvMappingFromOverrides(overrides);
  if (mapping === undefined) return;

  // --- Runtime affix character check.
  // The JSON schema in schemas/v1/override-config.schema.json is for editor
  // tooling only; there is no runtime schema enforcement. This is the sole
  // runtime guard against unsafe affix characters, so keep it here.
  if (env.namePrefix !== undefined && !VALID_AFFIX_RE.test(env.namePrefix)) {
    logger.warn(
      `[publish] environment.namePrefix "${env.namePrefix}" contains characters that may be invalid ` +
        `in APIM resource names. Only [A-Za-z0-9-] are safe.`
    );
  }
  if (env.nameSuffix !== undefined && !VALID_AFFIX_RE.test(env.nameSuffix)) {
    logger.warn(
      `[publish] environment.nameSuffix "${env.nameSuffix}" contains characters that may be invalid ` +
        `in APIM resource names. Only [A-Za-z0-9-] are safe.`
    );
  }
  if (env.apiPathPrefix !== undefined && !VALID_PATH_PREFIX_RE.test(env.apiPathPrefix)) {
    logger.warn(
      `[publish] environment.apiPathPrefix "${env.apiPathPrefix}" contains characters that may be invalid ` +
        `in APIM API paths. Only [A-Za-z0-9/_-] are safe.`
    );
  }

  // --- Warn if apiPathPrefix is set but no Api descriptors are present ---
  if (env.apiPathPrefix !== undefined) {
    const hasApiDescriptors = artifactDescriptors.some((d) => d.type === ResourceType.Api);
    if (!hasApiDescriptors) {
      logger.warn(
        `[publish] environment.apiPathPrefix is set but no Api resources were found in the artifact descriptors. ` +
          `This may be a typo or misconfiguration.`
      );
    }
  }

  // --- Warn if any affixed name would exceed APIM's 80-character limit ---
  // Top-level APIM resource names (APIs, NamedValues, Products, Backends, etc.)
  // are capped at 80 characters. If prefix + canonical + suffix crosses that
  // threshold, the ARM PUT will fail mid-publish with a cryptic 400 that does
  // not name the affix as the cause. Surface it up front instead.
  for (const d of artifactDescriptors) {
    if (d.nameParts.length === 0) continue;
    if (!mapping.appliesTo.has(d.type)) continue;
    const canonical = d.nameParts[0];
    if (canonical === undefined) continue;
    const deployedLen = mapping.prefix.length + canonical.length + mapping.suffix.length;
    if (deployedLen > 80) {
      logger.warn(
        `[publish] Affixed name "${mapping.prefix}${canonical}${mapping.suffix}" would be ${deployedLen} characters ` +
          `for ${d.type}, exceeding APIM's 80-character resource name limit. Shorten the canonical name or the affix ` +
          `before publishing.`
      );
    }
  }

  // --- Warn for override entries that don't match any artifact descriptor of that type ---
  for (const [sectionKey, resourceType] of OVERRIDE_SECTION_TYPES) {
    const section = overrides[sectionKey];
    if (section === undefined) continue;

    const knownNames = new Set<string>(
      artifactDescriptors
        .filter((d) => d.type === resourceType && d.nameParts.length > 0)
        .map((d) => d.nameParts[0] ?? '')
    );

    for (const overrideName of Object.keys(section)) {
      if (!knownNames.has(overrideName)) {
        logger.warn(
          `[publish] Override entry "${overrideName}" in overrides.${sectionKey} does not match any ` +
            `${resourceType} artifact descriptor. This may be a stale override after a rename.`
        );
      }
    }
  }

  // --- Log active mapping summary ----------------------------------------
  logger.info(
    `[publish] Environment affix active: prefix="${mapping.prefix}" suffix="${mapping.suffix}" applies to ${mapping.appliesTo.size} types`
  );

  config.envMapping = mapping;
}
