# Data Model: APIops CLI Tool

**Phase**: 1 — Design | **Date**: 2026-04-06 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

---

## Core Entities

### ResourceType (Enum)

Defines all APIM resource types the tool handles.

| Value | ARM Resource Path Suffix | Artifact Directory | Info File |
|-------|-------------------------|-------------------|-----------|
| `NamedValue` | `/namedValues/{name}` | `named values/{name}/` | `namedValueInformation.json` |
| `Tag` | `/tags/{name}` | `tags/{name}/` | `tagInformation.json` |
| `Gateway` | `/gateways/{name}` | `gateways/{name}/` | `gatewayInformation.json` |
| `VersionSet` | `/apiVersionSets/{name}` | `version sets/{name}/` | `versionSetInformation.json` |
| `Backend` | `/backends/{name}` | `backends/{name}/` | `backendInformation.json` |
| `Logger` | `/loggers/{name}` | `loggers/{name}/` | `loggerInformation.json` |
| `Group` | `/groups/{name}` | `groups/{name}/` | `groupInformation.json` |
| `Diagnostic` | `/diagnostics/{name}` | `diagnostics/{name}/` | `diagnosticInformation.json` |
| `PolicyFragment` | `/policyFragments/{name}` | `policy fragments/{name}/` | `policyFragmentInformation.json` |
| `ServicePolicy` | `/policies/policy` | (root) | `policy.xml` |
| `Product` | `/products/{name}` | `products/{name}/` | `productInformation.json` |
| `ProductPolicy` | `/products/{name}/policies/policy` | `products/{name}/` | `policy.xml` |
| `ProductApi` | `/products/{name}/apis/{apiName}` | `products/{name}/` | `apis.json` |
| `ProductGroup` | `/products/{name}/groups/{groupName}` | `products/{name}/` | `groups.json` |
| `ProductTag` | `/products/{name}/tags/{tagName}` | `products/{name}/` | (in productInformation.json) |
| `Api` | `/apis/{name}` | `apis/{name}/` | `apiInformation.json` |
| `ApiPolicy` | `/apis/{name}/policies/policy` | `apis/{name}/` | `policy.xml` |
| `ApiTag` | `/apis/{name}/tags/{tagName}` | `apis/{name}/tags/` | `tagInformation.json` |
| `ApiDiagnostic` | `/apis/{name}/diagnostics/{diagName}` | `apis/{name}/diagnostics/` | `diagnosticInformation.json` |
| `ApiOperation` | `/apis/{name}/operations/{opName}` | `apis/{name}/operations/{opName}/` | — |
| `ApiOperationPolicy` | `/apis/{name}/operations/{opName}/policies/policy` | `apis/{name}/operations/{opName}/` | `policy.xml` |
| `GatewayApi` | `/gateways/{name}/apis/{apiName}` | `gateways/{name}/` | `apis.json` |
| `Subscription` | `/subscriptions/{name}` | `subscriptions/{name}/` | `subscriptionInformation.json` |
| `GlobalSchema` | `/schemas/{name}` | `schemas/{name}/` | `schemaInformation.json` |
| `PolicyRestriction` | `/policyRestrictions/{name}` | `policy restrictions/{name}/` | `policyRestrictionInformation.json` |
| `Documentation` | `/documentations/{name}` | `documentations/{name}/` | `documentationInformation.json` |
| `ApiSchema` | `/apis/{name}/schemas/{schemaName}` | `apis/{name}/schemas/{schemaName}/` | `schemaInformation.json` |
| `ApiRelease` | `/apis/{name}/releases/{releaseName}` | `apis/{name}/releases/{releaseName}/` | `releaseInformation.json` |
| `ApiTagDescription` | `/apis/{name}/tagDescriptions/{tagDescName}` | `apis/{name}/tag descriptions/{tagDescName}/` | `tagDescriptionInformation.json` |
| `ApiWiki` | `/apis/{name}/wikis/default` | `apis/{name}/` | `wiki.md` |
| `ProductWiki` | `/products/{name}/wikis/default` | `products/{name}/` | `wiki.md` |
| `GraphQLResolver` | `/apis/{name}/resolvers/{resolverName}` | `apis/{name}/resolvers/{resolverName}/` | `resolverInformation.json` |
| `GraphQLResolverPolicy` | `/apis/{name}/resolvers/{resolverName}/policies/policy` | `apis/{name}/resolvers/{resolverName}/` | `policy.xml` |

---

### ResourceDescriptor

Represents a specific resource instance with enough information to construct its ARM URI and artifact path.

```typescript
interface ResourceDescriptor {
  type: ResourceType;
  name: string;
  /** Parent resource name (e.g., API name for ApiOperation) */
  parent?: string;
  /** Grandparent resource name (e.g., API name for ApiOperationPolicy) */
  grandparent?: string;
  /** Workspace name if workspace-scoped */
  workspace?: string;
}
```

