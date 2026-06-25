// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Sample override configuration template per environment
 * Generates environment-specific configuration.{env}.yaml files
 */

import { overrideConfigTemplate } from '../generated/embedded-markdown.js';
import { renderTemplate } from '../../lib/render-template.js';
import { schemaUrl } from './schema-ref.js';

export function generateOverrideConfig(environment: string): string {
  return renderTemplate(overrideConfigTemplate, {
    SCHEMA_URL: schemaUrl('override-config.schema.json'),
    ENVIRONMENT: environment,
  });
}
