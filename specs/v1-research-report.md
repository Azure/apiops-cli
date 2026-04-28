# APIOps v1 Research Report: Scenarios, Requirements & Edge Cases

> **Source**: `c:\sources\apiops` — READ-ONLY analysis of the existing APIOps toolset  
> **Purpose**: Extract every user scenario, requirement, and edge case the v2 rebuild must support

---

## 1. Extract Scenarios (`apiops extract`)

### 1.1 End-to-End Flow

1. Authenticate to Azure using `DefaultAzureCredential` or a pre-obtained bearer token
2. Connect to APIM REST API at `https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{name}?api-version=2023-09-01-preview`
3. For each resource type (in fixed order), call `GET /list` to enumerate resources
4. Apply name-based filters from `configuration.extractor.yaml` (if provided)
5. Write each resource as a JSON info file + extra artifacts (policy XML, API specification) to the output directory
6. For APIs: enumerate all revisions, group by version set, extract specification in the configured format
7. If `Workspaces` feature flag is enabled, repeat for workspace-scoped resources

### 1.2 Extraction Order (from `extractor/App.cs`)

```
1.  NamedValues
2.  Tags
3.  Gateways
4.  VersionSets
5.  Backends
6.  Loggers
7.  Diagnostics
8.  PolicyFragments
9.  ServicePolicies
10. Products (→ ProductApis, ProductGroups, ProductTags, ProductPolicy)
11. Groups
12. Subscriptions
13. APIs (→ ApiPolicies, ApiTags, ApiDiagnostics, ApiOperations → ApiOperationPolicies)
14. Workspaces (feature-flagged, repeats most above under /workspaces/{name}/)
```

### 1.3 Extractor Configuration Options

**Environment variables (from `.env.extractor.template`):**

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_RESOURCE_GROUP_NAME` | Yes | Resource group containing the APIM instance |
| `API_MANAGEMENT_SERVICE_NAME` | Yes | APIM instance name |
| `AZURE_CLIENT_ID` | Auth | Service principal client ID |
| `AZURE_CLIENT_SECRET` | Auth | Service principal secret |
| `AZURE_TENANT_ID` | Auth | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Yes | Azure subscription ID |
| `API_MANAGEMENT_SERVICE_OUTPUT_FOLDER_PATH` | Yes | Output directory for extracted artifacts |
| `CONFIGURATION_YAML_PATH` | No | Path to `configuration.extractor.yaml` for filtering |
| `API_SPECIFICATION_FORMAT` | No | Output format for API specs (default: `OpenAPIV3Yaml`) |
| `AZURE_BEARER_TOKEN` | No | Pre-obtained bearer token (bypasses credential auth) |
| `AZURE_CLOUD_ENVIRONMENT` | No | Sovereign cloud: `AzurePublicCloud`, `AzureChinaCloud`, `AzureUSGovernment`, `AzureGermanCloud` |
| `ARM_API_VERSION` | No | Override the APIM REST API version (default: `2023-09-01-preview`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OpenTelemetry OTLP exporter endpoint |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | App Insights connection string for telemetry |

**API Specification Format values** (from `extractor/ApiSpecification.cs`):

| Value | Description |
|-------|-------------|
| `OpenAPIV3Yaml` | OpenAPI 3.0 in YAML (**default**) |
| `OpenAPIV3Json` | OpenAPI 3.0 in JSON |
| `OpenAPIV2Yaml` | OpenAPI 2.0 (Swagger) in YAML |
| `OpenAPIV2Json` | OpenAPI 2.0 (Swagger) in JSON |
| `Wadl` | WADL format |
| `JSON` | Alias for OpenAPIV3Json |
| `YAML` | Alias for OpenAPIV3Yaml |

Note: GraphQL and WSDL specs are detected automatically from the API type and always extracted in their native format (`specification.graphql`, `specification.wsdl`).

### 1.4 Extractor Filter Configuration (`configuration.extractor.yaml`)

The filter file supports inclusive name-lists for these resource types:

```yaml
apiNames:
  - apiName1
  - apiName2
backendNames:
  - backendName1
diagnosticNames:
  - diagnosticName1
loggerNames:
  - loggerName1
namedValueNames:
  - namedValueName1
productNames:
  - productName1
subscriptionNames:
  - subscriptionName1
tagNames:
  - tagName1
policyFragmentNames:
  - policyFragment1
