# Feature Specification: APIops CLI Tool

**Feature Branch**: `001-apiops-cli`
**Created**: 2026-04-06
**Status**: Draft
**Input**: User description: "Build an apiops CLI tool that can extract APIM configuration to local files and publish local configuration files back to an APIM instance. Users can run this CLI tool directly (apiops extract ...) or they can integrate it in CI/CD pipelines automatically. We must plan for future expansion (new commands like apiops verify ...). Please use existing APIOps Toolkit implementation as inspiration on scenarios & requirements, but we are rebuilding as a more general purpose tool with different technology stack."

## User Scenarios & Testing

## Clarifications

### Session 2026-04-06

- Q: Should filtered extraction auto-include transitive dependencies (backends, named values, loggers referenced by selected APIs)? → A: Yes, transitive inclusion by default with `--no-transitive` opt-out.
- Q: What progress feedback should the tool provide during long-running operations? → A: Per-resource status lines by default (e.g., `✓ apis/orders-api`). A `--log-level debug` option adds additional diagnostic output (HTTP requests, timing, retry details) useful for debugging.
- Q: How should the tool handle API revisions during extract and publish? → A: Extract all revisions, stored as sub-folders under each API. Publish recreates all revisions in the correct order (root API first, then revisions with forced revision numbers).
- Q: How should the tool parallelize extraction? → A: Cross-type parallel where safe (independent resource types extracted concurrently; resources within each type also concurrent). Publish remains dependency-ordered.
- Q: Should the CLI emit structured telemetry/logging? → A: Structured logging to stderr by default. An `--otel <path>` flag accepts a standard OpenTelemetry configuration YAML file to enable trace and metric export. Credentials (API keys, connection strings) live in the OTel config file or environment variables, never as CLI flags.

### User Story 1 — Extract APIM Configuration (Priority: P1)

A platform engineer wants to capture the current state of an Azure API Management instance as local files so the configuration can be version-controlled, reviewed, and used as the source of truth for future deployments.

**Why this priority**: Extract is the foundational operation — without it, there are no artifact files for any other command to work with. Every downstream workflow (publish, verify, CI/CD) depends on extracted configuration.

**Independent Test**: Run `apiops extract` against an APIM instance with several APIs, products, backends, and policies. Verify the output directory contains the expected file structure with all resources represented.

**Acceptance Scenarios**:

1. **Given** a running APIM instance with APIs, products, backends, named values, policies, loggers, diagnostics, tags, policy fragments, version sets, gateways, groups, subscriptions, global schemas, policy restrictions, documentation resources, API schemas, API releases, GraphQL resolvers (with resolver policies), API tag descriptions, API wikis, and product wikis, **When** the user runs `apiops extract --subscription-id <sub> --resource-group <rg> --service-name <svc> --output ./artifacts`, **Then** a directory tree is created matching the artifact layout with one folder per resource type, each containing JSON resource definitions and XML policy files.

6. **Given** a repository where the user stores APIM artifacts in a non-default directory (e.g., `infra/apim`, `config/api-management`, or any other path), **When** the user runs `apiops extract --output <custom-path>`, **Then** the artifacts are written to the specified directory, and subsequent extract runs to the same directory overwrite in place.

2. **Given** an APIM instance with workspace-scoped resources, **When** the user runs `apiops extract` with workspace support, **Then** workspace resources appear under `workspaces/{name}/` using the same structure as service-level resources.

3. **Given** the user only wants a subset of resources, **When** the user provides a filter configuration file via `--filter filter.yaml`, **Then** only the resources matching the allowlist in the configuration file are extracted, along with any resources those filtered resources transitively depend on (e.g., backends, named values, loggers referenced in policies). The user can suppress transitive inclusion with `--no-transitive`.

4. **Given** an APIM instance with APIs using different specification formats (OpenAPI v2/v3, GraphQL, SOAP/WSDL), **When** the user runs extract with a `--spec-format` option, **Then** API specifications are exported in the requested format where format conversion is possible, and in their native format otherwise.

5. **Given** an APIM instance, **When** the user runs `apiops extract --format json`, **Then** machine-readable JSON progress output is written to stdout (resource counts, file paths written) suitable for CI/CD pipeline consumption.

7. **Given** an APIM instance with APIs that have multiple revisions (e.g., `orders-api;rev=1`, `orders-api;rev=2`), **When** the user runs `apiops extract`, **Then** all revisions are extracted as sub-folders under the API directory, preserving revision numbers and metadata.

