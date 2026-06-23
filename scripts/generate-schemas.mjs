/**
 * Generates JSON Schema files for the filter (extractor) and override configurations.
 * Derives schemas from the canonical TypeScript interfaces in src/models/config.ts.
 *
 * Run: node scripts/generate-schemas.mjs
 * Hooked into: prebuild, prelint, pretest (alongside embed-markdown-templates)
 *
 * The script reads config.ts to extract the field names from FilterConfig and
 * OverrideConfig interfaces, then generates the full JSON Schema files into
 * schemas/. This ensures the schemas stay in sync with the TypeScript types
 * without requiring a heavy ts-json-schema-generator dependency.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const configPath = resolve(repoRoot, 'src/models/config.ts');
const schemasDir = resolve(repoRoot, 'schemas');

// Read the config.ts source to extract interface fields
const configSource = await readFile(configPath, 'utf8');

/**
 * Extract field names from a TypeScript interface definition.
 * Matches lines like: `fieldName?: Type;`
 */
function extractFields(interfaceName, source) {
  const regex = new RegExp(
    `interface\\s+${interfaceName}\\s*\\{([^}]+)\\}`,
    's'
  );
  const match = source.match(regex);
  if (!match) {
    throw new Error(`Could not find interface ${interfaceName} in config.ts`);
  }
  const body = match[1];
  const fieldRegex = /^\s*(?:\/\*\*[^*]*\*\/\s*)?(\w+)\??\s*:/gm;
  const fields = [];
  let m;
  while ((m = fieldRegex.exec(body)) !== null) {
    fields.push(m[1]);
  }
  return fields;
}

// --- Extractor (Filter) Config Schema ---

const filterFields = extractFields('FilterConfig', configSource);
const apiSubFilterFields = extractFields('ApiSubFilter', configSource);
const workspaceSubFilterFields = extractFields('WorkspaceSubFilter', configSource);

// Fields that use special handling (not simple resourcePatternArray)
const SPECIAL_FILTER_FIELDS = new Set([
  'apis', 'workspaces', 'apiSubFilters', 'workspaceSubFilters',
]);

// Human-friendly labels for resource types
const RESOURCE_LABELS = {
  apis: 'APIs',
  backends: 'Backends',
  products: 'Products',
  namedValues: 'Named values',
  loggers: 'Loggers',
  diagnostics: 'Diagnostics',
  tags: 'Tags',
  policyFragments: 'Policy fragments',
  gateways: 'Gateways',
  versionSets: 'Version sets',
  groups: 'Groups',
  subscriptions: 'Subscriptions',
  schemas: 'Schemas',
  policies: 'Service-level policies',
  policyRestrictions: 'Policy restrictions',
  documentations: 'Documentations',
  workspaces: 'Workspaces',
};

function buildFilterProperties() {
  const props = {
    $schema: {
      type: 'string',
      description: 'Optional schema URI for editor and IDE validation.',
    },
  };

  for (const field of filterFields) {
    // Skip internal-only fields that don't appear in YAML
    if (field === 'apiSubFilters' || field === 'workspaceSubFilters') continue;

    const label = RESOURCE_LABELS[field] || field;

    if (field === 'apis') {
      props.apis = {
        type: 'array',
        description: `${label} to extract. Each item can be either a plain API name or wildcard pattern, or an object with a single API name mapped to nested API sub-filters. Matching is case-insensitive and supports * and ? wildcards.`,
        items: { $ref: '#/definitions/apiSelector' },
      };
    } else if (field === 'workspaces') {
      props.workspaces = {
        type: 'array',
        description: `${label} to extract. Each item can be either a plain workspace name or wildcard pattern, or an object with a single workspace name mapped to nested workspace sub-filters. Matching is case-insensitive and supports * and ? wildcards.`,
        items: { $ref: '#/definitions/workspaceSelector' },
      };
    } else {
      props[field] = {
        $ref: '#/definitions/resourcePatternArray',
        description: `${label} to extract. Matching is case-insensitive and supports * and ? wildcards.`,
      };
    }
  }

  return props;
}

