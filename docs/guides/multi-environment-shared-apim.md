# Multi-Environment Publish to a Shared APIM Instance

This guide covers how to publish multiple environments (dev, qa, prod) to a **single Azure API Management instance** using the `environment:` block in your override files.

For standard single-APIM-per-env deployments, you do not need this guide — see [Environment Overrides](environment-overrides.md).

## When to use this

Use the shared-APIM pattern when:

- You want to reduce cost by running dev, qa, and prod APIs on one APIM instance.
- You need to demo or test multiple environments side-by-side on the same gateway endpoint.
- You are operating a Developer or Consumption tier APIM where creating per-environment instances is impractical.

**Do not use this pattern when:**

- Each environment has its own dedicated APIM instance (the default, simpler approach).
- Your security or compliance policy requires full network isolation between environments.
- You need independent SLA guarantees per environment — a shared APIM is a shared failure domain.

The trade-off is straightforward: shared APIM saves cost and consolidates gateway management, but all environments compete for the same capacity and any APIM-level outage affects all of them simultaneously.

## How it works

All artifact files on disk use **canonical names** — the bare names extracted from your source-of-truth APIM (e.g., `petstore-api`, `my-backend`). At publish time, `apiops publish` reads the `environment:` block from your override file and applies a prefix and/or suffix to every resource name before sending it to APIM.

For example, with `namePrefix: "dev-"`, the canonical artifact `petstore-api` is deployed as `dev-petstore-api`. The prod publish with `namePrefix: "prod-"` deploys the same artifact as `prod-petstore-api`. Both coexist on the shared APIM without colliding.

Cross-references inside resources — policy `{{token}}` references, fragment IDs, backend IDs, subscription scopes, API release API IDs, and association links — are rewritten automatically to use the affixed names. You write your artifacts and overrides using canonical names throughout; the tool handles renaming at the boundary.

## Prerequisites

You need a **canonical source-of-truth APIM** — a dedicated APIM instance (or clean committed artifacts) that contains your API configuration with bare, unprefixed names. Extract from this instance to produce your artifact files.

> **Warning: Do not extract from the shared APIM.**
> Extracting from a shared APIM produces mixed-environment artifacts — you will get `dev-petstore-api`, `prod-petstore-api`, and similar prefixed names in your artifact directory. Those prefixed names become the canonical names in your artifacts, and the affix logic will then double-prefix them on the next publish (e.g., `dev-dev-petstore-api`). Always extract from a dedicated source-of-truth APIM with clean, unprefixed names.

```bash
# Extract from your source-of-truth APIM (dedicated, unprefixed)
apiops extract \
  --resource-group rg-source \
  --service-name apim-source \
  --output ./apim-artifacts
```

## Setup

Add an `environment:` block to each environment's override file. The block is a top-level sibling of the resource sections (`apis`, `backends`, etc.).

```yaml
# configuration.dev.yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas/v1/override-config.schema.json
environment:
  namePrefix: "dev-"
  apiPathPrefix: "dev/"

apis:
  - name: petstore-api          # canonical name — no prefix here
    properties:
      serviceUrl: https://petstore-dev.contoso.com

backends:
  - name: petstore-backend      # canonical name
    properties:
      url: https://petstore-dev.contoso.com
```

```yaml
# configuration.prod.yaml
environment:
  namePrefix: "prod-"
  apiPathPrefix: "prod/"

apis:
  - name: petstore-api          # same canonical name
    properties:
      serviceUrl: https://petstore.contoso.com

backends:
  - name: petstore-backend
    properties:
      url: https://petstore.contoso.com
```

All override `name` values must be the **canonical (unprefixed) name**, matching the artifact on disk. The prefix is applied by the tool at publish time — not by you in the override file.

### Available fields

| Field | Type | Description |
|---|---|---|
| `namePrefix` | `string` | Prepended to resource names for types in `appliesTo`. |
| `nameSuffix` | `string` | Appended to resource names for types in `appliesTo`. |
| `appliesTo` | `string[]` | Resource type names to affix. Omit to use the default set. |
| `apiPathPrefix` | `string` | Prepended to each API's `properties.path`. Not applied when a per-API `path` override is present. |

You can use `namePrefix`, `nameSuffix`, or both simultaneously. For example, `namePrefix: "dev-"` and `nameSuffix: "-v2"` produces `dev-petstore-api-v2`.

