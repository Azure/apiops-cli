# Configure APIOps Environment Overrides

> **How to use:** Open this file in VS Code with GitHub Copilot and ask
> Copilot to help you create environment-specific APIOps override files.

## Goal

Create one `configuration.{environment}.yaml` file per deployment environment
so APIOps publish runs can promote the same artifacts across environments with
environment-specific settings.

Environments: {{ENVIRONMENT_LIST}}

---

## Step 1 — Gather Environment-Specific Values

Copilot, work through each environment in this list: **{{ENVIRONMENT_LIST}}**.

For each environment, ask the user for any values that differ by environment,
such as:

- Backend URLs
- Named value contents
- Service URLs
- Product settings
- Policy fragments or references
- Any other APIM setting that should change between environments

Summarize the collected values before generating files.

---

## Step 2 — Recommend an Override Layout

For each environment, explain:

1. Which settings belong in `configuration.{environment}.yaml`
2. Which settings should remain in the extracted base artifacts
3. Any values that should be stored securely rather than committed directly

Prefer a minimal override file that only contains values that truly vary by
environment.

---

## Step 3 — Secrets and External Resources

For values that must remain secret (API keys, connection strings, credentials):

- Use **`{#[TOKEN_NAME]#}`** placeholder syntax for pipeline secret substitution.
  The pipeline replaces these placeholders with environment variables at runtime.
  Example:
  ```yaml
  namedValues:
    - name: payment-api-key
      properties:
        value: "{#[PAYMENT_API_KEY]#}"
  ```

- For Azure Key Vault references, use the `keyVault` property:
  ```yaml
  namedValues:
    - name: db-connection-string
      properties:
        keyVault:
          secretIdentifier: "https://{env}-kv.vault.azure.net/secrets/db-conn"
          identityClientId: "{#[MANAGED_IDENTITY_CLIENT_ID]#}"
  ```

Guide the user on when to use each approach:
- **`{#[TOKEN_NAME]#}` placeholders** — simple secrets stored in pipeline variables
- **Key Vault references** — secrets that should be managed centrally in Azure
- **Plain values** — non-sensitive settings like URLs or feature flags

---

## Step 4 — Generate the Override Files

Create one YAML file per environment:

- `configuration.dev.yaml`
- `configuration.staging.yaml`
- `configuration.prod.yaml`

Only generate files that match the user's actual environment list. Replace the
example names above as needed.

Requirements:

- Output valid YAML for each file
- Include the schema comment at the top of each file:
  `# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas/override-config.schema.json`
- Keep the files easy to compare across environments
- Use `{#[TOKEN_NAME]#}` placeholders for secrets (never commit real secret values)
- Use Key Vault references for centrally-managed secrets
- Avoid duplicating unchanged base configuration

---

## Step 5 — Validate the Promotion Model

Before finishing:

1. Verify every generated override file matches the intended environment
2. Confirm no unresolved `{{ENVIRONMENT_LIST}}` placeholders remain
3. Verify all secrets use either `{#[TOKEN_NAME]#}` or Key Vault references
4. Remind the user to add the corresponding secret values to their pipeline's
   secret store (GitHub Actions Secrets or Azure DevOps variable groups)
5. Remind the user to test publish for a lower environment before promoting
   further
