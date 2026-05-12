# NodeJsDev — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management (`apiops extract`, `apiops publish`, `apiops init`)
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0)
- **User:** Elizabeth Maher
- **Stack:** Node.js 22 LTS, Commander CLI framework, ESM, npm
- **CLI commands:** `apiops extract [options]`, `apiops publish [options]`, `apiops init [options]`
- **Key rule (Constitution §I):** Every interactive input MUST have a non-interactive flag equivalent. Non-interactive mode required when stdout is not a TTY.
- **Output contract:** `--format json` → stdout. Logs/errors → stderr. Never mixed.

## Learnings

### 2026-04-09: Phase 1 Dependency Setup (T003–T005)

**Installed Dependencies:**
- **Core:** commander@14.0.3, @azure/identity@4.13.1, js-yaml@4.1.1, simple-git@3.35.2
- **Dev:** typescript@6.0.2, vitest@4.1.3, eslint@10.2.0, tsx@4.21.0, @types/node@25.5.2, @types/js-yaml@4.0.9
- **ESLint:** typescript-eslint@8.58.1, @typescript-eslint/parser@8.58.1, @typescript-eslint/eslint-plugin@8.58.1, @eslint/js@10.0.1

**Key Decisions:**
1. **tsx over ts-node** for `npm start`: tsx has native ESM support without extra config (`"type": "module"`), ts-node requires loader flags
2. **ESLint 10.x flat config**: ESLint v10 dropped `.eslintrc.json` support → migrated to `eslint.config.js` with `typescript-eslint` package
3. **TypeScript config**: Added `"types": ["node"]` to tsconfig to provide Node.js globals like `console`; included `tests/**/*` in compilation for linting

**Scripts Configured:**
- `build`: `tsc` — compiles to `dist/`
- `test`: `vitest run` — runs all `tests/**/*.test.ts` files
- `lint`: `eslint src tests` — flat config auto-detects `.ts` files
- `start`: `tsx src/cli/index.ts` — development runner with hot ESM support

**Gotchas:**
- ESLint 10 requires flat config (`eslint.config.js`), not `.eslintrc.json`
- TypeScript ESM compilation needs tests included in tsconfig for linter type-checking
- Empty test suite causes vitest exit code 1; added `tests/unit/setup.test.ts` as baseline

### 2026-04-09: Phase 2 Utilities & Client Implementations (T014–T018)

**Implemented Files:**
1. **src/lib/logger.ts** — Structured logger with stderr output, log levels (DEBUG, INFO, WARN, ERROR), --verbose support
2. **src/lib/config-loader.ts** — YAML config loader for filter/override/OTel configs using js-yaml
3. **src/lib/parallel-runner.ts** — Parallel task executor with bounded concurrency (no p-limit dependency)
4. **src/clients/apim-client.ts** — Azure REST HTTP client implementing IApimClient with DefaultAzureCredential, pagination, retry, rate limiting, provisioningState polling
5. **src/clients/artifact-store.ts** — Filesystem artifact store implementing IArtifactStore for JSON/XML/MD/spec files

**Key Decisions:**
1. **Logger stdout rule**: Logger MUST write to stderr only. stdout is reserved for --format json output (per FR-023/FR-026)
2. **Parallel runner**: Built in-house concurrency control instead of p-limit dependency to minimize package bloat
3. **Azure auth**: DefaultAzureCredential with token caching (5min expiry buffer) for efficiency
4. **Retry strategy**: Exponential backoff with jitter, respects Retry-After headers for 429s, max 3 retries
5. **Spec format detection**: Heuristic fallback (checks content for JSON/XML/GraphQL markers) when API metadata lacks format hint
6. **Error cause chains**: All re-thrown errors include `{ cause: error }` per ESLint preserve-caught-error rule

**Implementation Notes:**
- ApimClient handles ARM pagination (nextLink), long-running operations (provisioningState polling), rate limiting (429), and transient errors (5xx)
- ArtifactStore uses resource-path.ts utilities for consistent directory/file naming
- Config loader returns undefined for missing files (graceful handling, not errors)
- Parallel runner uses Promise.allSettled for fault tolerance — one task failure doesn't abort others

**ESLint Fixes Applied:**
- Added `{ cause: error }` to all re-thrown errors
- Used `never` type for exhaustiveness checks with String() coercion for template literals
- Fixed async boolean checks in parallel runner

### 2026-04-09: Phase 2 Commander Entry Point (T019)

**Implemented:**
- **src/cli/index.ts** — Commander program entry point with global options and subcommand registration pattern

