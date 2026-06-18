# Tasks: APIops CLI Tool

**Input**: Design documents from `/specs/001-apiops-cli/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in feature specification. Test tasks omitted.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Paths assume single project layout per plan.md: `src/`, `tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Initialize Node.js project with package.json, tsconfig.json, .eslintrc, and Vitest config in repository root
- [x] T002 Create project directory structure: src/cli/, src/models/, src/services/, src/clients/, src/lib/, tests/unit/, tests/integration/, tests/contract/
- [x] T003 [P] Install core dependencies: commander, @azure/identity, js-yaml, simple-git
- [x] T004 [P] Install dev dependencies: typescript, vitest, eslint, @types/node, @types/js-yaml
- [x] T005 [P] Configure npm scripts in package.json: build, test, lint, start (ts-node src/cli/index.ts)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Define ResourceType enum with all 33 resource types in src/models/resource-types.ts (values, ARM path suffixes, artifact directory names, info file names per data-model.md ResourceType table)
- [x] T007 Define core TypeScript interfaces in src/models/types.ts: ResourceDescriptor, ResourcePayload, ApimServiceContext, DependencyEdge (per data-model.md)
- [x] T008 [P] Define config interfaces in src/models/config.ts: ExtractConfig, FilterConfig, PublishConfig, OverrideConfig, InitConfig (per data-model.md)
- [x] T009 [P] Define IApimClient interface in src/clients/iapim-client.ts (6 methods per contracts/iapim-client.md)
- [x] T010 [P] Define IArtifactStore interface in src/clients/iartifact-store.ts (8 methods per contracts/iartifact-store.md)
- [x] T011 Implement static dependency graph and topological sort in src/lib/dependency-graph.ts (33 resource types, 4 tiers per data-model.md DependencyGraph; include cycle-detection assertion to guard against future edge additions)
- [x] T012 Implement resource descriptor ↔ ARM URI mapping in src/lib/resource-uri.ts (builds full ARM URL from ApimServiceContext + ResourceDescriptor, including workspace prefix)
- [x] T013 Implement resource descriptor ↔ artifact file path mapping in src/lib/resource-path.ts (maps descriptor to directory/file paths per data-model.md artifact conventions)
- [x] T014 [P] Implement structured logger in src/lib/logger.ts (stderr output, timestamps, log levels, --verbose support per FR-023/FR-026)
- [x] T015 [P] Implement YAML config loader in src/lib/config-loader.ts (parse filter YAML, override YAML, OTel config with js-yaml; validate against FilterConfig/OverrideConfig schemas)
- [x] T016 Implement Azure REST HTTP client in src/clients/apim-client.ts (implements IApimClient: DefaultAzureCredential auth, nextLink pagination, Retry-After/429 handling, exponential backoff, provisioningState polling per research.md R1)
- [x] T017 Implement filesystem artifact store in src/clients/artifact-store.ts (implements IArtifactStore: read/write resource JSON, policy XML, API specs, association files, wiki markdown; UTF-8 encoding; directory creation per contracts/iartifact-store.md)
- [x] T018 [P] Implement parallel execution runner in src/lib/parallel-runner.ts (p-limit based concurrency control, Promise.allSettled, configurable concurrency per research.md R8)
- [x] T019 Set up Commander program entry point in src/cli/index.ts (program name, version, global options --verbose/--otel/--format/--subscription-id/--cloud, subcommand registration pattern per FR-018)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Extract APIM Configuration (Priority: P1) 🎯 MVP

**Goal**: Extract all 33 resource types from a live APIM instance to local artifact files with filtering, transitive dependency resolution, and parallel execution.

**Independent Test**: Run `apiops extract` against an APIM instance. Verify output directory matches expected file structure with all resource types.

### Implementation for User Story 1

