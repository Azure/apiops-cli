# Contributing to apiops-cli

Thank you for your interest in contributing to **apiops-cli**! There are many ways to contribute:

- **Report bugs** — open an [issue](https://github.com/Azure/apiops-cli/issues) with a clear reproduction case.
- **Request features** — open an issue describing the use case.
- **Submit pull requests** — bug fixes, improvements, or new features are all welcome.
- **Improve documentation** — corrections and clarifications in README or inline docs.

Most contributions require you to agree to a Contributor License Agreement (CLA)
declaring that you have the right to, and actually do, grant us the rights to use
your contribution. For details, visit <https://cla.microsoft.com>.

When you submit a pull request, a CLA bot will automatically determine whether you
need to provide a CLA and decorate the PR appropriately (e.g., label, comment).
Simply follow the instructions provided by the bot. You will only need to do this
once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any
additional questions or comments.

## Getting started

### VS Code (Recommended)

Open the repository in VS Code and click **Reopen in Container** when prompted (requires the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)). This starts a pre-configured environment with Node.js 22, Azure CLI, and GitHub CLI — no local tool installation needed.

### GitHub Codespaces

Click **Code → Codespaces → Create codespace on `<branch>`** in the GitHub UI. The environment starts pre-configured — no local setup required.

### Manual setup

- Node.js 22.x LTS or later
- npm (comes with Node.js)

```bash
git clone https://github.com/Azure/apiops-cli.git
cd apiops-cli
npm install
```

## Development workflow

All commands assume you are in the repository root.

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

Run tests in watch mode while developing:

```bash
npm run test:watch
```

### Lint

```bash
npm run lint
```

### Recommended pre-push check

```bash
npm run lint && npm run build && npm test
```

## Debugging

For verbose logging at the command line, either run via `npm start`:

```bash
npm start -- extract --resource-group my-rg --service-name my-apim --log-level debug
```

Or use `npm link` to run the command as a user would:

```bash
npm link
apiops extract --resource-group my-rg --service-name my-apim --log-level debug
```

## Project structure

```
src/
  cli/          # CLI entry point and command definitions
  clients/      # Azure API Management client wrappers
  services/     # Business logic (extract, publish, etc.)
  models/       # TypeScript types and interfaces
  lib/          # Shared utilities
tests/
  unit/         # Unit tests
  integration/  # Integration tests
  contract/     # Contract tests
specs/          # Feature specifications and design documents
dist/           # Compiled output (git-ignored)
```

## Technology stack

Dependencies and dev tools are listed in [`package.json`](./package.json). The project uses TypeScript (strict mode), Vitest for testing, and ESLint for linting.

## Troubleshooting

**`apiops: command not found`** — run `npm link` from the repository root after building (see [Manual setup](#manual-setup) above).

## Pull request process

1. **Write tests** for new functionality or bug fixes.

2. **Ensure all checks pass locally:**
   ```bash
   npm run lint && npm run build && npm test
   ```

3. **Commit with a clear message.** Include `Closes #N` or `Fixes #N` when the change resolves a GitHub issue — this auto-closes the issue on merge:
   ```
   feat: add support for policy extraction

   Closes #42
   ```

4. **Open a pull request** against `main`. CI automatically runs lint, build, and the full test suite. All checks must pass before merge.

5. **Address review feedback** promptly.

## Questions or issues?

Open an issue in the [GitHub issue tracker](https://github.com/Azure/apiops-cli/issues) with a clear description of your question or problem.

