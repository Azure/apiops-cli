// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Shared template rendering utility for Copilot prompt templates.
 * Replaces {{TOKEN}} placeholders with provided values.
 */

/**
 * Replaces all `{{KEY}}` placeholders in a template string with the
 * corresponding values from the tokens map.
 */
export function renderTemplate(template: string, tokens: Record<string, string>): string {
  return Object.entries(tokens).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, value),
    template
  );
}
