# Contributing to apiops-cli

Thank you for contributing to **apiops-cli**, a TypeScript CLI tool for Azure API Management configuration-as-code.

## Commit Message Convention

**Always include `Closes #N` or `Fixes #N` in your commit messages when the change resolves a GitHub issue.**

This convention automatically closes the referenced issue when the pull request is merged.

Example:
```
feat: add support for policy extraction

Implemented policy extraction for all API operations.

Closes #42
```

## Development Setup

### Prerequisites

- Node.js 22.x LTS or later
- npm (comes with Node.js)

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/gim-home/apiops-cli.git
   cd apiops-cli
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

5. **Run linter:**
   ```bash
   npm run lint
   ```

### Development Workflow

- **Build:** `npm run build` (compiles TypeScript to `dist/`)
- **Test:** `npm test` (runs Vitest test suite)
- **Test Watch Mode:** `npm run test:watch` (runs tests in watch mode)
- **Lint:** `npm run lint` (runs ESLint on `src/` and `tests/`)
- **Run CLI locally:** `npm start` (runs CLI without building)

## Pull Request Process

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code style guidelines below.

3. **Write tests** for new functionality or bug fixes.

4. **Ensure all checks pass:**
   ```bash
   npm run build && npm test && npm run lint
   ```

5. **Commit your changes** with a clear message (include `Closes #N` or `Fixes #N` if applicable).

6. **Push to your fork** and open a pull request against `main`.

7. **Address review feedback** if requested.

## Code Style

- **TypeScript strict mode** is enabled — all type errors must be resolved.
- **ESLint** is configured with TypeScript-aware rules and runs automatically in CI.
- **Follow existing conventions** in the codebase (naming, structure, patterns).
- **Unused variables** are treated as errors (prefix with `_` if intentionally unused).
- **Comments:** Only comment code that requires clarification — avoid obvious comments.

## Project Structure

```
src/
  cli/        # CLI entry point and command definitions
  clients/    # Azure API Management client wrappers
  services/   # Business logic (extract, publish, etc.)
  models/     # TypeScript types and interfaces
  lib/        # Shared utilities

tests/
  unit/       # Unit tests
  integration/ # Integration tests
  contract/   # Contract tests
```

## Questions or Issues?

Open an issue in the [GitHub issue tracker](https://github.com/gim-home/apiops-cli/issues) with a clear description of your question or problem.
