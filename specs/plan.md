# Implementation Plan: APIops CLI Tool

**Branch**: `001-apiops-cli` | **Date**: 2026-04-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-apiops-cli/spec.md`

## Summary

Build a TypeScript CLI tool (`apiops`) that extracts Azure API Management configuration to local files and publishes local files back to APIM instances. The tool uses opaque JSON passthrough (no typed DTOs) for forward compatibility, Commander for CLI framework, `@azure/identity` for authentication, and raw Azure REST API calls. It supports filtered extraction with transitive dependency resolution, environment overrides for multi-stage deployments, incremental git-based publish, dry-run mode, parallel extraction, and a guided `init` command for repository/pipeline scaffolding.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js Active LTS, currently 22.x)
**Primary Dependencies**: Commander (CLI), `@azure/identity` (auth), `js-yaml` (YAML parsing), `simple-git` (git diff for incremental publish)
**Storage**: Local filesystem (artifact directories); no database
**Testing**: Vitest (native ESM + TypeScript)
**Target Platform**: Windows, macOS, Linux (cross-platform CLI)
**Project Type**: CLI tool (npm package + standalone binary via `pkg` or `esbuild`)
**Performance Goals**: Extract 100-API instance in <10 min; incremental publish <30s (SC-001, SC-004)
**Constraints**: Cross-type parallel extraction; dependency-ordered publish; zero data loss on round-trip
**Scale/Scope**: Single CLI binary, ~5,000-7,000 LOC target (vs v1's ~32,000 LOC)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Constitution Check

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | CLI-First Design | PASS | Three subcommands (`extract`, `publish`, `init`); all interactive inputs have `--flag` equivalents; structured JSON/text output modes |
| II | Azure APIM Native | PASS | Raw REST to APIM management plane; workspace-as-scope (single output dir, no duplication); dependency-aware ordering |
| III | Configuration as Code | PASS | YAML filter files, YAML override files, APIM JSON artifacts in version-controllable directory structure |
| IV | Idempotent Operations | PASS | `--dry-run` on publish; destructive deletes require explicit `--delete-unmatched` opt-in; re-running extract/publish produces same result |
| V | Simplicity | PASS | Single project layout; JSON passthrough eliminates ~20+ DTO types from v1; Commander replaces hand-rolled CLI parsing |
| VI | Testability by Design | PASS | Interface-based `IApimClient` and `IArtifactStore` abstractions; Vitest; contract tests for REST API |
| VII | Forward Compatibility | PASS | Opaque JSON passthrough — no typed ARM resource models; unknown properties preserved on round-trip |
| VIII | Secret & Credential Safety | PASS | `@azure/identity` DefaultAzureCredential (no secrets in CLI args); `--otel <path>` for config file (no endpoint URLs in process list); output scrubbing for named values |

**Gate**: All 8 principles satisfied. No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── cli/                 # Commander command definitions (extract, publish, init)
├── models/              # TypeScript interfaces/types (resource metadata, config schemas)
├── services/            # Core business logic (extraction, publishing, dependency resolution)
├── clients/             # Azure APIM REST client, artifact filesystem client
└── lib/                 # Shared utilities (logging, OTel setup, YAML helpers, parallel runner)

tests/
├── unit/                # Pure logic tests (dependency graph, config parsing, filtering)
├── integration/         # Tests against real/emulated APIM endpoints
└── contract/            # API contract tests (REST response shape validation)
```

**Structure Decision**: Single-project layout (Option 1). This is a CLI tool with no frontend/backend split. The `clients/` directory is added to separate I/O adapters (REST, filesystem) from business logic in `services/`, supporting testability (Constitution VI) via interface-based dependency injection.

## Complexity Tracking

> No Constitution Check violations. Table intentionally left empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