> **⚠️ At least one name affix is required.** If you specify an `environment:` block, you **must** set at least one of `namePrefix` or `nameSuffix`. A block with only `apiPathPrefix` (or with no fields set) is rejected at publish time with an error.
>
> **Why:** Without a name affix, resource names collide across environments on the shared APIM instance. Worse, `apiops publish --delete-unmatched` would treat every other environment's resources as stale and delete them — silently destroying the shared instance. Path-only isolation is intentionally not supported for this reason.
>
> **Use a separator character** in your affix (e.g., `"dev-"` not `"dev"`, or `"-dev"` not `"dev"`). This prevents partial-name matches during `--delete-unmatched` — a `namePrefix` of `"dev"` (no separator) would match `developer-*`, `development-*`, and any other resources whose canonical names happen to start with `"dev"`.
>
> If you don't need a name affix, remove the `environment:` block entirely and publish under canonical names (single-environment mode).

## What gets affixed

### Default affixed types

When `appliesTo` is omitted, the following resource types receive the prefix/suffix:

| Resource type | `appliesTo` value |
|---|---|
| Api | `Api` |
| Product | `Product` |
| NamedValue | `NamedValue` |
| Backend | `Backend` |
| Logger | `Logger` |
| PolicyFragment | `PolicyFragment` |
| VersionSet | `VersionSet` |
| Tag | `Tag` |
| Group | `Group` |
| Subscription | `Subscription` |
| Workspace | `Workspace` |

### Opt-in types

The following types are **not** affixed by default but can be added to `appliesTo`:

| Resource type | `appliesTo` value | Notes |
|---|---|---|
| Gateway | `Gateway` | Self-hosted gateways. |
| Diagnostic | `Diagnostic` | Service-level diagnostics (e.g., `applicationinsights`). Usually a singleton per APIM — affix carefully. |
| GlobalSchema | `GlobalSchema` | Service-wide shared schemas. |
| PolicyRestriction | `PolicyRestriction` | Policy restriction rules. |
| Documentation | `Documentation` | API documentation entries. |

### Types that are never affixed

Some resource types cannot be affixed because they are singletons, derived from their parent, or association links whose identity is fully determined by their parent names:

- **Singletons:** `ServicePolicy`, `ApiPolicy`, `ProductPolicy`, `ApiOperationPolicy`, `GraphQLResolverPolicy`, `ApiWiki`, `ProductWiki`, `McpServer`
- **Association children** (affixed via parent): `ProductApi`, `ProductGroup`, `ProductTag`, `GatewayApi`, `ApiTag`, `ApiDiagnostic`
- **Sub-resource children** (affixed via parent API): `ApiOperation`, `ApiSchema`, `ApiRelease`, `ApiTagDescription`, `GraphQLResolver`

Including any of these in `appliesTo` is a validation error.

## Customising `appliesTo`

### Adding opt-in types

```yaml
environment:
  namePrefix: "dev-"
  appliesTo:
    - Api
    - Product
    - NamedValue
    - Backend
    - Logger
    - PolicyFragment
    - VersionSet
    - Tag
    - Group
    - Subscription
    - Workspace
    - Gateway       # opt-in: affix self-hosted gateway names too
```

### Narrowing the default set

To affix only APIs and backends (and nothing else):

```yaml
environment:
  namePrefix: "dev-"
  appliesTo:
    - Api
    - Backend
```

Any type not listed is left with its canonical name on the shared APIM, which means all environments share the same named value, product, etc. Only do this intentionally — shared resources must be compatible across environments.

## Precedence rules

### Resource names

An explicit `name` in an override entry **always** refers to the canonical (unprefixed) name. The `environment:` block affix is applied after override properties are merged. You never write prefixed names in override files.

### API path (`apiPathPrefix`)

- `apiPathPrefix` is applied to `properties.path` for every API in `appliesTo`.
- If a specific API entry in the override file includes a `properties.path` value, that **explicit override wins** and `apiPathPrefix` is not applied to that API.
- The two do not stack — an explicit `path` override completely replaces the prefix behavior for that API.

```yaml
environment:
  namePrefix: "dev-"
  apiPathPrefix: "dev/"        # applied to all APIs by default

apis:
  - name: petstore-api
    properties:
      serviceUrl: https://petstore-dev.contoso.com
      # No path override → apiPathPrefix applies → deployed path is "dev/petstore"

  - name: legacy-api
    properties:
      serviceUrl: https://legacy-dev.contoso.com
      path: "internal/legacy"  # explicit override → apiPathPrefix NOT applied
```

### NamedValue displayName

NamedValues have both a `name` (resource key) and a `displayName` (the `{{token}}` identifier used in policy XML). When `NamedValue` is in `appliesTo`:

