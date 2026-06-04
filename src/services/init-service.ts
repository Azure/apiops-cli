// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T042 & T051: Init orchestrator service
 * Coordinates interactive prompts or flag-based config, generates scaffold files,
 * and detects existing file conflicts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { InitConfig } from '../models/config.js';
import { logger } from '../lib/logger.js';
import { promptService } from './prompt-service.js';
import { identityGuideService } from './identity-guide-service.js';
import {
  generateExtractWorkflow,
  ExtractWorkflowConfig,
} from '../templates/github-actions/extract-workflow.js';
import {
  generatePublishWorkflow,
  PublishWorkflowConfig,
} from '../templates/github-actions/publish-workflow.js';
import {
  generateExtractPipeline,
  ExtractPipelineConfig,
} from '../templates/azure-devops/extract-pipeline.js';
import {
  generatePublishPipeline,
  PublishPipelineConfig,
} from '../templates/azure-devops/publish-pipeline.js';
import { generateFilterConfig } from '../templates/configs/filter-config.js';
import { generateOverrideConfig } from '../templates/configs/override-config.js';
import { generatePackageJson } from '../templates/configs/package-json.js';
import { generateIdentitySetupPrompt } from '../templates/copilot/identity-setup-prompt.js';

/** Placeholder values used in generated identity setup guides */
const PLACEHOLDER_SUBSCRIPTION_ID = '<your-subscription-id>';
const PLACEHOLDER_RESOURCE_GROUP = '<your-resource-group>';

export interface GeneratedFiles {
  pipelines: string[];
  configs: string[];
  directories: string[];
}

export interface InitService {
  run(config: InitConfig): Promise<GeneratedFiles>;
}

class InitServiceImpl implements InitService {
  async run(config: InitConfig): Promise<GeneratedFiles> {
    logger.info('Starting APIM repository initialization...');

    // Validate that the CLI package tarball exists (only if provided)
    if (config.cliPackage) {
      await this.validateCliPackage(config.cliPackage);
    }

    // Gather configuration (interactive or from flags)
    const finalConfig = await this.gatherConfiguration(config);
    logger.debug('Final configuration:', finalConfig);

    // Detect conflicts
    await this.detectConflicts(finalConfig);

    // Generate files
    const generatedFiles = await this.generateFiles(finalConfig);

    // Output identity setup guide
    await this.outputIdentityGuide(finalConfig, generatedFiles);

    return generatedFiles;
  }

  /**
   * Validate that the CLI package tarball exists and looks like a .tgz
   */
  private async validateCliPackage(cliPackagePath: string): Promise<void> {
    const resolvedPath = path.resolve(cliPackagePath);
    if (!await this.fileExists(resolvedPath)) {
      throw new Error(`CLI package not found: ${resolvedPath}`);
    }
    if (!resolvedPath.endsWith('.tgz')) {
      throw new Error(
        `CLI package must be a .tgz tarball (got: ${path.basename(resolvedPath)})`
      );
    }
  }

  /**
   * Gather configuration from interactive prompts or flags
   */
  private async gatherConfiguration(config: InitConfig): Promise<InitConfig> {
    let ciProvider = config.ciProvider;
    let artifactDir = config.artifactDir;
    let environments = config.environments;

    // Interactive mode
    if (!config.nonInteractive && promptService.isTTY()) {
      logger.info('Running in interactive mode. Press Ctrl+C to cancel.\n');

      if (!ciProvider) {
        ciProvider = await promptService.askCIProvider();
      }

      artifactDir = await promptService.askArtifactDir(artifactDir);
      environments = await promptService.askEnvironments(environments);
    } else {
      // Non-interactive mode
      if (!ciProvider) {
        throw new Error(
          'Non-interactive mode requires --ci flag (github-actions or azure-devops)'
        );
      }
      logger.info('Running in non-interactive mode');
    }

    return {
      ciProvider,
      nonInteractive: config.nonInteractive,
      artifactDir,
      environments,
      outputDir: config.outputDir,
      cliPackage: config.cliPackage,
      force: config.force,
    };
  }