```

**Full list of filterable resource types** (from `extractor/Configuration.cs`):

| Config Key | Resource Type |
|------------|---------------|
| `apiNames` | APIs (matches root name, extracts all revisions) |
| `backendNames` | Backends |
| `diagnosticNames` | Diagnostics |
| `loggerNames` | Loggers |
| `namedValueNames` | Named Values |
| `productNames` | Products |
| `subscriptionNames` | Subscriptions |
| `tagNames` | Tags |
| `policyFragmentNames` | Policy Fragments |
| `gatewayNames` | Gateways |
| `versionSetNames` | Version Sets |
| `groupNames` | Groups |
| `workspaceNames` | Workspaces |

**Behavior when no filter file is provided**: Extract ALL resources (pipeline parameter `Extract All`).

### 1.5 Output Directory Structure (from `SampleArtifacts/`)

```
{output}/
├── policy.xml                          # Service-level policy
├── named values/
│   └── {name}/
│       └── namedValueInformation.json
├── tags/
│   └── {name}/
│       └── tagInformation.json
├── version sets/
│   └── {name}/
│       └── versionSetInformation.json
├── backends/
│   └── {name}/
│       └── backendInformation.json
├── loggers/
│   └── {name}/
│       └── loggerInformation.json
├── diagnostics/
│   └── {name}/
│       └── diagnosticInformation.json
├── policy fragments/
│   └── {name}/
│       └── policyFragmentInformation.json
├── products/
│   └── {name}/
│       ├── productInformation.json
│       ├── policy.xml
│       ├── apis.json
│       └── groups.json
├── apis/
│   └── {name}/                         # e.g. "demo-conference-api"
│       ├── apiInformation.json
│       ├── specification.yaml           # or .json, .graphql, .wsdl, .wadl
│       ├── tags/
│       ├── diagnostics/
│       └── operations/
│           └── {operation}/
│               └── policy.xml
│   └── {name};rev=2/                   # Revision directory naming
│       ├── apiInformation.json
│       └── specification.yaml
└── workspaces/
    └── {workspace-name}/
        ├── apis/
        ├── backends/
        ├── tags/
        └── ... (mirrors service-level structure)
```

---

## 2. Publish Scenarios (`apiops publish`)

### 2.1 End-to-End Flow

1. Detect publish mode: **incremental** (COMMIT_ID provided) or **full** (no COMMIT_ID)
2. If incremental: use LibGit2Sharp to diff the commit against its parent, get changed file set
3. If full: walk all files in the artifact directory
4. Load override configuration from `configuration.{env}.yaml` if `CONFIGURATION_YAML_PATH` is set
5. **PUT phase** (dependency order): For each resource type, read artifact files → apply overrides → PUT to APIM
6. **DELETE phase** (reverse dependency order): Compare files in current commit with APIM state → DELETE removed resources

### 2.2 Publish Ordering (from `publisher/App.cs`)

**PUT order** (dependencies first):
```
1.  NamedValues
2.  Gateways
3.  Tags
4.  VersionSets
5.  Backends
6.  Loggers
7.  Diagnostics
8.  PolicyFragments
9.  ServicePolicies
10. Products
11. Groups
12. APIs
13. Subscriptions
14. ApiPolicies
15. ApiTags
16. ApiDiagnostics
17. GatewayApis
18. ProductPolicies
19. ProductGroups
20. ProductTags
21. ProductApis
22. ApiOperationPolicies
    [Workspace PUT: same order under workspace scope]
```

**DELETE order** (reverse - children/dependents first):
```
1.  ApiOperationPolicies
2.  ProductApis
3.  ProductTags
4.  ProductGroups
5.  ProductPolicies
6.  GatewayApis
7.  ApiDiagnostics
8.  ApiTags
9.  ApiPolicies
10. Subscriptions
11. APIs
12. Groups
13. Products
14. ServicePolicies
15. PolicyFragments
16. Diagnostics
17. Loggers
18. VersionSets
19. Tags
20. Backends
21. Gateways
22. NamedValues
    [Workspace DELETE: same reverse order under workspace scope]
