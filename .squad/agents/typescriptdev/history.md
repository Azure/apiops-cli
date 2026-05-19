# TypeScriptDev — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0)
- **User:** Elizabeth Maher
- **Stack:** TypeScript 5.x strict mode, Node.js 22 LTS, ESLint with @typescript-eslint
- **Key principle (Constitution §VI):** Core operations MUST depend on abstractions, not concrete HTTP/file-system implementations.
- **Key principle (Constitution §VII):** Resource bodies are `Record<string, unknown>` — opaque passthrough, no typed DTOs.
- **Build:** `tsc` with strict mode. `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess` all enabled.

**Foundation Established (2026-04-09 through 2026-04-29):** Phase 2 type system implemented (ResourceType enum, IApimClient, IArtifactStore, dependency graph, ARM URI parsing). XML response handling fixed for policy endpoints. Log level paradigm shifted from `--verbose` to `--log-level <level>` with numerical priority filtering. Resource path labels added for improved logging. Windows path resolution in test mocks fixed. User-Agent header implementation for APIM API calls.

## Learnings

### 2026-05-19: Copyright Headers Implementation Complete

**Scope:** Add Microsoft copyright headers to all 91 TypeScript files in src/ and tests/.

**What was accomplished:**
- All TypeScript files in src/ and tests/ now have copyright headers at the top
- Header format: `// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT license.\n`
- Special handling for shebang files: #!/usr/bin/env node preserved at line 1, copyright starts line 2
- Build verification: `npm run build` passes with zero errors
- Test verification: All 885 tests pass across 44 test files
- Lint verification: Zero lint errors

**Implementation details:**
- Batch processing with detection logic to skip already-compliant files (2 files skipped)
- Regex-based insertion ensures consistency
- Platform-agnostic approach works on Windows and Unix
- No runtime behavior changes — purely additive

**Pattern for future work:**
- Always place copyright header at file start (or after shebang if present)
- Include blank line after header before other content
- Use automated tooling for batch operations to ensure consistency and reduce errors
- Always verify builds and tests before considering complete
