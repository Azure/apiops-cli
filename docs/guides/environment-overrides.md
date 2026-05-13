# Environment Overrides Guide

When promoting API configuration across environments (dev → staging → prod), the API structure stays the same but environment-specific values change — backend URLs, secrets, credentials, and logger endpoints. **Override files** let you deploy the same extracted artifacts to multiple environments with different property values.

## Why Overrides Exist

Consider an API with a backend:

- **Dev:** `https://api-dev.contoso.com`
- **Staging:** `https://api-staging.contoso.com`
- **Prod:** `https://api.contoso.com`

You extract from dev, and the backend URL is baked into the artifact JSON. Without overrides, publishing to prod would point it at the dev backend. Override files solve this by replacing environment-specific values at publish time.

---

## Override File Format

Override files are YAML. Pass one to `apiops publish` with the `--overrides` flag:

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim-prod \
  --subscription-id <sub-id> \
  --source ./apim-artifacts \
  --overrides overrides.prod.yaml
```

### Basic Structure

```yaml
# overrides.prod.yaml
namedValues:
  <named-value-name>:
    value: "override-value"

backends:
  <backend-name>:
    url: "https://prod-backend.contoso.com"

apis:
  <api-name>:
    serviceUrl: "https://prod-api.contoso.com"

diagnostics:
  <diagnostic-name>:
    loggerId: "/subscriptions/.../providers/.../loggers/prod-logger"

loggers:
  <logger-name>:
    resourceId: "/subscriptions/.../providers/.../components/prod-appinsights"
    credentials:
      instrumentationKey: "prod-key"
```

> **Key rule:** The resource **names** (keys in the YAML) must match the names in your extracted artifacts exactly. Names must be consistent across all environments — you override **properties**, not names.

---

## Override Capabilities by Resource Type

### Named Values

Named values are the most commonly overridden resource. They store secrets, connection strings, and configuration values.

```yaml
namedValues:
  # Simple value override
  api-base-url:
    value: "https://api.contoso.com"

  # Override display name and tags
  api-key:
    value: "prod-key-value"
    displayName: "Production API Key"
    tags:
      - production
      - sensitive

  # Key Vault reference (recommended for secrets)
  database-connection-string:
    keyVault:
      secretIdentifier: "https://prod-keyvault.vault.azure.net/secrets/db-conn-string"
      identityClientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
```

| Property | Type | Description |
|----------|------|-------------|
| `value` | `string` | Plain-text value |
| `displayName` | `string` | Display name in the portal |
| `tags` | `string[]` | Resource tags |
| `keyVault.secretIdentifier` | `string` | Key Vault secret URI |
| `keyVault.identityClientId` | `string` | Managed identity client ID for Key Vault access |

### Backends

```yaml
backends:
  petstore-backend:
    url: "https://petstore-prod.contoso.com"
    credentials:
      header:
        x-api-key:
          - "prod-backend-key"
```

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | Backend service URL |
| `credentials` | `object` | Authentication credentials (headers, query params, certificates) |

### APIs

```yaml
apis:
  petstore-api:
    serviceUrl: "https://petstore-prod.contoso.com/v1"
```

| Property | Type | Description |
|----------|------|-------------|
| `serviceUrl` | `string` | Backend service URL for the API |

### Diagnostics

```yaml
diagnostics:
  applicationinsights:
    loggerId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<apim>/loggers/prod-appinsights"
```

| Property | Type | Description |
|----------|------|-------------|
| `loggerId` | `string` | Full resource ID of the target logger |

### Loggers

```yaml
loggers:
  appinsights-logger:
    resourceId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/microsoft.insights/components/prod-appinsights"
    credentials:
      instrumentationKey: "prod-instrumentation-key"
```

| Property | Type | Description |
|----------|------|-------------|
| `resourceId` | `string` | Azure resource ID of the logging target (e.g., Application Insights) |
| `credentials` | `object` | Credentials for the logging service |

---

## Multi-Environment Setup

A typical project uses one override file per environment:

```
project/
├── apim-artifacts/           # Extracted from dev APIM
│   ├── apis/
│   │   └── petstore/
│   │       ├── apiInformation.json
│   │       └── policy.xml
│   ├── backends/
│   │   └── petstore-backend.json
│   └── namedValues/
│       ├── api-base-url.json
│       └── db-connection-string.json
├── overrides.dev.yaml        # Dev-specific overrides
├── overrides.staging.yaml    # Staging overrides
└── overrides.prod.yaml       # Production overrides
```

### Example: Three-Environment Setup

**overrides.dev.yaml**
```yaml
namedValues:
  api-base-url:
    value: "https://api-dev.contoso.com"
  db-connection-string:
    keyVault:
      secretIdentifier: "https://dev-kv.vault.azure.net/secrets/db-conn"

