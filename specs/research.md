# Research: APIops CLI Tool

**Phase**: 0 — Research | **Date**: 2026-04-06 | **Spec**: [spec.md](spec.md)

---

## R1: Azure APIM REST API Client Pattern

**Decision**: Raw `fetch()` with `@azure/identity` `DefaultAzureCredential` for token acquisition; custom thin wrapper for pagination, retry, and long-running operations.

**Rationale**: 
- v1 uses `Azure.Core.Pipeline` (C# SDK) which has no direct Node.js equivalent at the same abstraction level
- `@azure/core-rest-pipeline` exists but adds complexity for what is essentially `fetch()` + bearer token + pagination
- The APIM management API follows standard ARM patterns: `nextLink` pagination, `Retry-After` headers, `provisioningState` polling
- A thin wrapper (~100 LOC) over native `fetch()` keeps dependencies minimal and the code auditable

**Alternatives considered**:
- `@azure/arm-apimanagement` typed SDK: Rejected per Constitution VII (Forward Compatibility) — typed models lose unknown properties on round-trip
- `@azure/core-rest-pipeline`: Adds ~15 transitive deps for functionality we need ~3 functions from
- Raw `fetch()` without wrapper: Would duplicate pagination/retry logic across every call site

**Implementation notes**:
- Base URL: `https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{name}`
- API version: `2024-05-01` (latest stable), configurable via `AZURE_API_VERSION` env var (matching v1's `ARM_API_VERSION`)
- Auth: `DefaultAzureCredential.getToken("https://management.azure.com/.default")` → `Authorization: Bearer {token}`
- Pagination: Follow `nextLink` in response JSON, yield items from `value` array
- Retry: Respect `Retry-After` header, exponential backoff for 429/5xx, max 3 retries
- Long-running ops: Poll `provisioningState` for PUT responses returning 201/202

---

## R2: Resource Dependency Graph & Ordering

**Decision**: Static dependency graph defined as a DAG (directed acyclic graph) data structure; topological sort determines extraction and publish order dynamically.

**Rationale**:
- v1 uses hardcoded order in `App.cs` (14 extraction phases, 22 publish phases) — fragile; adding new resource types requires manual insertion
- A DAG with topological sort is self-documenting, extensible, and automatically handles new types
- Enables correct parallel extraction: independent types can be extracted concurrently (Constitution spec FR-014)

**Alternatives considered**:
- Hardcoded order (v1 approach): Rejected — error-prone, no parallelism insight, requires manual maintenance
- Runtime dependency detection (parse policies for references): Too slow and unreliable; policy XML parsing is fragile

**Resource types and dependencies** (from v1 analysis + APIM REST API 2024-05-01 review):

| Resource Type | Dependencies (must exist first) |
|--------------|-------------------------------|
| NamedValue | — |
| Tag | — |
| Gateway | — |
| VersionSet | — |
| Backend | — |
| Logger | — |
| Group | — |
| GlobalSchema | — |
| PolicyRestriction | — |
| Documentation | — |
| Diagnostic | Logger |
| PolicyFragment | — |
| ServicePolicy | NamedValue, PolicyFragment |
| Product | — |
| ProductPolicy | Product, NamedValue, PolicyFragment |
| ProductGroup | Product, Group |
| ProductTag | Product, Tag |
| ProductApi | Product, API |
| ProductWiki | Product |
| API | VersionSet (optional) |
| ApiPolicy | API, NamedValue, PolicyFragment |
| ApiTag | API, Tag |
| ApiDiagnostic | API, Logger |
| ApiOperation | API |
| ApiOperationPolicy | ApiOperation, NamedValue, PolicyFragment |
| ApiSchema | API |
| ApiRelease | API |
| ApiTagDescription | API, Tag |
| ApiWiki | API |
| GraphQLResolver | API |
| GraphQLResolverPolicy | GraphQLResolver |
| GatewayApi | Gateway, API |
| Subscription | Product (optional), API (optional) |

**Extraction parallelism tiers** (from topological sort):
1. NamedValue, Tag, Gateway, VersionSet, Backend, Logger, Group, PolicyFragment, GlobalSchema, PolicyRestriction, Documentation (all independent)
2. Diagnostic, ServicePolicy, Product, API (depend on tier 1)
3. ProductPolicy, ProductGroup, ProductTag, ProductApi, ProductWiki, ApiPolicy, ApiTag, ApiDiagnostic, ApiOperation, ApiSchema, ApiRelease, ApiTagDescription, ApiWiki, GraphQLResolver, GatewayApi (depend on tier 2)
4. ApiOperationPolicy, GraphQLResolverPolicy, Subscription (depend on tier 3)

---

## R3: Artifact Directory Structure

**Decision**: Maintain v1-compatible directory layout with identical naming conventions.

**Rationale**:
- Constitution III (Configuration as Code) requires version-controllable artifacts
- Backward compatibility with existing v1 users' repositories is critical for adoption
- v1 layout is well-established and documented in the community

**Directory layout** (extended from v1 with new resource types):
```
{output}/
├── policy.xml                          # Service-level global policy
├── namedValues/{name}/namedValueInformation.json
├── tags/{name}/tagInformation.json
├── versionSets/{name}/versionSetInformation.json
├── backends/{name}/backendInformation.json
├── loggers/{name}/loggerInformation.json
├── diagnostics/{name}/diagnosticInformation.json
├── policyFragments/{name}/policyFragmentInformation.json
├── gateways/{name}/gatewayInformation.json
├── groups/{name}/groupInformation.json
├── subscriptions/{name}/subscriptionInformation.json
├── schemas/{name}/schemaInformation.json                    # Global schemas (NEW)
├── policyRestrictions/{name}/policyRestrictionInformation.json  # NEW
├── documentations/{name}/documentationInformation.json      # NEW
├── products/{name}/
│   ├── productInformation.json
│   ├── policy.xml
│   ├── apis.json
│   ├── groups.json
│   └── wiki.md                                              # Product wiki (NEW)
├── apis/{name}/
│   ├── apiInformation.json
│   ├── specification.{yaml|json|graphql|wsdl|wadl}
│   ├── policy.xml
│   ├── wiki.md                                              # API wiki (NEW)
│   ├── tags/
│   ├── diagnostics/
│   ├── schemas/{schemaName}/schemaInformation.json          # API schemas (NEW)
│   ├── releases/{releaseName}/releaseInformation.json       # API releases (NEW)
│   ├── tagDescriptions/{tagDescName}/tagDescriptionInformation.json  # NEW
│   ├── resolvers/{resolverName}/                            # GraphQL resolvers (NEW)
│   │   ├── resolverInformation.json
│   │   └── policy.xml
│   └── operations/{operationName}/policy.xml
└── workspaces/{name}/
    └── (mirrors service-level structure)
```

**Naming conventions**:
- Info files: `{resourceType}Information.json` (camelCase type name)
- Policies: `policy.xml` (extracted from JSON wrapper, raw XML)
- API specs: `specification.{ext}` (extension from content-type detection)
- Associations: `apis.json`, `groups.json` (JSON arrays of `{name}` objects)
- Revisions: `{apiName};rev={N}/` (literal semicolon in directory name)
- Directory names: camelCase matching ARM path segment names (e.g., `namedValues`, `policyFragments`, `versionSets`)

---

## R4: Filtering with Transitive Dependencies

**Decision**: Transitive dependency inclusion by default; `--no-transitive` flag to opt out (spec clarification C1).

**Rationale**:
- v1 does NOT resolve transitive dependencies — this is a known pain point where filtering `apiNames: [my-api]` silently drops required backends, named values, and tags
- Users frequently report broken publishes because filter didn't include policy-referenced resources
- Including transitive deps by default follows the principle of least surprise

**Implementation approach**:
1. Parse filter file → get explicit allowlist per resource type
2. Extract explicitly listed resources
3. For each extracted resource, scan for references to other resources:
   - API/operation policies → named values (`{{namedValue}}` syntax), backends (`set-backend-service`), policy fragments (`include-fragment`)
   - Products → API associations (from `apis.json`)
   - APIs → version set references (from `apiVersionSetId` property)
4. Add discovered dependencies to the extraction set
5. Repeat until no new dependencies found (fixed-point)
6. With `--no-transitive`: skip steps 3-5, behave like v1

**Reference detection patterns**:
- Named values in policies: `\{\{([^}]+)\}\}` regex on policy XML
- Backends in policies: `<set-backend-service backend-id="([^"]+)"` 
- Policy fragments: `<include-fragment fragment-id="([^"]+)"`
- Version sets: `apiVersionSetId` property in apiInformation.json

---

## R5: Named Values & Secret Safety

**Decision**: Extract named values with secret flag preserved but plain-text values redacted; publish supports override injection.

**Rationale**:
- v1 extracts secret values as plain text to disk — violates Constitution VIII (Secret & Credential Safety)
- APIM GET response for `secret: true` named values returns the actual value anyway (ARM API behavior)
- We must redact at extraction time to prevent secrets from entering git repositories

**Implementation**:
- **Extraction**: When `properties.secret === true`, replace `properties.value` with `"*** REDACTED ***"` in the written JSON file
- **KeyVault references**: Preserved as-is (the `keyVault.secretIdentifier` URL is not itself secret)
- **Publish**: Override file can inject runtime values; pipeline should use environment variables or Key Vault references
- **Logging**: Named value names logged at info level; values NEVER logged at any level
- **Output**: `--dry-run` output shows named value names but never values

---

## R6: Git Diff for Incremental Publish

**Decision**: Use `simple-git` npm package for git diff computation; `COMMIT_ID` environment variable triggers incremental mode (matching v1 contract).

**Rationale**:
- v1 uses LibGit2Sharp (native C# git library) — no Node.js equivalent
- `simple-git` wraps the `git` CLI (must be installed on PATH) — simpler than native bindings
- `isomorphic-git` is pure JS but lacks some diff features and is slower for large repos
- CI/CD pipelines always have `git` on PATH

**Alternatives considered**:
- `isomorphic-git`: Pure JS, no native deps, but slower and missing some features (rename detection, partial tree walks)
- `nodegit` (LibGit2 bindings): Native bindings are fragile across Node.js versions, painful to install in CI
- Shell out to `git diff`: Parsing text output is error-prone; `simple-git` provides structured output

**Implementation notes**:
- `COMMIT_ID` env var: When set, diff `COMMIT_ID~1..COMMIT_ID` to get changed files
- Changed file → resource type mapping: Parse file path against known directory structure
- Delete detection: Files present in `COMMIT_ID~1` tree but absent in `COMMIT_ID` tree
- Requires: `fetchDepth: 0` (full clone) or `fetchDepth: 2` (enough for single-commit diff)

---

## R7: CLI Framework (Commander.js)

**Decision**: Commander.js with subcommand pattern; each command in its own module.

**Rationale**:
- Commander is the most mature Node.js CLI framework (1.4B+ npm downloads)
- Native TypeScript support, ESM compatible
- Built-in help generation, option parsing, subcommand routing

**Alternatives considered**:
- `yargs`: Comparable features but more complex API for subcommands
- `oclif`: Full framework (Salesforce) — too heavy for our needs; enforces its own project structure
- `clipanion` (Yarn): Good TypeScript support but smaller ecosystem

**Command structure**:
```typescript
// src/cli/index.ts
program
  .name('apiops')
  .version(version)
  .option('--subscription-id <id>', 'Azure subscription ID')
  .option('--cloud <name>', 'Azure cloud environment', 'AzureCloud')
  .option('--api-version <version>', 'APIM REST API version', '2024-05-01')
  .option('--format <mode>', 'Output format (text|json)', 'text')
  .option('--verbose', 'Enable verbose output')
  .option('--otel <path>', 'OpenTelemetry configuration file')
  .option('--client-id <id>', 'Service principal client ID')
  .option('--client-secret <secret>', 'Service principal client secret')
  .option('--tenant-id <id>', 'Azure AD tenant ID')

program.command('extract')
  .description('Extract APIM configuration to local files')
  .requiredOption('--resource-group <rg>', 'Azure resource group')
  .requiredOption('--service-name <name>', 'APIM service name')
  .option('--output <dir>', 'Output directory', './apim-artifacts')
  .option('--filter <path>', 'Filter configuration YAML file')
  .option('--no-transitive', 'Disable transitive dependency inclusion')
  .action(extractAction)

program.command('publish')
  .description('Publish local files to APIM instance')
  .requiredOption('--resource-group <rg>', 'Azure resource group')
  .requiredOption('--service-name <name>', 'APIM service name')
  .option('--source <dir>', 'Source artifact directory', './apim-artifacts')
  .option('--overrides <path>', 'Environment overrides YAML file')
  .option('--dry-run', 'Show what would change without applying')
  .option('--delete-unmatched', 'Delete resources not in artifact directory')
  .action(publishAction)

program.command('init')
  .description('Initialize repository and CI/CD pipelines')
  .option('--ci <provider>', 'CI/CD provider (github-actions|azure-devops)')
  .option('--artifact-dir <dir>', 'APIM artifact directory', './apim-artifacts')
  .option('--environments <list>', 'Comma-separated environment names', 'dev,prod')
  .option('--non-interactive', 'Skip interactive prompts')
  .action(initAction)
```

---

## R8: Parallel Execution Strategy

**Decision**: Use `p-limit` for concurrency control with `Promise.allSettled` for parallel tier execution.

**Rationale**:
- spec requires cross-type parallel extraction (clarification C4)
- Need bounded concurrency to avoid overwhelming APIM rate limits (429s)
- `p-limit` is a tiny (1KB) concurrency limiter widely used in the ecosystem

**Implementation**:
- Default concurrency: 5 simultaneous resource type extractions
- Within a type: sequential (list + paginate for each item)
- Rate limit handling: 429 response → respect `Retry-After`, retry with backoff
- Error isolation: `Promise.allSettled` — one type failing doesn't abort others; errors collected and reported at end

---

## R9: OpenTelemetry Integration

**Decision**: `@opentelemetry/sdk-node` with auto-instrumentation for HTTP; `--otel <path>` accepts standard OTel config YAML file.

**Rationale**:
- spec requires structured logging to stderr + optional OTel export (clarification C5)
- Standard OTel env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`) for server config
- Config file can set resource attributes, exporter endpoint, and custom headers
- `--otel <path>` flag consistent with `--filter <path>` and `--overrides <path>` pattern

**Implementation**:
- When `--otel` not specified: No OTel SDK initialized, no overhead
- When `--otel <path>` specified: Read YAML config, initialize `NodeSDK` with OTLP exporter
- Traces: One span per resource type extraction/publish, child spans per individual resource
- Metrics: Resource count, duration, error count
- Azure Monitor: Users set `APPLICATIONINSIGHTS_CONNECTION_STRING` env var + use Azure Monitor OTel exporter in config

---

## R10: Testing Strategy

**Decision**: Vitest with three test tiers — unit, integration, contract.

**Rationale**:
- Constitution VI (Testability by Design) mandates interface-based abstractions testable at unit level
- v1 has zero unit tests — a key pain point
- Integration tests against real APIM are slow/expensive; most logic should be testable via unit tests with mocked interfaces

**Test tiers**:
| Tier | Scope | Mocking | CI Speed |
|------|-------|---------|----------|
| Unit | Dependency graph, config parsing, path mapping, filtering, diff computation | Full mock of `IApimClient` and `IArtifactStore` | <5s |
| Contract | REST API response shapes, YAML schema validation | HTTP recording/playback | <30s |
| Integration | End-to-end extract/publish against real APIM | None (requires Azure subscription) | ~5min |

**Coverage target**: 80%+ line coverage on `src/services/` and `src/lib/`
