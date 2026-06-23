// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * GitHub Copilot prompt template for configuring resource filters.
 * Generates a .prompt.md file that guides Copilot through creating
 * a configuration.extractor.yaml filter file.
 */

import { copilotConfigureFilterPromptTemplate } from '../generated/embedded-markdown.js';

export interface ConfigureFilterPromptConfig {
  environments: string[];
}

export function generateConfigureFilterPrompt(_config: ConfigureFilterPromptConfig): string {
  // The filter prompt is static — no token substitution needed currently.
  // The config parameter is accepted for future extensibility and consistency.
  return copilotConfigureFilterPromptTemplate;
}
