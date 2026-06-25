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

## Copilot-Assisted Configuration

If you ran `apiops init`, a Copilot prompt file was generated at `.github/prompts/apiops-configure-overrides.prompt.md`. Open it in VS Code and ask GitHub Copilot to help you configure environment overrides — it will guide you through setting up environment-specific values interactively.

## IDE Autocompletion with JSON Schema

A JSON Schema is available for `configuration.{env}.yaml` override files. Add yaml-language-server comment at the top of your override file. Requires yaml language extension in VSCode.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas/v1/override-config.schema.json
```

The schema provides:
- Property name autocompletion for all resource sections
- Validation of the override structure (name + properties format)
- Inline documentation including token substitution syntax

## Override file format (APIOps Toolkit-compatible)

`apiops-cli` uses the [APIOps Toolkit](https://github.com/Azure/apiops) override layout:

- Top-level resource sections: `namedValues`, `backends`, `apis`, `diagnostics`, `loggers`, `policies`, `gateways`, `versionSets`, `groups`, `subscriptions`, `products`, `tags`, `policyFragments`, `workspaces`
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
  - name: payment-api-key
    properties:
      secret: true
      value: "{#[PAYMENT_API_KEY]#}"  # Pipeline token — replaced at runtime

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
    policies:
      - name: policy
        properties:
          format: rawxml

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

# Additional override sections (all APIOps Toolkit sections are supported):
# policies:
#   - name: policy
#     properties:
#       format: rawxml
# gateways:
#   - name: my-gateway
#     properties:
#       locationData:
#         name: "gateway location"
# versionSets:
#   - name: my-version-set
#     properties:
#       displayName: "My Version Set"
# groups:
#   - name: my-group
#     properties:
#       displayName: "My Group"
# subscriptions:
#   - name: my-subscription
#     properties:
#       displayName: "My Subscription"
# products:
#   - name: my-product
#     properties:
#       displayName: "My Product"
# tags:
#   - name: my-tag
#     properties:
#       displayName: "My Tag"
# policyFragments:
#   - name: my-fragment
#     properties:
#       description: "My Policy Fragment"
```

## Override capabilities by resource type

Override properties are generic — any ARM resource property can be overridden. The examples below show common use cases per resource type, but you're not limited to these properties.

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

### Named value secrets (with pipeline token substitution)