- [ ] T020 [US1] Implement extraction orchestrator in src/services/extract-service.ts (coordinate resource type extraction across dependency tiers using dependency-graph.ts and parallel-runner.ts; per-resource status output per FR-023)
- [ ] T021 [US1] Implement resource type extractor in src/services/resource-extractor.ts (generic extract logic: list resources via IApimClient, write each to IArtifactStore; handles all 33 types using ResourceType metadata; MUST preserve opaque JSON per FR-009)
- [ ] T022 [US1] Implement API-specific extraction logic in src/services/api-extractor.ts (API revisions: list revisions, extract each as sub-folder with ;rev=N naming; API specs: detect format and write specification.{ext}; operations: extract operation policies; GraphQL resolvers + resolver policies)
- [ ] T023 [US1] Implement product-specific extraction logic in src/services/product-extractor.ts (product associations: apis.json, groups.json; product policies; product wikis)
- [ ] T024 [US1] Implement filter service in src/services/filter-service.ts (load FilterConfig, apply inclusive allowlist per resource type, case-insensitive matching, API root-name matching for revisions per research.md R4)
- [ ] T025 [US1] Implement transitive dependency resolver in src/services/transitive-resolver.ts (scan policies for named value refs \{\{name\}\}, backend refs set-backend-service, policy fragment refs include-fragment; scan apiInformation.json for apiVersionSetId; fixed-point expansion; --no-transitive bypass per research.md R4)
- [ ] T026 [US1] Implement secret redaction in src/services/secret-redactor.ts (detect properties.secret === true on named values, replace properties.value with redaction marker per research.md R5)
- [ ] T027 [US1] Implement workspace-scoped extraction in src/services/workspace-extractor.ts (list workspaces, extract workspace-scoped resources under workspaces/{name}/ using same resource-extractor with workspace context prefix per FR-010)
- [ ] T028 [US1] Register extract command in src/cli/extract-command.ts (Commander subcommand with --resource-group, --service-name, --output, --filter, --no-transitive flags; wire to extract-service per contracts/cli-commands.md)
- [ ] T029 [US1] Implement JSON output mode for extract in src/cli/extract-command.ts (--format json: machine-readable JSON to stdout with resource counts and file paths per FR-013)

**Checkpoint**: `apiops extract` works end-to-end for all 33 resource types with filtering, parallelism, and secret redaction

---

## Phase 4: User Story 2 — Publish Configuration to APIM (Priority: P1)

**Goal**: Publish local artifact files to an APIM instance with dependency ordering, overrides, dry-run, incremental publish, and delete-unmatched support.

**Independent Test**: Extract from one instance, publish to another. Verify target matches artifacts. Run dry-run and confirm zero changes on re-publish.

### Implementation for User Story 2

- [x] T030 [US2] Implement publish orchestrator in src/services/publish-service.ts (coordinate PUT/DELETE across dependency tiers: PUTs in dependency order, DELETEs in reverse order; per-resource status output; exit code 0/1/2 per contracts/cli-commands.md)
- [x] T031 [US2] Implement resource publisher in src/services/resource-publisher.ts (generic publish logic: read resource from IArtifactStore, apply overrides, PUT via IApimClient; handles all 33 types using ResourceType metadata; MUST preserve opaque JSON per FR-009)
- [x] T032 [US2] Implement API-specific publish logic in src/services/api-publisher.ts (create root API first, then revisions in numeric order with forced revision numbers; publish operations, policies, schemas, releases, resolvers, tag descriptions, wikis per FR-024; handle SOAP/WSDL import via `?import=true&format=wsdl-link` query parameter when API type is SOAP)
- [x] T033 [US2] Implement override merger in src/services/override-merger.ts (load OverrideConfig, deep-merge property values into resource JSON before PUT; case-insensitive key matching; warning for unknown keys per data-model.md OverrideConfig)
- [x] T034 [US2] Implement dry-run reporter in src/services/dry-run-reporter.ts (compare artifact resources vs APIM state, output [DRY RUN] PUT/DELETE/SKIP lines per contracts/cli-commands.md; summary counts)
- [x] T035 [US2] Implement delete-unmatched service in src/services/delete-unmatched-service.ts (list current APIM resources, diff against artifact descriptors, generate DELETE actions in reverse dependency order; requires --delete-unmatched flag per FR-017)
- [x] T036 [US2] Implement git diff service in src/services/git-diff-service.ts (use simple-git to compute changed files between COMMIT_ID~1..COMMIT_ID; map changed file paths to ResourceDescriptors via resource-path.ts; detect deletes per research.md R6)
- [x] T037 [US2] Register publish command in src/cli/publish-command.ts (Commander subcommand with --resource-group, --service-name, --source, --overrides, --dry-run, --delete-unmatched flags; COMMIT_ID env var; wire to publish-service per contracts/cli-commands.md)
- [x] T038 [US2] Implement JSON output mode for publish in src/cli/publish-command.ts (--format json: machine-readable JSON to stdout with action list and summary per FR-013)