---

### User Story 2 — Publish Configuration to APIM (Priority: P1)

A platform engineer wants to apply local artifact files to an APIM instance to bring it into the desired state — creating, updating, and optionally deleting resources to match the file-based source of truth.

**Why this priority**: Publish is the second half of the core extract-publish round-trip. Together with extract, it forms the minimum viable product.

**Independent Test**: Extract from one APIM instance, then publish to a different (or the same) instance. Verify the target instance matches the artifact files.

**Acceptance Scenarios**:

1. **Given** a local artifact directory produced by `apiops extract` in any user-chosen location, **When** the user runs `apiops publish --subscription-id <sub> --resource-group <rg> --service-name <svc> --source <path>`, **Then** all resources in the artifacts are created or updated on the target APIM instance in the correct dependency order (e.g., backends before APIs that reference them), regardless of where the artifact directory lives in the repository.

2. **Given** resources exist on the target APIM instance that are NOT in the local artifacts, **When** the user runs `apiops publish` with a `--delete-unmatched` flag, **Then** those extra resources are removed from APIM in reverse dependency order after all creates/updates complete.

3. **Given** local artifacts and an environment override file, **When** the user runs `apiops publish --overrides overrides.prod.yaml`, **Then** property values from the override file are deep-merged into resource definitions before publishing (e.g., different backend URLs, named value secrets per environment).

4. **Given** a local artifact directory, **When** the user runs `apiops publish --dry-run`, **Then** the tool outputs a detailed plan of what would be created, updated, or deleted without making any changes, and exits with code 0 if the plan is valid.

5. **Given** previous publish attempts, **When** the user re-runs `apiops publish` with the same artifacts, **Then** the operation is idempotent — already-matching resources are skipped, and the end state is identical regardless of how many times publish runs.

6. **Given** a git repository with artifacts and a specific commit, **When** the `COMMIT_ID` environment variable is set to the triggering commit SHA, **Then** only resources whose artifact files changed in that commit are published (incremental publish).

---

### User Story 3 — CI/CD Pipeline Integration (Priority: P2)

A DevOps engineer wants to integrate the apiops CLI into automated pipelines (GitHub Actions, Azure DevOps) so that APIM configuration changes flow through a review-and-deploy process.

**Why this priority**: CI/CD integration is the primary consumption model for most teams, but it builds on top of the working extract and publish commands.

**Independent Test**: Configure a sample pipeline that runs `apiops extract` on schedule, creates a PR with changes, and on merge runs `apiops publish` to deploy.

**Acceptance Scenarios**:

1. **Given** a GitHub Actions or Azure DevOps pipeline, **When** the pipeline runs `apiops extract` and `apiops publish`, **Then** the commands execute non-interactively (no TTY prompts), produce structured output, and exit with appropriate codes (0 success, non-zero failure) that the pipeline can act on.

2. **Given** a multi-environment deployment (dev → staging → production), **When** the pipeline runs publish with different `--overrides` files per stage, **Then** each environment receives the correct environment-specific configuration values.

3. **Given** a pipeline that authenticates via service principal or managed identity, **When** the commands run, **Then** authentication works via the credential chain or explicit `--client-id`/`--client-secret`/`--tenant-id` flags without requiring manual token management.

4. **Given** a pipeline that wants incremental publish, **When** the pipeline sets the `COMMIT_ID` environment variable to the triggering commit SHA, **Then** only changed resources are published, reducing deployment time.

---

### User Story 4 — Guided Repository & Pipeline Setup (Priority: P2)

A platform engineer is adopting APIops for the first time and wants the CLI to scaffold the repository structure, generate CI/CD pipeline files, and guide them through configuring the Azure identities (service principals, federated credentials, managed identities) required for pipelines to authenticate against Azure resources.

**Why this priority**: Getting started with APIOps today requires extensive manual configuration — creating service principals, setting up federated credentials or secrets, writing pipeline YAML, and wiring environment variables. This is a major adoption barrier. Since the user already has the CLI installed, the tool should reduce this setup from hours of documentation-reading to a single interactive command.

**Independent Test**: Run `apiops init` in an empty repository and verify it produces a working pipeline configuration and outputs clear instructions for completing identity setup.

**Acceptance Scenarios**:

