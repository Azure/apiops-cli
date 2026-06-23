// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * GitHub Copilot prompt template for configuring environment overrides.
 * Generates a .prompt.md file that guides Copilot through creating
 * configuration.{env}.yaml override files for environment promotion.
 */

import { copilotConfigureOverridesPromptTemplate } from '../generated/embedded-markdown.js';
import { renderTemplate } from '../shared/template-utils.js';

export interface ConfigureOverridesPromptConfig {
  environments: string[];
}

export function generateConfigureOverridesPrompt(config: ConfigureOverridesPromptConfig): string {
  const environmentList = config.environments.join(', ');
  return renderTemplate(copilotConfigureOverridesPromptTemplate, {
    ENVIRONMENT_LIST: environmentList,
  });
}