  /**
   * Detect existing pipeline/config files and block unless --force is set
   */
  private async detectConflicts(config: InitConfig): Promise<void> {
    const conflictingFiles: string[] = [];

    // Check for pipeline files based on CI provider
    if (config.ciProvider === 'github-actions') {
      const extractWorkflow = path.join(
        config.outputDir,
        '.github/workflows/run-apim-extractor.yml'
      );
      const publishWorkflow = path.join(
        config.outputDir,
        '.github/workflows/run-apim-publisher.yml'
      );
      const promptFile = path.join(
        config.outputDir,
        '.github/prompts/apiops-setup-identity.prompt.md'
      );
      const identityGuide = path.join(
        config.outputDir,
        'IDENTITY-SETUP-GITHUB.md'
      );

      if (await this.fileExists(extractWorkflow)) {
        conflictingFiles.push(extractWorkflow);
      }
      if (await this.fileExists(publishWorkflow)) {
        conflictingFiles.push(publishWorkflow);
      }
      if (await this.fileExists(promptFile)) {
        conflictingFiles.push(promptFile);
      }
      if (await this.fileExists(identityGuide)) {
        conflictingFiles.push(identityGuide);
      }
    } else if (config.ciProvider === 'azure-devops') {
      const extractPipeline = path.join(
        config.outputDir,
        '.azdo/pipelines/run-apim-extractor.yml'
      );
      const publishPipeline = path.join(
        config.outputDir,
        '.azdo/pipelines/run-apim-publisher.yml'
      );
      const identityGuide = path.join(
        config.outputDir,
        'IDENTITY-SETUP-AZDO.md'
      );
      const promptFile = path.join(
        config.outputDir,
        '.github/prompts/apiops-setup-identity.prompt.md'
      );

      if (await this.fileExists(extractPipeline)) {
        conflictingFiles.push(extractPipeline);
      }
      if (await this.fileExists(publishPipeline)) {
        conflictingFiles.push(publishPipeline);
      }
      if (await this.fileExists(identityGuide)) {
        conflictingFiles.push(identityGuide);
      }
      if (await this.fileExists(promptFile)) {
        conflictingFiles.push(promptFile);
      }
    }

    // Check for config files
    const filterConfig = path.join(
      config.outputDir,
      'configuration.extract.yaml'
    );
    if (await this.fileExists(filterConfig)) {
      conflictingFiles.push(filterConfig);
    }

    for (const env of config.environments) {
      const overrideConfig = path.join(
        config.outputDir,
        `configuration.${env}.yaml`
      );
      if (await this.fileExists(overrideConfig)) {
        conflictingFiles.push(overrideConfig);
      }
    }

    // Block or warn based on --force flag
    if (conflictingFiles.length > 0) {
      if (config.force) {
        logger.warn('⚠ The following files already exist and will be overwritten:');
        conflictingFiles.forEach((file) => {
          logger.warn(`  - ${path.relative(config.outputDir, file)}`);
        });
        logger.warn('');
      } else {
        const fileList = conflictingFiles
          .map((file) => `  - ${path.relative(config.outputDir, file)}`)
          .join('\n');
        throw new Error(
          `The following files already exist:\n${fileList}\n\nUse --force to overwrite existing files.`
        );
      }
    }
  }