**Validation rules**:
- `name`: Non-empty string, must match ARM resource name constraints (`[a-zA-Z0-9-._~]`)
- `parent`: Required for child types (ApiPolicy, ApiTag, ApiDiagnostic, ApiOperation, ApiOperationPolicy, ApiSchema, ApiRelease, ApiTagDescription, ApiWiki, GraphQLResolver, GraphQLResolverPolicy, ProductPolicy, ProductApi, ProductGroup, ProductTag, ProductWiki, GatewayApi)
- `grandparent`: Required for ApiOperationPolicy and GraphQLResolverPolicy
- `workspace`: When set, ARM URI includes `/workspaces/{workspace}` prefix before resource type path

---

### DependencyGraph

Static DAG defining resource type dependencies. Used for topological ordering of extraction and publish operations.

```typescript
interface DependencyEdge {
  from: ResourceType;   // This type...
  to: ResourceType;     // ...depends on this type (must exist first)
  required: boolean;    // Hard dependency (parent/child) vs soft (policy reference)
}
```

**Edges** (see research.md R2 for full table):

| From | To | Required | Relationship |
|------|----|----------|-------------|
| Diagnostic | Logger | false | References logger |
| ServicePolicy | NamedValue | false | May reference named values |
| ServicePolicy | PolicyFragment | false | May include fragments |
| Product | — | — | No dependencies |
| ProductPolicy | Product | true | Child of product |
| ProductGroup | Product, Group | true | Association |
| ProductTag | Product, Tag | true | Association |
| ProductApi | Product, Api | true | Association |
| ProductWiki | Product | true | Child of product |
| Api | VersionSet | false | Optional version set reference |
| ApiPolicy | Api | true | Child of API |
| ApiTag | Api, Tag | true | Association |
| ApiDiagnostic | Api, Logger | true, false | Child + reference |
| ApiOperation | Api | true | Child of API |
| ApiOperationPolicy | ApiOperation | true | Child of operation |
| ApiSchema | Api | true | Child of API |
| ApiRelease | Api | true | Child of API |
| ApiTagDescription | Api, Tag | true | Child + reference |
| ApiWiki | Api | true | Child of API |
| GraphQLResolver | Api | true | Child of API (GraphQL only) |
| GraphQLResolverPolicy | GraphQLResolver | true | Child of resolver |
| GatewayApi | Gateway, Api | true | Association |
| Subscription | Product, Api | false | Optional scope (product or API) |
| GlobalSchema | — | — | No dependencies |
| PolicyRestriction | — | — | No dependencies |
| Documentation | — | — | No dependencies |

**Topological sort output** (extraction tiers):
1. NamedValue, Tag, Gateway, VersionSet, Backend, Logger, Group, PolicyFragment, GlobalSchema, PolicyRestriction, Documentation
2. Diagnostic, ServicePolicy, Product, Api
3. ProductPolicy, ProductGroup, ProductTag, ProductApi, ProductWiki, ApiPolicy, ApiTag, ApiDiagnostic, ApiOperation, ApiSchema, ApiRelease, ApiTagDescription, ApiWiki, GraphQLResolver, GatewayApi, Subscription
4. ApiOperationPolicy, GraphQLResolverPolicy

---

### ApimServiceContext

Connection context for a target APIM instance.

```typescript
interface ApimServiceContext {
  subscriptionId: string;
  resourceGroup: string;
  serviceName: string;
  apiVersion: string;    // Default: "2024-05-01"
  baseUrl: string;       // Computed: https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{name}
}
```

---

### ExtractConfig

Configuration for an extraction operation, loaded from CLI flags and optional filter file.

```typescript
interface ExtractConfig {
  service: ApimServiceContext;
  outputDir: string;
  filter?: FilterConfig;
  includeTransitive: boolean;   // Default: true; false when --no-transitive
  verbose: boolean;
}
```

---

### FilterConfig

Loaded from `--filter <path>` YAML file. Inclusive allowlist per resource type.

```typescript
interface FilterConfig {
  apiNames?: string[];
  backendNames?: string[];
  productNames?: string[];
  namedValueNames?: string[];
  loggerNames?: string[];
  diagnosticNames?: string[];
  tagNames?: string[];
  policyFragmentNames?: string[];
  gatewayNames?: string[];
  versionSetNames?: string[];
  groupNames?: string[];
  subscriptionNames?: string[];
  schemaNames?: string[];            // Global schemas
  policyRestrictionNames?: string[];
  documentationNames?: string[];
  workspaceNames?: string[];
}
```