1. **Given** a git repository with no APIops configuration, **When** the user runs `apiops init`, **Then** the tool interactively asks which CI/CD platform to target (GitHub Actions, Azure DevOps), which artifact directory to use, and how many environments to configure, then generates the appropriate pipeline YAML files and override configuration templates.

2. **Given** the user selects GitHub Actions during init, **When** the tool generates pipeline files, **Then** it creates workflow YAML for extract (scheduled/manual trigger) and publish (push-to-main trigger with environment stages), pre-configured with the user's chosen artifact directory path.

3. **Given** the user selects Azure DevOps during init, **When** the tool generates pipeline files, **Then** it creates pipeline YAML for extract and publish with the equivalent Azure DevOps structure (stages, environments, variable groups).

4. **Given** the user needs to configure Azure authentication for pipelines, **When** they run `apiops init`, **Then** the tool outputs step-by-step instructions for creating the required Azure identity (service principal or managed identity) with the correct RBAC roles, and for configuring the pipeline platform's secrets/variables (GitHub secrets, Azure DevOps service connections). Where possible, the tool offers to create these resources directly via Azure CLI commands.

5. **Given** the user wants artifacts in a custom directory (e.g., `infra/apim`), **When** they specify this during `apiops init`, **Then** all generated pipeline files and configuration templates reference that directory rather than a hardcoded default.

6. **Given** a non-interactive environment, **When** the user runs `apiops init` with all required flags (e.g., `--ci github-actions --artifact-dir ./apim --environments dev,prod`), **Then** the tool generates all files without prompts.

7. **Given** a repository that already contains one or more files that `apiops init` would generate (e.g., existing pipeline YAML, `package.json`, or configuration files), **When** the user runs `apiops init` without `--force`, **Then** the tool lists the conflicting files and exits with exit code `1` without writing any files.

8. **Given** a repository with existing conflicting files, **When** the user runs `apiops init --force`, **Then** the tool logs a warning listing the files that will be overwritten, and proceeds to generate all files (overwriting the existing ones).

---

### User Story 5 — Extensible Command Architecture (Priority: P3)

The development team wants the CLI to support adding new top-level commands (e.g., `apiops verify`, `apiops diff`) without structural changes to the core framework.

**Why this priority**: This ensures the codebase architecture supports growth, but delivering it as an explicit feature is lower priority than the core extract/publish functionality.

**Independent Test**: Add a minimal new command (e.g., a placeholder `apiops version` or future `apiops verify`) and confirm it integrates with the CLI framework, help system, and output modes without modifying existing command code.

**Acceptance Scenarios**:

1. **Given** the CLI framework, **When** a developer adds a new command module, **Then** it automatically appears in `apiops --help` output and is invokable without modifying the main entry point or other commands.

2. **Given** the shared infrastructure (authentication, APIM client, artifact store), **When** a new command needs to interact with APIM or the local file system, **Then** it can consume the same abstractions used by extract and publish.

---

### Edge Cases

