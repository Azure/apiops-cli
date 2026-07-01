# Changelog

All notable changes to the APIOps CLI are documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/) with alpha pre-release tags.

## [0.4.0-alpha.0] — 2026-07-01

### Breaking Changes

- **`apiops init` output filenames renamed** — identity setup guides and Copilot prompts are now emitted as `APIOPS-PIPELINE-IDENTITY-SETUP.md` / `APIOPS-WORKFLOW-IDENTITY-SETUP.md` and `apiops-setup-pipeline-identity.prompt.md` / `apiops-setup-workflow-identity.prompt.md`. Generated pipeline files are now named `run-apiops-extractor.yml` / `run-apiops-publisher.yml`. Users who re-run `apiops init` after upgrading will see the new files alongside any previously generated ones; delete the old files if you no longer want them tracked ([#200](https://github.com/Azure/apiops-cli/pull/200))

### Features

- **Secret redaction in policy XML** — `apiops extract` now redacts inline secrets (including literal bearer tokens in `Authorization` headers) from extracted policy files while preserving named-value references. `apiops publish` performs a pre-flight scan of all artifacts and aborts (including in dry-run mode) if any `*** REDACTED ***` markers remain, preventing accidental secret exposure ([#199](https://github.com/Azure/apiops-cli/pull/199))
- **JSON schemas and Copilot prompts for filter/override configuration** — new `schemas/extractor-config.schema.json` and `schemas/override-config.schema.json` provide IDE autocompletion for `configuration.extractor.yaml` and `configuration.{env}.yaml` via the `yaml-language-server` `$schema` directive. `apiops init` now also lays down `apiops-configure-filter.prompt.md` and `apiops-configure-overrides.prompt.md` to conversationally guide users through building these files. Schemas are auto-generated from the TypeScript types on every build so they stay in sync ([#183](https://github.com/Azure/apiops-cli/pull/183))
- **Dry-run validation gate in generated publish pipelines** — GitHub Actions and Azure DevOps publish templates emitted by `apiops init` now run `apiops publish --dry-run` before every real publish step. If the dry-run fails (connectivity, invalid resources, permission errors), the pipeline halts before touching APIM, preventing partial-failure states ([#182](https://github.com/Azure/apiops-cli/pull/182))
- **Identity setup guides rewritten for UI workflows** — the manual identity setup guides emitted by `apiops init` now walk users through the Azure portal, Azure DevOps, and GitHub web UIs with step-by-step instructions and links to official docs, while the companion `.prompt.md` files remain the CLI/scripted path for Copilot-driven setup ([#200](https://github.com/Azure/apiops-cli/pull/200))

### Bug Fixes

- **Removed stale `mcpServerInformation.json` references** — follow-up to #173, which moved MCP server configuration into `apiInformation.json`. Documentation (`docs/reference/artifact-format.md`, `docs/reference/resource-types.md`) and the `all-resource-types` integration test manifest now match the post-#173 artifact layout ([#205](https://github.com/Azure/apiops-cli/pull/205))

## [0.3.0-alpha.0] — 2026-06-25

### Breaking Changes

- **Removed unimplemented CLI options** — `--spec-format` (extract command) and `--otel` (global) have been removed from the CLI, docs, and specs. Both were documented but never implemented, so no functional behavior changes for users who weren't relying on them ([#165](https://github.com/Azure/apiops-cli/pull/165))

### Features

- **Wildcard pattern matching in filter configuration** — all name-based filter fields (`apis`, `backends`, `namedValues`, etc.) now accept glob-style patterns with `*` and `?`. Exact names still work alongside patterns ([#160](https://github.com/Azure/apiops-cli/pull/160))
- **Workspace sub-resource filtering** — nested workspace filters are now applied at runtime (previously documented but not implemented). Wildcard patterns in the `workspaces` list trigger discovery-then-filter instead of being used as literal names. Adds `schemas` field on `WorkspaceSubFilter` ([#160](https://github.com/Azure/apiops-cli/pull/160))
- **Token substitution validation in generated GitHub Actions publish workflow** — `apiops init` now adds a validation step between token substitution and publish that greps for unresolved \`{#[...]#}\` tokens and fails the job with a clear list of unmapped names. Mirrors the existing Azure DevOps behavior ([#158](https://github.com/Azure/apiops-cli/pull/158))
- **MCP publish from embedded API metadata** — MCP configuration is now read/written exclusively from `apiInformation.json`; the redundant `mcpServerInformation.json` sidecar is no longer produced or consumed. Legacy sidecars are ignored. Tool operation references are rewritten from source to target ARM IDs before override application so overrides still win ([#173](https://github.com/Azure/apiops-cli/pull/173))
- **Association scope tracking for round-trip correctness** — extract/publish now records and reconstructs whether each linked resource (e.g. workspace product → built-in group) is service-scoped or workspace-scoped, producing correct ARM paths in both directions. Backward-compatible with legacy artifact files that only contain `name`. 409 "link already exists" responses are treated as idempotent successes ([#175](https://github.com/Azure/apiops-cli/pull/175))

### Bug Fixes

- **Resource group log masking preserves meaningful segments** — `Protect-ResourceGroupName` now detects resource group names ending with a long numeric suffix (>=6 digits, typical of GitHub `run_id` values) and preserves the last dash-separated segment before the number. Output goes from `rg-...1553476` to `rg-...src-27781553476`, making source vs target groups distinguishable in logs ([#168](https://github.com/Azure/apiops-cli/pull/168))
- **Override config template no longer hardcodes a secret** — the generated `configuration.override.yaml` from `apiops init` now uses a \`{#[DB\_Connection\_String]#}\` token placeholder for the connection-string example (aligned with the pipeline substitution format) and drops the confusing "APIOps Toolkit" reference comment ([#164](https://github.com/Azure/apiops-cli/pull/164))

### Docs & Testing

- **Incremental publish behavior documented** — clarified that changes to override files alone don't trigger incremental publish; only API/policy/etc. artifact changes do ([#159](https://github.com/Azure/apiops-cli/pull/159))
- **Environment overrides guide improvements** — expanded examples and clarifications in `docs/guides/environment-overrides.md` ([#166](https://github.com/Azure/apiops-cli/pull/166))
- **All-types round-trip test imports Petstore Swagger** — the all-resource-types integration test now imports the canonical Petstore Swagger spec in both V2 and V3 forms, exercising a broader surface ([#171](https://github.com/Azure/apiops-cli/pull/171))

## [0.2.1-alpha.0] — 2026-06-12

### Features

- **Token substitution in publish pipelines** — \`{#[TOKEN\_NAME]#}\` placeholders are now resolved during publish, matching APIOps Toolkit behavior ([#127](https://github.com/Azure/apiops-cli/pull/127))

### Bug Fixes

- **Named value reference resolution** — logger credentials now correctly resolve `{{displayName}}` refs across environments; auto-generated named values are published when an override is provided ([#145](https://github.com/Azure/apiops-cli/pull/145))
- **Redacted secret guard** — secret named values with `*** REDACTED ***` placeholder are skipped during publish with a clear warning ([#145](https://github.com/Azure/apiops-cli/pull/145))
- **Schema ref stripping extended** — removes stale `schemaId`/`typeName` from `queryParameters`, `headers`, `templateParameters`, and response headers during operation PATCH ([#145](https://github.com/Azure/apiops-cli/pull/145))
- **Workspace ARM paths** — use workspace-specific ARM paths for association resources (tag links, product links) ([#136](https://github.com/Azure/apiops-cli/pull/136))

### Docs & Testing

- **Comprehensive environment override documentation** — added examples for all resource types, auto-generated named value walkthrough, and gotchas for secrets and loggers ([#145](https://github.com/Azure/apiops-cli/pull/145))
- **Override config template** — added logger `credentials.instrumentationKey` example ([#145](https://github.com/Azure/apiops-cli/pull/145))

## [0.2.0-alpha.0] — 2026-06-10

### Features

- **A2A (Agent-to-Agent) API support** — full extract/publish round-trip for A2A protocol APIs ([#89](https://github.com/Azure/apiops-cli/pull/89))
- **ApiOperation as first-class resource** — operations are persisted individually with PATCH reconciliation for drift-free round-trips ([#104](https://github.com/Azure/apiops-cli/pull/104))
- **Async LRO polling** — long-running APIM operations are polled to completion; OpenAPI specs are sanitized before import ([#112](https://github.com/Azure/apiops-cli/pull/112))
- **Workspace support on V2 SKUs** — workspace-scoped resources (APIs, products, backends, named values, tags) are extracted and published with correct ARM paths ([#128](https://github.com/Azure/apiops-cli/pull/128), [#129](https://github.com/Azure/apiops-cli/pull/129))
- **Integration test split into 7 phases** — deploy, extract, validate, override, publish, compare, teardown — each runnable independently ([#92](https://github.com/Azure/apiops-cli/pull/92))

### Bug Fixes

- **Override & filter config alignment** — fully aligned with APIOps Toolkit array-based format ([#102](https://github.com/Azure/apiops-cli/pull/102), [#115](https://github.com/Azure/apiops-cli/pull/115))
- **Schema ref stripping** — removes stale `schemaId`/`typeName` from operation representations during post-import PATCH reconciliation ([#111](https://github.com/Azure/apiops-cli/pull/111))
- **Windows cmd.exe quoting** — fixed stdin and argument quoting issues in `Invoke-MaskedProcess` ([#110](https://github.com/Azure/apiops-cli/pull/110))

### Docs & Testing

- **Extract filter documentation** — documented full filter surface and explicit exclude-all semantics ([#103](https://github.com/Azure/apiops-cli/pull/103))
- **Hardened teardown** — Phase 7 handles APIM delete/purge races and soft-delete conflicts ([#122](https://github.com/Azure/apiops-cli/pull/122))
- **Package-build test README** — added single-test run command for quick iteration ([#87](https://github.com/Azure/apiops-cli/pull/87))

## [0.1.7-alpha.0] — 2026-06-01

### Features

- **Workspace-scoped resource refactor** — uses `workspaceSupported` flag to determine which resource types are available in workspace containers ([#84](https://github.com/Azure/apiops-cli/pull/84))

### Bug Fixes

- **Premium SKU round-trip fixes** — resolved test failures specific to Premium tier ([#80](https://github.com/Azure/apiops-cli/pull/80))
- **Workspace unit test fixes** — corrected test failures introduced by workspace refactor ([#93](https://github.com/Azure/apiops-cli/pull/93))

### Docs & Testing

- **Air-gapped setup walkthroughs** — step-by-step guides for GitHub Actions and Azure DevOps in disconnected environments ([#77](https://github.com/Azure/apiops-cli/pull/77))
- **APIOps terminology update** — replaced "APIOps v1/v2" with "APIOps Toolkit/CLI" across all docs ([#94](https://github.com/Azure/apiops-cli/pull/94))
- **API version docs correction** — fixed default API version in documentation ([#81](https://github.com/Azure/apiops-cli/pull/81))
- **Integration test skill notes** — added AADSTS700016 and UI access troubleshooting ([#83](https://github.com/Azure/apiops-cli/pull/83))

## [0.1.6-alpha.0] — 2026-05-21

### Features

- **MCP server support** — extract and publish MCP server configurations ([#36](https://github.com/Azure/apiops-cli/pull/36), [#51](https://github.com/Azure/apiops-cli/pull/51))
- **Publish `--commit-id` flag** — CLI-over-env precedence for commit tracking ([#47](https://github.com/Azure/apiops-cli/pull/47))
- **Reusable integration test workflow** — `workflow_call` support for CI reuse ([#42](https://github.com/Azure/apiops-cli/pull/42))

### Bug Fixes

- **AzDO publish pipeline flag** — corrected `--overrides` (was `--override`) in Azure DevOps template ([#75](https://github.com/Azure/apiops-cli/pull/75))
- **Empty override file handling** — gracefully handles empty or missing override files ([#33](https://github.com/Azure/apiops-cli/pull/33))

### Docs & Testing

- **User-facing documentation** — added getting started guides, architecture diagram, and agent charters ([#69](https://github.com/Azure/apiops-cli/pull/69), [#56](https://github.com/Azure/apiops-cli/pull/56))
- **Open-source readiness** — copyright headers, sensitivity audit, accuracy policies ([#78](https://github.com/Azure/apiops-cli/pull/78))
- **Security hardening** — added SecurityExpert to Squad team ([#70](https://github.com/Azure/apiops-cli/pull/70))

## [0.1.5-alpha.1] — 2026-05-07

### Features

- **Azure DevOps `init`** — interactive Copilot prompt with managed identity / WIF support ([#31](https://github.com/Azure/apiops-cli/pull/31))
- **Public npm registry support** — install directly from `@peterhauge/apiops-cli` on npmjs.com ([#28](https://github.com/Azure/apiops-cli/pull/28))

### Bug Fixes

- **Empty override file** — fixed crash when override file exists but is empty ([#33](https://github.com/Azure/apiops-cli/pull/33))
- **Dependency bump** — updated `uuid` and `@azure/msal-node` ([#26](https://github.com/Azure/apiops-cli/pull/26))

### Docs & Testing

- **Auth documentation** — clarified OIDC vs client-secret auth paths ([#27](https://github.com/Azure/apiops-cli/pull/27))
- **Azure DevOps manual setup** — updated instructions for `apiops init --ci azure-devops` ([#30](https://github.com/Azure/apiops-cli/pull/30))

## [0.1.4-alpha.1] — 2026-04-29

### Features

- **User-Agent header** — all REST API calls now include a `User-Agent` header for tracing ([#21](https://github.com/Azure/apiops-cli/pull/21))
- **Optional `--cli-package` parameter** — enables using apiops from the public npm registry without specifying a local package path ([#20](https://github.com/Azure/apiops-cli/pull/20))

## [0.1.2-alpha.0] — 2026-04-28

### Features

- **Initial release** — core extract, publish, and init commands for Azure API Management ([#15](https://github.com/Azure/apiops-cli/pull/15))
- **CodeQL analysis** — automated security scanning workflow ([#19](https://github.com/Azure/apiops-cli/pull/19))

[0.4.0-alpha.0]: https://github.com/Azure/apiops-cli/compare/v0.3.0-alpha.0...v0.4.0-alpha.0
[0.3.0-alpha.0]: https://github.com/Azure/apiops-cli/compare/v0.2.1-alpha.0...v0.3.0-alpha.0
[0.2.1-alpha.0]: https://github.com/Azure/apiops-cli/compare/v0.2.0-alpha.0...v0.2.1-alpha.0
[0.2.0-alpha.0]: https://github.com/Azure/apiops-cli/compare/v0.1.7-alpha.0...v0.2.0-alpha.0
[0.1.7-alpha.0]: https://github.com/Azure/apiops-cli/compare/v0.1.6-alpha.0...v0.1.7-alpha.0
[0.1.6-alpha.0]: https://github.com/Azure/apiops-cli/compare/v0.1.5-alpha.1...v0.1.6-alpha.0
[0.1.5-alpha.1]: https://github.com/Azure/apiops-cli/compare/v0.1.4-alpha.1...v0.1.5-alpha.1
[0.1.4-alpha.1]: https://github.com/Azure/apiops-cli/compare/v0.1.2-alpha.0...v0.1.4-alpha.1
[0.1.2-alpha.0]: https://github.com/Azure/apiops-cli/releases/tag/v0.1.2-alpha.0
