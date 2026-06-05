# Quickstart: APIops CLI

**Estimated time**: 10 minutes  
**Prerequisites**: Node.js 22+, Azure CLI (`az login` completed), an Azure APIM instance

---

## Install

```bash
npm install -g @apiops/cli
```

## Extract APIM configuration

```bash
apiops extract \
  --resource-group my-rg \
  --service-name my-apim \
  --output ./apim-artifacts
```

This creates a local directory tree with all your APIM resources as JSON/XML files.

## Filter extraction to specific APIs

Create `filter.yaml`:

```yaml
apiNames:
  - pet-store-api
  - user-api
```

```bash
apiops extract \
  --resource-group my-rg \
  --service-name my-apim \
  --output ./apim-artifacts \
  --filter filter.yaml
```

Referenced backends, named values, and policy fragments are included automatically. Use `--no-transitive` to disable this.

## Publish to a target environment

Create `configuration.prod.yaml` for environment-specific values:

```yaml
namedValues:
  - name: backend-url
    properties:
      value: "https://api.prod.example.com"
backends:
  - name: my-backend
    properties:
      url: "https://api.prod.example.com"
```

```bash
apiops publish \
  --resource-group prod-rg \
  --service-name prod-apim \
  --source ./apim-artifacts \
  --overrides configuration.prod.yaml
```

## Preview changes before publishing

```bash
apiops publish \
  --resource-group prod-rg \
  --service-name prod-apim \
  --source ./apim-artifacts \
  --overrides overrides.prod.yaml \
  --dry-run
```

## Initialize a new repository

```bash
apiops init --ci github-actions
```

Generates CI/CD pipeline files, sample filter/override configs, and artifact directory structure.

## CI/CD incremental publish

In your pipeline, set `COMMIT_ID` to publish only changed resources:

```yaml
# GitHub Actions example
- run: |
    apiops publish \
      --resource-group ${{ vars.APIM_RG }} \
      --service-name ${{ vars.APIM_NAME }} \
      --overrides overrides.${{ vars.ENV }}.yaml
  env:
    COMMIT_ID: ${{ github.sha }}
```
