# Technical Decisions

All architectural and implementation decisions for apiops-cli.

---

### 2026-04-29: CLI version uses package.json as single source of truth via ESM import attributes
**By:** NodeJsDev  
**Status:** Implemented  
**What:** The CLI version displayed by `apiops --version` is imported from `package.json` using ESM import attributes: `import packageJson from '../../package.json' with { type: 'json' }`. The Commander program uses `program.version(packageJson.version)` instead of a hardcoded string.  
**Why:** Eliminates version drift between package.json and CLI output. Previously, version was hardcoded in `src/cli/index.ts` (".version('0.1.0')") while package.json had "0.1.3-alpha.0". Now `npm version` automatically updates the CLI version with no manual synchronization required. This is the standard pattern for Node.js CLI tools and requires no runtime dependencies — uses native Node 22+ ESM features with TypeScript's `resolveJsonModule: true`.  
**Note:** Import syntax must use `with { type: 'json' }` not `assert { type: 'json' }` — TypeScript enforces the newer import attributes syntax (TS2880 error if using `assert`).

---
