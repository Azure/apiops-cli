# Environment Overrides Guide

When promoting API configuration across environments (dev → staging → prod), the API structure stays the same but environment-specific values change — backend URLs, secrets, credentials, and logger endpoints. Override files let you deploy the same extracted artifacts to multiple environments with different property values.

## Why overrides exist

Consider an API backend URL across environments:

- **Dev:** `https://api-dev.contoso.com`
- **Staging:** `https://api-staging.contoso.com`
- **Prod:** `https://api.contoso.com`

If you extract from dev and publish to prod without overrides, dev values can be published to prod. Overrides replace environment-specific values at publish time.

## Use with publish

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim-prod \
  --subscription-id <sub-id> \
  --source ./apim-artifacts \
  --overrides ./configuration.prod.yaml
```

## Override file format (APIOps Toolkit-compatible)

`apiops-cli` uses the [APIOps Toolkit](https://github.com/Azure/apiops) override layout:

- Top-level resource sections: `namedValues`, `backends`, `apis`, `diagnostics`, `loggers`
  > **Note:** Gateway and subscription overrides are not currently supported.
- Each section is a list
- Each list item contains `name` and `properties`

```yaml
# configuration.prod.yaml
namedValues:
  - name: api-base-url
    properties:
      value: "https://api.contoso.com"
  - name: db-connection-string
    properties:
      keyVault:
        secretIdentifier: "https://prod-kv.vault.azure.net/secrets/db-conn"
        identityClientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

backends:
  - name: petstore-backend
    properties:
      url: "https://petstore.contoso.com"

apis:
  - name: petstore-api
    properties:
      serviceUrl: "https://petstore.contoso.com/v1"

diagnostics:
  - name: applicationinsights
    properties:
      loggerId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<apim>/loggers/prod-appinsights"

loggers:
  - name: appinsights-logger
    properties:
      resourceId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/microsoft.insights/components/prod-appinsights"
      credentials:
        instrumentationKey: "prod-key"
```

## Override capabilities by resource type

### Named values

```yaml
namedValues:
  - name: api-base-url
    properties:
      value: "https://api.contoso.com"
  - name: database-connection-string
    properties:
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
  - name: petstore-backend
    properties:
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
  - name: petstore-api
    properties:
      serviceUrl: "https://petstore-prod.contoso.com/v1"
```

| Property | Type | Description |
|----------|------|-------------|
| `serviceUrl` | `string` | Backend service URL for the API |

### Diagnostics

```yaml
diagnostics:
  - name: applicationinsights
    properties:
      loggerId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<apim>/loggers/prod-appinsights"
```

| Property | Type | Description |
|----------|------|-------------|
| `loggerId` | `string` | Full resource ID of the target logger |

### Loggers

```yaml
loggers:
  - name: appinsights-logger
    properties:
      resourceId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/microsoft.insights/components/prod-appinsights"
      credentials:
        instrumentationKey: "prod-instrumentation-key"
```

| Property | Type | Description |
|----------|------|-------------|
| `resourceId` | `string` | Azure resource ID of the logging target (for example, Application Insights) |
| `credentials` | `object` | Credentials for the logging service |

## Override rules

- `name` should correspond to the resource name in extracted artifacts.
- Name matching is case-insensitive during override apply.
- Unmatched names are ignored (they do not fail publish).
- Overrides change resource properties, not resource names.
- Override files are optional when publishing back to the same environment.

## Multi-environment setup

Use one override file per environment:

```text
project/
├── apim-artifacts/
├── configuration.dev.yaml
├── configuration.staging.yaml
└── configuration.prod.yaml
```

### Example differences between environments

```yaml
# configuration.dev.yaml
namedValues:
  - name: api-base-url
    properties:
      value: "https://api-dev.contoso.com"
backends:
  - name: petstore-backend
    properties:
      url: "https://petstore-dev.contoso.com"

# configuration.staging.yaml
namedValues:
  - name: api-base-url
    properties:
      value: "https://api-staging.contoso.com"
backends:
  - name: petstore-backend
    properties:
      url: "https://petstore-staging.contoso.com"

# configuration.prod.yaml
namedValues:
  - name: api-base-url
    properties:
      value: "https://api.contoso.com"
backends:
  - name: petstore-backend
    properties:
      url: "https://petstore.contoso.com"
```

### CI/CD integration

In your pipeline, pass the environment's override file:

```bash
# Dev
apiops publish --overrides configuration.dev.yaml \
  --resource-group rg-dev --service-name apim-dev ...

# Prod
apiops publish --overrides configuration.prod.yaml \
  --resource-group rg-prod --service-name apim-prod ...
```

## Key Vault pattern

For secrets, prefer Key Vault references over plain-text values:

```yaml
namedValues:
  - name: my-secret
    properties:
      keyVault:
        secretIdentifier: "https://my-kv.vault.azure.net/secrets/my-secret"
        identityClientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
```

Requirements:

- A Key Vault in each target environment with the referenced secret.
- A managed identity with `Key Vault Secrets User` access to the vault.
- `identityClientId` must reference an identity accessible to the APIM instance.

## Common patterns and gotchas

### Missing override entries

If a new environment-sensitive resource is added in source artifacts but not added to target override files, source-environment values can be published into other environments.

### Key Vault permissions

A common failure mode is valid Key Vault references with missing identity permissions on the target vault.

### Dry-run validation

Use `--dry-run` to preview publish behavior with overrides:

```bash
apiops publish --overrides configuration.prod.yaml --dry-run \
  --resource-group rg-prod --service-name apim-prod \
  --subscription-id <sub-id> --source ./apim-artifacts
```

## Related

- [`apiops publish` Command Reference](../commands/publish.md)
- [Configuration Reference](../reference/configuration.md)
- [Authentication Guide](authentication.md)
- [Scenarios and Workflows](scenarios-and-workflows.md)
- [GitHub Actions Integration](../ci-cd/github-actions.md)
