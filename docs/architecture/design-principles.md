# Design Principles

> Guiding principles for contributors to apiops-cli. Derived from the project constitution.

These eight principles govern every design decision in apiops-cli. When principles conflict, the lower-numbered principle takes precedence.

---

## I. CLI-First Design

**All functionality is delivered as `apiops <command>` subcommands.**

### What This Means

- **Text-based I/O** — Output goes to stdout (data) and stderr (logs). No GUI, no web UI.
- **`--format json`** — Every command supports `--format json` for machine-readable output. Scripts and CI/CD tools should parse JSON, not text.
- **Exit codes** — `0` = success, `1` = partial failure, `2` = complete failure. CI/CD pipelines rely on these.
- **Non-interactive in CI/CD** — Commands never prompt for input when no TTY is detected. Every interactive input has a flag equivalent.
- **Interactive when appropriate** — When a TTY is detected, commands may prompt (e.g., `apiops init` conflict resolution), but every prompt has a `--flag` equivalent for automation.

### For Contributors

- New features must be CLI subcommands or flags, never standalone scripts.
- Always provide a `--flag` for any interactive prompt.
- Test with `--format json` to ensure structured output is correct.
- Use exit code `1` for partial failures (some resources succeeded, others failed) and `2` for complete failures (nothing succeeded).

---

## II. Azure APIM Native

**Model APIM concepts directly. Align with APIM terminology.**

### What This Means

- Resource type names match APIM REST API names (e.g., `namedValues`, not `variables`).
- Artifact directory structure mirrors the APIM resource hierarchy.
- The CLI does not invent abstractions over APIM — it exposes APIM's own model.

### For Contributors

- When naming types, fields, or directories, check the [APIM REST API reference](https://learn.microsoft.com/en-us/rest/api/apimanagement/) and use its terminology.
- Don't create aliases or convenience names that diverge from APIM vocabulary.
- If APIM renames something in a new API version, update our terminology to match.

---

## III. Configuration-as-Code

**JSON/YAML artifact files, version-controlled, git-diffable.**

### What This Means

- Extracted artifacts are stored as JSON info files and XML policy files on disk.
- These files are designed to be committed to git and reviewed in pull requests.
- Override files allow environment-specific values without modifying the base artifacts.
- The artifact format is human-readable and produces meaningful git diffs.

### For Contributors

- File formats must be deterministic — same APIM state always produces identical files (sorted keys, consistent formatting).
- Avoid binary formats. Everything should be text-based and diffable.
- Default output paths should be configurable, not hardcoded.

---

## IV. Idempotent Operations

**Same input produces the same result. Safe to re-run.**

### What This Means

- Running `apiops extract` twice with the same APIM state produces identical artifacts.
- Running `apiops publish` twice with the same artifacts produces the same APIM state.
- Partial failures don't leave the system in an inconsistent state that prevents re-running.
- **Destructive operations require explicit opt-in** — `--delete-unmatched` is never a default.

### For Contributors

- PUT (create-or-update) is preferred over separate create/update paths.
- Never assume clean state — the command might be a re-run after a partial failure.
- Destructive operations (delete, overwrite) must require an explicit flag.

---

## V. YAGNI (You Aren't Gonna Need It)

**Don't build what isn't needed yet.**

### What This Means

- Features are implemented when there's a concrete use case, not speculatively.
- Code paths for future possibilities are not added until those possibilities are real.
- Abstractions are introduced when they serve current requirements, not hypothetical ones.

### For Contributors

- Before adding a new feature, ask: "Is there a user requesting this today?"
- Resist the temptation to add config options "just in case."
- Prefer simple, direct solutions over flexible-but-complex ones.
- It's easier to add an abstraction later than to remove one.

---

## VI. Testability

**Interfaces for mocking. Dependency injection.**

### What This Means

- External dependencies are accessed through interfaces (`IApimClient`, `IArtifactStore`).
- Services accept their dependencies via constructor parameters, not global imports.
- Unit tests mock interfaces — no real Azure API calls, no real filesystem access.
- Tests run fast, offline, and in isolation.

### For Contributors

- New external integrations must define an interface and accept it as a parameter.
- Don't import concrete clients directly in service logic — inject the interface.
- Unit tests should never need network access or filesystem side effects.
- If a function is hard to test, refactor it to accept its dependencies.

---

## VII. Forward Compatibility

**Support future APIM API versions.**

### What This Means

- The CLI's resource handling is data-driven via resource type descriptors, not hardcoded per resource type.
- Adding support for new APIM resource types should require configuration, not code changes.
- Unknown JSON properties are preserved (round-tripped), not stripped.

### For Contributors

- Don't hardcode resource-specific logic in generic processing paths.
- When extracting or publishing, preserve all properties — even ones the CLI doesn't understand.
- Resource type definitions should be declarative (name, path pattern, dependencies), not imperative.

---

## VIII. Secret & Credential Safety

**Never log secrets. Redact sensitive data.**

### What This Means

- Bearer tokens, API keys, client secrets, and passwords are never written to logs.
- The logger automatically sanitizes known sensitive field names (`token`, `secret`, `password`, `key`, `authorization`).
- Debug logging shows request URLs and response codes, but redacts authorization headers.
- Artifact files may contain named value references but never raw secret values (APIM returns `null` for secret values).

### For Contributors

- Never pass secret values to `logger.debug()`, `logger.info()`, or any log method.
- When adding new log statements, check whether the logged object could contain credentials.
- If a new API response includes sensitive fields, add them to the logger's redaction list.
- In tests, use placeholder values like `"test-secret"` — never real credentials.

---

## Principle Precedence

When principles conflict, lower-numbered principles take priority. For example:

- **I vs. V** — A CLI flag (I) is needed for a real use case even if the implementation is minimal (V says don't over-build, but I says provide the flag).
- **IV vs. VII** — Idempotency (IV) overrides forward compatibility (VII) — don't preserve unknown properties if doing so breaks re-runnability.
- **VI vs. V** — Add an interface (VI) for an external dependency even if it currently has only one implementation. Testability justifies the cost.

---

## Related Docs

- [Architecture Overview](overview.md) — High-level system design
- [Contributing](../../CONTRIBUTING.md) — How to contribute to the project