**Key Features:**
1. **Global options** inherited by all subcommands:
   - `--verbose` — enables debug logging via logger.configure()
   - `--otel <path>` — path to OpenTelemetry config YAML
   - `--format <type>` — output format: "text" (default) or "json"
   - `--subscription-id <id>` — Azure subscription ID
   - `--cloud <name>` — sovereign cloud: "public" (default), "china", "usgov", "germany"

2. **Logger integration**: preAction hook configures logger verbose mode before each command runs
3. **Unknown command handling**: Gracefully exits with error message and help suggestion
4. **Exit codes**: 0 for success, 1 for errors/unknown commands
5. **Subcommand registration pattern**: Placeholder comments show where extract/publish/init commands will be registered (T020–T022)

**Implementation Notes:**
- Commander's `optsWithGlobals()` ensures inherited options are accessible in subcommands
- ESLint fix: Type operands parameter as `string[]` and use nullish coalescing for array access
- Shebang `#!/usr/bin/env node` preserved as first line for bin entry
- Top-level await for parseAsync() — requires ESM and Node 22+ (already configured)

**Verification:**
- `--help` shows all global options correctly
- `--version` outputs "0.1.0" from program.version()
- Unknown commands log error to stderr and exit with code 1
- Build and lint pass without errors

### 2026-04-29: Version Management Pattern — Single Source of Truth

**Problem:** Version was maintained in two places: `package.json` ("0.1.3-alpha.0") and hardcoded in `src/cli/index.ts` (".version('0.1.0')"). This caused version drift and required manual updates in both locations.

**Solution:** Import version from `package.json` using ESM import attributes (Node 22+ with TypeScript):
```typescript
import packageJson from '../../package.json' with { type: 'json' };
program.version(packageJson.version);
```

**Key Implementation Notes:**
1. **Import syntax:** Use `with { type: 'json' }` (not `assert`) — TypeScript TS2880 error enforces the newer import attributes syntax
2. **Path resolution:** From `src/cli/index.ts`, use `../../package.json` — when compiled to `dist/cli/index.js`, this resolves correctly to root `package.json`
3. **tsconfig requirement:** `resolveJsonModule: true` (already configured) enables JSON imports in TypeScript
4. **Node version:** Requires Node 22+ for import attributes support (already enforced via `"engines": {"node": ">=22.0.0"}`)

**Benefits:**
- Single source of truth: `package.json` version is the canonical version
- Automated versioning: `npm version` updates package.json, CLI automatically reflects the change
- Eliminates drift: No manual synchronization required between files
- Standard pattern: Follows Node.js ecosystem conventions for CLI tools

**Verification:**
- Build passes: `npm run build` compiles successfully
- Version output correct: `node dist/cli/index.js --version` displays "0.1.3-alpha.0" from package.json
- No runtime dependencies: Uses native Node ESM features, no additional packages required

### 2026-04-29: Dual-Mode Init — Public npm vs Local Tarball

**Problem:** After publishing `@peterhauge/apiops-cli` to npm, `apiops init` still required `--cli-package <path>` pointing to a local .tgz tarball, making the workflow cumbersome for users who just want to use the public package.

**Solution:** Made `--cli-package` optional and implemented two modes:

1. **Local tarball mode** (when `--cli-package` provided):
   - Creates `.apiops/` directory, copies tarball
   - Generates package.json with `"apiops": "file:.apiops/{tarball}"`
   - Use case: Local development, pre-release testing

2. **Public npm mode** (when `--cli-package` NOT provided):
   - No tarball copy, no `.apiops/` directory
   - Generates package.json with `"@peterhauge/apiops-cli": "latest"`
   - Use case: Standard consumption after publishing to npm

**Implementation Details:**
- Changed `.requiredOption()` to `.option()` in init-command.ts
- Made `cliPackage?: string` optional in InitConfig interface
- Conditional validation: `validateCliPackage()` only runs if `cliPackage` provided
- Conditional file operations in `generateFiles()`: tarball copy and `.apiops/` creation only in local mode
- Refactored package-json.ts to accept discriminated union config: `{ mode: 'local', tarballRelPath } | { mode: 'npm' }`

**Key Pattern:** The package.json generator uses a discriminated union for type safety:
```typescript
export type PackageJsonConfig =
  | { mode: 'local'; tarballRelPath: string }
  | { mode: 'npm' };
```
This enforces that `tarballRelPath` is only accessible when `mode === 'local'`, preventing runtime errors.

**Testing:**
- All 467 tests pass (init-command.test.ts validates both modes)
- ESLint clean (no warnings or errors)
- Backward compatible: Existing workflows with `--cli-package` continue to work

<!-- Append new learnings here after each session -->

