// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * GitHub Copilot prompt template for configuring environment overrides.
 * Generates a .prompt.md file that guides Copilot through creating
 * configuration.{env}.yaml override files for environment promotion.
 */

import { copilotConfigureOverridesPromptTemplate } from '../generated/embedded-markdown.js';

export function generateConfigureOverridesPrompt(): string {
  return copilotConfigureOverridesPromptTemplate;
}