- What happens when the APIM REST API returns paginated results? The tool must follow `nextLink` pagination for all list operations.
- What happens when a resource has circular dependencies (e.g., API references backend, backend references API)? The tool must detect and handle circular references gracefully, applying resources in a safe order.
- What happens when authentication credentials expire mid-operation? The tool must support token refresh via the credential chain.
- What happens when the APIM REST API returns a 429 (rate limit)? The tool must respect `Retry-After` headers and retry with backoff.
- What happens when an API specification is in a format that cannot be converted (e.g., WSDL requested as OpenAPI v3)? The tool must fall back to the native format and warn the user.
- What happens when extracted artifact files contain properties that the current APIM API version doesn't recognize? Properties must be preserved (passthrough) per Constitution Principle VII.
- What happens when the user runs extract against an instance with hundreds of APIs? The tool must handle large-scale instances within reasonable time and memory. Per-resource status lines provide visibility into progress; `--log-level debug` aids diagnosis of slow or failing resources.
- What happens when a publish fails partway through? The tool must report which resources succeeded and which failed, and the user must be able to re-run to complete the remaining items.
- What happens when the artifact directory path contains spaces or special characters? The tool must handle any valid filesystem path.
- What happens when `apiops init` is run in a repo that already has pipeline files? The tool detects existing files and exits with an error listing the conflicts. The user must pass `--force` to overwrite.
- What happens when an API has revisions and the user publishes to a clean APIM instance? The tool must create the root API first, then apply each revision in numeric order with forced revision numbers. Revision ordering must be respected to avoid APIM auto-assignment conflicts.

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide an `apiops extract` command that reads APIM resources from a live instance and writes them as local files. Supported resource types include: APIs (with operations, policies, tags, diagnostics, schemas, releases, revisions, tag descriptions, and wikis), products (with policies, groups, tags, and wikis), backends, named values, loggers, diagnostics, tags, policy fragments, version sets, gateways, groups, subscriptions, global schemas, policy restrictions, documentation resources, and GraphQL API resolvers (with resolver policies).
- **FR-002**: System MUST provide an `apiops publish` command that reads local artifact files and creates, updates, or deletes APIM resources to match the desired state.
- **FR-003**: System MUST support filtering which resources to extract via a YAML configuration file passed with `--filter`. The file contains allowlists per resource type. By default, filtered extraction MUST transitively include resources referenced by the selected resources (e.g., backends, named values, loggers). A `--no-transitive` flag MUST allow opting out of transitive inclusion.
- **FR-004**: System MUST support environment-specific overrides during publish via a YAML configuration file passed with `--overrides` that deep-merges property values into resource definitions.
- **FR-005**: System MUST support incremental publish based on git commit diff, processing only artifact files that changed in a specified commit.
- **FR-006**: System MUST support a `--dry-run` mode for publish that outputs a detailed change plan without applying any modifications.
- **FR-007**: System MUST authenticate to Azure via the `DefaultAzureCredential` chain, supporting managed identity, service principal (client ID/secret/tenant), Azure CLI, and pre-obtained bearer tokens.
- **FR-008**: System MUST process resources in the correct dependency order during publish (creates in dependency order, deletes in reverse dependency order).
- **FR-009**: System MUST treat APIM resource payloads as opaque JSON, preserving unknown properties during extract-edit-publish round-trips without data loss.
- **FR-010**: System MUST support workspace-scoped resources using a single resource handler with a scope parameter, not duplicated entity types.
- **FR-011**: System MUST support multiple API specification formats for extraction: OpenAPI v2 (JSON/YAML), OpenAPI v3 (JSON/YAML), and native formats (GraphQL SDL, WSDL, WADL).
- **FR-012**: System MUST support configuring the APIM REST API version per invocation via a CLI flag or configuration file.
- **FR-024**: System MUST extract all API revisions as sub-folders under each API directory, preserving revision numbers. During publish, the tool MUST create the root API first, then apply revisions in order with forced revision numbers to prevent APIM from auto-assigning.
- **FR-025**: During extraction, the system MUST parallelize across independent resource types (e.g., backends and loggers concurrently) and across resources within each type. Dependencies between types (e.g., APIs depend on version sets) MUST be respected. During publish, resource types MUST be processed in dependency order.
- **FR-026**: All commands MUST emit structured log output to stderr by default (timestamps, log levels, resource context). An `--otel <path>` flag MUST accept a standard OpenTelemetry configuration YAML file to enable trace and metric export. The tool MUST pass this file to the OTel SDK (equivalent to setting `OTEL_CONFIG_FILE`). If `--otel` is not provided, no telemetry is exported. Credentials (API keys, connection strings) MUST NOT be accepted as separate CLI flags — they MUST reside in the OTel config file or environment variables.
- **FR-013**: System MUST provide `--format json|text` on all commands for machine-readable output suitable for CI/CD pipeline consumption. The default format is `text` (human-readable). `--format json` writes structured JSON to stdout. This flag is independent of `--output` (extract directory) and `--source` (publish directory).
- **FR-014**: System MUST handle paginated Azure REST API responses by following `nextLink` continuation tokens.
- **FR-015**: System MUST implement retry logic with exponential backoff for transient HTTP failures and 429 rate-limit responses.
- **FR-016**: System MUST support all Azure sovereign clouds (Public, China, US Government, Germany) via a `--cloud` flag or configuration.
- **FR-017**: System MUST support a `--delete-unmatched` flag on publish to remove APIM resources that are not represented in the local artifacts.
- **FR-018**: System MUST be designed with an extensible command architecture that allows adding new top-level commands without modifying existing command code.
- **FR-019**: System MUST allow the user to specify the artifact directory path via `--output` (extract) or `--source` (publish) flags, defaulting to `./apim-artifacts` when omitted. Both commands MUST work with any valid filesystem path.
- **FR-020**: System MUST provide an `apiops init` command that scaffolds CI/CD pipeline files (GitHub Actions and Azure DevOps), override configuration templates, and artifact directory structure based on user choices.
- **FR-021**: The `apiops init` command MUST provide guidance (and where possible, automation) for creating Azure identities (service principals, federated credentials) and configuring pipeline secrets/service connections required for authentication.
- **FR-022**: The `apiops init` command MUST support both interactive mode (prompts when TTY is available) and non-interactive mode (all options via flags) for CI/CD or scripted usage.
- **FR-027**: The `apiops init` command MUST detect existing files at target paths before generating output. If conflicts are found without `--force`, it MUST list the conflicting files and exit with a non-zero code. If `--force` is set, it MUST warn and overwrite.
- **FR-023**: All commands MUST display per-resource status lines to stderr by default (e.g., `✓ apis/orders-api`, `✓ backends/orders-backend`). A `--log-level <level>` option (values: debug, info, warn, error; default: info) controls verbosity. Setting `--log-level debug` adds diagnostic detail (HTTP requests, response times, retry attempts, dependency resolution) to aid debugging. `--format json` MUST NOT be affected by `--log-level` (structured output remains on stdout).

