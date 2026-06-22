// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Configure orchestrator service
 * Scans extracted APIM artifacts, runs interactive prompts to understand
 * environment-specific values, then generates filter and override config files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigureConfig } from '../models/config.js';
import { logger } from '../lib/logger.js';
import { promptService } from './prompt-service.js';
import { artifactScanner, ScannedArtifacts, ScannedNamedValue, ScannedBackend } from './artifact-scanner.js';

/** Placeholder wrapper syntax used for secret token references */
const TOKEN_PLACEHOLDER_OPEN = '{#[';
const TOKEN_PLACEHOLDER_CLOSE = ']#}';

/**
 * Convert a resource name to a safe uppercase token identifier.
 * e.g. "my-api-key" → "MY_API_KEY"
 */
function toTokenName(resourceName: string): string {
  return resourceName
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function wrapToken(tokenName: string): string {
  return `${TOKEN_PLACEHOLDER_OPEN}${tokenName}${TOKEN_PLACEHOLDER_CLOSE}`;
}

/**
 * Result describing what the configure service generated.
 */
export interface ConfigureResult {
  filterConfig?: string;
  overrideConfigs: Record<string, string>;
  writtenFiles: string[];
}

export interface ConfigureService {
  run(config: ConfigureConfig): Promise<ConfigureResult>;
}

class ConfigureServiceImpl implements ConfigureService {
  async run(config: ConfigureConfig): Promise<ConfigureResult> {
    logger.info('Scanning extracted artifacts...');

    const artifacts = await artifactScanner.scan(config.artifactDir);

    const hasArtifacts =
      artifacts.apis.length > 0 ||
      artifacts.namedValues.length > 0 ||
      artifacts.backends.length > 0;

    if (!hasArtifacts) {
      logger.warn(
        `No artifacts found in "${config.artifactDir}". ` +
          'Run "apiops extract" first to pull down your APIM configuration.'
      );
    } else {
      this.logArtifactSummary(artifacts);
    }

    let selectedApis: string[];
    let secretOverrides: Record<string, Record<string, string>>;
    let backendOverrides: Record<string, Record<string, string>>;

    if (!config.nonInteractive && promptService.isTTY()) {
      logger.info('\nRunning in interactive mode. Press Ctrl+C to cancel.\n');
      selectedApis = await this.gatherApiFilter(artifacts);
      secretOverrides = await this.gatherSecretOverrides(artifacts, config.environments);
      backendOverrides = await this.gatherBackendOverrides(artifacts, config.environments);
    } else {
      logger.info('Running in non-interactive mode — using best-effort defaults.');
      selectedApis = artifacts.apis.map((a) => a.name);
      secretOverrides = this.buildDefaultSecretOverrides(artifacts, config.environments);
      backendOverrides = this.buildDefaultBackendOverrides(artifacts, config.environments);
    }

    // Generate file contents
    const filterContent = this.generateFilterConfig(selectedApis);
    const overrideContents: Record<string, string> = {};
    for (const env of config.environments) {
      overrideContents[env] = this.generateOverrideConfig(
        env,
        artifacts,
        secretOverrides[env] ?? {},
        backendOverrides[env] ?? {}
      );
    }

    // Check for conflicts then write files
    const writtenFiles = await this.writeFiles(config, filterContent, overrideContents);

    return {
      filterConfig: filterContent,
      overrideConfigs: overrideContents,
      writtenFiles,
    };
  }

  // ---------------------------------------------------------------------------
  // Logging helpers
  // ---------------------------------------------------------------------------

  private logArtifactSummary(artifacts: ScannedArtifacts): void {
    logger.info('Found the following resources:');
    if (artifacts.apis.length > 0) {
      logger.info(`  APIs:          ${artifacts.apis.length}`);
    }
    if (artifacts.namedValues.length > 0) {
      const secrets = artifacts.namedValues.filter((nv) => nv.isSecret).length;
      logger.info(
        `  Named values:  ${artifacts.namedValues.length}` +
          (secrets > 0 ? ` (${secrets} secret)` : '')
      );
    }
    if (artifacts.backends.length > 0) {
      logger.info(`  Backends:      ${artifacts.backends.length}`);
    }
    if (artifacts.products.length > 0) {
      logger.info(`  Products:      ${artifacts.products.length}`);
    }
    if (artifacts.loggers.length > 0) {
      logger.info(`  Loggers:       ${artifacts.loggers.length}`);
    }
    if (artifacts.diagnostics.length > 0) {
      logger.info(`  Diagnostics:   ${artifacts.diagnostics.length}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Interactive gathering
  // ---------------------------------------------------------------------------

  private async gatherApiFilter(artifacts: ScannedArtifacts): Promise<string[]> {
    if (artifacts.apis.length === 0) {
      return [];
    }
    return promptService.askApiFilter(artifacts.apis.map((a) => a.name));
  }

  private async gatherSecretOverrides(
    artifacts: ScannedArtifacts,
    environments: string[]
  ): Promise<Record<string, Record<string, string>>> {
    const result: Record<string, Record<string, string>> = {};
    for (const env of environments) {
      result[env] = {};
    }

    const secrets = artifacts.namedValues.filter((nv) => nv.isSecret);
    if (secrets.length === 0) {
      return result;
    }

    logger.info(`\nFound ${secrets.length} secret named value(s) that likely need per-environment overrides.`);

    for (const env of environments) {
      logger.info(`\nConfiguring secret overrides for "${env}" environment:`);
      for (const nv of secrets) {
        const suggested = toTokenName(nv.name);
        const tokenName = await promptService.askSecretTokenName(nv.name, env, suggested);
        result[env][nv.name] = wrapToken(tokenName);
      }
    }

    return result;
  }

  private async gatherBackendOverrides(
    artifacts: ScannedArtifacts,
    environments: string[]
  ): Promise<Record<string, Record<string, string>>> {
    const result: Record<string, Record<string, string>> = {};
    for (const env of environments) {
      result[env] = {};
    }

    if (artifacts.backends.length === 0) {
      return result;
    }

    const wantOverrides = await promptService.askYesNo(
      `\nFound ${artifacts.backends.length} backend(s). Do you want to configure per-environment URL overrides?`,
      true
    );

    if (!wantOverrides) {
      return result;
    }

    for (const env of environments) {
      logger.info(`\nConfiguring backend URL overrides for "${env}" environment:`);
      for (const backend of artifacts.backends) {
        const url = await promptService.askBackendUrl(backend.name, env, backend.url);
        if (url) {
          result[env][backend.name] = url;
        }
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Non-interactive defaults
  // ---------------------------------------------------------------------------

  private buildDefaultSecretOverrides(
    artifacts: ScannedArtifacts,
    environments: string[]
  ): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const env of environments) {
      result[env] = {};
      for (const nv of artifacts.namedValues.filter((n) => n.isSecret)) {
        const tokenName = toTokenName(nv.name);
        result[env][nv.name] = wrapToken(tokenName);
      }
    }
    return result;
  }

  private buildDefaultBackendOverrides(
    _artifacts: ScannedArtifacts,
    environments: string[]
  ): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const env of environments) {
      result[env] = {};
    }
    // Non-interactive: no backend URL overrides by default (user can edit)
    return result;
  }

  // ---------------------------------------------------------------------------
  // Config file generation
  // ---------------------------------------------------------------------------

  private generateFilterConfig(selectedApis: string[]): string {
    const lines: string[] = [
      '# APIM Extract Filter Configuration',
      '# Generated by "apiops configure"',
      '# Edit this file to control which resources are extracted.',
      '# For full format details see:',
      '# https://github.com/Azure/apiops-cli/blob/main/docs/guides/filtering-resources.md',
      '',
    ];

    if (selectedApis.length === 0) {
      lines.push('# No APIs found — extracting all resource types (no filter applied)');
    } else {
      lines.push('apis:');
      for (const api of selectedApis) {
        lines.push(`  - ${api}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  private generateOverrideConfig(
    environment: string,
    artifacts: ScannedArtifacts,
    secretOverrides: Record<string, string>,
    backendOverrides: Record<string, string>
  ): string {
    const lines: string[] = [
      `# APIM Override Configuration for ${environment} environment`,
      '# Generated by "apiops configure"',
      '# Customize resource properties for this specific environment.',
      '# For full format details see:',
      '# https://github.com/Azure/apiops-cli/blob/main/docs/guides/environment-overrides.md',
      '',
    ];

    // Named value overrides
    const secretNvs: ScannedNamedValue[] = artifacts.namedValues.filter((nv) => nv.isSecret);
    if (secretNvs.length > 0) {
      lines.push('namedValues:');
      for (const nv of secretNvs) {
        const tokenValue = secretOverrides[nv.name] ?? wrapToken(toTokenName(nv.name));
        lines.push(`  - name: ${nv.name}`);
        lines.push('    properties:');
        lines.push(`      value: "${tokenValue}"`);
      }
      lines.push('');
    }

    // Backend URL overrides
    const backendsWithOverrides: ScannedBackend[] = artifacts.backends.filter(
      (b) => backendOverrides[b.name]
    );
    if (backendsWithOverrides.length > 0) {
      lines.push('backends:');
      for (const backend of backendsWithOverrides) {
        lines.push(`  - name: ${backend.name}`);
        lines.push('    properties:');
        lines.push(`      url: "${backendOverrides[backend.name]}"`);
      }
      lines.push('');
    }

    // If no actionable overrides were generated, add helpful comments
    if (secretNvs.length === 0 && backendsWithOverrides.length === 0) {
      lines.push('# No secret named values or backend URL overrides detected.');
      lines.push('# Add overrides below as needed, for example:');
      lines.push('#');
      lines.push('# namedValues:');
      lines.push('#   - name: my-api-key');
      lines.push('#     properties:');
      lines.push(`#       value: "{#[MY_API_KEY]#}"`);
      lines.push('#');
      lines.push('# backends:');
      lines.push('#   - name: my-backend');
      lines.push('#     properties:');
      lines.push(`#       url: "https://${environment}-api.example.com"`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // File I/O
  // ---------------------------------------------------------------------------

  private async writeFiles(
    config: ConfigureConfig,
    filterContent: string,
    overrideContents: Record<string, string>
  ): Promise<string[]> {
    const filterPath = path.join(config.outputDir, 'configuration.extractor.yaml');
    const overridePaths: Array<{ filePath: string; env: string }> = config.environments.map(
      (env) => ({
        filePath: path.join(config.outputDir, `configuration.${env}.yaml`),
        env,
      })
    );

    // Conflict detection
    const conflicting: string[] = [];
    if (!config.force) {
      if (await this.fileExists(filterPath)) {
        conflicting.push(filterPath);
      }
      for (const { filePath } of overridePaths) {
        if (await this.fileExists(filePath)) {
          conflicting.push(filePath);
        }
      }
    }

    if (conflicting.length > 0) {
      if (config.force) {
        logger.warn('⚠ The following files already exist and will be overwritten:');
        conflicting.forEach((f) => logger.warn(`  - ${path.relative(config.outputDir, f)}`));
      } else {
        const fileList = conflicting
          .map((f) => `  - ${path.relative(config.outputDir, f)}`)
          .join('\n');
        throw new Error(
          `The following files already exist:\n${fileList}\n\nUse --force to overwrite existing files.`
        );
      }
    }

    const written: string[] = [];

    await fs.writeFile(filterPath, filterContent, 'utf-8');
    written.push(path.relative(config.outputDir, filterPath));

    for (const { filePath, env } of overridePaths) {
      const content = overrideContents[env];
      if (content !== undefined) {
        await fs.writeFile(filePath, content, 'utf-8');
        written.push(path.relative(config.outputDir, filePath));
      }
    }

    return written;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export const configureService: ConfigureService = new ConfigureServiceImpl();
