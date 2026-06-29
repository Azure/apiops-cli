---
mode: 'agent'
description: 'Configure APIOps environment overrides'
---

# Configure APIOps Environment Overrides

> **How to use:** Open this file in VS Code with GitHub Copilot and ask Copilot to help you create environment-specific APIOps override files.

## Goal

Create one `configuration.{environment}.yaml` file per deployment environment so APIOps publish runs can promote the same artifacts across environments with environment-specific settings.

---

## How Copilot must work through this prompt

These rules apply to **every** step below. Follow them strictly:

1. **Confirm before proceeding.** At the end of every step, summarize what you learned or propose, then **STOP and wait for the user to confirm** before moving to the next step. Never chain steps together without an explicit "yes" / "go ahead" from the user.
   - **Hard stop rule:** When you ask for confirmation, end the response there. Do **not** include the next question, next override, or any forward action in the same message.
   - This hard stop applies to **step boundaries** (Step 0, Step 1, Step 2, Step 3, Step 5, Step 6). In Step 4, follow the single-setting cadence below.
2. **Never assume a value.** Do not invent backend URLs, service URLs, resource IDs, instrumentation keys, secret names, Key Vault URLs, or token names. If you don't know a value, **ask the user**.
3. **Do not tokenize everything.** A `{#[TOKEN_NAME]#}` placeholder is only for values the user explicitly wants injected by the pipeline (see Step 4 for how to classify each value). Many values are plain, non-sensitive settings that should be written literally.
4. **Ask, don't guess, about pipeline tokens.** Only use a token after the user has told you that token exists (or will be added) in their pipeline.
5. **The JSON schema is the source of structure.** To determine the valid shape of an override entry and its nested properties (for example a Key Vault named value's `keyVault.secretIdentifier` / `identityClientId`), consult the `override-config` JSON schema referenced in each file's `# yaml-language-server: $schema=...` comment (the public schema URL). Do **not** rely on the `apiops-cli` source repository — end users only have the built npm package and the published schema URL.

---

## Step 0 — Detect and Confirm Environments

Before asking the user anything else, look for existing environment configuration files in the repository:

1. Search for files matching `configuration.*.yaml` (excluding `configuration.extractor.yaml`). The `*` portion is the environment name.
2. Also check CI/CD workflow files (`.github/workflows/` or `.azdo/pipelines/`) for environment references.

Then **present the detected environments to the user** and ask which ones they want override files for:

> "I found these environments: `<list>`. Which of these do you want to create or update override files for? If you deploy to other environments I didn't detect, list them too."

If no config files are found, ask:
> "What environments do you deploy to? Common patterns include `dev, stage, prod` or `stage, prod` (if dev shares the same APIM instance as stage)."

**STOP. Do not proceed until the user has explicitly confirmed the exact list of environments to work on.**

---

## Step 1 — Gather Information

Once the environment list is confirmed, collect the following:

1. **Existing override config files** — If `configuration.{env}.yaml` files already exist:
   - Use those as the starting point.
   - Ask whether the user wants to update them or start fresh.

2. **APIM artifacts location** — Ask the user where the APIOps artifact directory is (default: `./apim-artifacts`). You will inspect the artifacts in the next step.

Summarize what you've learned and **STOP for confirmation** before continuing.

---

## Step 2 — Investigate Artifacts and Create Stub Override Files

Using the artifact directory confirmed in Step 1:

1. Scan the artifacts for references to **external resources** — the things that typically differ between environments. Examples:
   - API `serviceUrl` values
   - Backend service URLs and linked `resourceId`s
   - Named values (secrets and plain config values)
   - Logger `resourceId`s and credentials
   - Diagnostic `loggerId` references
   - Gateway or VNet references
   - Policy fragment references to external endpoints
   - Workspace-scoped resources (only if the APIM instance uses **workspaces**) — workspaces can contain their own APIs, backends, named values, loggers, etc. that may need per-environment overrides

   > **Note:** References to sub-resources of the same APIM instance (e.g., one API referencing another API's policy) are handled automatically by APIOps and do **not** need overrides.

2. Produce a **plain list of override candidates** grouped by resource type (e.g., "APIs needing a serviceUrl: `src-graphql-passthrough`, `src-rest-versioned-v1`…"). Do **not** decide yet which are tokens versus literals — that happens in Step 3.

3. Present this list and ask the user to confirm which items actually need per-environment overrides and which can be left as-is.

4. Once the candidate list is confirmed, **create the stub override files** — one `configuration.{env}.yaml` per confirmed environment — containing every confirmed candidate as an entry with the correct `name` and structure but **blank values** (e.g., empty strings `""` or empty `properties`). This shows the shape of each file; the actual values are filled in during Step 4. **Preserve any existing schema comment.** If a file already has a `# yaml-language-server: $schema=...` line (as `apiops init` generates), keep it **exactly as-is** — it already points at the correct schema version. Only when creating a brand-new file with no schema comment, add one referencing the current schema version:
   `# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas/v1/override-config.schema.json`

**STOP for confirmation before continuing to Step 3.**

---

## Step 3 — Confirm Available Pipeline Tokens

Before asking the user anything, **first inspect the pipeline files** in the repository (`.github/workflows/` or `.azdo/pipelines/`) to discover what environment variables and secrets are already defined. Look for `env:` blocks, `vars.*` and `secrets.*` references, and variable group entries.

Then, try running `gh --version` to check if the `gh` CLI is available. If the command succeeds, ask the user for permission to query pipeline variables automatically:

> "I can check your GitHub Actions secrets and variables automatically using the `gh` CLI. May I run `gh variable list` and `gh secret list` (names only — no values are revealed) to see what's available? Or would you prefer to list them manually?"

If the user agrees, run the commands and use the results. If `gh` is not available or the user declines, fall back to asking manually.

Regardless of how the variable list was obtained, **validate** that any token names the user provides actually appear in the pipeline files or in the queried variable list (if `gh` was used). Warn the user if a token name doesn't match anything found.

**Known `apiops init` tokens.** If the user scaffolded the repo with `apiops init`, the generated publish pipeline already wires up a standard set of pipeline variables / secrets that are usable as `{#[...]#}` tokens. Cross-reference with any pipeline files you inspected or variables you queried. The standard tokens are (substitute `<ENV>` with the uppercased environment name, e.g. `STAGE`):

- `AZURE_SUBSCRIPTION_ID_<ENV>` (e.g., `AZURE_SUBSCRIPTION_ID_STAGE`)
- `APIM_RESOURCE_GROUP_<ENV>` (e.g., `APIM_RESOURCE_GROUP_STAGE`)
- `APIM_SERVICE_NAME_<ENV>` (e.g., `APIM_SERVICE_NAME_STAGE`)
- GitHub Actions only: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` (used for login; rarely needed inside override files)

> Note: some repos use `AZURE_SUBSCRIPTION_ID` (global, no env suffix) as the default init-generated name. Others customize to `AZURE_SUBSCRIPTION_ID_<ENV>`. Check the pipeline files or queried variables to see which pattern is used.

After combining what you found from the pipeline inspection and any `gh` query, present the discovered token list to the user and ask them to confirm it is complete:

> "Based on the pipeline files and variables I found, the available tokens appear to be: `<list>`. Are these correct? Are there any other pipeline variables (with their exact, case-sensitive names) I should use as tokens?"

> **Beyond the confirmed tokens, do NOT propose, guess, or pre-populate tokens.** Do not invent token names for secrets, URLs, or resource segments. Let the user tell you what else exists.

Record this list of confirmed tokens. You may **only** use these token names later. Never invent a token, and never wrap a value in `{#[TOKEN_NAME]#}` unless its token is on this confirmed list. The publish step fails if a token has no matching pipeline variable.

**STOP and confirm the token list before continuing to Step 4.**

---

## Step 4 — Fill In Each Override With the User

Walk through the stub entries created in Step 2 **one setting/property at a time** (for example one `resourceId` or one `value` field), not one whole override object at a time. Do not batch multiple settings in a single prompt.

**Single-setting cadence for Step 4:**

- Ask for exactly one setting when information is missing.
- If the user provides that setting unambiguously, write it immediately.
- After writing it, proceed by asking for the next single missing setting.
- Only pause for confirmation when the user explicitly asks for confirmation, or when the value is ambiguous and you need clarification.
- Do not ask the user to reconfirm a setting they just provided unless there is a concrete ambiguity.

For each override value, classify how it should be supplied using the confirmed token list from Step 3. There are three kinds of values — do not default to tokens:

| Kind | When to use | How it's written |
| --- | --- | --- |
| **Literal value** | Non-sensitive settings that are safe to commit — API/backend URLs, resource IDs, Application Insights logger resource IDs, **Application Insights instrumentation keys** (telemetry ingestion keys, **not secrets**), feature flags. | Plain YAML value, e.g. `url: "https://api.contoso.com"` |
| **Pipeline token** | Secrets or values the user wants injected at publish time from the pipeline's secret store (GitHub Actions secrets / Azure DevOps variable groups). | `value: "{#[TOKEN_NAME]#}"` — only use a token the user confirms exists |
| **Key Vault reference** | Secrets stored centrally in Azure Key Vault and referenced by named values. | A `keyVault.secretIdentifier` URL (see pattern below) |

For each candidate value, ask the user something like:

> "For `<resource>.<property>`, what is the value in **<env>**? Is it a fixed value I can write directly, a secret your pipeline injects via a token, or a Key Vault secret?"

Concrete guidance to follow while classifying:

- **API service URLs and backend URLs** — Ask the user for the actual URL per environment. These are usually plain literal values, **not tokens**, unless the user specifically wants them injected by the pipeline.
- **Application Insights instrumentation keys** — These are **not secrets**. Write the value the user provides directly, or leave the extracted value in place. Do **not** wrap them in `{#[TOKEN_NAME]#}` unless the user asks.
- **Resource IDs (loggers, backends, diagnostics)** — Usually literal values. Only the subscription ID / resource group / service name segments need tokenizing if the user wants them injected; ask first.
- **Connection strings, API keys, passwords** — These are secrets. Use a pipeline token or a Key Vault reference based on the user's preference.

### Key Vault reference — the correct pattern

A Key Vault-backed named value uses a **`keyVault.secretIdentifier`** that is a **full secret URL**. Do **not** create a separate named value just to hold a Key Vault base URL, and do **not** concatenate a token with a secret name.

Correct — literal full secret identifier:

```yaml
namedValues:
  - name: db-connection-string
    properties:
      keyVault:
        secretIdentifier: "https://prod-kv.vault.azure.net/secrets/db-conn"
        identityClientId: "{#[MANAGED_IDENTITY_CLIENT_ID]#}"
```

Also acceptable — tokenize the whole secret identifier when the user wants the pipeline to supply it:

```yaml
namedValues:
  - name: db-connection-string
    properties:
      keyVault:
        secretIdentifier: "{#[DB_CONN_SECRET_IDENTIFIER]#}"
        identityClientId: "{#[MANAGED_IDENTITY_CLIENT_ID]#}"
```

As you fill in each override, write it into the stub file using the right form:

- Write literal values directly; use `{#[TOKEN_NAME]#}` only for confirmed tokens; use full `keyVault.secretIdentifier` URLs for Key Vault secrets.
- Never commit real secret values — those must be tokens or Key Vault references.

Continue setting-by-setting until there are no missing values.

---

## Step 5 — Finalize and Review the Override Files

Once every stub override has been filled in across all environments:

- Re-read each `configuration.{env}.yaml` file and confirm it is valid YAML with no leftover blank values from the stubs.
- Confirm the schema comment is present as the first line of each file.
- **Validate each file against the schema** referenced in its `# yaml-language-server: $schema=...` comment. Perform structural validation: check that all top-level keys are recognized resource section names (e.g., `namedValues`, `backends`, `apis`, `diagnostics`, `loggers`, `policies`, `gateways`, `versionSets`, `groups`, `subscriptions`, `products`, `tags`, `policyFragments`, `workspaces`), that every list item has both `name` (string) and `properties` (object), and that no `properties` keys are obviously misspelled. If you can fetch the schema URL, use it to verify additional property constraints.
- Keep files easy to compare across environments and avoid duplicating unchanged base configuration.

Ask the user to open and review each finalized file to confirm it looks correct before checking it in. Summarize any validation concerns you identified.

**STOP for confirmation** before treating the files as final.

---

## Step 6 — Validate the Promotion Model

Before finishing:

1. Verify every generated override file matches the intended environment.
2. Verify all **secrets** use either `{#[TOKEN_NAME]#}` or a Key Vault reference — and that non-secrets (URLs, resource IDs, instrumentation keys) are written as plain values, not tokens.
3. Confirm every `{#[TOKEN_NAME]#}` used corresponds to a token the user said exists in their pipeline.
4. Remind the user to add any `{#[TOKEN_NAME]#}` tokens to their pipeline's secret store (GitHub Actions Secrets or Azure DevOps variable groups). Help with this if they ask. Note that the pipeline fails with an error if any tokens are missing.
5. Remind the user to test publish for a lower environment before promoting further.