**Checkpoint**: `apiops publish` works end-to-end with overrides, dry-run, incremental, and delete-unmatched

---

## Phase 5: User Story 3 — CI/CD Pipeline Integration (Priority: P2)

**Goal**: Ensure extract and publish work seamlessly in automated pipelines with non-interactive auth, structured output, and appropriate exit codes.

**Independent Test**: Run extract and publish in a GitHub Actions workflow using service principal auth. Verify non-interactive execution with correct exit codes.

### Implementation for User Story 3

- [x] T039 [US3] Implement sovereign cloud support in src/lib/cloud-config.ts (map --cloud flag to ARM base URLs and auth scopes for Public, China, US Government, Germany per FR-016)
- [x] T040 [US3] Add explicit auth flags to CLI in src/cli/index.ts (--client-id, --client-secret, --tenant-id global options; pass to DefaultAzureCredential environment vars per FR-007; ensure no TTY prompts)
- [x] T041 [P] [US3] Implement exit code handling in src/lib/exit-codes.ts (0 success, 1 partial failure, 2 fatal; aggregate per-resource results per contracts/cli-commands.md)

**Checkpoint**: CLI runs in CI/CD pipelines without human interaction

---

## Phase 6: User Story 4 — Guided Repository & Pipeline Setup (Priority: P2)

**Goal**: `apiops init` scaffolds CI/CD pipelines, artifact directory, sample configs, and guides identity setup.

**Independent Test**: Run `apiops init` in empty repo. Verify generated pipeline files, configs, and identity instructions.

### Implementation for User Story 4

- [x] T042 [US4] Implement init orchestrator in src/services/init-service.ts (coordinate interactive prompts or flag-based config: CI provider, artifact dir, environment names; generate all scaffold files)
- [x] T043 [P] [US4] Create GitHub Actions extract workflow template in src/templates/github-actions/extract-workflow.ts (scheduled/manual trigger, service principal auth, artifact dir placeholder per spec US4 scenario 2)
- [x] T044 [P] [US4] Create GitHub Actions publish workflow template in src/templates/github-actions/publish-workflow.ts (push-to-main trigger, environment stages, COMMIT_ID pass-through, override files per env per spec US4 scenario 2)
- [x] T045 [P] [US4] Create Azure DevOps extract pipeline template in src/templates/azure-devops/extract-pipeline.ts (equivalent structure for ADO per spec US4 scenario 3)
- [x] T046 [P] [US4] Create Azure DevOps publish pipeline template in src/templates/azure-devops/publish-pipeline.ts (stages, environments, variable groups per spec US4 scenario 3)
- [x] T047 [P] [US4] Create sample filter and override config templates in src/templates/configs/ (filter.yaml sample, overrides.{env}.yaml samples per spec US4 scenario 1)
- [x] T048 [US4] Implement identity setup guide generator in src/services/identity-guide-service.ts (output step-by-step instructions for service principal creation, RBAC roles, federated credentials, pipeline secrets/service connections; optional az CLI automation per FR-021)
- [x] T049 [US4] Implement interactive prompt handler in src/services/prompt-service.ts (TTY detection, question prompts for CI provider/artifact dir/environments; --non-interactive bypass per FR-022)
- [x] T050 [US4] Register init command in src/cli/init-command.ts (Commander subcommand with --ci, --non-interactive, --artifact-dir, --environments flags; wire to init-service per contracts/cli-commands.md)
- [x] T051 [US4] Implement existing-file conflict detection in src/services/init-service.ts (detect existing pipeline/config files, warn before overwriting or offer to skip per edge case)

**Checkpoint**: `apiops init` generates working pipeline scaffolds for both GitHub Actions and Azure DevOps

---

## Phase 7: User Story 5 — Extensible Command Architecture (Priority: P3)

**Goal**: Ensure new commands can be added without modifying existing code.

**Independent Test**: Add a placeholder `apiops version` command and confirm it appears in `--help` without changes to other files.

### Implementation for User Story 5

