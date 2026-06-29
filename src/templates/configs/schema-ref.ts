// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * Builds URLs to the published JSON schemas.
 *
 * The schema is only an editor/IDE validation aid (yaml-language-server); the
 * CLI does its own validation at runtime. Schemas are versioned independently
 * of the CLI package version: each schema version lives at a frozen path
 * (`schemas/v<N>/...`) on the `main` branch. Backward-compatible edits update
 * the current version in place; a breaking change introduces a new version
 * folder. The `main` ref always resolves, and the versioned path keeps existing
 * config files pointing at the schema shape they were written against.
 */

import packageJson from '../../../package.json' with { type: 'json' };

const SCHEMA_BASE = 'https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas';

/**
 * Returns the raw URL for a published schema file at the current schema version.
 *
 * @param fileName Schema file name, e.g. `extractor-config.schema.json`.
 */
export function schemaUrl(fileName: string): string {
  const { schemaVersion } = packageJson as { schemaVersion?: string };
  const version = schemaVersion ?? '1';
  return `${SCHEMA_BASE}/v${version}/${fileName}`;
}