### Key Entities

- **APIM Service**: The target Azure API Management instance, identified by subscription, resource group, and service name.
- **Artifact Directory**: The local file tree representing the extracted APIM configuration, structured with one folder per resource type.
- **Resource Definition**: An individual APIM resource (API, product, backend, etc.) represented as a JSON file in the artifact directory.
- **Policy**: An APIM policy document represented as an XML file, associated with a service, product, API, or operation.
- **Filter Configuration**: A YAML file specifying which resource types and names to include during extraction.
- **Override Configuration**: A YAML file specifying per-environment property values to merge into resource definitions during publish.
- **Workspace**: An APIM workspace that scopes resources; treated as a context prefix, not a separate entity hierarchy.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Users can extract a complete APIM instance configuration (up to 100 APIs with associated resources) and publish it to a clean instance, producing an identical configuration, within 10 minutes for a typical instance.
- **SC-002**: Round-trip fidelity — extracting from an instance and immediately re-publishing to the same instance produces zero changes reported by `--dry-run`.
- **SC-003**: The `--dry-run` mode accurately predicts 100% of changes that a subsequent publish would make.
- **SC-004**: Incremental publish (commit-based) processes only changed resources, completing in under 30 seconds for typical single-API changes.
- **SC-005**: The tool runs successfully in GitHub Actions and Azure DevOps pipelines using service principal authentication without any manual intervention.
- **SC-006**: Existing APIOps Toolkit users can point the new tool at their existing artifact directories and successfully publish without restructuring their files.
- **SC-007**: Adding a new top-level command requires creating only the command module — no changes to existing command files, the main entry point, or shared infrastructure.
- **SC-008**: Unknown APIM properties introduced in newer API versions are preserved through extract-edit-publish cycles with zero data loss.
- **SC-009**: A new user can go from an empty repository to a working CI/CD pipeline (with extract and publish stages) by running `apiops init` and following the outputted identity-setup instructions, completing the process in under 15 minutes.
- **SC-010**: Generated pipeline files reference the user's chosen artifact directory and require no manual path editing after init.

## Assumptions

- Users have an Azure subscription with permissions to read and write APIM resources (Contributor or equivalent role on the APIM instance).
- The Azure APIM REST API remains stable within a given API version; the tool targets a default version but allows override.
- The APIOps Toolkit artifact directory layout is the established convention and maintaining compatibility is strongly preferred over a new layout.
- Internet connectivity is available when running extract and publish (offline-only workflows are out of scope).
- The tool is distributed as an npm package and/or standalone binary; distribution mechanism details are deferred to implementation planning.
- APIM API secrets (named value values marked as secrets, subscription keys) are NOT extracted in plaintext — they must be handled via override configuration or key vault references.
- GraphQL and SOAP/WSDL APIs are supported for extraction in their native formats; format conversion between these and OpenAPI is out of scope.
- Instance-specific resources (authorization servers, OpenID Connect providers, certificates, caches, identity providers, portal configuration, content types/items, notifications, users, tenant settings) are intentionally excluded — they do not belong in environment-promotion pipelines.
