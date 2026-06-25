// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Config interfaces
 * ExtractConfig, FilterConfig, PublishConfig, OverrideConfig, InitConfig
 */

import { ApimServiceContext } from './types.js';
import { LogLevel } from '../lib/logger.js';

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

export interface PublishConfig {
  service: ApimServiceContext;
  sourceDir: string;
  overrides?: OverrideConfig;
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