```

### 2.3 Incremental vs Full Publish

| Mode | Trigger | How files are selected |
|------|---------|----------------------|
| **Incremental** | `COMMIT_ID` env var set to a git SHA | `Git.GetChangedFilesInCommit()` — uses LibGit2Sharp to compare commit tree with parent |
| **Full** | `COMMIT_ID` not set | `serviceDirectory.GetFilesRecursively()` — all files in artifact folder |
| **Force Full via pipeline** | Parameter `publish-all-artifacts-in-repo` | Omits `COMMIT_ID` from environment |

**Incremental publish details:**
- Uses `LibGit2Sharp` to compute `TreeChanges` between the commit and its parent
- Both `Path` and `OldPath` are collected (to handle renames)
- For delete detection: compares files in previous commit against current commit
- `TryGetFileContentsInCommit` can read file contents from any git commit (not just working tree)
- Pipeline requires `fetchDepth: 0` (full clone) or `fetchDepth: 2` (minimum for diff)

### 2.4 Environment Override System

**Configuration file**: `configuration.{env}.yaml` (e.g., `configuration.prod.yaml`)

**Override structure** — per-resource-type sections with name-based matching:

```yaml
# Override the target APIM instance name
apimServiceName: apim-prod-instance

# Override named values
namedValues:
  - name: environment
    properties:
      displayName: environment
      value: "https://www.production-api.com"
  - name: mysecretvalue
    properties:
      displayName: mysecretvalue
      keyVault:
        identityClientId: <prod-identity-client-id>
        secretIdentifier: <prod-keyvault-url>

# Override backends
backends:
  - name: helloworldfromfuncapp
    properties:
      url: "https://prod-funcapp.azurewebsites.net/api"
      resourceId: "https://management.azure.com/subscriptions/.../Microsoft.Web/sites/prod-funcapp"
      credentials:
        header:
          x-functions-key: ["{{prod-key-namedvalue}}"]

# Override loggers
loggers:
  - name: my-app-insights
    properties:
      loggerType: applicationInsights
      description: prod application insights
      resourceId: "/subscriptions/.../providers/microsoft.insights/components/prod-ai"
      credentials:
        instrumentationKey: "{{ prod-namedvalue }}"

# Override diagnostics
diagnostics:
  - name: applicationinsights
    properties:
      loggerId: "/subscriptions/.../loggers/prod-ai"

# Override API-specific diagnostics
apis:
  - name: demo-conference-api
    diagnostics:
      - name: applicationinsights
        properties:
          loggerId: "/subscriptions/.../loggers/prod-ai"
