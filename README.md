# apiops

`apiops` is a CLI tool for Azure API Management (APIM) configuration-as-code. Extract your APIM service configuration to local artifact files, publish those artifacts back to Azure, and scaffold CI/CD pipelines — all from the command line.

| | |
|---|---|
| **Source code** | [github.com/Azure/apiops-cli](https://github.com/Azure/apiops-cli) |
| **Issues** | [GitHub Issues](https://github.com/Azure/apiops-cli/issues) |
| **Architecture** | [docs/architecture.md](./docs/architecture.md) |

## Getting started

**Prerequisites:** An Azure subscription with an existing APIM resource, and Node.js ≥ 22.

```bash
npm install -g @peterhauge/apiops-cli
```

## Authentication

`apiops` uses [`@azure/identity`](https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/identity/identity) `DefaultAzureCredential` for authentication.

### Generated GitHub Actions workflows (`apiops init`)

Workflows scaffolded by `apiops init` authenticate via **OIDC (workload identity federation)** — no client secret is stored or needed. Run `apiops init` and use the generated `identity-setup.prompt.md` to create an Azure AD application with federated credentials for your GitHub repository.

Required repository secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`

### Local CLI / other CI systems

When running `apiops` outside a GitHub Actions OIDC context you can supply credentials explicitly:

- **Environment variables:** `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- **CLI flags:** `--client-id`, `--client-secret`, `--tenant-id`, `--subscription-id`
- **Managed Identity / Workload Identity:** Supported automatically via `DefaultAzureCredential` when running on Azure-hosted infrastructure (VMs, App Service, etc.) or in Azure Pipelines with workload identity federation configured.

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

```bash
apiops extract --help

# Basic extraction to the default output directory
apiops extract \
  --resource-group <rg> \
  --service-name <name> \
  --output ./apim-artifacts

# Extract a filtered subset of resources
apiops extract \
  --resource-group <rg> \
  --service-name <name> \
  --filter ./filter.yaml

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
| `--commit-id <sha>` | | Git commit SHA for incremental publish |
| `--dry-run` | | Preview changes without applying |
| `--delete-unmatched` | | Delete resources not in artifacts (mutually exclusive with `--commit-id`) |

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

# Incremental publish for a specific commit
apiops publish \
  --resource-group <rg> \
  --service-name <name> \
  --commit-id <sha>
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

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release notes and the list of changes in each version. To see what has changed
since the version you have installed, compare tags on GitHub
(e.g. [`v0.2.1-alpha.0...main`](https://github.com/Azure/apiops-cli/compare/v0.2.1-alpha.0...main)).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to build, test, debug, and submit changes.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact
[opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Security

Please do not report security vulnerabilities through public GitHub issues. Instead, please follow the instructions in
our [SECURITY.md](./SECURITY.md).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

## License

[MIT](./LICENSE.md)
