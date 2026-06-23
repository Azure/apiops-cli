// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for GitHub Copilot environment override prompt template
 */

import { describe, it, expect } from 'vitest';
import { generateConfigureOverridesPrompt } from '../../../../src/templates/copilot/configure-overrides-prompt.js';

describe('copilot/configure-overrides-prompt', () => {
  it('should produce a static prompt with environment auto-detection instructions', () => {
    const prompt = generateConfigureOverridesPrompt();

    expect(prompt).toContain('# Configure APIOps Environment Overrides');
    expect(prompt).toContain('configuration.{environment}.yaml');
    expect(prompt).toContain('Detect Environments');
    expect(prompt).toContain('configuration.*.yaml');
    expect(prompt).not.toMatch(/\{\{[^}]+\}\}/);
  });
});
