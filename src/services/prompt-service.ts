// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * T049: Interactive prompt handler
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
