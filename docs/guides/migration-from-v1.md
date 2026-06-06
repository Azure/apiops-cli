# Migration from v1 Toolkit

Migrate from the [Azure/apiops](https://github.com/Azure/apiops) toolkit (v1) to apiops-cli (v2) — same concepts, simpler tooling, more features.

## Why Migrate?

The v1 toolkit uses separate Extractor and Publisher binaries orchestrated by pipeline templates. It works, but:

- Requires Docker or the .NET SDK to run
- Uses two separate configuration files and complex pipeline YAML
- Supports ~20 resource types
- Has no built-in dry-run, incremental publish, or scaffolding command

apiops-cli (v2) is a single Node.js CLI that covers the full workflow with less setup.

---

## Key Differences

| Feature | v1 (Azure/apiops) | v2 (apiops-cli) |
|---------|-------------------|-----------------|
| **Runtime** | .NET SDK or Docker | Node.js 22+ |
| **CLI** | Separate Extractor/Publisher binaries | Single `apiops` CLI |
| **Install** | Docker pull or .NET tool install | `npm install -g @peterhauge/apiops-cli` |
| **Configuration** | `configuration.extractor.yaml` + `configuration.publisher.yaml` | Single filter YAML + override YAML |
| **Authentication** | Azure service connections / env vars | `DefaultAzureCredential` (Azure CLI, OIDC, service principal, managed identity) |
| **Scaffolding** | Manual pipeline setup | `apiops init` generates pipelines, config, directory structure |
| **Dry-run** | ❌ Not available | ✅ `--dry-run` previews changes |
| **Incremental publish** | ❌ Not available | ✅ `--commit-id` publishes only changed resources |
| **Machine output** | ❌ Text only | ✅ `--format json` for CI/CD integration |
| **Filtering** | Name lists | Name lists with transitive dependency resolution |
| **Sovereign clouds** | Limited | ✅ `--cloud china\|usgov\|germany` |
| **Resource types** | ~20 | 34 (see below) |
| **Pipeline targets** | GitHub Actions, Azure DevOps | GitHub Actions, Azure DevOps |

### Additional resource types in v2

v2 supports all v1 resource types plus: `GlobalSchema`, `PolicyRestriction`, `Documentation`, `ApiSchema`, `ApiRelease`, `ApiTagDescription`, `ApiWiki`, `ProductWiki`, `GraphQLResolver`, `McpServer`, and more.

---

## Migration Steps

### 1. Install apiops-cli

```bash
npm install -g @peterhauge/apiops-cli
```

Verify:

```bash
apiops --version
```

### 2. Scaffold new pipeline templates

Run `apiops init` in your repository root to generate updated CI/CD pipeline files:

```bash
apiops init
```

This creates:
- GitHub Actions workflows and/or Azure DevOps pipelines
- A starter directory structure for artifacts
- Example filter and override files

> `apiops init` detects existing files and prompts before overwriting.

### 3. Verify artifact compatibility

**Your existing extracted artifacts should work as-is with v2.** The artifact format is backward compatible — v2 reads the same `apiInformation.json`, `backendInformation.json`, `policy.xml`, and other files that v1 produces.

Test by running a dry-run against your existing artifacts:

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim \
  --source ./apim-artifacts \
  --dry-run
```

If the dry-run shows the expected resources, your artifacts are compatible.

### 4. Update pipeline YAML

Replace the v1 pipeline tasks/actions with v2 CLI commands.

#### GitHub Actions

**v1 (before):**

```yaml
- name: Run Publisher
  uses: docker://ghcr.io/azure/apiops/publisher:latest
  env:
    AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
    AZURE_RESOURCE_GROUP_NAME: ${{ secrets.APIM_RESOURCE_GROUP }}
    API_MANAGEMENT_SERVICE_NAME: ${{ secrets.APIM_SERVICE_NAME }}
    CONFIGURATION_YAML_PATH: configuration.publisher.yaml
```

**v2 (after):**

```yaml
- name: Publish APIs
  run: |
    npx apiops publish \
      --subscription-id ${{ secrets.AZURE_SUBSCRIPTION_ID }} \
      --resource-group ${{ secrets.APIM_RESOURCE_GROUP }} \
      --service-name ${{ secrets.APIM_SERVICE_NAME }} \
      --source ./apim-artifacts
```

#### Azure DevOps

**v1 (before):**

```yaml
- task: AzureCLI@2
  inputs:
    inlineScript: |
      dotnet run --project $(Build.SourcesDirectory)/tools/publisher -- \
        --configuration-yaml-path configuration.publisher.yaml
```

**v2 (after):**

```yaml
- task: AzureCLI@2
  inputs:
    azureSubscription: $(SERVICE_CONNECTION)
    scriptType: bash
    inlineScript: |
      npx apiops publish \
        --subscription-id $(AZURE_SUBSCRIPTION_ID) \
        --resource-group $(APIM_RESOURCE_GROUP) \
        --service-name $(APIM_SERVICE_NAME) \
        --source ./apim-artifacts
```

### 5. Update configuration files

#### Extractor configuration

**v1** (`configuration.extractor.yaml`):

```yaml
apiNames:
  - payments-api
  - orders-api
```

**v2** (filter YAML — same format, different file name convention):

```yaml
apiNames:
  - payments-api
  - orders-api
```

The filter YAML format is compatible. Rename the file if you prefer the v2 convention, and pass it with `--filter`:

```bash
apiops extract \
  --resource-group my-rg \
  --service-name my-apim \
  --filter ./filter.yaml
```

#### Publisher configuration

v1's `configuration.publisher.yaml` maps directly to v2's override files. The structure is the same:

**v1:**

```yaml
namedValues:
  - name: my-secret
    properties:
      value: "prod-value"
```

**v2** (`overrides.prod.yaml` — same structure):

```yaml
namedValues:
  - name: my-secret
    properties:
      value: "prod-value"
```

Pass overrides with `--overrides`:

```bash
apiops publish \
  --source ./apim-artifacts \
  --overrides overrides.prod.yaml \
  ...
```

### 6. Test with dry-run

Before your first real publish with v2, always preview:

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim \
  --source ./apim-artifacts \
  --overrides overrides.prod.yaml \
  --dry-run
```

Review the output to confirm the correct resources would be created, updated, or deleted.

---

## New Features to Adopt

After migration, take advantage of v2-only capabilities:

### Incremental publish

Deploy only what changed in a commit — faster and safer in CI/CD:

```bash
apiops publish --commit-id ${{ github.sha }} ...
```

See [Incremental Publish](./incremental-publish.md).

### Dry-run in PR workflows

Preview deployment impact before merge:

```bash
apiops publish --dry-run ...
```

See [Dry-Run Workflow](./dry-run-workflow.md).

### JSON output for automation

Parse publish results programmatically:

```bash
apiops publish --format json ... | jq '.summary'
```

### Transitive dependency filtering

v2 automatically includes resources that your filtered APIs depend on (backends, named values, policy fragments). No need to manually list every dependency.

```bash
apiops extract --filter filter.yaml  # includes deps by default
apiops extract --filter filter.yaml --no-transitive  # opt out
```

### Sovereign cloud support

Publish to Azure China, US Government, or Germany clouds:

```bash
apiops publish --cloud china ...
apiops extract --cloud usgov ...
```

---

## Troubleshooting Migration Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `apiops: command not found` | CLI not installed globally | Run `npm install -g @peterhauge/apiops-cli` |
| Artifacts not recognized | Unexpected directory structure | Verify your artifacts follow the standard layout (`apis/{name}/apiInformation.json`, etc.) |
| Authentication fails in pipeline | v1 used service connection env vars; v2 uses `DefaultAzureCredential` | See [Authentication Guide](./authentication.md). For GitHub Actions, use `azure/login` with OIDC. For Azure DevOps, use `AzureCLI@2` task. |
| Override values not applied | Wrong override file format or path | Check YAML structure matches v2 format. Pass with `--overrides <path>`. |
| Extra resources published | v2 supports more resource types than v1 | This is expected. v2 extracts additional resource types (e.g., `GlobalSchema`, `ApiWiki`). Review with `--dry-run`. |
| `--delete-unmatched` removes unexpected resources | v2 sees more resource types | Run `--dry-run --delete-unmatched` first. Consider using `--commit-id` for safer incremental deploys. |

---

## Related

- [Getting Started](../getting-started.md) — Install and first extraction
- [apiops init](../commands/init.md) — Scaffold pipelines and configuration
- [apiops extract](../commands/extract.md) — Full extraction reference
- [apiops publish](../commands/publish.md) — Full publish reference
- [Authentication](./authentication.md) — Credential configuration
- [Environment Overrides](./environment-overrides.md) — Override values per environment
