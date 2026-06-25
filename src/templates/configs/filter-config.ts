// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Sample filter configuration template
 * Generates a sample configuration.extractor.yaml file
 */

import { filterConfigTemplate } from '../generated/embedded-markdown.js';
import { renderTemplate } from '../../lib/render-template.js';
import { schemaUrl } from './schema-ref.js';

export function generateFilterConfig(): string {
  return renderTemplate(filterConfigTemplate, {
    SCHEMA_URL: schemaUrl('extractor-config.schema.json'),
  });
}
