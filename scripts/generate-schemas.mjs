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

// Schemas are versioned independently of the CLI package version. Each schema
// version lives at a frozen path (schemas/v<N>/...) on the `main` branch:
// backward-compatible edits update the current version in place, while a
// breaking change introduces a new version folder. The `main` ref always
// resolves, and the versioned path keeps existing configs pointing at the
// schema shape they were written against.
const pkg = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
const schemaVersion = pkg.schemaVersion ?? '1';
const schemaDirName = `v${schemaVersion}`;
const schemasDir = resolve(repoRoot, 'schemas', schemaDirName);
const SCHEMA_BASE = 'https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas';
const schemaId = (fileName) => `${SCHEMA_BASE}/${schemaDirName}/${fileName}`;

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
const versionComment = `${LICENSE_COMMENT} Schema version: ${schemaDirName}.`;

const extractorSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $comment: versionComment,
  $id: schemaId('extractor-config.schema.json'),
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
    } else if (field === 'namedValues') {
      props.namedValues = {
        $ref: '#/definitions/namedValueOverrideSection',
        description: `Named value overrides. Use the properties object to deep-merge resource properties. ${tokenNote}`,
      };
    } else if (field === 'backends') {
      props.backends = {
        $ref: '#/definitions/backendOverrideSection',
        description: `Backend overrides. Use the properties object to deep-merge resource properties such as URLs or credentials. ${tokenNote}`,
      };
    } else if (field === 'loggers') {
      props.loggers = {
        $ref: '#/definitions/loggerOverrideSection',
        description: `Loggers overrides. ${tokenNote}`,
      };
    } else if (field === 'diagnostics') {
      props.diagnostics = {
        $ref: '#/definitions/diagnosticOverrideSection',
        description: `Diagnostics overrides. ${tokenNote}`,
      };
    } else if (field === 'policies') {
      props.policies = {
        $ref: '#/definitions/policyOverrideSection',
        description: `Service-level policies overrides. ${tokenNote}`,
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
  $comment: versionComment,
  $id: schemaId('override-config.schema.json'),
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
      required: ['name'],
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

    // --- Named value typed section ---
    namedValueOverrideEntry: {
      type: 'object',
      required: ['name', 'properties'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Named value name to match for this override entry.' },
        properties: { $ref: '#/definitions/namedValuePropertiesObject' },
      },
    },
    namedValueOverrideSection: {
      type: 'array',
      description: 'A list of named value override entries.',
      items: { $ref: '#/definitions/namedValueOverrideEntry' },
    },

    // --- Backend typed section ---
    backendOverrideEntry: {
      type: 'object',
      required: ['name', 'properties'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Backend name to match for this override entry.' },
        properties: { $ref: '#/definitions/backendPropertiesObject' },
      },
    },
    backendOverrideSection: {
      type: 'array',
      description: 'A list of backend override entries.',
      items: { $ref: '#/definitions/backendOverrideEntry' },
    },

    // --- Logger typed section ---
    loggerOverrideEntry: {
      type: 'object',
      required: ['name', 'properties'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Logger name to match for this override entry.' },
        properties: { $ref: '#/definitions/loggerPropertiesObject' },
      },
    },
    loggerOverrideSection: {
      type: 'array',
      description: 'A list of logger override entries.',
      items: { $ref: '#/definitions/loggerOverrideEntry' },
    },

    // --- Diagnostic typed section ---
    diagnosticOverrideEntry: {
      type: 'object',
      required: ['name', 'properties'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Diagnostic name to match for this override entry.' },
        properties: { $ref: '#/definitions/diagnosticPropertiesObject' },
      },
    },
    diagnosticOverrideSection: {
      type: 'array',
      description: 'A list of diagnostic override entries.',
      items: { $ref: '#/definitions/diagnosticOverrideEntry' },
    },

    // --- Policy typed section ---
    policyOverrideEntry: {
      type: 'object',
      required: ['name', 'properties'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Policy name to match for this override entry.' },
        properties: { $ref: '#/definitions/policyPropertiesObject' },
      },
    },
    policyOverrideSection: {
      type: 'array',
      description: 'A list of policy override entries.',
      items: { $ref: '#/definitions/policyOverrideEntry' },
    },

    // --- Operation override ---
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
          $ref: '#/definitions/policyOverrideSection',
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

    // --- API typed section ---
    apiOverrideEntry: {
      type: 'object',
      required: ['name', 'properties'],
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'API name to match for this override entry.',
        },
        properties: { $ref: '#/definitions/apiPropertiesObject' },
        diagnostics: {
          $ref: '#/definitions/diagnosticOverrideSection',
          description:
            'Diagnostic overrides nested under this API. Values may include {#[TOKEN_NAME]#} placeholders for CI/CD secret token substitution.',
        },
        operations: {
          $ref: '#/definitions/operationOverrideSection',
          description:
            'Operation overrides nested under this API. Each operation can define its own nested policies. Values may include {#[TOKEN_NAME]#} placeholders for CI/CD secret token substitution.',
        },
        policies: {
          $ref: '#/definitions/policyOverrideSection',
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

    // --- Typed properties objects ---
    apiPropertiesObject: {
      type: 'object',
      description: 'Common API properties with editor autocomplete. Additional API properties are allowed.',
      properties: {
        displayName: { type: 'string', description: 'Friendly API display name in the APIM portal.' },
        description: { type: ['string', 'null'], description: 'Optional API description.' },
        path: { type: 'string', description: 'API URL suffix/path.' },
        serviceUrl: { type: ['string', 'null'], description: 'Backend service URL for this API.' },
        apiType: {
          type: 'string',
          description: 'API kind used by APIM import/export logic.',
          enum: ['http', 'soap', 'graphql', 'websocket', 'odata', 'grpc', 'mcp', 'a2a'],
        },
        type: {
          type: 'string',
          description: 'Source API type from extracted API metadata. Use the same values as apiType.',
          enum: ['http', 'soap', 'graphql', 'websocket', 'odata', 'grpc', 'mcp', 'a2a'],
        },
        protocols: {
          type: 'array',
          description: 'Supported frontend protocols for this API.',
          items: { type: 'string', enum: ['http', 'https', 'ws', 'wss'] },
          uniqueItems: true,
        },
        subscriptionRequired: { type: 'boolean', description: 'Whether a subscription key is required to call this API.' },
        subscriptionKeyParameterNames: {
          type: 'object',
          description: 'Custom subscription key header/query names.',
          properties: {
            header: { type: 'string' },
            query: { type: 'string' },
          },
          additionalProperties: false,
        },
        apiRevision: { type: 'string', description: 'API revision identifier.' },
        apiRevisionDescription: { type: ['string', 'null'], description: 'Description for the API revision.' },
        apiVersion: { type: 'string', description: 'API version label.' },
        isCurrent: { type: 'boolean', description: 'Marks this API revision as current.' },
        apiVersionSetId: { type: 'string', description: 'Reference to the API version set resource.' },
        format: {
          type: 'string',
          description: 'Specification format used for API import/export payloads.',
          enum: [
            'openapi', 'openapi+json', 'openapi-link',
            'swagger-json', 'swagger-link',
            'wsdl', 'wsdl-link',
            'wadl-xml', 'wadl-link',
            'graphql-link',
          ],
        },
        value: { type: 'string', description: 'Inline specification content or URL depending on format.' },
        authenticationSettings: {
          type: 'object',
          description: 'Authentication settings for backend authorization.',
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },

    namedValuePropertiesObject: {
      type: 'object',
      description: 'Common named value properties with editor autocomplete. Additional named value properties are allowed.',
      properties: {
        displayName: { type: 'string', description: 'Friendly named value display name in the APIM portal.' },
        value: { type: ['string', 'null'], description: 'Literal named value content (avoid putting secrets directly in source control).' },
        secret: { type: 'boolean', description: 'Whether the named value is treated as a secret.' },
        tags: { type: 'array', description: 'Named value tags.', items: { type: 'string' }, uniqueItems: true },
        keyVault: {
          type: 'object',
          description: 'Key Vault secret reference for this named value.',
          properties: {
            secretIdentifier: { type: 'string', description: 'Full Key Vault secret identifier URL.' },
            identityClientId: { type: ['string', 'null'], description: 'User-assigned managed identity client ID used to access the secret.' },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },

    backendPropertiesObject: {
      type: 'object',
      description: 'Common backend properties with editor autocomplete. Additional backend properties are allowed.',
      properties: {
        title: { type: ['string', 'null'], description: 'Optional backend title.' },
        description: { type: ['string', 'null'], description: 'Optional backend description.' },
        url: { type: ['string', 'null'], description: 'Backend runtime URL.' },
        protocol: { type: 'string', description: 'Backend protocol.', enum: ['http', 'soap'] },
        resourceId: { type: ['string', 'null'], description: 'Linked Azure resource ID, when applicable.' },
        credentials: { type: 'object', description: 'Backend authentication credentials object.', additionalProperties: true },
        proxy: { type: 'object', description: 'Proxy settings for backend connectivity.', additionalProperties: true },
        tls: { type: 'object', description: 'TLS settings for backend connectivity.', additionalProperties: true },
      },
      additionalProperties: true,
    },

    loggerPropertiesObject: {
      type: 'object',
      description: 'Common logger properties with editor autocomplete. Additional logger properties are allowed.',
      properties: {
        loggerType: {
          type: 'string',
          description: 'Logger type.',
          enum: ['applicationInsights', 'azureEventHub'],
        },
        description: { type: ['string', 'null'], description: 'Optional logger description.' },
        resourceId: { type: ['string', 'null'], description: 'Linked Azure resource ID for the logger target.' },
        isBuffered: { type: 'boolean', description: 'Whether messages are buffered before being sent.' },
        credentials: {
          type: 'object',
          description: 'Logger credentials (for example instrumentationKey or connection string).',
          properties: {
            instrumentationKey: { type: 'string', description: 'Application Insights instrumentation key or named value reference.' },
            name: { type: 'string', description: 'Event Hub name, where applicable.' },
            connectionString: { type: 'string', description: 'Event Hub connection string or named value reference.' },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },

    diagnosticPropertiesObject: {
      type: 'object',
      description: 'Common diagnostic properties with editor autocomplete. Additional diagnostic properties are allowed.',
      properties: {
        alwaysLog: {
          type: ['string', 'null'],
          description: 'Diagnostic always-log behavior.',
          enum: ['allErrors', 'always', null],
        },
        httpCorrelationProtocol: {
          type: ['string', 'null'],
          description: 'HTTP correlation protocol for tracing.',
          enum: ['Legacy', 'W3C', 'None', null],
        },
        logClientIp: { type: 'boolean', description: 'Whether client IP address is logged.' },
        verbosity: {
          type: 'string',
          description: 'Diagnostic verbosity level.',
          enum: ['verbose', 'information', 'error', 'Verbose', 'Information', 'Error'],
        },
        loggerId: { type: ['string', 'null'], description: 'Target logger ARM resource ID.' },
        sampling: {
          type: 'object',
          description: 'Diagnostic sampling configuration.',
          properties: {
            samplingType: { type: 'string', enum: ['fixed'] },
            percentage: { type: 'number' },
          },
          additionalProperties: true,
        },
        frontend: { type: ['object', 'null'], description: 'Frontend request/response diagnostic settings.', additionalProperties: true },
        backend: { type: ['object', 'null'], description: 'Backend request/response diagnostic settings.', additionalProperties: true },
        largeLanguageModel: { type: ['object', 'null'], description: 'LLM diagnostic settings.', additionalProperties: true },
        tags: { type: ['object', 'null'], description: 'Diagnostic tags.', additionalProperties: true },
      },
      additionalProperties: true,
    },

    policyPropertiesObject: {
      type: 'object',
      description: 'Common policy properties with editor autocomplete. Additional policy properties are allowed.',
      properties: {
        format: {
          type: 'string',
          description: 'Policy content format.',
          enum: ['rawxml', 'rawxml-link', 'xml', 'xml-link'],
        },
        value: { type: 'string', description: 'Inline policy XML or linked value, depending on format.' },
      },
      additionalProperties: true,
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
