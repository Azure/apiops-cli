# apiops extract

Extract Azure API Management configuration to local artifact files.

```bash
apiops extract --resource-group <rg> --service-name <name> [options]
```

## Examples

### Extract all resources

```bash
apiops extract \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --resource-group my-rg \
  --service-name my-apim
```

### Extract to a custom directory

```bash
apiops extract \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --resource-group my-rg \
  --service-name my-apim \
  --output ./artifacts
```

### Extract with a filter

```bash
apiops extract \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --resource-group my-rg \
  --service-name my-apim \
  --filter ./configuration.extractor.yaml
```

### Extract without transitive dependencies

```bash
apiops extract \
  --resource-group my-rg \
  --service-name my-apim \
  --no-transitive
```

### Machine-readable JSON output

```bash
apiops extract \
  --resource-group my-rg \
  --service-name my-apim \
  --format json
```

## Flags

### Command flags

| Flag | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `--resource-group <rg>` | string | — | Yes | Azure resource group name |
| `--service-name <name>` | string | — | Yes | APIM service instance name |
| `--output <dir>` | string | `./apim-artifacts` | No | Output directory path |
| `--filter <path>` | string | — | No | Filter configuration YAML file |
| `--no-transitive` | boolean | false (transitive ON) | No | Disable transitive dependency inclusion |

### Global flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--subscription-id <id>` | string | env: `AZURE_SUBSCRIPTION_ID` | Azure subscription ID (required) |
| `--log-level <level>` | string | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `--format <type>` | string | `text` | Output format: `text` or `json` |
| `--cloud <name>` | string | `public` | Sovereign cloud: `public`, `china`, `usgov`, `germany` |
| `--client-id <id>` | string | — | Service principal client ID |
| `--client-secret <secret>` | string | — | Service principal client secret |
| `--tenant-id <id>` | string | — | Azure AD tenant ID |

## Authentication

`apiops extract` authenticates using `DefaultAzureCredential`, which tries credentials in this order:

1. Managed Identity
2. Workload Identity
3. Service Principal (via `--client-id`, `--client-secret`, `--tenant-id`)
4. Azure CLI (`az login`)

For local development, `az login` is the simplest option. For CI/CD pipelines, use federated credentials (OIDC) or a service principal. See the [authentication guide](../guides/authentication.md) for details.

## Filter configuration

By default, `apiops extract` exports **all** resources from the APIM instance (34 resource types including APIs, products, backends, named values, tags, policies, and more).

To extract only specific resources, pass a YAML filter file with `--filter`. Filter entries support exact names and wildcard patterns (`*` for any characters, `?` for a single character):

```yaml
# configuration.extractor.yaml
apis:
  - echo-api
  - petstore-api
  - 'prod-*'             # Wildcard: all APIs starting with prod-
products:
  - starter
backends:
  - backend-api
  - '*-internal'        # Wildcard: all backends ending with -internal
namedValues:
  - api-key
tags:
  - production
policyFragments:
  - rate-limit-fragment
loggers:
  - appinsights-logger
diagnostics:
  - applicationinsights
```

### Filterable resource types

All 17 supported filter keys:

| Filter key | Resource type |
|------------|---------------|
| `apis` | APIs (accepts nested object entries — see [API sub-filters](#api-sub-filters) below) |
| `backends` | Backends |
| `products` | Products |
| `namedValues` | Named values |
| `loggers` | Loggers |
| `diagnostics` | Diagnostics |
| `tags` | Tags |
| `policyFragments` | Policy fragments |
| `gateways` | Gateways |
| `versionSets` | API version sets |
| `groups` | Groups |
| `subscriptions` | Subscriptions |
| `schemas` | Schemas |
| `policies` | Service-level policy (singleton — use `- 'policy'` to include, `[]` to exclude) |
| `policyRestrictions` | Policy restrictions |
| `documentations` | Documentation resources |
| `workspaces` | Workspaces (accepts nested object entries — see [Workspace sub-filters](#workspace-sub-filters) below) |

For every key, the value semantics are:

- **Key omitted** → include all resources of that type (default)
- **`key: []`** → include none of that type
- **`key: [name1, name2]`** → include only the named resources (exact match, case-insensitive; supports `*` and `?` wildcards)

### API sub-filters

To restrict which child resources of an API are extracted (operations,
diagnostics, schemas, releases), use the **nested object entry** form under
`apis:`. Each entry becomes a `name: { subKey: [...] }` map:

```yaml
apis:
  - 'echo-api'                     # plain entry — all child resources included
  - 'petstore-api':                # nested entry — only listed children
      operations:
        - 'listPets'
        - 'getPet'
      diagnostics: []              # exclude all diagnostics for this API
      schemas:
        - 'pet-schema'
      releases: []
```

Supported API sub-filter keys: `operations`, `diagnostics`, `schemas`, `releases`.
Same value semantics as top-level keys (omitted = include all, `[]` = include none, list = allowlist).

### Workspace sub-filters

Workspaces accept the same nested object entry form. Each workspace can have
its own inner allowlists for the workspace-scoped resource types:

```yaml
workspaces:
  - 'team-a-workspace':
      apis:
        - 'team-a-orders'
      backends: []                 # exclude all workspace backends
      namedValues:
        - 'team-a-secret'
```

Supported workspace sub-filter keys: `apis`, `backends`, `diagnostics`,
`groups`, `loggers`, `namedValues`, `policyFragments`, `products`, `schemas`,
`subscriptions`, `tags`, `versionSets`.

### Transitive dependencies

When extracting with a filter, transitive dependencies are **included automatically**. For example, extracting `echo-api` also extracts any backends, named values, and policy fragments that `echo-api` references in its policies.

Use `--no-transitive` to disable this behavior and extract only the explicitly listed resources.

## Output format

Extracted artifacts are organized as JSON info files and XML policy files in a directory tree:

```
apim-artifacts/
├── apis/
│   └── echo-api/
│       ├── apiInformation.json
│       ├── policy.xml
│       └── operations/
│           └── get-resource/
│               ├── operationInformation.json
│               └── policy.xml
├── products/
│   └── starter/
│       ├── productInformation.json
│       └── policy.xml
├── backends/
│   └── backend-api/
│       └── backendInformation.json
├── namedValues/
│   └── api-key/
│       └── namedValueInformation.json
└── ...
```

When using `--format json`, structured output is written to stdout with resource counts and file paths. This is useful for scripting and CI/CD pipelines.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success — all resources extracted |
| `1` | Partial — some resources failed to extract |
| `2` | Fatal — extraction could not proceed |

## Related docs

- [apiops publish](./publish.md) — publish extracted artifacts to APIM
- [apiops init](./init.md) — scaffold a repository with CI/CD pipelines
- [Authentication guide](../guides/authentication.md)
- [Filtering resources](../guides/filtering.md)
- [Artifact format reference](../reference/artifact-format.md)
