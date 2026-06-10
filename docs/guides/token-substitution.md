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

2. **Store actual values** in your pipeline's secret store (GitHub Actions Secrets or Azure DevOps variable groups).

3. **Token substitution runs automatically** as a pipeline step before `apiops publish`. Placeholders are replaced with the actual values — the secrets are never committed to the repository.

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

> [!IMPORTANT]
> The environment variable name must exactly match the token name inside `{#[...]#}`. Token names are case-sensitive.

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

> [!IMPORTANT]
> The [Replace Tokens extension](https://marketplace.visualstudio.com/items?itemName=qetza.replacetokens) must be installed in your Azure DevOps organization.
> You can install it from Marketplace or via CLI:
> `az devops extension install --publisher-id qetza --extension-id replacetokens`

### Mapping Variables to Tokens

The `replacetokens` task automatically reads from pipeline variables (including those from variable groups). Add your secret values as variables in the `apim-<env>` variable group:

1. Go to **Pipelines → Library → apim\<env\>** (e.g., `apim-prod`)
2. Add a variable for each token (e.g., `PROD_SECRET_VALUE`)
3. Check **"Keep this value secret"** to mark it as a secret variable

The substitution task will automatically replace `{#[PROD_SECRET_VALUE]#}` with the variable value from the group.

### Step-by-Step for Azure DevOps

1. **Install the Replace Tokens extension** in your Azure DevOps organization if not already present.
  ```bash
  az devops extension install --publisher-id qetza --extension-id replacetokens
  ```

2. **Add secret variables to your variable group:**
   - Go to **Pipelines → Library → apim\<env\>** (e.g., `apim-prod`)
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

Variable group `apim<env>` (e.g., `apim-prod`):
| Variable | Value | Secret |
|----------|-------|--------|
| `ORDER_SERVICE_URL` | `https://orders.contoso.com/api` | ✓ |

Result: `{#[ORDER_SERVICE_URL]#}` is replaced with `https://orders.contoso.com/api` before publish.

---

## Migration from APIOps Toolkit

If you are migrating from APIOps Toolkit, your existing `configuration.<env>.yaml` files that use `{#[TOKEN_NAME]#}` placeholders work without modification. The same syntax is supported, using the same token prefix/suffix and the same pipeline extensions.

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

- `{#[TOKEN_NAME]#}` placeholders are committed to your repository — actual secret values are never stored in YAML files.
- Use your pipeline platform's secret storage (GitHub Actions Secrets or Azure DevOps secret variables) to store the actual values.
- Substitution happens at pipeline runtime before `apiops publish` runs.

---

## Related

- [Environment Overrides](environment-overrides.md) — merge environment-specific configuration before publishing
- [GitHub Actions Integration](../ci-cd/github-actions.md) — full GitHub Actions pipeline guide
- [Azure DevOps Integration](../ci-cd/azure-devops.md) — full Azure DevOps pipeline guide
- [apiops init](../commands/init.md) — generate pipeline scaffolding