**Validation rules**:
- All name arrays: Case-insensitive matching (lowercased before comparison)
- If a type's array is undefined/absent: all resources of that type are included
- If a type's array is empty `[]`: no resources of that type are included
- API filter matches root name; all revisions of matching root are included

---

### PublishConfig

Configuration for a publish operation.

```typescript
interface PublishConfig {
  service: ApimServiceContext;
  sourceDir: string;
  overrides?: OverrideConfig;
  dryRun: boolean;
  deleteUnmatched: boolean;    // Default: false; true when --delete-unmatched
  commitId?: string;           // From COMMIT_ID env var; triggers incremental publish
  verbose: boolean;
}
```

---

### OverrideConfig

Loaded from `--overrides <path>` YAML file. Per-resource property overrides for environment-specific values.

```typescript
interface OverrideConfig {
  namedValues?: Record<string, NamedValueOverride>;
  backends?: Record<string, BackendOverride>;
  apis?: Record<string, ApiOverride>;
  diagnostics?: Record<string, DiagnosticOverride>;
  loggers?: Record<string, LoggerOverride>;
}

interface NamedValueOverride {
  value?: string;
  displayName?: string;
  tags?: string[];
  keyVault?: {
    identityClientId?: string;
    secretIdentifier?: string;
  };
}

interface BackendOverride {
  url?: string;
  credentials?: Record<string, unknown>;
}

interface ApiOverride {
  serviceUrl?: string;
}

interface DiagnosticOverride {
  loggerId?: string;
}

interface LoggerOverride {
  credentials?: Record<string, unknown>;
  resourceId?: string;
}
```

**Validation rules**:
- Override keys: Case-insensitive match against resource names in artifact directory
- Override values: Deep-merged into resource JSON (`Object.assign` semantics — override replaces at property level)
- Unknown override keys (referencing non-existent resources): Warning logged, not an error

---

### ResourcePayload

Opaque JSON wrapper for any APIM resource. **Not typed per resource type** — this is the core of Constitution VII (Forward Compatibility).

```typescript
interface ResourcePayload {
  descriptor: ResourceDescriptor;
  /** Raw JSON from APIM GET response (properties envelope). Never parsed into typed fields. */
  json: Record<string, unknown>;
}
```

---

### PublishAction

Represents a single operation to perform during publish.

```typescript
interface PublishAction {
  type: 'put' | 'delete';
  descriptor: ResourceDescriptor;
  /** JSON body for PUT; undefined for DELETE */
  payload?: Record<string, unknown>;
  /** Dry-run description of what would change */
  description: string;
}
```

**State transitions**:
- `pending` → `in-progress` → `succeeded` | `failed`
- On failure: error captured, remaining actions in same dependency tier continue (Promise.allSettled)

---

### InitConfig

Configuration for the `init` command.

```typescript
interface InitConfig {
  ciProvider?: 'github-actions' | 'azure-devops';
  nonInteractive: boolean;
  artifactDir: string;         // Default: './apim-artifacts' — directory referenced in generated pipelines
  environments: string[];      // Default: ['dev', 'prod'] — names for override templates and pipeline stages
  outputDir: string;           // Default: current directory — where generated files are written
}
```

---

## Entity Relationship Diagram

```
ApimServiceContext ─────────────────────────────────┐
                                                     │
ExtractConfig ──→ FilterConfig                       │
     │                                               │
     └──→ ApimServiceContext ◄───────────────────────┤
                                                     │
PublishConfig ──→ OverrideConfig                     │
     │                                               │
     └──→ ApimServiceContext ◄───────────────────────┘

DependencyGraph ──→ DependencyEdge[] ──→ ResourceType (enum)

ResourceDescriptor ──→ ResourceType
     │
     └──→ ResourcePayload (1:1, carries opaque JSON)

PublishAction ──→ ResourceDescriptor
     │
     └──→ ResourcePayload (optional, for PUT)
```

---

## Key Design Decisions

1. **No typed resource models**: `ResourcePayload.json` is always `Record<string, unknown>`. This eliminates the ~20+ DTO types from v1 and ensures unknown ARM properties are preserved on round-trip.

2. **ResourceDescriptor as the universal key**: Every operation (extract, publish, filter, diff) identifies resources by descriptor, not by file path or ARM URI. Mapping between descriptor ↔ file path ↔ ARM URI is centralized in utility functions.

3. **Static dependency graph**: Dependencies are defined at the `ResourceType` level, not per-instance. This is sufficient because APIM's parent-child relationships are structural (determined by type hierarchy), not dynamic.

4. **Separate FilterConfig and OverrideConfig**: These are different concerns — filtering controls *which* resources to extract; overrides control *what values* to inject during publish. They use different YAML schemas and apply at different stages.