backends:
  petstore-backend:
    url: "https://petstore-dev.contoso.com"
```

**overrides.staging.yaml**
```yaml
namedValues:
  api-base-url:
    value: "https://api-staging.contoso.com"
  db-connection-string:
    keyVault:
      secretIdentifier: "https://staging-kv.vault.azure.net/secrets/db-conn"

backends:
  petstore-backend:
    url: "https://petstore-staging.contoso.com"
```

**overrides.prod.yaml**
```yaml
namedValues:
  api-base-url:
    value: "https://api.contoso.com"
  db-connection-string:
    keyVault:
      secretIdentifier: "https://prod-kv.vault.azure.net/secrets/db-conn"
      identityClientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

backends:
  petstore-backend:
    url: "https://petstore.contoso.com"
```

### CI/CD Integration

In your CI/CD pipeline, pass the right override file per environment:

```bash
# Dev deployment
apiops publish --overrides overrides.dev.yaml \
  --resource-group rg-dev --service-name apim-dev ...

# Prod deployment
apiops publish --overrides overrides.prod.yaml \
  --resource-group rg-prod --service-name apim-prod ...
```

See [GitHub Actions Integration](../ci-cd/github-actions.md) for full pipeline examples.

---

## Key Vault Integration

For secrets, use Key Vault references instead of plain-text values. This keeps secrets out of your YAML files and git history.

```yaml
namedValues:
  my-secret:
    keyVault:
      secretIdentifier: "https://my-keyvault.vault.azure.net/secrets/my-secret"
      identityClientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
```

**Requirements:**
- A Key Vault in each target environment with the referenced secret.
- A managed identity with `Key Vault Secrets User` role on the vault.
- The `identityClientId` must reference a managed identity accessible to the APIM instance.

> **Tip:** Use the same secret **name** across all Key Vaults (e.g., `db-conn`). Only the vault URL changes per environment.

---

## Override Rules

### Names Must Be Consistent

Resource **names** must be the same across all environments. You cannot rename a backend or named value per environment.

```yaml
# ✅ Correct — same backend name, different URL
backends:
  petstore-backend:
    url: "https://petstore-prod.contoso.com"

# ❌ Wrong — you can't rename the backend per environment
backends:
  petstore-backend-prod:    # This name doesn't exist in artifacts
    url: "https://petstore-prod.contoso.com"
```

### Properties Can Differ

Environment-specific **properties** (URLs, secrets, credentials, resource IDs) are exactly what overrides are for:

- Backend URLs → different per environment
- Named value secrets → different Key Vault references per environment
- Logger resource IDs → different Application Insights instances per environment
- API service URLs → different backend endpoints per environment

### Override Files Are Optional

If you're publishing to the same environment you extracted from (e.g., dev → dev), you don't need an override file. Overrides are only needed when the target environment differs from the source.

---

## Common Patterns and Gotchas

### Pattern: Shared Base with Environment Differences

Extract from dev (your baseline environment), then override only what differs in staging and prod. Most APIM configuration (policies, operations, products) stays the same — only URLs and credentials change.

### Gotcha: Missing Override Keys

If you add a new backend in dev but forget to add it to `overrides.prod.yaml`, publish will use the dev URL in production. **Always update all override files when adding new environment-sensitive resources.**

### Gotcha: Key Vault Permissions

When using Key Vault references, the APIM managed identity needs access to the Key Vault. A common failure mode: overrides reference a Key Vault but APIM lacks the `Key Vault Secrets User` role on that vault.

### Pattern: Dry Run to Verify Overrides

Use `--dry-run` to preview what publish would do with your overrides before actually deploying:

```bash
apiops publish --overrides overrides.prod.yaml --dry-run \
  --resource-group rg-prod --service-name apim-prod \
  --subscription-id <sub-id> --source ./apim-artifacts
```

## Related

- [`apiops publish` Command Reference](../commands/publish.md)
- [Authentication Guide](authentication.md) — configure credentials for your pipeline
- [Scenarios and Workflows](scenarios-and-workflows.md)
- [GitHub Actions Integration](../ci-cd/github-actions.md)
