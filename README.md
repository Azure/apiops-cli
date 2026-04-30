# apiops

`apiops` is a CLI tool for Azure API Management (APIM) configuration-as-code. Extract your APIM service configuration to local artifact files, publish those artifacts back to Azure, and scaffold CI/CD pipelines — all from the command line.

| | |
|---|---|
| **Source code** | [github.com/Azure/apiops-cli](https://github.com/Azure/apiops-cli) |
| **Issues** | [GitHub Issues](https://github.com/Azure/apiops-cli/issues) |

## Getting started

**Prerequisites:** An Azure subscription with an existing APIM resource, and Node.js ≥ 22.

```bash
npm install -g @peterhauge/apiops-cli
```

## Authentication

`apiops` uses [`@azure/identity`](https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/identity/identity) `DefaultAzureCredential` for authentication:

- To use environment variables, set the following variables: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`
- To specify authentication in command, use the following flags: `--client-id`, `--client-secret`, `--tenant-id`, and `--subscription-id`
- **CI/CD:** A service principal with the **API Management Service Contributor** role is recommended.
- **Azure-hosted environments:** Managed Identity and Workload Identity are also supported.

## Commands

### `apiops extract`

Extract APIM service configuration to local artifact files.

| Flag | Default | Description |
|------|---------|-------------|
| `--resource-group <rg>` | *(required)* | Azure resource group |
| `--service-name <name>` | *(required)* | APIM service name |
| `--output <dir>` | `./apim-artifacts` | Output directory |
| `--filter <path>` | | Extract only matching resources |
| `--no-transitive` | | Skip transitive dependencies |
| `--spec-format <format>` | | Override API spec format |

```bash
apiops extract --help

# Basic extraction to the default output directory
apiops extract \
  --resource-group <rg> \
  --service-name <name> \
  --output ./apim-artifacts

# Extract a filtered subset of resources and override the API spec format
apiops extract \
  --resource-group <rg> \
  --service-name <name> \
  --filter ./filter.yaml \
  --spec-format openapi-v3-yaml

# Authenticate explicitly with a service principal
apiops extract \
  --resource-group <rg> \
  --service-name <name> \
  --client-id $AZURE_CLIENT_ID \
  --client-secret $AZURE_CLIENT_SECRET \
  --tenant-id $AZURE_TENANT_ID \
  --subscription-id $AZURE_SUBSCRIPTION_ID
```

### `apiops publish`

Publish local artifact files to an Azure APIM service.

| Flag | Default | Description |
|------|---------|-------------|
| `--resource-group <rg>` | *(required)* | Azure resource group |
| `--service-name <name>` | *(required)* | APIM service name |
| `--source <dir>` | `./apim-artifacts` | Source artifacts directory |
| `--overrides <path>` | | Path to overrides file |
| `--dry-run` | | Preview changes without applying |
| `--delete-unmatched` | | Delete resources not in artifacts |

```bash
apiops publish --help

# Preview changes without applying them
apiops publish \
  --resource-group <rg> \
  --service-name <name> \
  --dry-run

# Publish and remove resources not present in the local artifacts
apiops publish \
  --resource-group <rg> \
  --service-name <name> \
  --delete-unmatched
```

### `apiops init`

Scaffold a new APIM artifacts repository with CI/CD pipelines.

| Flag | Description |
|------|-------------|
| `--cli-package <path>` | Path to a local `.tgz` tarball |
| `--ci <platform>` | `github-actions` or `azure-devops` |
| `--environments <list>` | Comma-separated environments (e.g. `dev,prod`) |
| `--non-interactive` | Skip all prompts |
| `--force` | Overwrite existing files |

```bash
apiops init --help

apiops init \
  --ci github-actions \
  --environments dev,prod
```

## Global options

| Option | Default | Description |
|--------|---------|-------------|
| `--subscription-id <id>` | `AZURE_SUBSCRIPTION_ID` env var | Azure subscription ID |
| `--cloud <name>` | `public` | `public`, `china`, `usgov`, `germany` |
| `--log-level <level>` | `info` | `debug`, `info`, `warn`, `error` |
| `--format <type>` | `text` | `text` or `json` |
| `--client-id <id>` | `AZURE_CLIENT_ID` env var | Service principal client ID |
| `--client-secret <secret>` | `AZURE_CLIENT_SECRET` env var | Service principal secret |
| `--tenant-id <id>` | `AZURE_TENANT_ID` env var | Azure AD tenant ID |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to build, test, debug, and submit changes.

## License

[MIT](./LICENSE)
