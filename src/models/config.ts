/**
 * T008: Config interfaces
 * ExtractConfig, FilterConfig, PublishConfig, OverrideConfig, InitConfig
 */

import { ApimServiceContext } from './types.js';
import { LogLevel } from '../lib/logger.js';

export interface ExtractConfig {
  service: ApimServiceContext;
  outputDir: string;
  filter?: FilterConfig;
  includeTransitive: boolean;
  specFormat?: string;
  logLevel: LogLevel;
  otelConfigPath?: string;
}

export interface FilterConfig {
  apiNames?: string[];
  backendNames?: string[];
  productNames?: string[];
  namedValueNames?: string[];
  loggerNames?: string[];
  diagnosticNames?: string[];
  tagNames?: string[];
  policyFragmentNames?: string[];
  gatewayNames?: string[];
  versionSetNames?: string[];
  groupNames?: string[];
  subscriptionNames?: string[];
  schemaNames?: string[];
  policyRestrictionNames?: string[];
  documentationNames?: string[];
  workspaceNames?: string[];
}

export interface PublishConfig {
  service: ApimServiceContext;
  sourceDir: string;
  overrides?: OverrideConfig;
  dryRun: boolean;
  deleteUnmatched: boolean;
  commitId?: string;
  logLevel: LogLevel;
  otelConfigPath?: string;
}

export interface OverrideConfig {
  namedValues?: Record<string, NamedValueOverride>;
  backends?: Record<string, BackendOverride>;
  apis?: Record<string, ApiOverride>;
  diagnostics?: Record<string, DiagnosticOverride>;
  loggers?: Record<string, LoggerOverride>;
}

export interface NamedValueOverride {
  value?: string;
  displayName?: string;
  tags?: string[];
  keyVault?: {
    identityClientId?: string;
    secretIdentifier?: string;
  };
}

export interface BackendOverride {
  url?: string;
  credentials?: Record<string, unknown>;
}

export interface ApiOverride {
  serviceUrl?: string;
}

export interface DiagnosticOverride {
  loggerId?: string;
}

export interface LoggerOverride {
  credentials?: Record<string, unknown>;
  resourceId?: string;
}

export interface InitConfig {
  ciProvider?: 'github-actions' | 'azure-devops';
  nonInteractive: boolean;
  artifactDir: string;
  environments: string[];
  outputDir: string;
  cliPackage: string;
  force: boolean;
}
