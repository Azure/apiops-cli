# Token/Placeholder Substitution

Token substitution lets you store secrets and environment-specific values in your pipeline's secret store rather than in your configuration YAML files. The publish pipeline replaces `{#[TOKEN_NAME]#}` placeholders in `configuration.<env>.yaml` with the actual values before running `apiops publish`.

This feature is compatible with APIOps Toolkit configuration files — users migrating from APIOps Toolkit can use their existing configuration files without modification.

---

## How It Works

1. **Define placeholders** in your `configuration.<env>.yaml` using the `{#[TOKEN_NAME]#}` syntax:

   ```yaml
   namedValues:
     - name: my-api-secret
       properties:
         displayName: my-api-secret
         secret: true
         value: "{#[PROD_SECRET_VALUE]#}"
     - name: backend-url
       properties:
         displayName: backend-url
         value: "{#[BACKEND_API_URL]#}"
   ```

2. **Store actual values** in your pipeline's secret store (GitHub Actions Secrets or Azure DevOps variable groups / Key Vault).

3. **Token substitution runs automatically** as a pipeline step before `apiops publish`. Placeholders are replaced with the actual values in memory — the files on disk are modified only within the pipeline run and the secrets are never committed to the repository.

The substitution follows this pattern:

```
{#[TOKEN_NAME]#}  →  value of environment variable TOKEN_NAME
```

---

## GitHub Actions Setup

### Generated Step

`apiops init` generates a substitution step in each environment's publish job:

```yaml
- name: Substitute tokens in configuration.prod.yaml
  uses: cschleiden/replace-tokens@v1.3
  with:
    tokenPrefix: '{#['
    tokenSuffix: ']#}'
    files: '["configuration.prod.yaml"]'
  env:
    # Map pipeline secrets/variables to environment variables so that
    # {#[TOKEN_NAME]#} placeholders in configuration.prod.yaml are replaced
    # with their actual values before the publish step runs. Example:
    #   MY_SECRET: ${{ secrets.MY_SECRET }}
```

### Mapping Secrets to Tokens

To substitute a token, add the corresponding secret to your GitHub environment and map it in the `env` block:

```yaml
- name: Substitute tokens in configuration.prod.yaml
  uses: cschleiden/replace-tokens@v1.3
  with:
    tokenPrefix: '{#['
    tokenSuffix: ']#}'
    files: '["configuration.prod.yaml"]'
  env:
    PROD_SECRET_VALUE: ${{ secrets.PROD_SECRET_VALUE }}
    BACKEND_API_URL: ${{ secrets.BACKEND_API_URL }}
```

> **Important:** The environment variable name must exactly match the token name inside `{#[...]#}`. Token names are case-sensitive.

### Step-by-Step for GitHub Actions

1. **Add secrets to your GitHub environment:**
   - Go to **Settings → Environments → prod → Add secret**
   - Add a secret for each token (e.g., `PROD_SECRET_VALUE`)

2. **Map secrets to env vars** in the substitution step's `env:` block as shown above.

3. **Define placeholders** in `configuration.prod.yaml` using the matching token names.

4. The substitution step runs during the publish job and replaces the placeholders before `apiops publish` is called.

### Example

`configuration.prod.yaml`:
```yaml
namedValues:
  - name: payment-api-key
    properties:
      displayName: payment-api-key
      secret: true
      value: "{#[PAYMENT_API_KEY]#}"
```

GitHub environment secret: `PAYMENT_API_KEY = sk-live-abc123...`

Workflow `env:` mapping:
```yaml
env:
  PAYMENT_API_KEY: ${{ secrets.PAYMENT_API_KEY }}
```

Result: the placeholder `{#[PAYMENT_API_KEY]#}` is replaced with `sk-live-abc123...` before publish.

---

## Azure DevOps Setup

### Generated Step

`apiops init` generates a substitution step in each environment's deployment job using the [Replace Tokens](https://marketplace.visualstudio.com/items?itemName=qetza.replacetokens) extension:

```yaml
- task: replacetokens@6
  displayName: 'Substitute tokens in configuration.prod.yaml'
  inputs:
    sources: 'configuration.prod.yaml'
    tokenPrefix: '{#['
    tokenSuffix: ']#}'
```

