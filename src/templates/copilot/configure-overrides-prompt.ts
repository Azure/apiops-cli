// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * GitHub Copilot prompt template for configuring environment overrides.
 * Generates a .prompt.md file that guides Copilot through creating
 * configuration.{env}.yaml override files for environment promotion.
 */

import { copilotConfigureOverridesPromptTemplate } from '../generated/embedded-markdown.js';

export interface ConfigureOverridesPromptConfig {
  environments: string[];
}

function renderTemplate(template: string, tokens: Record<string, string>): string {
  return Object.entries(tokens).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, value),
    template
  );
}

export function generateConfigureOverridesPrompt(config: ConfigureOverridesPromptConfig): string {
  const environmentList = config.environments.join(', ');
  return renderTemplate(copilotConfigureOverridesPromptTemplate, {
    ENVIRONMENT_LIST: environmentList,
  });
}