- Both the resource name **and** the displayName receive the affix.
- This ensures `{{my-token}}` in a policy becomes `{{dev-my-token}}` for dev — cross-env policy isolation is maintained automatically.
- If you set an explicit `displayName` in a NamedValue override entry, that value is used as-is (no affix applied to it).

## Cross-reference rewrites (automatic)

When `appliesTo` includes the relevant types, `apiops publish` rewrites the following references in artifacts before sending them to APIM. You do not need to update artifact files or override files manually.

| Reference | Location | How it is rewritten |
|---|---|---|
| `{{namedValueToken}}` | Policy XML | Token rewritten to affixed displayName when `NamedValue ∈ appliesTo` and the named value artifact exists. Unknown tokens pass through unchanged. |
| `fragment-id="..."` | Policy XML `<include-fragment>` | Fragment ID rewritten when `PolicyFragment ∈ appliesTo`. |
| `backend-id="..."` | Policy XML `<set-backend-service>` | Backend ID rewritten when `Backend ∈ appliesTo`. |
| Subscription `scope` | ARM subscription properties | Trailing segment rewritten when the referenced type (Api or Product) is in `appliesTo`. |
| ApiRelease `apiId` | ARM release properties | Api ID segment rewritten when `Api ∈ appliesTo`. |
| ProductApi association | ARM resource path | Both product and API name segments rewritten per `appliesTo`. |
| ProductGroup association | ARM resource path | Both product and group name segments rewritten per `appliesTo`. |
| GatewayApi association | ARM resource path | Gateway and API name segments rewritten per `appliesTo`. |
| API `properties.path` | ARM API properties | Prefix applied unless explicit path override present (see [Precedence rules](#precedence-rules)). |

## `--delete-unmatched` safety

When you run `apiops publish --delete-unmatched` against a shared APIM, the delete pass is **namespace-scoped**: only resources whose name matches the current environment's prefix/suffix pattern are candidates for deletion.

A publish with `namePrefix: "dev-"` will only delete resources that start with `dev-`. Resources named `prod-*`, `qa-*`, or any other prefix are invisible to the delete pass and are never touched.

> **Warning: Do not drop the prefix mid-life.**
>
> If you initially deploy an environment with `namePrefix: "dev-"` and later remove or change the prefix in your override file, `--delete-unmatched` can no longer identify which resources belong to that environment. It will see all resources without the old prefix as candidates for deletion, potentially removing resources from other environments.
>
> If you need to rename or remove the prefix, do so in a controlled migration: first remove `--delete-unmatched` from your pipeline, rename/remove the prefix, republish all resources, then manually delete the old prefixed resources.

## Worked end-to-end example

This example shows a three-environment pipeline (dev, qa, prod) all publishing to a single APIM instance named `apim-shared`.

### Repository structure

```text
project/
├── apim-artifacts/
│   ├── apis/
│   │   └── petstore-api/
│   │       └── apiInformation.json
│   ├── backends/
│   │   └── petstore-backend/
│   │       └── backendInformation.json
│   └── namedValues/
│       └── api-key/
│           └── namedValueInformation.json
├── configuration.dev.yaml
├── configuration.qa.yaml
└── configuration.prod.yaml
```

### Override files

```yaml
# configuration.dev.yaml
environment:
  namePrefix: "dev-"
  apiPathPrefix: "dev/"

apis:
  - name: petstore-api
    properties:
      serviceUrl: https://petstore-dev.contoso.com

backends:
  - name: petstore-backend
    properties:
      url: https://petstore-dev.contoso.com

namedValues:
  - name: api-key
    properties:
      value: "{#[DEV_API_KEY]#}"
```

```yaml
# configuration.qa.yaml
environment:
  namePrefix: "qa-"
  apiPathPrefix: "qa/"

apis:
  - name: petstore-api
    properties:
      serviceUrl: https://petstore-qa.contoso.com

backends:
  - name: petstore-backend
    properties:
      url: https://petstore-qa.contoso.com

namedValues:
  - name: api-key
    properties:
      value: "{#[QA_API_KEY]#}"
```

```yaml
# configuration.prod.yaml
environment:
  namePrefix: "prod-"
  apiPathPrefix: "prod/"

apis:
  - name: petstore-api
    properties:
      serviceUrl: https://petstore.contoso.com

backends:
  - name: petstore-backend
    properties:
      url: https://petstore.contoso.com

namedValues:
  - name: api-key
    properties:
      value: "{#[PROD_API_KEY]#}"
```

### Extract from source-of-truth

```bash
apiops extract \
  --resource-group rg-source \
  --service-name apim-source \
  --output ./apim-artifacts
```

### Publish each environment

```bash
# Dev
apiops publish \
  --resource-group rg-shared \
  --service-name apim-shared \
  --source ./apim-artifacts \
  --overrides configuration.dev.yaml \
  --delete-unmatched

# QA
apiops publish \
  --resource-group rg-shared \
  --service-name apim-shared \
  --source ./apim-artifacts \
  --overrides configuration.qa.yaml \
  --delete-unmatched

# Prod
apiops publish \
  --resource-group rg-shared \
  --service-name apim-shared \
  --source ./apim-artifacts \
  --overrides configuration.prod.yaml \
  --delete-unmatched
```

### What lands on the shared APIM

After all three publishes, the shared APIM contains:

| Resource type | Dev | QA | Prod |
|---|---|---|---|
| API | `dev-petstore-api` (path: `dev/petstore`) | `qa-petstore-api` (path: `qa/petstore`) | `prod-petstore-api` (path: `prod/petstore`) |
| Backend | `dev-petstore-backend` | `qa-petstore-backend` | `prod-petstore-backend` |
| NamedValue | `dev-api-key` | `qa-api-key` | `prod-api-key` |

Each environment's resources are fully isolated by namespace. A request to `https://apim-shared.azure-api.net/dev/petstore/pets` routes to the dev backend; `prod/petstore/pets` routes to prod.

## Troubleshooting

### Policy token `{{myThing}}` was not rewritten

**Cause:** Either `NamedValue` is not in `appliesTo`, or the artifact for `myThing` does not exist in the artifact directory.

**Fix:** Verify that:
1. `NamedValue` is included in `appliesTo` (or you are using the default set, which includes it).
2. A `namedValues/myThing/` artifact directory exists in your `--source` path.
3. The token name in the policy exactly matches the NamedValue's `displayName` in the artifact (case-sensitive).

Unknown tokens (no matching artifact) pass through unchanged and are left as-is in the deployed policy.

### Publish failed with duplicate path

**Cause:** Two environments are publishing to the same API path. This happens when `apiPathPrefix` is omitted or set to the same value for multiple environments.

**Fix:** Ensure each environment has a unique `apiPathPrefix`. If you intentionally share a path across environments (only one env active at a time), omit `apiPathPrefix` for that resource and manage path assignment manually via a per-API `path` override.

### `--delete-unmatched` removed resources from another environment

**Cause:** The environment whose resources were deleted did not have `namePrefix` or `nameSuffix` set, so its resources had no namespace prefix and were indistinguishable from unmanaged resources.

**Fix:** Every environment on a shared APIM **must** have a unique `namePrefix` or `nameSuffix`. Add the missing `environment:` block to the override file for the affected environment, republish it to restore the deleted resources, and ensure all subsequent publishes include the `environment:` block.

### I have a shared APIM for dev/qa but a dedicated APIM for prod

No special configuration is needed — the two patterns are independent and can be mixed across override files.

```yaml
# configuration.dev.yaml — shared APIM, env prefix required
environment:
  namePrefix: "dev-"
  apiPathPrefix: "dev/"
```

```yaml
# configuration.prod.yaml — dedicated APIM, no environment block needed
# No environment: block
apis:
  - name: petstore-api
    properties:
      serviceUrl: https://petstore.contoso.com
```

Publish each with its respective `--service-name` (shared APIM for dev/qa, dedicated APIM for prod). The `environment:` block is only interpreted during the publish where it appears.

## Limitations

- **Policy XML rewriting is regex-based.** The rewriter uses targeted regular expressions for `{{token}}`, `fragment-id="..."`, and `backend-id="..."` patterns. Tokens or attributes inside CDATA sections or XML comments may not be rewritten correctly. Avoid placing canonical resource name references inside CDATA blocks or comments in policy XML.
- **Workspace container is not affixed.** The Workspace resource name itself is never prefixed/suffixed, even if `Workspace` is in `appliesTo`. Resources *inside* a workspace are affixed normally via their parent workspace's name.
- **`ServicePolicy` and singleton types are never affixed.** The service-level policy, API policies, product policies, and operation policies derive their identity from their parent resource and are handled transitively — see [Types that are never affixed](#types-that-are-never-affixed).
- **No `--strip-prefix` for extraction.** There is no built-in flag to strip environment prefixes when extracting from a shared APIM. Always extract from a dedicated source-of-truth APIM with canonical names.