function buildApiSubFilterProperties() {
  const props = {};
  for (const field of apiSubFilterFields) {
    const label = field.charAt(0).toUpperCase() + field.slice(1);
    props[field] = {
      $ref: '#/definitions/resourcePatternArray',
      description: `${label} to extract for this API. Matching is case-insensitive and supports * and ? wildcards.`,
    };
  }
  return props;
}

function buildWorkspaceSubFilterProperties() {
  const props = {};
  for (const field of workspaceSubFilterFields) {
    // Skip internal-only fields
    if (field === 'apiSubFilters') continue;

    const label = RESOURCE_LABELS[field] || field;

    if (field === 'apis') {
      props.apis = {
        type: 'array',
        description: `${label} within this workspace to extract. Each item can be either a plain API name or wildcard pattern, or an object with a single API name mapped to nested API sub-filters. Matching is case-insensitive and supports * and ? wildcards.`,
        items: { $ref: '#/definitions/apiSelector' },
      };
    } else {
      props[field] = {
        $ref: '#/definitions/resourcePatternArray',
        description: `${label} within this workspace to extract. Matching is case-insensitive and supports * and ? wildcards.`,
      };
    }
  }
  return props;
}

const LICENSE_COMMENT = 'Copyright (c) Microsoft Corporation. Licensed under the MIT license.';

const extractorSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $comment: LICENSE_COMMENT,
  $id: 'https://github.com/Azure/apiops-cli/schemas/extractor-config.schema.json',
  title: 'APIOps Filter Configuration',
  description:
    'Validates configuration.extractor.yaml files used by APIOps CLI to select which Azure API Management resources are extracted. All resource sections are optional.',
  type: 'object',
  additionalProperties: false,
  properties: buildFilterProperties(),
  definitions: {
    resourcePattern: {
      type: 'string',
      description:
        'A resource name or wildcard pattern. Matching is case-insensitive. Supported wildcards: * matches zero or more characters, and ? matches a single character.',
    },
    resourcePatternArray: {
      type: 'array',
      description:
        'A list of resource names or wildcard patterns. Matching is case-insensitive. Supported wildcards: * and ?.',
      items: { $ref: '#/definitions/resourcePattern' },
    },
    apiSelector: {
      oneOf: [
        { $ref: '#/definitions/resourcePattern' },
        {
          type: 'object',
          description:
            'A single API name mapped to sub-resource filters for that API.',
          minProperties: 1,
          maxProperties: 1,
          patternProperties: {
            '^.+$': { $ref: '#/definitions/apiSubFilter' },
          },
          additionalProperties: false,
        },
      ],
    },
    workspaceSelector: {
      oneOf: [
        { $ref: '#/definitions/resourcePattern' },
        {
          type: 'object',
          description:
            'A single workspace name mapped to sub-resource filters for that workspace.',
          minProperties: 1,
          maxProperties: 1,
          patternProperties: {
            '^.+$': { $ref: '#/definitions/workspaceSubFilter' },
          },
          additionalProperties: false,
        },
      ],
    },
    apiSubFilter: {
      type: 'object',
      description:
        'Sub-resource filters for a specific API. Omit a property to include all sub-resources of that type, or set it to an empty array to exclude all of that type. Matching is case-insensitive and supports * and ? wildcards.',
      additionalProperties: false,
      properties: buildApiSubFilterProperties(),
    },
    workspaceSubFilter: {
      type: 'object',
      description:
        'Sub-resource filters for a specific workspace. Omit a property to include all resources of that type, or set it to an empty array to exclude all of that type. Matching is case-insensitive and supports * and ? wildcards.',
      additionalProperties: false,
      properties: buildWorkspaceSubFilterProperties(),
    },
  },
};

// --- Override Config Schema ---

const overrideFields = extractFields('OverrideConfig', configSource);

