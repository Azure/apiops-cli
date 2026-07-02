---
mode: 'agent'
description: 'Configure APIOps resource extraction filters'
---

# Configure APIOps Extractor Filters

> **How to use:** Open this file in VS Code with GitHub Copilot and ask Copilot to help you design a `configuration.extractor.yaml` file for your repository.

## Goal

Create a `configuration.extractor.yaml` file that limits APIOps extraction to the Azure API Management resources your team wants to manage in source control.

---

## How Copilot must work through this prompt

These rules apply to **every** step below. Follow them strictly:

1. **Confirm before proceeding.** At the end of every step, summarize what you learned or propose, then **STOP and wait for the user to confirm** before moving to the next step. Never chain steps together without an explicit "yes" / "go ahead" from the user.
   - **Hard stop rule:** When you ask for confirmation, end the response there. Do **not** include the next question, next resource type, or any forward action in the same message.
   - This hard stop applies to **step boundaries** (Step 0, Step 2, Step 3, Step 4). In Step 1, follow the single-resource-type cadence below.
2. **Never assume or invent names.** Do not invent API, product, backend, named value, or any other resource names. Use only names that come from the live APIM instance or that the user explicitly provides. The local artifact directory is not authoritative — it may be stale or empty. When unsure, ask.
3. **Default is extract-everything.** APIOps extracts **all** resources of a type when that type is **omitted** from the filter. Only add a type to the filter when the user wants to narrow it (SOME) or exclude it (NONE). Do not add a type just to list every resource.
4. **Empty array means exclude all.** Setting a type to `[]` excludes every resource of that type. Use this only when the user explicitly wants NONE.
5. **The JSON schema is the source of structure.** To determine which resource types support sub-entries and what those sub-entries are (for example, `apis` → `operations`, `diagnostics`, `schemas`, `releases`), consult the `extractor-config` JSON schema referenced in the file's `# yaml-language-server: $schema=...` comment (the public schema URL).

---

## Step 0 — Determine the Authoritative Resource List

The filter runs at **extraction time against the live Azure API Management instance**. The local artifact directory may be stale, partial, or empty, so it is **not** an authoritative list of what exists in Azure. Establish the source of truth first:

1. **Prefer querying the live APIM instance.** Ask the user for (or reuse if already known) the subscription ID, resource group, and APIM service name, and whether the Azure CLI is logged in. If Azure is reachable, enumerate the resource types and names directly from the instance (for example with `az apim` / `az rest` calls) and use that as the source of truth.
2. **Fallback when Azure cannot be queried.** Do **not** treat the local artifacts as the definitive list. Instead, in Step 1 ask the user type-by-type; for SOME, the user must provide the resource (and sub-resource) names themselves.
3. Check whether `configuration.extractor.yaml` already exists (it may have been created by `apiops init`). If it exists, note its current contents — you will update it in place rather than overwriting it.

Tell the user which mode you will use (live-Azure list vs. user-provided names), and confirm the connection details if querying Azure.

**STOP. Do not proceed until the user confirms the source of truth.**

---

## Step 1 — Decide Scope Per Resource Type (one type at a time)

Walk through the resource types **one type at a time**. For each type, ask the user which scope they want:

- **Extract ALL** — include every resource of this type. Leave this type **out** of the filter (APIOps extracts everything by default).
- **Extract NONE** — exclude all resources of this type. Add the type with an empty array: `tags: []`.
- **Extract SOME** — include only specific resources. The user provides which names (or wildcard patterns) to include. Matching is case-insensitive and supports `*` and `?` wildcards. Entries can also be prefixed with `!` to **exclude** a name or pattern (e.g. `'!prod-legacy-*'`); a list containing only `!` entries means "include everything, then subtract." **Always quote `!`-prefixed entries in YAML** — an unquoted leading `!` is parsed as a YAML tag and fails to load.

**Single-resource-type cadence for Step 1:**

