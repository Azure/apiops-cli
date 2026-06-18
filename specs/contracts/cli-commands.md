# Contract: CLI Commands

**Purpose**: Defines the external interface of the `apiops` CLI tool — the commands, flags, environment variables, exit codes, and output formats that users and CI/CD pipelines interact with.

---

## Global Options

These flags are available on **all** commands (`extract`, `publish`, `init`).

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--subscription-id <id>` | string | no | From `az` CLI context | Azure subscription ID |
| `--cloud <name>` | string | no | `AzureCloud` | Azure cloud environment (`AzureCloud`, `AzureChinaCloud`, `AzureUSGovernment`, `AzureGermanCloud`) |
| `--api-version <version>` | string | no | `2024-05-01` | APIM REST API version |
| `--format <mode>` | string | no | `text` | Output format: `text` (human-readable) or `json` (machine-readable) |
| `--verbose` | boolean | no | `false` | Enable debug-level output |
| `--otel <path>` | string | no | — | OpenTelemetry configuration YAML file |
| `--client-id <id>` | string | no | — | Service principal client ID (sets `AZURE_CLIENT_ID` for DefaultAzureCredential) |
| `--client-secret <secret>` | string | no | — | Service principal client secret (sets `AZURE_CLIENT_SECRET`) |
| `--tenant-id <id>` | string | no | — | Azure AD tenant ID (sets `AZURE_TENANT_ID`) |

---

## Commands

### `apiops extract`

Extract APIM configuration to local artifact files.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--resource-group <rg>` | string | yes | — | Azure resource group name |
| `--service-name <name>` | string | yes | — | APIM service instance name |
| `--output <dir>` | string | no | `./apim-artifacts` | Output directory path |
| `--filter <path>` | string | no | — | Filter configuration YAML file |
| `--no-transitive` | boolean | no | `false` | Disable transitive dependency inclusion |

**stdout**: Per-resource status lines (one per extracted resource)  
**stderr**: Structured log messages (JSON when `--verbose`)  
**Exit codes**: `0` success, `1` partial failure (some resources failed), `2` fatal error  

---

### `apiops publish`

Publish local artifact files to an APIM instance.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--resource-group <rg>` | string | yes | — | Azure resource group name |
| `--service-name <name>` | string | yes | — | APIM service instance name |
| `--source <dir>` | string | no | `./apim-artifacts` | Source artifact directory |
| `--overrides <path>` | string | no | — | Environment overrides YAML file |
| `--commit-id <sha>` | string | no | — | Git commit SHA for incremental publish (overrides `COMMIT_ID`) |
| `--dry-run` | boolean | no | `false` | Show planned changes without applying |
| `--delete-unmatched` | boolean | no | `false` | Delete APIM resources not in artifacts. Mutually exclusive with `--commit-id`. |

**Environment variables** (publish-specific):
| Variable | Description |
|----------|-------------|
| `COMMIT_ID` | Git commit SHA; enables incremental publish (only changed files) |

**stdout**: Per-resource action lines (`PUT {type}/{name}`, `DELETE {type}/{name}`, `SKIP {type}/{name}`)  
**stderr**: Structured log messages  
**Exit codes**: `0` success, `1` partial failure, `2` fatal error  

**Dry-run output format**:
```
[DRY RUN] PUT named values/my-secret
[DRY RUN] PUT apis/pet-store
[DRY RUN] DELETE apis/deprecated-api
Summary: 2 creates/updates, 1 deletes (not applied)
```

---

### `apiops init`

Initialize repository structure and CI/CD pipeline configuration.

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--ci <provider>` | string | no | — | CI/CD provider (`github-actions` or `azure-devops`) |
| `--artifact-dir <dir>` | string | no | `./apim-artifacts` | APIM artifact directory referenced in generated pipelines |
| `--environments <list>` | string | no | `dev,prod` | Comma-separated environment names for override templates and pipeline stages |
| `--non-interactive` | boolean | no | `false` | Skip interactive prompts |
| `--force` | boolean | no | `false` | Overwrite existing files without prompting |

**Interactive mode** (default): Prompts for CI provider, APIM instance details, directory preferences.  
**Non-interactive mode**: Requires `--ci` flag; uses defaults for all other options.

**File conflict detection**: Before generating any files, the command checks whether target file paths already exist. If conflicts are found and `--force` is not set, the command lists the conflicting files and exits with exit code `1`. If `--force` is set, it logs a warning and overwrites existing files.

**Generated files**:
- `.github/workflows/extract.yml` and `publish.yml` (for `github-actions`)
- `.azdo/pipelines/extract.yml` and `publish.yml` (for `azure-devops`)
- `apim-artifacts/` directory (empty, with `.gitkeep`)
- `configuration.extractor.yaml` (sample filter file)
- `configuration.{env}.yaml` (sample override files)

---

## Shared Environment Variables

| Variable | Description | Used By |
|----------|-------------|---------|
| `AZURE_SUBSCRIPTION_ID` | Azure subscription (fallback for `--subscription-id`) | extract, publish |
| `AZURE_API_VERSION` | Override APIM REST API version (default: `2024-05-01`) | extract, publish |
| `COMMIT_ID` | Git SHA for incremental publish | publish |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel exporter endpoint (used by OTel SDK) | extract, publish |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Azure Monitor connection string | extract, publish |

---

## Exit Code Contract

| Code | Meaning | When |
|------|---------|------|
| `0` | Success | All operations completed |
| `1` | Partial failure | Some resources failed but others succeeded |
| `2` | Fatal error | Cannot proceed (auth failure, invalid config, network unreachable) |
