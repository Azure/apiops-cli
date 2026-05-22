# apiops publish

Publish local APIM artifacts to an Azure API Management instance.

```bash
apiops publish --resource-group <rg> --service-name <name> [options]
```

## Examples

### Publish all artifacts

```bash
apiops publish \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --resource-group my-rg \
  --service-name my-apim
```

### Publish with environment overrides

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim \
  --overrides ./configuration.prod.yaml
```

### Dry run — preview changes without applying

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim \
  --dry-run
```

### Incremental publish (deploy only changed resources)

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim \
  --commit-id abc123def456
```

### Delete resources not in source

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim \
  --delete-unmatched
```

### Machine-readable JSON output

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim \
  --dry-run \
  --format json
```

## Flags

### Command flags

| Flag | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `--resource-group <rg>` | string | — | Yes | Azure resource group name |
| `--service-name <name>` | string | — | Yes | APIM service instance name |
| `--source <dir>` | string | `./apim-artifacts` | No | Source directory containing artifacts |
| `--overrides <path>` | string | — | No | Override configuration YAML file |
| `--commit-id <sha>` | string | env: `COMMIT_ID` | No | Git commit SHA for incremental publish |
| `--dry-run` | boolean | `false` | No | Preview changes without applying |
| `--delete-unmatched` | boolean | `false` | No | Delete APIM resources not present in source |

> **Note:** `--commit-id` and `--delete-unmatched` are **mutually exclusive**. The CLI will error if both are specified.

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

`apiops publish` authenticates using `DefaultAzureCredential`, which tries credentials in this order:

1. Managed Identity
2. Workload Identity
3. Service Principal (via `--client-id`, `--client-secret`, `--tenant-id`)
4. Azure CLI (`az login`)

See the [authentication guide](../guides/authentication.md) for details.

## Override configuration

Overrides let you replace environment-specific values (URLs, secrets, connection strings) at publish time without modifying the artifact files. This is the key mechanism for promoting artifacts across dev → staging → production.

Pass an override YAML file with `--overrides`:

```yaml
# configuration.prod.yaml
namedValues:
  api-key:
    value: "prod-api-key-value"
  secret-from-keyvault:
    keyVault:
      secretIdentifier: "https://prod-kv.vault.azure.net/secrets/my-secret"
      identityClientId: "00000000-0000-0000-0000-000000000000"

backends:
  backend-api:
    url: "https://prod-api.example.com"

apis:
  echo-api:
    serviceUrl: "https://prod-echo.example.com"

diagnostics:
  applicationinsights:
    loggerId: "appinsights-logger-prod"

loggers:
  appinsights-logger:
    resourceId: "/subscriptions/xxx/resourceGroups/prod-rg/providers/microsoft.insights/components/prod-appinsights"
```

### Overridable resource types

| Resource type | Overridable properties |
|---------------|----------------------|
| `namedValues` | `value`, `keyVault.secretIdentifier`, `keyVault.identityClientId` |
| `backends` | `url` |
| `apis` | `serviceUrl` |
| `diagnostics` | `loggerId` |
| `loggers` | `resourceId` |

Resource **names** must match across environments — only **properties** are overridden.

## Dependency ordering

Resources are published in dependency order using topological sorting. For example, backends and named values are created before the APIs that reference them. This ensures references are valid at every step.

## Incremental publish

When `--commit-id` is provided, `apiops publish` uses `git diff` to identify which artifact files changed since that commit. Only the affected resources are published, which speeds up deployments significantly.

In CI/CD pipelines, this is typically set automatically:

```yaml
# GitHub Actions example
- run: npx apiops publish --commit-id ${{ github.event.before }}
```

When both are provided, `--commit-id` takes precedence over `COMMIT_ID`.

> **Tip:** Incremental publish cannot be combined with `--delete-unmatched` because delete-unmatched requires a full comparison between source and APIM.

## Dry run

Use `--dry-run` to preview what would happen without making any changes to Azure:

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim \
  --dry-run
```

The output lists each resource and the planned action (create, update, or delete). With `--format json`, the dry-run report is machine-readable — useful for approval gates in CI/CD pipelines.

## Delete unmatched

When `--delete-unmatched` is set, resources that exist in the APIM instance but are **not** present in the source artifacts are deleted. This enforces the source directory as the single source of truth.

> **Warning:** Use with caution. Resources created manually in the Azure portal that are not in your artifact directory will be removed.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success — all resources published |
| `1` | Partial — some resources failed to publish |
| `2` | Fatal — publish could not proceed |

## Related docs

- [apiops extract](./extract.md) — extract APIM configuration to local files
- [apiops init](./init.md) — scaffold a repository with CI/CD pipelines
- [Authentication guide](../guides/authentication.md)
- [Environment overrides guide](../guides/environment-overrides.md)
- [GitHub Actions integration](../ci-cd/github-actions.md)
- [Azure DevOps integration](../ci-cd/azure-devops.md)