- Ask about exactly **one** resource type at a time. Do not batch multiple types into one prompt.
- **Ask ALL / NONE / SOME first.** Do **not** enumerate or query any names up front. For ALL or NONE, record the answer and move on — no enumeration is needed.
- **Only when the user answers SOME**, then gather names:
  - If you can query the live APIM instance, list that type's names from Azure to help the user choose.
  - Otherwise, ask the user to provide the names/patterns. Do **not** invent names or pull them from the local artifacts.
- When the user answers a type unambiguously, record the decision and move to the next type.
- **Update `configuration.extractor.yaml` immediately after each decision that affects the file** (SOME or NONE adds/updates that type's section; ALL means no change since the type is omitted). Keep the file in sync as you go rather than waiting until the end.
- Only pause for clarification when the answer is ambiguous.

Resource types to consider (ask only about types that exist in the instance/artifacts or that the user mentions):

`apis`, `products`, `namedValues`, `backends`, `loggers`, `diagnostics`, `tags`, `versionSets`, `policyFragments`, `gateways`, `groups`, `subscriptions`, `schemas`, `policies`, `workspaces`.

> **APIs can be filtered at the sub-resource level.** Whenever `apis` is SOME and specific API names are listed in the filter, **ask about each listed API's sub-resources** — `operations`, `diagnostics`, `schemas`, and `releases`. The user may want everything for that API, or only a subset (for example, a single revision or release). Omit a sub-filter to include all of that sub-type; set it to `[]` to exclude all.

> **Workspaces apply only if the APIM instance uses workspaces.** Skip this type entirely if there are no workspaces. When a user wants SOME for `workspaces`, each workspace can also be narrowed by its own sub-resources (`apis`, `backends`, `diagnostics`, `groups`, `loggers`, `namedValues`, `policyFragments`, `products`, `schemas`, `subscriptions`, `tags`, `versionSets`). Omit a sub-filter to include all of that sub-type; set it to `[]` to exclude all. Only offer this depth if the user wants it.

> **Service-level `policies` is effectively a single global policy.** For this type, ask only **include (ALL)** or **exclude (NONE)** — SOME does not apply.

After all types are decided, summarize the per-type decisions and **STOP for confirmation** before generating YAML.

---

## Step 2 — Propose a Filter Strategy

Based on the recorded decisions:

1. Recommend the smallest filter that safely captures the intended scope (remember: omitted types are fully extracted, so only NONE/SOME types appear in the file).
2. Explain any tradeoffs between broad and narrow filters.
3. Call out any risk of accidentally excluding required dependencies — for example, excluding a named value or backend that an included API's policy references.

If the user is unsure, recommend a conservative filter that is easy to refine, then **STOP for confirmation**.

---

## Step 3 — Generate `configuration.extractor.yaml`

> **Note:** The file `configuration.extractor.yaml` may already exist if the user ran `apiops init`. If it exists, **update it in place** rather than overwriting unrelated content.

Create the YAML file content reflecting the confirmed decisions.

Requirements:

- **Preserve the existing schema comment.** If the file already has a `# yaml-language-server: $schema=...` line (as `apiops init` generates), keep it **exactly as-is** — it already points at the correct schema version. Only if the file has **no** schema comment, add one referencing the current schema version:
  `# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas/v1/extractor-config.schema.json`
- Output valid YAML.
- Only include resource types the user chose to narrow (SOME) or exclude (NONE). Leave ALL types out of the file.
- Use only names/patterns that exist in the artifacts or that the user provided — do not invent names.
- Add a short comment only when it explains a non-obvious choice.

Show the generated file and **STOP for confirmation** before treating it as final.

---

## Step 4 — Validate the Result

Before finishing:

1. Review the generated YAML for syntax issues and schema validity.
2. Confirm the filters align with the user's intended extraction scope, and that no type the user wanted is accidentally excluded or fully extracted.
3. Remind the user to run the extractor and inspect the artifact output.

If the extractor output is too broad or too narrow, help the user refine the filter file iteratively.

