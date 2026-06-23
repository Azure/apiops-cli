// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Unit tests for GitHub Copilot filter configuration prompt template
 */

import { describe, it, expect } from 'vitest';
import { generateConfigureFilterPrompt } from '../../../../src/templates/copilot/configure-filter-prompt.js';

describe('copilot/configure-filter-prompt', () => {
  it('should return the static filter prompt template', () => {
    const prompt = generateConfigureFilterPrompt({ environments: ['dev', 'prod'] });

    expect(prompt).toContain('# Configure APIOps Extractor Filters');
    expect(prompt).toContain('configuration.extractor.yaml');
    expect(prompt).toContain('## Step 1');
    expect(prompt).toContain('## Step 4');
  });
});
