# apiops apic

Back up and restore Azure API Center (`Microsoft.ApiCenter`) service configuration. The `apic` command group operates on Azure API Center; use [`apiops extract`](extract.md) and [`apiops publish`](publish.md) for Azure API Management services.

## Extract

Extract API Center resources and API definition specifications to local artifacts.

```bash
apiops apic extract --resource-group <rg> --service-name <name> [options]
```

### Examples

```bash
# Extract the complete service
apiops apic extract \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --resource-group my-rg \
  --service-name my-api-center

# Extract one workspace without downloading specifications
apiops apic extract \
  --resource-group my-rg \
  --service-name my-api-center \
  --workspace engineering \
  --output ./backups/api-center \
  --no-specifications
```

### Flags

| Flag | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `--resource-group <rg>` | string | — | Yes | Azure resource group name |
| `--service-name <name>` | string | — | Yes | API Center service instance name |
| `--workspace <name>` | string | — | No | Restrict extraction to one workspace |
| `--output <dir>` | string | `./apic-artifacts` | No | Output directory path |
| `--no-specifications` | boolean | false | No | Skip exporting API definition specifications |

## Publish

Publish local API Center artifacts and API definition specifications to a service.

```bash
apiops apic publish --resource-group <rg> --service-name <name> [options]
```

### Examples

```bash
# Preview the restore
apiops apic publish \
  --resource-group my-rg \
  --service-name my-api-center \
  --source ./backups/api-center \
  --dry-run

# Publish resources without importing specifications
apiops apic publish \
  --resource-group my-rg \
  --service-name my-api-center \
  --no-specifications
```

### Flags

| Flag | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `--resource-group <rg>` | string | — | Yes | Azure resource group name |
| `--service-name <name>` | string | — | Yes | API Center service instance name |
| `--source <dir>` | string | `./apic-artifacts` | No | Source directory containing artifacts |
| `--dry-run` | boolean | false | No | Preview changes without applying them |
| `--no-specifications` | boolean | false | No | Skip importing API definition specifications |

## Global Flags

Both subcommands inherit the CLI's global flags, including `--subscription-id`, `--cloud`, `--log-level`, `--format`, and service-principal authentication options. The subscription can also be supplied through `AZURE_SUBSCRIPTION_ID`.

Authentication uses the same `DefaultAzureCredential` chain as the APIM commands. See the [authentication guide](../guides/authentication.md) for supported local and CI/CD authentication methods.

Use `--format json` for machine-readable results. Exit codes follow the shared [CLI exit-code contract](../reference/exit-codes.md).