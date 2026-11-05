# Filtering Resources

By default, `apiops extract` pulls every resource from your APIM instance and `apiops publish` publishes every artifact in the source directory. For large instances or multi-team setups, you can use the same YAML filter file to limit either operation to specific resources.

## Why Filter?

- **Speed** — Extract only what your team owns instead of hundreds of APIs
- **Isolation** — Each team manages its own APIs in separate repos or branches
- **Noise reduction** — Avoid cluttering PRs with unrelated changes
- **Permissions** — Limit who sees what in version control

---

## Quick Start

1. Create a filter file:

```yaml
# configuration.extractor.yaml
apis:
  - petstore-api
  - orders-api
```

2. Pass it to extract:

```bash
apiops extract \
  --resource-group my-rg \
  --service-name my-apim \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --filter configuration.extractor.yaml
```

`petstore-api`, `orders-api`, and their transitive dependencies are extracted — along with every backend, named value, product, tag, workspace, and every other resource type, because those keys are omitted and therefore default to "include all". To narrow the extract to just these APIs, see [How To: Extract Just One API](#how-to-extract-just-one-api) below.

The same filter can limit publishing to a subset of the extracted artifacts:

```bash
apiops publish \
  --resource-group my-rg \
  --service-name my-apim \
  --filter configuration.extractor.yaml
```

Referenced dependencies are included by default; add `--no-transitive` to publish only direct filter
matches.

---

## How To: Extract Just One API

Each top-level filter key is **independent**. Setting `apis:` narrows only the `apis` type — it does not implicitly exclude other resource types. Every key that is **omitted** from the file defaults to "include all resources of that type".

To extract a single API (plus whatever transitive dependencies it needs) and nothing else, set every other type to `[]`:

```yaml
# configuration.extractor.yaml — extract only my-own-api and its transitive deps
apis:
  - my-own-api
backends: []
namedValues: []
products: []
tags: []
versionSets: []
loggers: []
diagnostics: []
groups: []
policyFragments: []
gateways: []
schemas: []
subscriptions: []
policies: []
policyRestrictions: []
documentations: []
workspaces: []
```

With transitive resolution enabled (the default), the resources `my-own-api` depends on — such as the backends, named values and policy fragments its policies reference, its version set, its tags, and its diagnostics' loggers — are still pulled in automatically, even though those keys are set to `[]`. See [Transitive Dependency Behavior](#transitive-dependency-behavior) for the full list. Use `--no-transitive` to disable that behavior.

The three states for every key are:

| Value | Meaning |
|-------|---------|
| Key omitted | Include **all** resources of that type (default) |
| `key: []` | Include **none** of that type |
| `key: [name1, name2]` | Include only the named resources (case-insensitive, supports `*` and `?` wildcards) |

---

## IDE Autocomplete (JSON Schema)

Add yaml-language-server comment at the top of your override file. Requires yaml language extension in VSCode.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas/v1/extractor-config.schema.json
```

The schema validates field names, array structure, and sub-resource filters. It is published at [`schemas/v1/extractor-config.schema.json`](https://github.com/Azure/apiops-cli/blob/main/schemas/v1/extractor-config.schema.json).

---

## Filter YAML Format

The filter file is a YAML document where each key is a resource type and the value is an array of resource names:

```yaml
# configuration.extractor.yaml

# APIs to extract (by display name or API ID)
apis:
  - petstore-api
  - orders-api

# Backends to include
backends:
  - orders-backend

# Products to include
products:
  - starter
  - enterprise

# Named values to include
namedValues:
  - api-key
  - connection-string

# Leave sections out (or comment them) to extract ALL of that type
# loggers:
#   - appinsights
```

**Rules:**
- Each field is optional — omit it to extract all resources of that type
- Simple fields must be an array of strings
- `apis` and `workspaces` also accept nested object entries for sub-resource filtering (see below)
- Names are matched case-insensitively against APIM resource names
- Wildcard patterns are supported — `*` matches any characters, `?` matches a single character (see below)
- Exact names and wildcard patterns can be mixed in the same array
- Entries beginning with `!` are **exclusions** — see [Excluding resources with `!`](#excluding-resources-with-) below
- An empty file extracts everything (same as no filter)
- An empty array (`[]`) excludes ALL resources of that type

---

## Wildcard Pattern Matching

Filter entries support glob-style wildcard patterns for matching multiple resources by naming convention:

| Wildcard | Meaning | Example |
|----------|---------|---------|
| `*` | Matches zero or more characters | `prod-*` matches `prod-api`, `prod-users` |
| `?` | Matches exactly one character | `api-v?` matches `api-v1`, `api-v2` but not `api-v10` |

### Examples

```yaml
apis:
  - '*-test'          # All APIs ending with -test
  - 'prod-*'          # All APIs starting with prod-
  - '*-internal-*'    # All APIs containing -internal-
  - 'v2-*-api'        # APIs following v2-{name}-api pattern
  - 'echo-api'        # Exact names and patterns can be mixed

products:
  - 'test-*'          # All test products
  - '*-starter'       # All starter tier products

backends:
  - 'backend-*-prod'  # All production backends

namedValues:
  - '*-connection-string'  # All connection string named values
```

Wildcard matching is case-insensitive, just like exact matching. Special characters in resource names (e.g., dots in `my.api.v1`) are treated literally — `my.api.*` matches `my.api.test` but not `myXapiXtest`.

---

## Excluding resources with `!`

Any filter entry whose first character is `!` is treated as an **exclusion**. Exclusions are applied *after* inclusions for the same list, so you can write patterns like "include everything matching this shape, except these specific ones."

Semantics:

- `!` must be the **first character** of the entry to count as negation. `foo!bar` is a literal name.
- The rest of the entry is a normal filter value — exact name or wildcard pattern, matched case-insensitively.
- A resource is included iff at least one inclusion matches it **and** no exclusion matches it.
- A list containing only exclusions is treated as "include everything, then subtract" — equivalent to prepending an implicit `*`.
- Exclusions respect the same semantics as inclusions: they match API root names (stripping revision suffixes), and excluding a parent (Api, Product, Gateway, Workspace) cascades to its children.

> **Always quote `!`-prefixed entries in YAML.** An unquoted leading `!` (e.g. `- !prod-legacy-billing`) is parsed by YAML as a **tag** and produces an "unknown tag" error before the filter code ever sees the value. Wrap the entry in single or double quotes, exactly like the examples in this guide: `- '!prod-legacy-billing'`.

### Examples

```yaml
# Include all prod-* APIs except one specific legacy API and any deprecated variants
apis:
  - 'prod-*'
  - '!prod-legacy-billing'
  - '!prod-*-deprecated'

# Include every backend except the shared infra ones
backends:
  - '*'
  - '!shared-monitoring'
  - '!shared-*-infra'

# Include every named value except Key Vault-backed ones (pure-exclusion list)
namedValues:
  - '!keyvault-*'
```

Exclusions work anywhere a string list is accepted, including nested API and workspace sub-filter entries:

```yaml
apis:
  - 'my-api':
      operations:
        - 'get-*'
        - '!get-internal-*'   # keep all get-* operations except internal ones
```

---

## Nested Sub-Resource Filtering

### API sub-resource filters

For APIs, you can control which sub-resources (operations, diagnostics, schemas, releases, tag descriptions) are extracted. Use an object entry instead of a plain string:

```yaml
apis:
  - petstore-api                  # Simple: include all sub-resources
  - orders-api:                   # Nested: control sub-resources
      operations:
        - get-order
        - create-order
      diagnostics:
        - applicationinsights
      schemas: []                 # Empty = exclude ALL schemas
      releases:
        - v1-release
      tagDescriptions: []         # By name, as under apis/<api>/tagDescriptions/
```

**Sub-filter rules:**
- If a sub-resource key is **omitted**, all sub-resources of that type are included
- If a sub-resource key is an **empty array** (`[]`), all sub-resources of that type are excluded
- If a sub-resource key lists **names**, only those sub-resources are included

#### One sub-filter for many APIs

The key of a nested entry can be a wildcard pattern (`*`, `?`) instead of an API name. Like a plain pattern, it selects the matching APIs, and its sub-filter applies to each of them. For example, to extract every API without its operations, schemas or tag descriptions:

```yaml
apis:
  - '*':
      operations: []
      schemas: []
      tagDescriptions: []
```

An entry keyed by an API's name takes precedence over a pattern; otherwise the first matching pattern applies. Quote patterns that start with `*` so YAML reads them as strings.

During extraction, the `operations` filter also applies to the API's OpenAPI specification
(`specification.yaml` or `specification.json`, including Swagger 2.0). Excluded operations
are removed from the specification, and paths with no remaining operations are removed.
Shared definitions and metadata on retained paths are preserved. Omitting `operations`
leaves the specification unchanged; `operations: []` removes all operations from it.
GraphQL, WSDL, and WADL specifications are not filtered.

### Workspace sub-resource filters

The configuration format supports specifying which workspace-scoped resources to extract:

```yaml
workspaces:
  - team-a-workspace:             # Nested: control workspace resources
      apis:
        - team-api-1
        - team-api-2
      backends:
        - team-backend
      namedValues:
        - team-api-key
  - team-b-workspace              # Simple: extract all resources
```

Supported workspace sub-filter keys: `apis`, `backends`, `diagnostics`, `groups`, `loggers`, `namedValues`, `policyFragments`, `products`, `schemas`, `subscriptions`, `tags`, `versionSets`.

As for APIs, the key can be a wildcard pattern: `- 'team-*': { apis: [orders] }` selects every matching workspace and applies the sub-filter to each. An entry keyed by the workspace's name takes precedence over a pattern; otherwise the first matching pattern applies.

A sub-filter can't be attached to an exclusion (`- '!team-c': {...}`), for APIs or workspaces: the exclusion still applies, but its sub-filter is ignored with a warning.

---

## All 17 Filterable Resource Types

| Filter Field | APIM Resource | Example Values |
|-------------|---------------|----------------|
| `apis` | APIs | `petstore-api`, `orders-v2` |
| `backends` | Backends | `orders-backend`, `payment-service` |
| `products` | Products | `starter`, `enterprise`, `internal` |
| `namedValues` | Named Values | `api-key`, `db-connection-string` |
| `loggers` | Loggers | `appinsights-logger`, `eventhub-logger` |
| `diagnostics` | Diagnostics | `applicationinsights`, `azuremonitor` |
| `tags` | Tags | `production`, `beta`, `internal` |
| `policyFragments` | Policy Fragments | `rate-limit-fragment`, `cors-policy` |
| `gateways` | Self-hosted Gateways | `on-prem-gateway`, `edge-gateway` |
| `versionSets` | API Version Sets | `orders-version-set` |
| `groups` | Groups | `developers`, `partners`, `admins` |
| `subscriptions` | Subscriptions | `team-a-subscription` |
| `schemas` | Global Schemas | `shared-error-schema` |
| `policies` | Service-level Policies | `policy` |
| `policyRestrictions` | Policy Restrictions | `no-external-calls` |
| `documentations` | Documentation | `getting-started`, `changelog` |
| `workspaces` | Workspaces | `team-a-workspace`, `team-b-workspace` |

---

## Transitive Dependency Behavior

When you filter resources, `apiops extract` and `apiops publish` automatically include the resources the selected ones depend on. This is **transitive dependency resolution** — it keeps the extracted artifacts self-contained and publishable. Dependencies are followed until nothing new is found, so a pulled-in resource's own dependencies are included too.

### What Gets Auto-Included

| Selected resource | Includes |
|-------------------|----------|
| Any policy (service, API, operation, GraphQL resolver, product) and policy fragment | Named values referenced as `{{displayName}}`; backends named by `<set-backend-service backend-id>`, `<llm-content-safety backend-id>` and `embeddings-backend-id` on the semantic cache lookup policies; fragments named by `<include-fragment fragment-id>`; loggers named by `<log-to-eventhub logger-id>`; schemas named by validate-content's `<content schema-id>` |
| API | Its version set, and the tags it is linked to |
| Diagnostic (service-level or on an API) | The logger it sends data to (`loggerId`) |
| Logger, backend | Named values referenced in their credentials |
| Backend pool | Its member backends |
| Product | The groups and tags it is linked to |

A reference written as a policy expression (`backend-id="@(...)"`) is not followed, because its value is only known at run time. One set to a named value (`backend-id="{{backend-name}}"`) pulls in the named value and the resource its value names, in the same scope (except `<include-fragment fragment-id>`, where APIM doesn't substitute named values); publish reads the value with your `--overrides` applied, so each environment gets the resource its own value names. A named value that is published also brings the resource its value names whenever any policy or fragment in the source uses it that way, even one the filter leaves out: APIM checks every policy on the target that uses a named value when its value changes. A resource the filter excludes by name, or that isn't in the source, isn't published, so it has to exist on the target already. When a policy uses a named value to name a backend, logger or schema that is published in the same run, publish creates that resource before it updates the named value, and publishes policy fragments after it, since APIM rejects a named value change that would leave a policy using it pointing at a resource that doesn't exist. A secret or Key Vault named value's value isn't known, so the resource it names isn't pulled in; add that resource to the filter.

A `{{...}}` reference, in a policy or in credentials, names a named value by its display name, as APIM does; when no named value has that display name, it is read as a resource name. The `namedValues` list and its exclusions (`'!name'`) use the resource name, which can differ from the display name. References inside XML comments are ignored. Inside a `<set-body template="liquid">` body, a `{{name}}` is followed only when a named value has that name: APIM substitutes those there and leaves every other `{{ ... }}` (`{{body.id}}`, `{{ name }}`, `{{x | upcase}}`) to Liquid, so those are skipped without an error.

A resource the filter excludes by name (`'!name'`) is never pulled in, and links to it are not extracted: an API's or product's link to an excluded tag, or a product's link to an excluded group. Built-in groups (`administrators`, `developers`, `guests`) exist at service level in every APIM instance, so they are not pulled in either; a product's links to them are published only when the filter includes them, as for any group. The exception is the link to `administrators`, which APIM adds to every product itself: it is published whatever the `groups` filter says, unless the filter excludes `administrators` by name.

**Not included:** the products, gateways and subscriptions an API is linked to, and the APIs a product contains. These are independent resources, not dependencies; add them to the filter to include them. On publish, links to APIs or products outside the publish set are skipped.

> **Logger keys:** APIM stores an Application Insights logger's key as an auto-generated secret named value, named with a 24-character hex ID (its display name is `Logger-Credentials--<id>`). It is pulled in with the logger and extracted with its value redacted. Publish skips it unless you provide an override for it: an instance that already has the logger already has its key, but on a new instance the logger can't be published without one. See [Logger credentials with auto-generated named values](environment-overrides.md#logger-credentials-with-auto-generated-named-values).

### Example

Given this filter:

```yaml
apis:
  - petstore-api
backends: []
namedValues: []
policyFragments: []
loggers: []
tags: []
products: []
```

If `petstore-api` has a policy that references:
- Backend `petstore-backend` → **auto-included**
- Named value `petstore-api-key` → **auto-included**
- Policy fragment `rate-limit-fragment` → **auto-included**

And `petstore-api`:
- has a diagnostic that sends data to logger `appinsights` → **auto-included**
- is tagged `production` → **auto-included**
- is in product `starter` → **not included**; add `starter` to `products` to include it

### Why Transitive Matters

Without transitive resolution, publishing the extracted artifacts to a new APIM instance would fail — the API references a backend that doesn't exist, a named value that's missing, or a policy fragment that can't be found.

---

## Disabling Transitive Dependencies

Use `--no-transitive` to extract **only** the explicitly listed resources:

```bash
apiops extract \
  --resource-group my-rg \
  --service-name my-apim \
  --subscription-id 00000000-0000-0000-0000-000000000000 \
  --filter configuration.extractor.yaml \
  --no-transitive
```

**When to use `--no-transitive`:**
- You manage dependencies separately (e.g., shared backends are in a different repo)
- You want a minimal extract and will handle missing references manually
- Debugging — to see exactly what was explicitly filtered

> ⚠️ **Caution:** Extracted artifacts without transitive dependencies may not be publishable standalone. You'll need to ensure all referenced resources exist in the target APIM instance.

---

## Common Patterns

### Single API Team

A team that owns one or two APIs:

```yaml
# configuration.extractor.yaml
apis:
  - orders-api
  - orders-admin-api
```

Transitive dependencies (backends, named values, policy fragments, version sets, tags and loggers) are auto-included.

### Product-Focused Extract

Extract everything associated with a product:

```yaml
# configuration.extractor.yaml
products:
  - enterprise
```

> **Note:** Filtering by `products` extracts the product definition and its associations, but does **not** transitively include the APIs in that product. To include the APIs, add them to `apis` as well.

### Shared Infrastructure Team

A platform team managing cross-cutting resources:

```yaml
# configuration.extractor.yaml
namedValues:
  - global-api-key
  - rate-limit-threshold
  - cors-allowed-origins

policyFragments:
  - standard-rate-limit
  - cors-policy
  - auth-validation

loggers:
  - appinsights-logger

backends:
  - identity-service
```

### Full Extract Minus Specific Resources

Use quoted `!`-prefixed entries to exclude specific resources. A list containing only exclusions includes every resource that does not match them; combine `'*'` with exclusions when you want to make the include-all intent explicit. See [Excluding resources with `!`](#excluding-resources-with-) for examples and matching rules.

### Pattern-Based Team Filtering

Using wildcard patterns to extract resources by naming convention:

```yaml
# configuration.extractor.yaml
apis:
  - 'team-payments-*'     # All APIs owned by the payments team
namedValues:
  - 'payments-*'          # All named values for payments
backends:
  - '*-payments-*'        # All backends related to payments
```

---

## Tips

- **Start broad, narrow later** — Begin with no filter to see what's in your APIM instance, then create a filter for your team's slice
- **One filter per team** — In multi-team setups, each team maintains its own `configuration.extractor.yaml`
- **Commit the filter file** — Keep it in version control alongside your artifacts so CI/CD pipelines can use it
- **Case-insensitive matching** — Filter values are matched case-insensitively against APIM resource names
- **Use wildcard patterns** — `*` and `?` patterns let you match resources by naming convention instead of listing each name individually
- **Validate early** — The config loader validates filter entries and will throw `Failed to load filter config` on invalid YAML. Unknown top-level keys produce a warning.

---

## Related

- [apiops extract](../commands/extract.md) — extract command reference
- [Artifact Directory Format](../reference/artifact-format.md) — what the extracted files look like
- [Environment Overrides](environment-overrides.md) — per-environment configuration
- [Configuration Reference](../reference/configuration.md) — config priority chain
- [APIM Glossary](../reference/apim-glossary.md) — APIM resource terminology

---

## Copilot-Assisted Configuration

If you ran `apiops init`, a Copilot prompt file was generated at `.github/prompts/apiops-configure-filter.prompt.md`. Open it in VS Code and ask GitHub Copilot to help you configure your filter — it will walk you through selecting resources interactively.

If you didn't run `apiops init`, see the [Prompt files guide](./prompt-files.md) for instructions on downloading and setting up prompt files manually.
