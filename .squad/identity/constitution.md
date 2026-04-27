<!--
  Sync Impact Report
  ==================================================
  Version change: 2.0.1 → 2.1.0
  Modified principles:
    - I. CLI-First Design: clarified interactive mode
      permitted when TTY present; all interactive inputs
      MUST have non-interactive flag equivalents
    - IV. Idempotent Operations: added destructive
      operation safeguard requiring explicit opt-in
  Added sections:
    - VIII. Secret & Credential Safety (new principle)
  Removed sections: none
  Other changes:
    - Technology Constraints: updated target commands
      to include `apiops init`
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ verified
    - .specify/templates/spec-template.md ✅ verified
    - .specify/templates/tasks-template.md ✅ verified
  Follow-up TODOs: none
  ==================================================
-->

# apiops-cli Constitution

## Core Principles

### I. CLI-First Design

All functionality MUST be exposed as `apiops <command>`
subcommands with consistent argument patterns and
predictable behavior.

- Command structure: `apiops extract [options]`,
  `apiops publish [options]`, etc. Each top-level verb
  maps to one core operation.
- Text-based I/O protocol: arguments and stdin for input,
  stdout for results, stderr for errors and diagnostics.
- Every command MUST support `--format json` for
  machine-readable output and human-readable format by
  default.
- Exit codes MUST follow convention: 0 for success,
  non-zero for failure, with distinct codes for different
  error classes.
- Commands MUST be composable via pipes and standard shell
  tooling.
- CI/CD ergonomics: commands MUST run non-interactively
  (no prompts) when stdout is not a TTY. All configuration
  MUST be expressible via CLI flags or config files — never
  requiring environment variables as the only input method.
- Interactive prompts are permitted when a TTY is detected,
  but every interactive input MUST have a non-interactive
  flag equivalent so the same operation can be scripted.

### II. Azure APIM Native

The tool MUST model Azure API Management concepts directly
and align domain vocabulary with APIM terminology.

- First-class entities: APIs, operations, policies, products,
  subscriptions, backends, named values, loggers,
  diagnostics, policy fragments, version sets, gateways,
  groups, and tags.
- Workspaces MUST be treated as a scoped context, not as
  duplicated entity types. A single resource handler MUST
  support both service-level and workspace-scoped resources
  via a context/scope parameter.
- All APIM interactions MUST use the Azure REST API directly
  with `@azure/identity` for authentication. The tool MUST
  NOT depend on typed APIM SDK models for resource payloads.
- Resource identifiers MUST match APIM naming conventions
  so users can map between CLI output and the Azure portal.

### III. Configuration as Code

APIM configurations MUST be represented as declarative,
version-controllable files that serve as the source of truth.

- Configuration files MUST be extractable from a live APIM
  instance and re-applicable to produce an identical state.
- File formats MUST be diff-friendly (XML for policies,
  YAML or JSON for resource definitions, with stable key
  ordering).
- Schema validation MUST be available for configuration
  files before they are applied.
- **Artifact format backward compatibility**: The v2
  extracted artifact directory structure MUST be compatible
  with the v1 APIOps layout (`apis/{name}/apiInformation.json`,
  `policy.xml`, etc.). If breaking changes are unavoidable,
  a documented migration path and conversion command MUST
  be provided.

### IV. Idempotent Operations

Every write operation MUST be safely re-runnable, producing
the same end state regardless of how many times it executes.

- All mutating commands MUST support a `--dry-run` (or
  `--what-if`) mode that previews changes without applying.
- Partial failures MUST leave the system in a recoverable
  state; operations MUST NOT corrupt existing configuration.
- Diff output MUST clearly show what will change before
  any destructive action proceeds.
- Destructive operations (resource deletion, overwriting
  live configurations) MUST NOT be default behavior.
  They MUST require explicit opt-in via dedicated flags
  (e.g., `--delete-unmatched`). Omitting the flag MUST
  result in a safe, non-destructive run.

### V. Simplicity

Start with minimal viable commands; avoid premature
abstractions.

