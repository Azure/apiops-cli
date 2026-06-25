---
name: "update-config-schema-version"
description: "Bump the filter/override JSON Schema version (schemas/v<N>) and update every reference so docs, Copilot prompts, init-generated configs, and tests point at the new version. Use when changing the configuration.extractor.yaml / configuration.<env>.yaml schema shape, introducing a breaking schema change, or when 'schemaVersion' in package.json needs to move."
domain: "configuration-schema"
confidence: "high"
source: "manual + observed from schemas/v1 layout and schema-ref.ts/generate-schemas.mjs wiring"
---

## Context

The filter (extractor) and override config JSON Schemas are versioned
**independently of the CLI package version**. Each schema version lives at a
frozen path `schemas/v<N>/` on the `main` branch:

- **Backward-compatible edits** (add an optional field, loosen validation):
  keep the same version and regenerate in place.
- **Breaking changes** (rename/remove a field, tighten validation): introduce a
  **new** version folder `schemas/v<N+1>/` and leave the old folder frozen so
  existing config files keep resolving against the shape they were written for.

The single source of truth is `schemaVersion` in [`package.json`](../../../package.json).

## What updates automatically (do NOT hand-edit)

Both of these read `schemaVersion` at build time — bumping `package.json` is
enough for them:

- [`scripts/generate-schemas.mjs`](../../../scripts/generate-schemas.mjs) —
  writes the schema files to `schemas/v<N>/` and stamps the `$id` URL.
- [`src/templates/configs/schema-ref.ts`](../../../src/templates/configs/schema-ref.ts) —
  builds the `# yaml-language-server: $schema=` URL injected into the
  `apiops init` generated configs (`filter-config.yaml` / `override-config.yaml`
  templates use the `{{SCHEMA_URL}}` placeholder).

Regenerating happens on `prebuild` / `prelint` / `pretest`, or run manually:

```bash
node scripts/generate-schemas.mjs && node scripts/embed-markdown-templates.mjs
```

## What must be updated by hand

These hardcode `schemas/v<N>/` and will NOT change on their own. Update every
one to the new version. Find them all first:

```bash
grep -rn "schemas/v[0-9]" \
  src/templates docs tests \
  | grep -v node_modules
```

Files that reference the version directly today:

1. **Copilot prompt templates** (embedded into the package — must be edited at
   the source, then re-embed):
   - [`src/templates/copilot/configure-filter-prompt.md`](../../../src/templates/copilot/configure-filter-prompt.md)
     → `schemas/v<N>/extractor-config.schema.json`
   - [`src/templates/copilot/configure-overrides-prompt.md`](../../../src/templates/copilot/configure-overrides-prompt.md)
     → `schemas/v<N>/override-config.schema.json`
2. **Docs**:
   - [`docs/guides/filtering-resources.md`](../../../docs/guides/filtering-resources.md)
     (the `$schema` example line and the "published at `schemas/v<N>/...`" link)
   - [`docs/guides/environment-overrides.md`](../../../docs/guides/environment-overrides.md)
     (two `$schema` example lines and the "published at `schemas/v<N>/...`" link)
3. **Unit tests** (assert the rendered schema URL):
   - [`tests/unit/templates/configs/config-templates.test.ts`](../../../tests/unit/templates/configs/config-templates.test.ts)
     (`expect(config).toContain('schemas/v<N>/extractor-config.schema.json')` and
     the override equivalent)

## Procedure

### 1) Decide compatible vs breaking

- **Backward-compatible:** keep `schemaVersion` as-is, edit
  `src/models/config.ts`, regenerate, done. No reference updates needed.
- **Breaking:** bump `schemaVersion` and continue below.

### 2) Bump the source of truth

```jsonc
// package.json
"schemaVersion": "2",
```

### 3) Regenerate derived artifacts

```bash
node scripts/generate-schemas.mjs        # creates schemas/v2/*.schema.json
node scripts/embed-markdown-templates.mjs # re-embeds prompt md after step 4
```

`schemas/v2/` is created; **keep `schemas/v1/` in place** (frozen for existing
configs). Do not delete the old version folder.

### 4) Update every hardcoded reference

Edit each file listed in "What must be updated by hand" to `v2`, then re-run the
embed script so the prompt changes land in
`src/templates/generated/embedded-markdown.ts`.

### 5) Verify nothing still points at the old version unintentionally

```bash
# Should only match the intentionally-frozen old folder and any "previous
# version" historical notes — not docs/prompts/tests describing the current shape.
grep -rn "schemas/v1" src docs tests scripts
```

### 6) Build and test

```bash
npm run build
npx vitest run tests/unit/templates/configs/config-templates.test.ts \
              tests/integration/package-build/package-build.test.ts
```

The package-build integration test confirms the embedded templates (including
the updated prompts) ship in the npm pack output.

## Gotchas

- The `schemas/v<old>/` folder is intentionally retained on a breaking bump —
  removing it breaks configs already pinned to that version.
- Prompt `.md` edits do nothing until `embed-markdown-templates.mjs` re-runs and
  the project rebuilds; the embedded constant is what ships, not the raw file.
- `apiops init` output needs no manual change — it derives the URL from
  `schemaVersion` via `schema-ref.ts`.
- Keep `package.json schemaVersion` a bare integer string (`"2"`), not `"v2"`;
  the `v` prefix is added by the scripts.
