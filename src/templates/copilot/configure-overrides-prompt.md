---
mode: 'agent'
description: 'Configure APIOps environment overrides'
---

# Configure APIOps Environment Overrides

> **How to use:** Open this file in VS Code with GitHub Copilot and ask
> Copilot to help you create environment-specific APIOps override files.

## Goal

Create one `configuration.{environment}.yaml` file per deployment environment
so APIOps publish runs can promote the same artifacts across environments with
environment-specific settings.

Environments: {{ENVIRONMENT_LIST}}

---

## Step 1 — Gather Information

Copilot, start by collecting the following from the user:

1. **Environment names** — Confirm or update the list: **{{ENVIRONMENT_LIST}}**.
   Note that many teams only need `stage` and `prod` (dev may share the same
   settings as stage, or dev may not be managed by APIOps at all).

2. **Existing override config files** — Check whether
   `configuration.{env}.yaml` files already exist in the repository:
   - If they exist, use those as the starting point.
   - If they don't, ask the user whether to create new ones or whether they
     may already exist under a different name or location.

3. **APIM artifacts location** — Ask the user where the APIOps artifact
   directory is (default: `./apim-artifacts`). You will need to inspect the
   artifacts in the next step.

Summarize what you've learned before moving on.

---

## Step 2 — Investigate APIM Artifacts and Create Stub Override Files

Using the artifact directory identified in Step 1:

1. Scan the artifacts for references to **external resources** — these are the
   things that typically need overrides between environments. Examples:
   - Backend service URLs
   - Named values (especially those referencing Key Vault secrets)
   - Product subscription settings
   - Logger resource IDs
   - Gateway or VNet references
   - Policy fragment references to external endpoints

   > **Note:** References to sub-resources of the same APIM instance (e.g.,
   > one API referencing another API's policy) are handled automatically by
   > APIOps and do **not** need overrides.

2. For each environment, create a **stub** `configuration.{env}.yaml` that
   covers all the commonly-overridden items you found. Use placeholder example
   values so the user can see the shape of the file.

3. **Add everything as YAML comments initially** — a commented-out section is
   safe because it will not cause a publish failure. The user can uncomment
   and fill in values in Step 3. Example pattern:
   ```yaml
   # namedValues:
   #   - name: payment-api-key
   #     properties:
   #       value: "{#[PAYMENT_API_KEY]#}"
   ```

---

## Step 3 — Work With the User to Fill In Values

Go through each environment one at a time. For each environment:

1. **Pipeline environment variables (tokens)** — Ask the user whether
   environment variables are available in the publish pipeline. Common ones:
   - Subscription ID
   - Resource group name
   - APIM service instance name

   These can be added as `{#[TOKEN_NAME]#}` placeholders so the pipeline
   substitutes the real value at runtime. This avoids hardcoding
   environment-specific IDs in files committed to source control.

2. **Shared values** — Sometimes a value does not need to differ by
   environment (e.g., dev and stage may use the same Key Vault). Confirm with
   the user before duplicating values.

3. **Key Vault pattern** — A common pattern is for one Key Vault to hold all
   secrets per environment (e.g., `https://{env}-kv.vault.azure.net/secrets/`).
   Users often define a named-value token for the Key Vault secrets base URL and
   then append the secret name — this avoids human error. For example:
   ```yaml
   namedValues:
     - name: kv-base-url
       properties:
         value: "{#[KV_BASE_URL]#}"
     - name: db-connection-string
       properties:
         keyVault:
           secretIdentifier: "{#[KV_BASE_URL]#}db-conn"
           identityClientId: "{#[MANAGED_IDENTITY_CLIENT_ID]#}"
   ```

4. For values that must remain secret (API keys, connection strings):
   - Use **`{#[TOKEN_NAME]#}`** for pipeline-injected secrets.
   - Use `keyVault.secretIdentifier` for Azure Key Vault-managed secrets.
   - Use plain values only for non-sensitive settings like URLs or feature
     flags that are safe to commit.

Uncomment and populate each stub entry as the user provides or confirms values.

---

## Step 4 — Generate the Override Files

Once all values are confirmed, produce the final YAML files:

- Output valid YAML for each file.
- Include the schema comment at the top of each file:
  `# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas/override-config.schema.json`
- Keep files easy to compare across environments.
- Use `{#[TOKEN_NAME]#}` placeholders for secrets (never commit real secret values).
- Use Key Vault references for centrally-managed secrets.
- Avoid duplicating unchanged base configuration.

---

## Step 5 — Validate the Promotion Model

Before finishing:

1. Verify every generated override file matches the intended environment.
2. Confirm no unresolved `{{ENVIRONMENT_LIST}}` placeholders remain.
3. Verify all secrets use either `{#[TOKEN_NAME]#}` or Key Vault references.
4. Remind the user to add any `{#[TOKEN_NAME]#}` tokens to their pipeline's
   secret store (GitHub Actions Secrets or Azure DevOps variable groups).
   Help the user with this step if they ask. Note that the pipeline will fail
   with an error if any tokens are missed.
5. Remind the user to test publish for a lower environment before promoting
   further.