Secrets can be stored in Key Vault (see [Key Vault pattern](#key-vault-pattern) below) or injected at pipeline runtime using [token substitution](token-substitution.md). With token substitution, the `{#[TOKEN_NAME]#}` placeholder is replaced with the actual secret value from your pipeline's secret store (GitHub Actions Secrets or Azure DevOps variable groups).

```yaml
namedValues:
  - name: payment-api-key
    properties:
      displayName: payment-api-key
      secret: true
      value: "{#[PAYMENT_API_KEY]#}"  # Replaced at pipeline runtime
  - name: webhook-secret
    properties:
      secret: true
      value: "{#[WEBHOOK_SECRET]#}"
```

Store the actual secret values in:
- **GitHub Actions:** Environment secrets (Settings → Environments → Add secret). See [Using secrets in GitHub Actions](https://docs.github.com/actions/security-guides/using-secrets-in-github-actions#creating-secrets-for-an-environment).
- **Azure DevOps:** Variable groups marked as secret (Pipelines → Library). See [Use variable groups in pipelines](https://learn.microsoft.com/azure/devops/pipelines/library/variable-groups) and [Set secret variables](https://learn.microsoft.com/azure/devops/pipelines/process/set-secret-variables).

See the [Token Substitution guide](token-substitution.md) for complete setup instructions.

### Backends

```yaml
backends:
  - name: petstore-backend
    properties:
      url: "https://petstore-prod.contoso.com"
      resourceId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.Web/sites/prod-backend"
      credentials:
        header:
          x-api-key:
            - "prod-backend-key"
```

### APIs

```yaml
apis:
  - name: petstore-api
    properties:
      serviceUrl: "https://petstore-prod.contoso.com/v1"
      displayName: "Petstore API (Production)"
```

### APIs with nested sub-resource overrides

API entries support nested sub-resource overrides for diagnostics, operations, policies, and releases:

```yaml
apis:
  - name: petstore-api
    properties:
      serviceUrl: "https://petstore-prod.contoso.com/v1"
    diagnostics:
      - name: applicationinsights
        properties:
          loggerId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<apim>/loggers/prod-appinsights"
          verbosity: Error
    operations:
      - name: get-pets
        policies:
          - name: policy
            properties:
              format: rawxml
    policies:
      - name: policy
        properties:
          format: rawxml
    releases:
      - name: v1-release
        properties:
          notes: "Production release"
```

### Diagnostics (service-level)

```yaml
diagnostics:
  - name: applicationinsights
    properties:
      loggerId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<apim>/loggers/prod-appinsights"
      verbosity: Error
```

### Loggers

```yaml
loggers:
  - name: appinsights-logger
    properties:
      loggerType: applicationInsights
      resourceId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/microsoft.insights/components/prod-appinsights"
      credentials:
        instrumentationKey: "prod-instrumentation-key"
      isBuffered: true
```

> **Note:** When you provide a raw `instrumentationKey` value (instead of a `{{namedValue}}` reference), APIM will automatically create a named value to store the credential securely.

### Logger credentials with auto-generated named values

When APIM creates a logger (e.g., for Application Insights), it auto-generates a named value to store the instrumentation key. These auto-generated named values have 24-character hex IDs (e.g., `66f48e1226dab62c0823e4f8`) and are normally skipped during publish because APIM recreates them automatically.

However, when publishing to a **fresh environment**, APIM cannot recreate these named values because the logger doesn't exist yet. To handle this, provide an override for the auto-generated named value:

```yaml
namedValues:
  # Override the auto-generated named value with the production instrumentation key.
  # Use the 24-char hex ID from the extracted artifact filename.
  - name: 66f48e1226dab62c0823e4f8
    properties:
      value: "prod-instrumentation-key-value"

loggers:
  - name: appinsights-logger
    properties:
      loggerType: applicationInsights
      resourceId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/microsoft.insights/components/prod-appinsights"
      isBuffered: true
```

Alternatively, you can override the logger credentials directly to bypass the named value reference entirely:

```yaml
loggers:
  - name: appinsights-logger
    properties:
      loggerType: applicationInsights
      resourceId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/microsoft.insights/components/prod-appinsights"
      credentials:
        instrumentationKey: "prod-instrumentation-key-value"
      isBuffered: true
```

> **Tip:** You can also use [pipeline token substitution](token-substitution.md) for logger credentials. Replace the hardcoded value with a placeholder like `{#[APPINSIGHTS_KEY]#}`, and store the actual key in your pipeline's secret store. This keeps secrets out of your repository entirely.

### Subscriptions

```yaml
subscriptions:
  - name: my-subscription
    properties:
      displayName: "My Subscription (Production)"
      scope: "/apis/petstore-api"
```

> **Note:** The built-in `master` subscription is automatically skipped during publish.
> Product-scoped subscriptions auto-generated by APIM are also skipped to avoid subscription limit errors.

### Products

```yaml
products:
  - name: starter-product
    properties:
      displayName: "Starter (Production)"
      subscriptionRequired: true
      approvalRequired: false
      subscriptionsLimit: 10
```

### Gateways

```yaml
gateways:
  - name: on-prem-gateway
    properties:
      locationData:
        name: "Production datacenter"
        city: "Seattle"
        countryOrRegion: "US"
```

### Policy fragments

```yaml
policyFragments:
  - name: rate-limit-fragment
    properties:
      description: "Production rate limiting policy"
```

### Service-level policies

```yaml
policies:
  - name: policy
    properties:
      format: rawxml
```

### Version sets, groups, and tags

Overrides are also supported for `versionSets`, `groups`, and `tags`. Each uses the same `name` + `properties` format:

```yaml
versionSets:
  - name: petstore-versions
    properties:
      displayName: "Petstore API Versions"
      versioningScheme: Segment

groups:
  - name: partner-developers
    properties:
      displayName: "Partner Developers (Production)"

tags:
  - name: public-api
    properties:
      displayName: "Public API"
```

### Workspaces

Workspaces (Premium/StandardV2/PremiumV2 tiers) support overrides for the workspace container itself:

```yaml
workspaces:
  - name: partner-workspace
    properties:
      displayName: "Partner Workspace (Production)"
      description: "Production workspace for partner APIs"
```

#### Workspace-scoped resource overrides

Resources inside a workspace are extracted to `workspaces/<workspace-name>/` subdirectories. To override them, **nest** the child sections directly under the workspace entry (matching the APIOps Toolkit format):

```yaml
workspaces:
  - name: partner-workspace
    properties:
      displayName: "Partner Workspace (Production)"
    apis:
      - name: orders-api
        properties:
          serviceUrl: "https://orders-prod.contoso.com/v1"
    backends:
      - name: orders-backend
        properties:
          url: "https://orders-prod.contoso.com"
    namedValues:
      - name: api-key
        properties:
          secret: true
          value: "{#[PARTNER_API_KEY]#}"
    loggers:
      - name: appinsights-logger
        properties:
          resourceId: "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/microsoft.insights/components/prod-appinsights"
```

The supported workspace child sections are: `apis`, `backends`, `diagnostics`, `groups`, `loggers`, `namedValues`, `policyFragments`, `products`, `subscriptions`, `tags`, and `versionSets`.

> ⚠️ **Known limitation — tracked in [#118](https://github.com/Azure/apiops-cli/issues/118):** workspace child overrides are *parsed* (the YAML above is accepted with no errors) but are **not yet applied at publish time**. Until #118 is fixed, only the workspace container's own `properties` are honored for workspace-scoped resources. Authoring overrides in this nested shape today is safe and forward-compatible — they will start taking effect automatically once the merger is updated.

## Override rules

### Names must be consistent

Resource **names** must be the same across all environments. You cannot rename a backend or named value per environment.

```yaml
# ✅ Correct — same backend name, different URL
backends:
  - name: petstore-backend
    properties:
      url: "https://petstore-prod.contoso.com"

# ❌ Wrong — you can't rename the backend per environment
backends:
  - name: petstore-backend-prod    # This name doesn't exist in artifacts
    properties:
      url: "https://petstore-prod.contoso.com"
```

### Properties can differ

Environment-specific **properties** (URLs, secrets, credentials, resource IDs) are exactly what overrides are for:

- Backend URLs → different per environment
- Named value secrets → different Key Vault references per environment
- Logger resource IDs → different Application Insights instances per environment
- API service URLs → different backend endpoints per environment

### Additional rules

- Name matching is case-insensitive during override apply.
- Unmatched names are ignored (they do not fail publish).
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

> **Tip:** Use the same secret **name** across all Key Vaults (e.g., `db-conn`). Only the vault URL changes per environment.

## Common patterns and gotchas

### Pattern: Shared base with environment differences

Extract from dev (your baseline environment), then override only what differs in staging and prod. Most APIM configuration (policies, operations, products) stays the same — only URLs and credentials change.

### Gotcha: Missing override entries

If you add a new backend in dev but forget to add it to your override files, publish will use the dev URL in production. **Always update all override files when adding new environment-sensitive resources.**

### Gotcha: Key Vault permissions

When using Key Vault references, the APIM managed identity needs access to the Key Vault. A common failure mode: overrides reference a Key Vault but APIM lacks the `Key Vault Secrets User` role on that vault.

### Gotcha: Auto-generated named values for loggers

When you create a logger in APIM (e.g., for Application Insights), APIM auto-generates a named value to store the credential. These have 24-character hex names (e.g., `<24-char-hex-id>`). During extract, these are captured as artifacts. During publish:

- **Same environment:** Auto-generated named values are skipped (APIM already has them).
- **Fresh environment:** The logger fails because the named value doesn't exist yet. Provide an override with the target environment's credential value, or override the logger's `credentials` directly.

### Gotcha: Redacted secrets

Extracted secret named values have their `value` replaced with `*** REDACTED ***`. If you publish these without providing an override with a real value or Key Vault reference, they will be skipped with a warning. Always provide overrides for secret named values when publishing to a different environment.

### Gotcha: Override-only changes are not published incrementally

If your pipeline uses incremental publish (`--commit-id`) and you commit **only** a change to the override file (e.g., updating a named value URL in `configuration.prod.yaml`), nothing will be published. Incremental publish uses `git diff` on artifact files in the `--source` directory to determine which resources changed — the override file is not an artifact file and is not considered.

**Workaround:** Either run a full publish (omit `--commit-id`) when you change override values, or include an artifact file change in the same commit. See the [Incremental Publish guide](incremental-publish.md#override-only-changes) for details.

### Dry-run validation

Use `--dry-run` to preview publish behavior with overrides:

```bash
apiops publish --overrides configuration.prod.yaml --dry-run \
  --resource-group rg-prod --service-name apim-prod \
  --subscription-id <sub-id> --source ./apim-artifacts
```

## Related

- [`apiops publish` Command Reference](../commands/publish.md)
- [Token Substitution Guide](token-substitution.md)
- [Configuration Reference](../reference/configuration.md)
- [Authentication Guide](authentication.md)
- [Scenarios and Workflows](scenarios-and-workflows.md)
- [GitHub Actions Integration](../ci-cd/github-actions.md)