function buildOverrideProperties() {
  const props = {
    $schema: {
      type: 'string',
      description: 'Optional schema URI for editor and IDE validation.',
    },
  };

  for (const field of overrideFields) {
    const label = RESOURCE_LABELS[field] || field.charAt(0).toUpperCase() + field.slice(1);
    const tokenNote = 'Values may include {#[TOKEN_NAME]#} placeholders for CI/CD secret token substitution.';

    if (field === 'apis') {
      props.apis = {
        $ref: '#/definitions/apiOverrideSection',
        description: `API overrides. Each entry can override API properties and optionally define nested diagnostics, operations, policies, and releases. ${tokenNote}`,
      };
    } else if (field === 'backends') {
      props.backends = {
        $ref: '#/definitions/overrideSection',
        description: `Backend overrides. Use the properties object to deep-merge resource properties such as URLs or credentials. ${tokenNote}`,
      };
    } else if (field === 'namedValues') {
      props.namedValues = {
        $ref: '#/definitions/overrideSection',
        description: `Named value overrides. Use the properties object to deep-merge resource properties. ${tokenNote}`,
      };
    } else {
      props[field] = {
        $ref: '#/definitions/overrideSection',
        description: `${label} overrides. ${tokenNote}`,
      };
    }
  }

  return props;
}

const overrideSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $comment: LICENSE_COMMENT,
  $id: 'https://github.com/Azure/apiops-cli/schemas/override-config.schema.json',
  title: 'APIOps Override Configuration',
  description:
    'Validates configuration.{env}.yaml override files used by APIOps CLI to apply environment-specific property overrides during publish. All resource sections are optional.',
  type: 'object',
  additionalProperties: false,
  properties: buildOverrideProperties(),
  definitions: {
    propertiesObject: {
      type: 'object',
      description:
        'Properties to deep-merge into the target resource. Any property name is allowed. Values may include {#[TOKEN_NAME]#} placeholders for CI/CD secret token substitution.',
      additionalProperties: true,
    },
    overrideEntry: {
      type: 'object',
      required: ['name', 'properties'],
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'Resource name to match for this override entry.',
        },
        properties: { $ref: '#/definitions/propertiesObject' },
      },
    },
    overrideSection: {
      type: 'array',
      description: 'A list of override entries for a resource type.',
      items: { $ref: '#/definitions/overrideEntry' },
    },
    operationOverrideEntry: {
      type: 'object',
      required: ['name', 'properties'],
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'Operation name to match for this override entry.',
        },
        properties: { $ref: '#/definitions/propertiesObject' },
        policies: {
          $ref: '#/definitions/overrideSection',
          description:
            'Policy overrides nested under this operation. Values may include {#[TOKEN_NAME]#} placeholders for CI/CD secret token substitution.',
        },
      },
    },
    operationOverrideSection: {
      type: 'array',
      description: 'A list of operation override entries.',
      items: { $ref: '#/definitions/operationOverrideEntry' },
    },
    apiOverrideEntry: {
      type: 'object',
      required: ['name', 'properties'],
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'API name to match for this override entry.',
        },
        properties: { $ref: '#/definitions/propertiesObject' },
        diagnostics: {
          $ref: '#/definitions/overrideSection',
          description:
            'Diagnostic overrides nested under this API. Values may include {#[TOKEN_NAME]#} placeholders for CI/CD secret token substitution.',
        },
        operations: {
          $ref: '#/definitions/operationOverrideSection',
          description:
            'Operation overrides nested under this API. Each operation can define its own nested policies. Values may include {#[TOKEN_NAME]#} placeholders for CI/CD secret token substitution.',
        },
        policies: {
          $ref: '#/definitions/overrideSection',
          description:
            'Policy overrides nested directly under this API. Values may include {#[TOKEN_NAME]#} placeholders for CI/CD secret token substitution.',
        },
        releases: {
          $ref: '#/definitions/overrideSection',
          description:
            'Release overrides nested under this API. Values may include {#[TOKEN_NAME]#} placeholders for CI/CD secret token substitution.',
        },
      },
    },
    apiOverrideSection: {
      type: 'array',
      description: 'A list of API override entries.',
      items: { $ref: '#/definitions/apiOverrideEntry' },
    },
  },
};

// Write schemas
await mkdir(schemasDir, { recursive: true });
await writeFile(
  resolve(schemasDir, 'extractor-config.schema.json'),
  JSON.stringify(extractorSchema, null, 2) + '\n'
);
await writeFile(
  resolve(schemasDir, 'override-config.schema.json'),
  JSON.stringify(overrideSchema, null, 2) + '\n'
);