  /**
   * Generate all scaffold files
   */
  private async generateFiles(config: InitConfig): Promise<GeneratedFiles> {
    const generatedFiles: GeneratedFiles = {
      pipelines: [],
      configs: [],
      directories: [],
    };

    // Create artifact directory
    const artifactPath = path.join(config.outputDir, config.artifactDir);
    await fs.mkdir(artifactPath, { recursive: true });
    
    // Create .gitkeep to ensure directory is tracked
    const gitkeepPath = path.join(artifactPath, '.gitkeep');
    await fs.writeFile(gitkeepPath, '');
    generatedFiles.directories.push(config.artifactDir);

    // Generate package.json - mode depends on whether cliPackage is provided
    let packageJsonContent: string;
    if (config.cliPackage) {
      // Local tarball mode: copy tarball and reference via file: dependency
      const apiopsDir = path.join(config.outputDir, '.apiops');
      await fs.mkdir(apiopsDir, { recursive: true });
      const tarballFilename = path.basename(config.cliPackage);
      const tarballDest = path.join(apiopsDir, tarballFilename);
      await fs.copyFile(path.resolve(config.cliPackage), tarballDest);
      generatedFiles.directories.push('.apiops');

      const tarballRelPath = path.join('.apiops', tarballFilename);
      packageJsonContent = generatePackageJson({ mode: 'local', tarballRelPath });
    } else {
      // Public npm mode: use registry package
      packageJsonContent = generatePackageJson({ mode: 'npm' });
    }

    const packageJsonPath = path.join(config.outputDir, 'package.json');
    await this.writeOrMergePackageJson(packageJsonPath, packageJsonContent);
    generatedFiles.configs.push('package.json');

    // Generate pipeline files
    if (config.ciProvider === 'github-actions') {
      await this.generateGitHubActionsWorkflows(config, generatedFiles);
    } else if (config.ciProvider === 'azure-devops') {
      await this.generateAzureDevOpsPipelines(config, generatedFiles);
    }

    // Generate config files
    await this.generateConfigFiles(config, generatedFiles);

    return generatedFiles;
  }

  /**
   * Generate GitHub Actions workflow files
   */
  private async generateGitHubActionsWorkflows(
    config: InitConfig,
    generatedFiles: GeneratedFiles
  ): Promise<void> {
    const workflowsDir = path.join(config.outputDir, '.github/workflows');
    await fs.mkdir(workflowsDir, { recursive: true });

    // Extract workflow
    const extractWorkflowConfig: ExtractWorkflowConfig = {
      artifactDir: config.artifactDir,
    };
    const extractContent = generateExtractWorkflow(extractWorkflowConfig);
    const extractPath = path.join(workflowsDir, 'run-apim-extractor.yml');
    await fs.writeFile(extractPath, extractContent);
    generatedFiles.pipelines.push('.github/workflows/run-apim-extractor.yml');

    // Publish workflow
    const publishWorkflowConfig: PublishWorkflowConfig = {
      artifactDir: config.artifactDir,
      environments: config.environments,
    };
    const publishContent = generatePublishWorkflow(publishWorkflowConfig);
    const publishPath = path.join(workflowsDir, 'run-apim-publisher.yml');
    await fs.writeFile(publishPath, publishContent);
    generatedFiles.pipelines.push('.github/workflows/run-apim-publisher.yml');

    await this.generateCopilotIdentitySetupPrompt(config, generatedFiles);
  }

  /**
   * Generate Azure DevOps pipeline files
   */
  private async generateAzureDevOpsPipelines(
    config: InitConfig,
    generatedFiles: GeneratedFiles
  ): Promise<void> {
    const pipelinesDir = path.join(config.outputDir, '.azdo/pipelines');
    await fs.mkdir(pipelinesDir, { recursive: true });

    // Extract pipeline
    const extractPipelineConfig: ExtractPipelineConfig = {
      artifactDir: config.artifactDir,
    };
    const extractContent = generateExtractPipeline(extractPipelineConfig);
    const extractPath = path.join(pipelinesDir, 'run-apim-extractor.yml');
    await fs.writeFile(extractPath, extractContent);
    generatedFiles.pipelines.push('.azdo/pipelines/run-apim-extractor.yml');

    // Publish pipeline
    const publishPipelineConfig: PublishPipelineConfig = {
      artifactDir: config.artifactDir,
      environments: config.environments,
    };
    const publishContent = generatePublishPipeline(publishPipelineConfig);
    const publishPath = path.join(pipelinesDir, 'run-apim-publisher.yml');
    await fs.writeFile(publishPath, publishContent);
    generatedFiles.pipelines.push('.azdo/pipelines/run-apim-publisher.yml');

    await this.generateCopilotIdentitySetupPrompt(config, generatedFiles);
  }

