// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Interactive prompt handler
 * TTY detection, question prompts for CI provider/artifact dir/environments
 * --non-interactive bypass per FR-022
 */

import * as readline from 'readline';
import { logger } from '../lib/logger.js';

export interface PromptService {
  isTTY(): boolean;
  askCIProvider(): Promise<'github-actions' | 'azure-devops'>;
  askArtifactDir(defaultValue: string): Promise<string>;
  askEnvironments(defaultValue: string[]): Promise<string[]>;
  /**
   * Ask the user to select which APIs to include in the extractor filter.
   * Returns the chosen names (or all names if the user accepts the default).
   */
  askApiFilter(allApiNames: string[]): Promise<string[]>;
  /**
   * Ask the user for the secret-token placeholder name to use for a named
   * value in a specific environment.  Returns the token name without
   * the `{#[...]#}` wrapper so callers can format as needed.
   */
  askSecretTokenName(namedValueName: string, environment: string, suggestedToken: string): Promise<string>;
  /**
   * Ask the user for the URL to use for a backend in a specific environment.
   * Returns an empty string to signal "keep the default / don't override".
   */
  askBackendUrl(backendName: string, environment: string, currentUrl: string | undefined): Promise<string>;
  /**
   * Ask the user a yes/no question. Returns true for yes.
   */
  askYesNo(question: string, defaultYes?: boolean): Promise<boolean>;
}

class PromptServiceImpl implements PromptService {
  /**
   * Check if we're running in an interactive terminal
   */
  isTTY(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
  }

  /**
   * Ask user to choose CI/CD provider
   */
  async askCIProvider(): Promise<'github-actions' | 'azure-devops'> {
    const answer = await this.ask(
      'Select CI/CD provider:\n  1) GitHub Actions\n  2) Azure DevOps\nChoice (1-2): '
    );
    
    if (answer === '1') {
      return 'github-actions';
    } else if (answer === '2') {
      return 'azure-devops';
    } else {
      logger.warn('Invalid choice, defaulting to GitHub Actions');
      return 'github-actions';
    }
  }

  /**
   * Ask user for artifact directory path
   */
  async askArtifactDir(defaultValue: string): Promise<string> {
    const answer = await this.ask(
      `Artifact directory path (default: ${defaultValue}): `
    );
    return answer.trim() || defaultValue;
  }

  /**
   * Ask user for environment names
   */
  async askEnvironments(defaultValue: string[]): Promise<string[]> {
    const defaultStr = defaultValue.join(',');
    const answer = await this.ask(
      `Environment names, comma-separated (default: ${defaultStr}): `
    );
    
    if (!answer.trim()) {
      return defaultValue;
    }
    
    return answer
      .split(',')
      .map((env) => env.trim())
      .filter((env) => env.length > 0);
  }

  /**
   * Ask user to select APIs for the extractor filter.
   */
  async askApiFilter(allApiNames: string[]): Promise<string[]> {
    if (allApiNames.length === 0) {
      return [];
    }

    logger.info(`\nFound ${allApiNames.length} API(s):`);
    allApiNames.forEach((name, i) => logger.info(`  ${i + 1}) ${name}`));
    logger.info('');

    const answer = await this.ask(
      'Enter API names to include (comma-separated), or press Enter to include all: '
    );

    if (!answer.trim()) {
      return allApiNames;
    }

    const selected = answer
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    return selected;
  }

  /**
   * Ask user for a secret token name for a named value override.
   */
  async askSecretTokenName(
    namedValueName: string,
    environment: string,
    suggestedToken: string
  ): Promise<string> {
    const answer = await this.ask(
      `  Token name for secret named-value "${namedValueName}" in ${environment} (default: ${suggestedToken}): `
    );
    return answer.trim() || suggestedToken;
  }

  /**
   * Ask user for a backend URL override in a specific environment.
   */
  async askBackendUrl(
    backendName: string,
    environment: string,
    currentUrl: string | undefined
  ): Promise<string> {
    const hint = currentUrl ? ` (current: ${currentUrl})` : '';
    const answer = await this.ask(
      `  URL for backend "${backendName}" in ${environment}${hint} (leave blank to keep default): `
    );
    return answer.trim();
  }

  /**
   * Ask user a yes/no question.
   */
  async askYesNo(question: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = await this.ask(`${question} ${hint}: `);
    const trimmed = answer.trim().toLowerCase();
    if (!trimmed) {
      return defaultYes;
    }
    return trimmed === 'y' || trimmed === 'yes';
  }

  /**
   * Low-level prompt helper
   */
  private ask(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

export const promptService: PromptService = new PromptServiceImpl();
