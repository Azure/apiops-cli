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
  --filter ./configuration.extract.yaml
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
| `--spec-format <format>` | string | — | No | API spec format: `openapi-v2-json`, `openapi-v3-json`, `openapi-v3-yaml` |

### Global flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--subscription-id <id>` | string | env: `AZURE_SUBSCRIPTION_ID` | Azure subscription ID (required) |
| `--log-level <level>` | string | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `--format <type>` | string | `text` | Output format: `text` or `json` |
| `--api-version <version>` | string | `2024-05-01` (env: `AZURE_API_VERSION`) | APIM REST API version override |
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

To extract only specific resources, pass a YAML filter file with `--filter`:

```yaml
# configuration.extract.yaml
apiNames:
  - echo-api
  - petstore-api
productNames:
  - starter
backendNames:
  - backend-api
namedValueNames:
  - api-key
tagNames:
  - production
policyFragmentNames:
  - rate-limit-fragment
loggerNames:
  - appinsights-logger
diagnosticNames:
  - applicationinsights
```

### Filterable resource types

All 16 supported filter keys:

| Filter key | Resource type |
|------------|---------------|
| `apiNames` | APIs |
| `backendNames` | Backends |
| `productNames` | Products |
| `namedValueNames` | Named values |
| `loggerNames` | Loggers |
| `diagnosticNames` | Diagnostics |
| `tagNames` | Tags |
| `policyFragmentNames` | Policy fragments |
| `gatewayNames` | Gateways |
| `versionSetNames` | API version sets |
| `groupNames` | Groups |
| `subscriptionNames` | Subscriptions |
| `schemaNames` | Schemas |
| `policyRestrictionNames` | Policy restrictions |
| `documentationNames` | Documentation resources |
| `workspaceNames` | Workspaces |

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