- Each command MUST do one thing well. Combine via
  composition, not monolithic flags.
- YAGNI applies: features are added when a concrete need
  is demonstrated, not when anticipated.
- Complexity MUST be justified in writing (plan.md or PR
  description) before being accepted.

### VI. Testability by Design

All business logic MUST be testable in isolation without
requiring live Azure resources.

- Core operations MUST depend on abstractions (e.g.,
  `IApimClient`, `IArtifactStore`), not on concrete HTTP
  or file-system implementations.
- Unit tests MUST cover command logic, diffing, merge, and
  validation without network or disk I/O.
- Integration tests against real APIM instances are
  complementary but MUST NOT be the only test layer.
- Sealed or static dependencies MUST be wrapped behind
  interfaces to enable mocking and substitution.

### VII. Forward Compatibility

The tool MUST handle APIM resource payloads without
requiring hand-crafted models for every property.

- Resource bodies MUST be treated as opaque JSON trees
  (passthrough) rather than mapped to typed DTOs. The
  tool manipulates structure (create, update, delete,
  diff) without needing to understand every field.
- Unknown or new APIM properties MUST be preserved during
  extract → edit → publish round-trips; silent data loss
  is prohibited.
- The APIM REST API version MUST be configurable per
  invocation (via flag or config) so users can target
  preview or GA versions without code changes.

### VIII. Secret & Credential Safety

The tool MUST NOT expose secrets, credentials, or
sensitive values in output, logs, or artifact files.

- APIM named values marked as secrets MUST be replaced
  with placeholders (e.g., key vault references or
  empty values with a marker) during extraction. Secret
  values MUST NOT be written to disk in plaintext.
- Credentials (client secrets, bearer tokens, subscription
  keys) MUST NOT appear in stdout, stderr, `--format json`
  results, or diagnostic logs.
- The `apiops init` command MUST NOT persist credentials
  to generated pipeline files. It MUST direct users to
  platform-native secret storage (GitHub Secrets, Azure
  DevOps variable groups marked as secret, etc.).
- Override configuration files that contain secret values
  MUST be documented as requiring secure handling (e.g.,
  added to `.gitignore`, stored in secret managers).

## Technology Constraints

- **Language**: TypeScript (Node.js runtime)
- **CLI Framework**: Commander
- **Azure Integration**: `@azure/identity` for
  authentication; raw REST calls to the APIM management
  plane (no typed `@azure/arm-apimanagement` SDK for
  resource payloads)
- **Build**: TypeScript compiler with strict mode enabled
- **Package Manager**: npm
- **Linting**: ESLint with TypeScript rules
- **Testing**: Vitest (native ESM + TypeScript support);
  unit tests mandatory, integration tests complementary
- **Minimum Node.js**: Active LTS at time of first release
- **Target Platforms**: Windows, macOS, Linux
- **Target Commands**: `apiops extract`, `apiops publish`,
  `apiops init`

## Development Workflow

- All changes MUST go through pull requests with at least
  one reviewer approval before merge.
- The default branch is protected; direct pushes are
  prohibited.
- Every PR MUST pass CI checks (lint, build, test) before
  merge is permitted.
- Feature work follows the speckit flow: spec → plan →
  tasks → implement.
- Commit messages MUST follow Conventional Commits format
  (e.g., `feat:`, `fix:`, `docs:`, `chore:`).

## Governance

This constitution is the supreme governance document for
the apiops-cli project. It supersedes all other practices
and guidelines when conflicts arise.

- **Amendment procedure**: Any team member MAY propose an
  amendment via PR. Amendments require approval from at
  least two maintainers before merge.
- **Versioning**: Constitution versions follow semantic
  versioning — MAJOR for principle removals or
  redefinitions, MINOR for additions or material expansions,
  PATCH for wording clarifications.
- **Compliance review**: All PRs and code reviews MUST
  verify alignment with these principles. Violations MUST
  be resolved or justified with a documented exception
  before merge.

**Version**: 2.1.0 | **Ratified**: 2026-04-06 | **Last Amended**: 2026-04-06