> **Prerequisite:** The [Replace Tokens extension](https://marketplace.visualstudio.com/items?itemName=qetza.replacetokens) (by Guillaume Rouchon / qetza) must be installed in your Azure DevOps organization from the Visual Studio Marketplace.

### Mapping Variables to Tokens

The `replacetokens` task automatically reads from pipeline variables (including those from variable groups). Add your secret values as variables in the `apim-<env>` variable group:

1. Go to **Pipelines → Library → apim-prod**
2. Add a variable for each token (e.g., `PROD_SECRET_VALUE`)
3. Check **"Keep this value secret"** to mark it as a secret variable

The substitution task will automatically replace `{#[PROD_SECRET_VALUE]#}` with the variable value from the group.

### Step-by-Step for Azure DevOps

1. **Install the Replace Tokens extension** in your Azure DevOps organization if not already present.

2. **Add secret variables to your variable group:**
   - Go to **Pipelines → Library → apim-prod**
   - Add each token as a secret variable (e.g., `PROD_SECRET_VALUE`)

3. **Define placeholders** in `configuration.prod.yaml` using matching variable names.

4. The substitution step runs automatically before the publish task.

### Example

`configuration.prod.yaml`:
```yaml
backends:
  - name: order-service
    properties:
      url: "{#[ORDER_SERVICE_URL]#}"
      description: Order processing backend
```

Variable group `apim-prod`:
| Variable | Value | Secret |
|----------|-------|--------|
| `ORDER_SERVICE_URL` | `https://orders.contoso.com/api` | ✓ |

Result: `{#[ORDER_SERVICE_URL]#}` is replaced with `https://orders.contoso.com/api` before publish.

---

## Migration from APIOps Toolkit

If you are migrating from APIOps Toolkit, your existing `configuration.<env>.yaml` files that use `{#[TOKEN_NAME]#}` placeholders work without modification. The same syntax is supported.

The only difference is where secrets are stored and mapped:

| | APIOps Toolkit | APIOps CLI |
|---|---|---|
| **Token syntax** | `{#[TOKEN_NAME]#}` | `{#[TOKEN_NAME]#}` (identical) |
| **GitHub Actions** | `cschleiden/replace-tokens@v1.3` | `cschleiden/replace-tokens@v1.3` (same action) |
| **Azure DevOps** | `qetza.replacetokens@6` | `replacetokens@6` (same extension) |
| **Token prefix/suffix** | `{#[` / `]#}` | `{#[` / `]#}` (identical) |

### Migration Steps

1. Copy your existing `configuration.<env>.yaml` files to your new repository — no changes required.

2. Run `apiops init` to generate the pipeline scaffolding. The publish pipeline includes token substitution steps out of the box.

3. Re-create your secrets in the new pipeline:
   - **GitHub Actions**: Add each secret to the corresponding GitHub environment.
   - **Azure DevOps**: Add each secret to the corresponding `apim-<env>` variable group.

4. For GitHub Actions, add the `env:` mappings to the substitution step as described in [GitHub Actions Setup](#github-actions-setup).

---

## Common Use Cases

### Named Value Secrets

```yaml
namedValues:
  - name: subscription-key
    properties:
      displayName: subscription-key
      secret: true
      value: "{#[SUBSCRIPTION_KEY]#}"
```

### Backend URLs

```yaml
backends:
  - name: inventory-api
    properties:
      url: "{#[INVENTORY_API_BASE_URL]#}"
```

### Multiple Tokens in One File

```yaml
namedValues:
  - name: db-connection
    properties:
      value: "{#[DB_CONNECTION_STRING]#}"
  - name: auth-secret
    properties:
      secret: true
      value: "{#[AUTH_SECRET_KEY]#}"
backends:
  - name: payment-service
    properties:
      url: "{#[PAYMENT_SERVICE_URL]#}"
```

### Using Different Values per Environment

Use separate `configuration.<env>.yaml` files (e.g., `configuration.dev.yaml`, `configuration.prod.yaml`) each referencing the same token names. The pipeline substitutes values from the environment-specific secret store, so `{#[API_KEY]#}` resolves to the dev key in dev and the prod key in prod.

---

## Security Notes

- Tokens are replaced **in the pipeline runner's memory** — they are never committed to the repository.
- Use your pipeline platform's secret storage (GitHub Actions Secrets or Azure DevOps secret variables / Key Vault) — never store actual secret values in YAML files.
- The replaced configuration YAML files are only visible within the single pipeline run and are discarded after the run completes.

---

## Related

- [Environment Overrides](environment-overrides.md) — merge environment-specific configuration before publishing
- [GitHub Actions Integration](../ci-cd/github-actions.md) — full GitHub Actions pipeline guide
- [Azure DevOps Integration](../ci-cd/azure-devops.md) — full Azure DevOps pipeline guide
- [apiops init](../commands/init.md) — generate pipeline scaffolding
