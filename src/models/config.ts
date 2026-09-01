// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Config interfaces
 * ExtractConfig, FilterConfig, PublishConfig, OverrideConfig, InitConfig
 */

import { ApimServiceContext } from './types.js';
import { LogLevel } from '../lib/logger.js';
import type { EnvMapping } from '../services/env-mapper.js';

export interface ExtractConfig {
  service: ApimServiceContext;
  outputDir: string;
  filter?: FilterConfig;
  includeTransitive: boolean;
  logLevel: LogLevel;
}

/**
 * Sub-resource filter for an individual API.
 * Only sub-resources listed here are included; undefined means include all.
 * An empty array means include NONE of that sub-resource type.
 */
export interface ApiSubFilter {
  operations?: string[];
  diagnostics?: string[];
  schemas?: string[];
  releases?: string[];
}

/**
 * Sub-resource filter for an individual workspace.
 * Specifies exactly which workspace-scoped resources to include.
 */
export interface WorkspaceSubFilter {
  apis?: string[];
  apiSubFilters?: Record<string, ApiSubFilter>;
  backends?: string[];
  diagnostics?: string[];
  groups?: string[];
  loggers?: string[];
  namedValues?: string[];
  policyFragments?: string[];
  products?: string[];
  schemas?: string[];
  subscriptions?: string[];
  tags?: string[];
  versionSets?: string[];
}

export interface FilterConfig {
  apis?: string[];
  /** Per-API sub-resource filters (only for APIs listed with nested object syntax) */
  apiSubFilters?: Record<string, ApiSubFilter>;
  backends?: string[];
  products?: string[];
  namedValues?: string[];
  loggers?: string[];
  diagnostics?: string[];
  tags?: string[];
  policyFragments?: string[];
  gateways?: string[];
  versionSets?: string[];
  groups?: string[];
  subscriptions?: string[];
  schemas?: string[];
  policies?: string[];
  policyRestrictions?: string[];
  documentations?: string[];
  workspaces?: string[];
  /** Per-workspace sub-resource filters (only for workspaces listed with nested object syntax) */
  workspaceSubFilters?: Record<string, WorkspaceSubFilter>;
}

/**
 * Sets of canonical artifact names used to gate policy XML reference rewriting.
 * Populated once per publish from the full artifact descriptor list.
 */
export interface KnownArtifactSets {
  /** Canonical NamedValue resource names */
  namedValues: ReadonlySet<string>;
  /** Canonical PolicyFragment resource names */
  fragments: ReadonlySet<string>;
  /** Canonical Backend resource names */
  backends: ReadonlySet<string>;
}

export interface PublishConfig {
  service: ApimServiceContext;
  sourceDir: string;
  filter?: FilterConfig;
  includeTransitive?: boolean;
  overrides?: OverrideConfig;
  /**
   * Pre-built environment name mapping (prefix/suffix + appliesTo).
   * Constructed by publish-service from overrides.environment.
   * When present, delete-unmatched scopes deletions to this env's namespace only.
   * Absent → original behaviour (no namespace scoping, 100 % back-compat).
   */
  envMapping?: EnvMapping;
  /**
   * Known canonical artifact name sets for policy XML ref rewriting.
   * Built by publish-service after determinePublishTargets.
   */
  knownArtifactSets?: KnownArtifactSets;
  dryRun: boolean;
  deleteUnmatched: boolean;
  commitId?: string;
  logLevel: LogLevel;
}

/**
 * A single override entry: properties to deep-merge + optional nested child overrides.
 */
export interface OverrideEntry {
  /** Properties to deep-merge into the resource's ARM DTO */
  properties: Record<string, unknown>;
  /** Nested sub-resource override sections (e.g., diagnostics under an API) */
  children?: Record<string, OverrideSection>;
}

/** A section of overrides: resource name → override entry */
export type OverrideSection = Record<string, OverrideEntry>;

/**
 * Per-environment settings for publishing to a shared APIM instance.
 * When present, resource names are prefixed/suffixed at publish time so
 * multiple environments (dev/qa/prod) can coexist on one APIM.
 * Absent = current behaviour (no affix, 100% back-compat).
 */
export interface EnvironmentOverride {
  /** Prefix applied to resource names for types in appliesTo. Optional. */
  namePrefix?: string;
  /** Suffix applied to resource names for types in appliesTo. Optional. */
  nameSuffix?: string;
  /**
   * Resource type names that get the affix. If omitted, a default set is used.
   * Values are the string names of the ResourceType enum (e.g. "Api", "Product").
   */
  appliesTo?: string[];
  /** Prefix prepended to Api properties.path (e.g. "dev/"). Not applied when a per-API path override exists. */
  apiPathPrefix?: string;
}

/**
 * Environment-specific override configuration.
 * Supports all Toolkit override sections with generic property passthrough.
 * Nested sub-resource overrides (e.g., API diagnostics) are stored in OverrideEntry.children.
 */
export interface OverrideConfig {
  namedValues?: OverrideSection;
  backends?: OverrideSection;
  apis?: OverrideSection;
  diagnostics?: OverrideSection;
  loggers?: OverrideSection;
  policies?: OverrideSection;
  gateways?: OverrideSection;
  versionSets?: OverrideSection;
  groups?: OverrideSection;
  subscriptions?: OverrideSection;
  products?: OverrideSection;
  tags?: OverrideSection;
  policyFragments?: OverrideSection;
  workspaces?: OverrideSection;
  environment?: EnvironmentOverride;
}

export interface InitConfig {
  ciProvider?: 'github-actions' | 'azure-devops';
  nonInteractive: boolean;
  artifactDir: string;
  environments: string[];
  outputDir: string;
  cliPackage?: string;
  force: boolean;
}
