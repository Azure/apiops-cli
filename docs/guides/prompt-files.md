# Prompt Files

APIOps provides [prompt files](https://code.visualstudio.com/docs/copilot/copilot-customization#_reusable-prompt-files-experimental) that guide GitHub Copilot through common APIOps configuration tasks. These are reusable `.prompt.md` files that give Copilot the context it needs to help you configure extraction filters, environment overrides, and CI/CD identity setup.

## What are prompt files?

Prompt files are markdown files with a `.prompt.md` extension that provide instructions and context to GitHub Copilot. When you open a prompt file in VS Code and invoke Copilot, it uses the file's content as context to guide you through a task interactively.

## Available prompt files

| File | Description |
|------|-------------|
| `apiops-configure-filter.prompt.md` | Guides Copilot through creating a `configuration.extractor.yaml` filter file to control which API Management resources are extracted. See also: [Filtering resources guide](./filtering-resources.md) |
| `apiops-configure-overrides.prompt.md` | Guides Copilot through creating environment override files (`configuration.<env>.yaml`) for promoting APIs across environments. See also: [Environment overrides guide](./environment-overrides.md) |
| `apiops-setup-workflow-identity-github-actions.prompt.md` | Walks through setting up Azure identity (app registration, federated credentials, RBAC) for GitHub Actions CI/CD pipelines. |
| `apiops-setup-workflow-identity-azure-devops.prompt.md` | Walks through setting up Azure identity (app registration, federated credentials, RBAC) for Azure DevOps CI/CD pipelines. |

## Getting prompt files

### Via `apiops init` (recommended)

The easiest way to get prompt files is to run [`apiops init`](../commands/init.md), which scaffolds your repository with prompt files already in place at `.github/prompts/`.

### Download individually

If you already have an APIOps repository and want to add prompt files without re-running init, you can download them directly from this repository.

#### Bash

```bash
# Resolve repo root so this works from any subdirectory
repo_root="$(git rev-parse --show-toplevel)"

# Create the prompts directory
mkdir -p "${repo_root}/.github/prompts"

# Available prompt files — remove any you don't need
files=(
  "apiops-configure-filter.prompt.md"
  "apiops-configure-overrides.prompt.md"
  # Remove the identity setup prompt that doesn't apply to your CI provider:
  "apiops-setup-workflow-identity-github-actions.prompt.md"
  "apiops-setup-workflow-identity-azure-devops.prompt.md"
)

base_url="https://raw.githubusercontent.com/Azure/apiops-cli/main/src/templates/copilot"

for file in "${files[@]}"; do
  curl -sL "${base_url}/${file}" -o "${repo_root}/.github/prompts/${file}"
  echo "Downloaded ${file}"
done
```

#### PowerShell

```powershell
# Resolve repo root so this works from any subdirectory
$repoRoot = git rev-parse --show-toplevel

# Create the prompts directory
New-Item -ItemType Directory -Path "$repoRoot/.github/prompts" -Force | Out-Null

# Available prompt files — remove any you don't need
$files = @(
  "apiops-configure-filter.prompt.md"
  "apiops-configure-overrides.prompt.md"
  # Remove the identity setup prompt that doesn't apply to your CI provider:
  "apiops-setup-workflow-identity-github-actions.prompt.md"
  "apiops-setup-workflow-identity-azure-devops.prompt.md"
)

$baseUrl = "https://raw.githubusercontent.com/Azure/apiops-cli/main/src/templates/copilot"

foreach ($file in $files) {
  Invoke-WebRequest -Uri "$baseUrl/$file" -OutFile "$repoRoot/.github/prompts/$file"
  Write-Host "Downloaded $file"
}
```

## Further reading

- [VS Code: Reusable prompt files](https://code.visualstudio.com/docs/copilot/copilot-customization#_reusable-prompt-files-experimental)
- [GitHub Copilot in the CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli/using-github-copilot-in-the-cli)