```

**Overrideable resource sections** (from `publisher/OverrideDto.cs`):

| Section Name | Resource Type |
|-------------|---------------|
| `namedValues` | Named Values |
| `tags` | Tags |
| `gateways` | Gateways |
| `versionSets` | Version Sets |
| `backends` | Backends |
| `loggers` | Loggers |
| `diagnostics` | Diagnostics |
| `policyFragments` | Policy Fragments |
| `servicePolicies` | Service Policies |
| `products` | Products |
| `groups` | Groups |
| `subscriptions` | Subscriptions |
| `apis` | APIs |

**Override mechanism**: Deep JSON merge. The override `JsonObject` is merged with the artifact `JsonObject` — matching properties are replaced, new properties are added, nested objects are recursively merged.

### 2.5 Token Substitution (`{#placeholder#}`)

The `{#...#}` pattern is **not handled by the APIOps tool itself**. It is processed by pipeline tasks:

- **Azure DevOps**: `qetza.replacetokens@6` task with `tokenPrefix: "{#"` and `tokenSuffix: "#}"`
- **GitHub Actions**: `cschleiden/replace-tokens@v1.3` with same prefix/suffix

The pipeline substitutes tokens from pipeline secrets/variables **before** the publisher runs. Example:

```yaml
# In configuration.prod.yaml
namedValues:
  - name: testSecret
    properties:
      value: "{#testSecretValue#}"

# In pipeline env/secrets, testSecretValue is mapped to the actual secret value
```

### 2.6 Publisher Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_RESOURCE_GROUP_NAME` | Yes | Target APIM resource group |
| `API_MANAGEMENT_SERVICE_NAME` | No | Target APIM instance name (can also come from `apimServiceName` in config YAML) |
| `API_MANAGEMENT_SERVICE_OUTPUT_FOLDER_PATH` | Yes | Path to artifact directory |
| `CONFIGURATION_YAML_PATH` | No | Path to environment override YAML |
| `COMMIT_ID` | No | Git commit SHA for incremental publish |
| `AZURE_CLIENT_ID` | Auth | Service principal |
| `AZURE_CLIENT_SECRET` | Auth | Service principal |
| `AZURE_TENANT_ID` | Auth | Service principal |
| `AZURE_SUBSCRIPTION_ID` | Yes | Target subscription |
| `AZURE_BEARER_TOKEN` | No | Pre-obtained token |
| `AZURE_CLOUD_ENVIRONMENT` | No | Sovereign cloud |
| `ARM_API_VERSION` | No | Override REST API version |

---

## 3. CI/CD Integration

### 3.1 Pipeline Stages — Typical Flow

```
[Manual Trigger] → Extract → Spectral Lint → Upload Artifact → Create PR
                                                                    ↓
                                                              [PR Review]
                                                                    ↓
                                                              [Merge to main]
                                                                    ↓
                       Publish to Dev → [Gate/Approval] → Publish to Prod
```

### 3.2 Azure DevOps Pipeline Structure

**Extractor pipeline** (`tools/azdo_pipelines/run-extractor.yaml`):
- Manual trigger only (`trigger: none`)
- Parameters: `APIM_INSTANCE_NAME`, `RESOURCE_GROUP_NAME`, `APIM_REPOSITORY_NAME`, `API_MANAGEMENT_SERVICE_OUTPUT_FOLDER_PATH`, `TARGET_BRANCH_NAME`, `CONFIGURATION_YAML_PATH`, `API_SPECIFICATION_FORMAT`
- Authentication via `AzureCLI@2` task with service connection → extracts bearer token + SPN credentials
- Downloads extractor binary from GitHub releases (platform-specific: `linux-x64`, `win-x64`, `osx-arm64`, `osx-x64`)
- Runs Spectral linting on extracted API specs
- Publishes pipeline artifact

**Publisher pipeline** (`tools/azdo_pipelines/run-publisher.yaml`):
- Triggered on push to `main` (excludes `tools/*`)
- Two-stage: Dev → Prod (with environment gate for Prod)
- Commit ID control: `publish-artifacts-in-last-commit` (default) vs `publish-all-artifacts-in-repo`
- Uses template: `run-publisher-with-env.yaml`

**Publisher template** (`tools/azdo_pipelines/run-publisher-with-env.yaml`):
- `fetchDepth: 0` (full clone) required for git diff
- Token substitution via `qetza.replacetokens@6`
- Downloads publisher binary from GitHub releases
- 4 conditional branches: with/without config YAML × with/without commit ID

### 3.3 GitHub Actions Structure

**Extractor workflow** (`tools/github_workflows/run-extractor.yaml`):
- `workflow_dispatch` trigger with `CONFIGURATION_YAML_PATH` and `API_SPECIFICATION_FORMAT` inputs
- Two-job flow: `extract` → `create-pull-request`
- Uses `peter-evans/create-pull-request@v6` to auto-create PR with labels `extract, automated pr`
- Secrets: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP_NAME`, `API_MANAGEMENT_SERVICE_NAME`

**Publisher workflow** (`tools/github_workflows/run-publisher.yaml`):
- Triggered on push to `main` or manual `workflow_dispatch`
- Multi-job: Get commit → Dev (with/without commit ID) → Prod (with/without commit ID)
- Uses reusable workflow `run-publisher-with-env.yaml`
- GitHub Environments for gating (e.g., `prod` environment with approval rules)

**Publisher reusable workflow** (`tools/github_workflows/run-publisher-with-env.yaml`):
- Token substitution via `cschleiden/replace-tokens@v1.3`
- Spectral linting before publish
- Logging level configurable via `vars.LOG_LEVEL` (environment variable)
- `fetch-depth: 2` for git diff

### 3.4 Multi-Environment Pattern

```
main branch
  ├── artifacts/          (source of truth)
  ├── configuration.prod.yaml
  └── configuration.staging.yaml

Pipeline:
  1. On merge to main → publish to Dev (no config override, just COMMIT_ID)
  2. After Dev succeeds → publish to Prod (with configuration.prod.yaml)
```

Each environment has its own:
- APIM instance (`API_MANAGEMENT_SERVICE_NAME` secret)
- Override file (`configuration.{env}.yaml`)
- Service principal credentials
- Environment gate/approval in the pipeline

---

## 4. Authentication Scenarios

From `common/Azure.cs`:

### 4.1 Supported Auth Methods

| Method | Mechanism | When Used |
|--------|-----------|-----------|
| **Service Principal (client secret)** | `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` + `AZURE_TENANT_ID` | CI/CD pipelines (most common) |
| **Pre-obtained bearer token** | `AZURE_BEARER_TOKEN` env var | Azure DevOps pipeline (token extracted from service connection via `az account get-access-token`) |
| **DefaultAzureCredential chain** | Azure.Identity automatic chain | Local development, managed identity, etc. |
| **Azure Service Connection** | Pipeline `AzureCLI@2` task extracts SPN and token | Azure DevOps pipelines |

### 4.2 Sovereign Cloud Support

```csharp
AzureEnvironment.Public       // AzurePublicCloud
AzureEnvironment.USGovernment // AzureUSGovernment
AzureEnvironment.Germany      // AzureGermanCloud
AzureEnvironment.China        // AzureChinaCloud
```

Controlled by `AZURE_CLOUD_ENVIRONMENT` env var. Affects:
- Authority host for authentication
- Management endpoint URL (e.g., `management.chinacloudapi.cn`)
- Default scope for token acquisition

### 4.3 HTTP Pipeline

Authentication is handled by `Azure.Core.Pipeline.BearerTokenAuthenticationPolicy`. The pipeline also includes:
- Custom retry policy (`CommonRetryPolicy`)
- Request/response logging via `ILoggerHttpPipelinePolicy`
- Telemetry header via `TelemetryPolicy` (includes tool version)

---

## 5. Edge Cases and Error Scenarios

### 5.1 API Revisions

- APIs can have multiple revisions: `my-api` (current) + `my-api;rev=2`, `my-api;rev=3`
- Directory naming uses the `;rev=N` suffix literally: `apis/testapi;rev=2/`
- During extract: all revisions are enumerated via `/apis/{name}/revisions` endpoint
- During publish:
  - `isCurrent` flag must be handled: only one revision can be current
  - Root API must exist before non-current revisions can be created
  - Revision number correction: `CorrectApimRevisionNumber` delegate verifies APIM's actual revision number matches
  - `MakeApiRevisionCurrent` can update which revision is current
  - `ApiRelease` is created/deleted to manage revision lifecycle

### 5.2 API Specification Formats

| Format | File Name | Detection |
|--------|-----------|-----------|
| OpenAPI YAML | `specification.yaml` | `Microsoft.OpenApi.Readers` parses and detects v2/v3 |
| OpenAPI JSON | `specification.json` | Same library |
| GraphQL | `specification.graphql` | File extension |
| WADL | `specification.wadl` | File extension |
| WSDL | `specification.wsdl` | File extension |

**Edge cases:**
- SOAP APIs (`ApiSpecification.Wsdl`) require `?import=true` query parameter on PUT
- GraphQL APIs require a separate PUT to `/schemas/graphql` endpoint
- OpenAPI version detection can fail — caught and returns `Option.None`
- Format conversion: if user requests OpenAPI v2 but API is v3, the extractor converts using `Microsoft.OpenApi.Extensions.WriteAsAsync()`

### 5.3 Version Sets

- APIs within a version set are grouped during extraction to avoid parallel write conflicts
- `apiVersionSetId` property links an API to its version set
- Version sets must exist before APIs that reference them (PUT ordering)

### 5.4 Workspace-Scoped Resources

- Workspaces are **feature-flagged** (`FeatureManagement.Workspaces`)
- Each workspace contains its own: APIs, Backends, Tags, VersionSets, Loggers, Diagnostics, PolicyFragments, Policies, Products, Groups, Subscriptions
- URI pattern: `/workspaces/{workspaceName}/apis/{apiName}` (vs service-level `/apis/{apiName}`)
- Separate file modules exist for every workspace resource type (15+ duplicated files)
- During extract: workspace filter uses `workspaceNames` configuration key
- During publish: workspace resources are PUT/DELETE in the same ordering as service-level

### 5.5 Partial Publish Failure

**Current behavior**: No transaction semantics. If a PUT fails mid-publish:
- Resources PUT before the failure are live in APIM
- Resources after the failure are NOT applied
- DELETE phase may or may not have started
- No rollback mechanism exists
- Pipeline shows failure, user must re-run after fixing

**Delete safety**:
- Delete only happens when a resource exists in APIM but NOT in the artifact directory (for full publish) or NOT in the current commit (for incremental)
- The delete phase compares against "previous commit" state using `GetArtifactsInPreviousCommit`
- This is the source of a common user issue: deleting an API file from the repo causes the API to be deleted from APIM

### 5.6 Circular Dependencies

Not explicitly handled. The PUT/DELETE ordering is **hardcoded** in `App.cs`, not dynamically computed. The ordering was manually determined to avoid dependency conflicts. The v2 architecture proposes topological sort via `DependencyGraph`.

### 5.7 Long-Running Operations

- Some APIM operations (especially SOAP import, large API PUT) return `202 Accepted` with provisioning state
- The common library handles polling for completion (`LongRunningOperation.cs`)
- Timeout handling is via `Azure.Core`'s retry policy

### 5.8 Pagination

- APIM list endpoints return paginated results with `nextLink`
- `HttpPipeline.ListJsonObjects()` follows `nextLink` automatically

---

## 6. Configuration Filtering Deep Dive

### 6.1 Filter Semantics

- Filters are **inclusive allowlists**: if a filter is specified for a resource type, ONLY named resources are extracted
- If no filter is specified for a resource type, ALL resources of that type are extracted
- If no configuration file is provided at all, ALL resources of ALL types are extracted
- Filters are **case-insensitive** (`StringComparer.OrdinalIgnoreCase`)

### 6.2 API Name Filtering Special Behavior

- When filtering APIs by name, the filter matches the **root name** (without `;rev=N` suffix)
- All revisions of a matching API are extracted
- Example: filtering for `my-api` will extract `my-api`, `my-api;rev=2`, `my-api;rev=3`

### 6.3 Transitive Dependencies Not Filtered

A notable gap: filtering `apiNames: [my-api]` extracts only `my-api` but **does not** automatically include:
- Backends referenced by `my-api`'s policies
- Named values referenced in policies
- Products that contain `my-api`
- Tags assigned to `my-api`

Users must explicitly list all dependent resources in the filter file, or extract everything and use the filter only to limit the scope.

---

## 7. Full Resource Type Inventory

### 7.1 Service-Level Resources (24 types)

| Resource | Info File | Extra Artifacts | Parent |
|----------|-----------|----------------|--------|
| Named Value | `namedValueInformation.json` | — | — |
| Tag | `tagInformation.json` | — | — |
| Gateway | `gatewayInformation.json` | — | — |
| Version Set | `versionSetInformation.json` | — | — |
| Backend | `backendInformation.json` | — | — |
| Logger | `loggerInformation.json` | — | — |
| Diagnostic | `diagnosticInformation.json` | — | — |
| Policy Fragment | `policyFragmentInformation.json` | — | — |
| Service Policy | `policy.xml` | — | — |
| Product | `productInformation.json` | `policy.xml`, `apis.json`, `groups.json` | — |
| Group | `groupInformation.json` | — | — |
| Subscription | `subscriptionInformation.json` | — | — |
| API | `apiInformation.json` | `specification.{yaml,json,graphql,wsdl,wadl}` | — |
| API Policy | `policy.xml` | — | API |
| API Tag | (association) | — | API |
| API Diagnostic | `diagnosticInformation.json` | — | API |
| API Operation | (extracted for policies) | — | API |
| API Operation Policy | `policy.xml` | — | API Operation |
| Product API | `apis.json` | — | Product |
| Product Group | `groups.json` | — | Product |
| Product Tag | (association) | — | Product |
| Product Policy | `policy.xml` | — | Product |
| Gateway API | (association) | — | Gateway |
| API Release | (publisher only) | — | API |

### 7.2 Workspace-Scoped Resources (13 types)

All mirror service-level equivalents under `/workspaces/{name}/`:
- WorkspaceApi, WorkspaceBackend, WorkspaceDiagnostic, WorkspaceGroup
- WorkspaceLogger, WorkspaceNamedValue, WorkspacePolicy, WorkspacePolicyFragment
- WorkspaceProduct, WorkspaceSubscription, WorkspaceTag, WorkspaceVersionSet
- WorkspaceApiRelease (publisher only)

---

## 8. v2 Architecture Proposal (from `apiops-v2.md`)

### Key Decisions

1. **CLI via System.CommandLine**: `apiops extract --service-name ... --output ... --config ...` and `apiops publish --service-name ... --input ... --config ... --commit-id ...`
2. **REST API directly** via `Azure.Core.Pipeline` (no `Azure.ResourceManager.ApiManagement` SDK)
3. **`JsonNode` over DTOs**: `System.Text.Json.Nodes.JsonObject` for all payloads — eliminates ~3,000 LOC of DTOs, auto-roundtrips unknown properties
4. **Two core interfaces**: `IApimClient` (list/get/put/delete) and `IArtifactStore` (list/read/write/delete) — enables unit testing with in-memory fakes
5. **Declarative ResourceRegistry**: Each resource type is a `ResourceDefinition` record (~10 lines) instead of a per-resource module (4 files, ~300+ lines each)
6. **Workspace = scoped context**: `ResourcePath.WorkspaceName` instead of duplicated types — eliminates 15+ workspace files
7. **Special cases via hooks**: `PostExtract` and `CustomPut` delegates on `ResourceDefinition`
8. **Drop LanguageExt**: Replace `Option<T>`/`Either<L,R>` with nullable types + pattern matching
9. **Drop Flurl**: Simple string interpolation for URLs
10. **Target ~4,000 LOC** (vs ~32,000 current)

### Proposed Project Structure

```
ApiOps.Core/           (~1,500 LOC) - ResourceDefinition, DependencyGraph, IApimClient, IArtifactStore, OverrideEngine, ConfigurationModel
ApiOps.Apim/           (~800 LOC)   - ApimRestClient, Auth, LRO, Pagination
ApiOps.ArtifactStore/  (~300 LOC)   - FileArtifactStore
ApiOps.Extract/        (~500 LOC)   - ExtractPipeline, ApiExtractHandler
ApiOps.Publish/        (~800 LOC)   - PublishPipeline, ApiPublishHandler, DiffEngine
ApiOps.Cli/            - Single CLI entry point
```

---

## 9. Summary of v2 Requirements

### Must Support

- [ ] All 24 service-level resource types + 13 workspace-scoped resource types
- [ ] Extract with inclusive name filters for all resource types
- [ ] Extract all API revisions when root name matches filter
- [ ] API specification export in OpenAPI v2/v3 JSON/YAML, plus auto-detect GraphQL/WSDL/WADL
- [ ] Incremental publish via git commit diff
- [ ] Full publish (all artifacts)
- [ ] Per-environment override YAML with deep JSON merge
- [ ] `apimServiceName` override in config (target different APIM instance per environment)
- [ ] Correct PUT ordering (dependencies first) and DELETE ordering (dependents first)
- [ ] API revision lifecycle: create root first, correct revision numbers, manage `isCurrent`, ApiRelease
- [ ] SOAP import (`?import=true`)
- [ ] GraphQL schema PUT to `/schemas/graphql`
- [ ] Policy XML as separate files (not inline in JSON)
- [ ] Product associations (APIs, groups, tags) as separate files
- [ ] Authentication: `DefaultAzureCredential`, service principal, pre-obtained bearer token
- [ ] Sovereign cloud support (Public, China, USGov, Germany)
- [ ] OpenTelemetry tracing + metrics
- [ ] Application Insights integration
- [ ] Configurable ARM API version
- [ ] Cross-platform binaries (linux-x64, win-x64, osx-arm64, osx-x64)

### Must Handle (Edge Cases)

- [ ] Partial publish failure (no rollback, clear error reporting)
- [ ] Token substitution (`{#...#}`) happens outside the tool (pipeline responsibility)
- [ ] Delete detection: file removed from repo → resource deleted from APIM
- [ ] APIs grouped by version set during extraction (avoid parallel conflicts)
- [ ] Workspace feature flag (opt-in)
- [ ] Deep clone required for file fetching from git commits (not just working tree)
- [ ] Pagination on all list endpoints
- [ ] Long-running operation polling
- [ ] Case-insensitive name matching
- [ ] API name root extraction (strip `;rev=N` for filtering)

### Pipeline Integration Requirements

- [ ] Downloadable as self-contained binary (no runtime dependency)
- [ ] All configuration via environment variables (no CLI flags in v1, v2 adds CLI flags)
- [ ] YAML configuration file loaded if `CONFIGURATION_YAML_PATH` is set
- [ ] Exit code 0 on success, non-zero on failure
- [ ] Structured logging compatible with pipeline output
- [ ] Works with Azure DevOps service connections and GitHub Actions secrets