  private async generateCopilotIdentitySetupPrompt(
    config: InitConfig,
    generatedFiles: GeneratedFiles
  ): Promise<void> {
    const promptContent = generateIdentitySetupPrompt({
      environments: config.environments,
      ciProvider: config.ciProvider,
    });
    const promptsDir = path.join(config.outputDir, '.github/prompts');
    await fs.mkdir(promptsDir, { recursive: true });
    const promptPath = path.join(promptsDir, 'apiops-setup-identity.prompt.md');
    await fs.writeFile(promptPath, promptContent);
    generatedFiles.configs.push('.github/prompts/apiops-setup-identity.prompt.md');
  }

  /**
   * Generate configuration files
   */
  private async generateConfigFiles(
    config: InitConfig,
    generatedFiles: GeneratedFiles
  ): Promise<void> {
    // Filter config
    const filterContent = generateFilterConfig();
    const filterPath = path.join(config.outputDir, 'configuration.extract.yaml');
    await fs.writeFile(filterPath, filterContent);
    generatedFiles.configs.push('configuration.extract.yaml');

    // Override configs for each environment
    for (const env of config.environments) {
      const overrideContent = generateOverrideConfig(env);
      const overridePath = path.join(
        config.outputDir,
        `configuration.${env}.yaml`
      );
      await fs.writeFile(overridePath, overrideContent);
      generatedFiles.configs.push(`configuration.${env}.yaml`);
    }
  }

  /**
   * Save identity setup guide to file and tell user where to find it
   */
  private async outputIdentityGuide(config: InitConfig, generatedFiles: GeneratedFiles): Promise<void> {
    // Use placeholder values for the guide — users replace these with their actual Azure details
    const subscriptionId = PLACEHOLDER_SUBSCRIPTION_ID;
    const resourceGroup = PLACEHOLDER_RESOURCE_GROUP;

    let guide: string;
    if (config.ciProvider === 'github-actions') {
      guide = identityGuideService.generateGitHubActionsGuide(
        subscriptionId,
        resourceGroup,
        config.environments
      );
    } else {
      guide = identityGuideService.generateAzureDevOpsGuide(
        subscriptionId,
        resourceGroup,
        config.environments
      );
    }

    // Save guide to file
    const guideFileName =
      config.ciProvider === 'github-actions'
        ? 'IDENTITY-SETUP-GITHUB.md'
        : 'IDENTITY-SETUP-AZDO.md';
    const guidePath = path.join(config.outputDir, guideFileName);
    await fs.writeFile(guidePath, guide);
    generatedFiles.configs.push(guideFileName);
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Write package.json if missing, otherwise merge APIOps dependency into existing content.
   */
  private async writeOrMergePackageJson(
    packageJsonPath: string,
    generatedPackageJsonContent: string
  ): Promise<void> {
    const generatedPkg = JSON.parse(generatedPackageJsonContent) as {
      dependencies?: Record<string, string>;
    };

    if (!await this.fileExists(packageJsonPath)) {
      await fs.writeFile(packageJsonPath, generatedPackageJsonContent);
      return;
    }

    const existingRaw = await fs.readFile(packageJsonPath, 'utf8');
    let existingPkg: Record<string, unknown>;
    try {
      existingPkg = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      throw new Error(
        `Existing package.json is not valid JSON: ${packageJsonPath}`
      );
    }

    const existingDeps = (
      typeof existingPkg.dependencies === 'object' &&
      existingPkg.dependencies !== null
        ? existingPkg.dependencies
        : {}
    ) as Record<string, string>;

    const generatedDeps = generatedPkg.dependencies ?? {};

    existingPkg.dependencies = {
      ...existingDeps,
      ...generatedDeps,
    };

    await fs.writeFile(packageJsonPath, `${JSON.stringify(existingPkg, null, 2)}\n`);
  }
}

export const initService: InitService = new InitServiceImpl();
