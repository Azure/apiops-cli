# Environment Overrides Guide

Environment overrides let you promote the same extracted APIM artifacts across environments (dev → test → prod) while changing only environment-specific values.

## Use with publish

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim-prod \
  --subscription-id <sub-id> \
  --source ./apim-artifacts \
  --overrides ./configuration.prod.yaml
```

## Override file format (APIOPs Toolkit-compatible)

`apiops-cli` uses the APIOPs Toolkit override layout:

- Top-level resource sections (`namedValues`, `backends`, `apis`, `diagnostics`, `loggers`)
- Each section is a list
- Each list item contains `name` + `properties`

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

## Supported override sections

| Section | Key properties commonly overridden |
|---------|------------------------------------|
| `namedValues` | `value`, `displayName`, `tags`, `keyVault.secretIdentifier`, `keyVault.identityClientId` |
| `backends` | `url`, `credentials` |
| `apis` | `serviceUrl` |
| `diagnostics` | `loggerId` |
| `loggers` | `resourceId`, `credentials` |

## Rules

- `name` must match the resource name in extracted artifacts.
- Overrides change **properties**, not resource names.
- Override files are optional when publishing back to the same environment.

## Multi-environment pattern

Use one file per environment:

```text
configuration.dev.yaml
configuration.test.yaml
configuration.prod.yaml
```

Example differences between environments:

```yaml
# configuration.dev.yaml
namedValues:
  - name: api-base-url
    properties:
      value: "https://api-dev.contoso.com"

# configuration.prod.yaml
namedValues:
  - name: api-base-url
    properties:
      value: "https://api.contoso.com"
```

## Key Vault pattern

Prefer Key Vault references for secrets:

```yaml
namedValues:
  - name: my-secret
    properties:
      keyVault:
        secretIdentifier: "https://my-kv.vault.azure.net/secrets/my-secret"
        identityClientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
```

## Related

- [`apiops publish` Command Reference](../commands/publish.md)
- [Configuration Reference](../reference/configuration.md)
- [Authentication Guide](authentication.md)
- [GitHub Actions Integration](../ci-cd/github-actions.md)