- [ ] T052 [US5] Implement command auto-discovery in src/cli/index.ts (scan src/cli/*-command.ts files or use explicit registration array; new commands appear in --help automatically per FR-018/SC-007)
- [ ] T053 [US5] Extract shared command infrastructure in src/cli/shared.ts (common option builders for --resource-group/--service-name/--subscription-id/--verbose/--otel; shared APIM client factory; shared artifact store factory)
- [ ] T054 [US5] Create command developer guide in src/cli/README.md (document how to add a new command: file naming, interface shape, option reuse, testing pattern)

**Checkpoint**: Adding a new command requires only creating one file in src/cli/

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T055 [P] Implement OTel integration in src/lib/otel-setup.ts (load --otel config YAML, initialize NodeSDK with OTLP exporter, create spans per resource type/resource, metrics for counts/duration per research.md R9)
- [ ] T056 [P] Add --api-version global flag support in src/cli/index.ts and src/clients/apim-client.ts (override default 2024-05-01 per FR-012)
- [ ] T058 Run quickstart.md validation (execute each quickstart command against a test APIM instance, verify expected outputs)
- [ ] T059 Add bin entry to package.json and shebang to src/cli/index.ts for global npm install (`npx apiops` / `npm install -g`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - US1 (Extract) and US2 (Publish) share foundational components but can be built in parallel
  - US2 depends on IArtifactStore reading (T017) which is foundational
  - US3 (CI/CD) enhances US1+US2 but can be done in parallel
  - US4 (Init) is fully independent of US1-US3
  - US5 (Extensibility) refactors CLI registration — best done after US1+US2 commands exist
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (Extract, P1)**: Can start after Phase 2. No dependencies on other stories.
- **US2 (Publish, P1)**: Can start after Phase 2. Shares foundational types with US1 but is independently implementable. Uses IArtifactStore for reading (same interface US1 uses for writing).
- **US3 (CI/CD, P2)**: Can start after Phase 2. Enhances global CLI options. Independent of US1/US2 implementation.
- **US4 (Init, P2)**: Can start after Phase 2. Fully independent — generates files, no APIM interaction.
- **US5 (Extensibility, P3)**: Best after US1+US2 exist so command registration pattern can be validated.

### Within Each User Story

- Orchestrator before individual services
- Services before CLI command registration
- Core logic before output formatting (JSON mode)

### Parallel Opportunities

Within Phase 2 (Foundational):
- T008 (config interfaces), T009 (IApimClient), T010 (IArtifactStore), T014 (logger), T015 (config loader), T018 (parallel runner) — all independent
- T016 (apim-client) and T017 (artifact-store) — independent of each other but depend on their interfaces

Within Phase 3 (US1 Extract):
- T024 (filter), T025 (transitive resolver), T026 (secret redactor), T027 (workspace extractor) — independent once T020/T021 exist

Within Phase 6 (US4 Init):
- T043, T044, T045, T046, T047 — all template files can be written in parallel

---

## Parallel Example: User Story 1

```text
# After Phase 2 completes, launch extract orchestrator:
T020: Implement extraction orchestrator in src/services/extract-service.ts
T021: Implement resource type extractor in src/services/resource-extractor.ts

# Then these can all run in parallel (different files, independent):
T024: Filter service           → src/services/filter-service.ts
T025: Transitive resolver      → src/services/transitive-resolver.ts
T026: Secret redactor          → src/services/secret-redactor.ts
T027: Workspace extractor      → src/services/workspace-extractor.ts

# Then API/product-specific logic:
T022: API extraction logic     → src/services/api-extractor.ts
T023: Product extraction logic → src/services/product-extractor.ts

# Finally CLI registration:
T028: Extract command          → src/cli/extract-command.ts
T029: JSON output mode         → src/cli/extract-command.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 (Extract)
4. **STOP and VALIDATE**: Extract from real APIM instance, verify all 33 resource types
5. Deploy/demo if ready — extract alone provides value

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (Extract) → Test independently → MVP!
3. Add US2 (Publish) → Test round-trip (extract → publish → extract → dry-run = 0 changes)
4. Add US3 (CI/CD) → Test in GitHub Actions pipeline
5. Add US4 (Init) → Test scaffold generation in empty repo
6. Add US5 (Extensibility) → Verify new command pattern
7. Polish → OTel, quickstart validation
