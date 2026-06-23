// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for GitHub Copilot environment override prompt template
 */

import { describe, it, expect } from 'vitest';
import { generateConfigureOverridesPrompt } from '../../../../src/templates/copilot/configure-overrides-prompt.js';

describe('copilot/configure-overrides-prompt', () => {
  it('should render the environment list into the prompt', () => {
    const prompt = generateConfigureOverridesPrompt({
      environments: ['dev', 'staging', 'prod'],
    });

    expect(prompt).toContain('# Configure APIOps Environment Overrides');
    expect(prompt).toContain('Environments: dev, staging, prod');
    expect(prompt).toContain('configuration.{environment}.yaml');
    expect(prompt).not.toMatch(/\{\{[^}]+\}\}/);
  });
});
