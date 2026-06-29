# Prompt Files

APIOps provides [prompt files](https://code.visualstudio.com/docs/copilot/copilot-customization#_reusable-prompt-files-experimental) that guide GitHub Copilot through common APIOps configuration tasks. These are reusable `.prompt.md` files that give Copilot the context it needs to help you configure extraction filters, environment overrides, and CI/CD identity setup.

## What are prompt files?

Prompt files are markdown files with a `.prompt.md` extension that provide instructions and context to GitHub Copilot. When you open a prompt file in VS Code and invoke Copilot, it uses the file's content as context to guide you through a task interactively.

## Available prompt files

| File | Description |
|------|-------------|
| `apiops-configure-filter.prompt.md` | Guides Copilot through creating a `configuration.extractor.yaml` filter file to control which API Management resources are extracted. |
| `apiops-configure-overrides.prompt.md` | Guides Copilot through creating environment override files (`configuration.<env>.yaml`) for promoting APIs across environments. |
| `apiops-setup-workflow-identity.prompt.md` | Walks through setting up Azure identity (app registration, federated credentials, RBAC) for your CI/CD pipeline. There are separate versions for GitHub Actions and Azure DevOps — `apiops init` selects the correct one based on your chosen CI provider. |

## Getting prompt files

### Via `apiops init` (recommended)

The easiest way to get prompt files is to run [`apiops init`](../commands/init.md), which scaffolds your repository with prompt files already in place at `.github/prompts/`.

### Download individually

If you already have an APIOps repository and want to add prompt files without re-running init, you can download them directly from this repository.

#### Bash

```bash
# Create the prompts directory
mkdir -p .github/prompts

# Available prompt files — comment out any you don't need
files=(
  "configure-filter-prompt.md:apiops-configure-filter.prompt.md"
  "configure-overrides-prompt.md:apiops-configure-overrides.prompt.md"
  # Choose ONE of the following identity setup prompts:
  "identity-setup-prompt-github-actions.md:apiops-setup-workflow-identity.prompt.md"
  # "identity-setup-prompt-azure-devops.md:apiops-setup-workflow-identity.prompt.md"
)

base_url="https://raw.githubusercontent.com/Azure/apiops-cli/main/src/templates/copilot"

for entry in "${files[@]}"; do
  src="${entry%%:*}"
  dest="${entry##*:}"
  curl -sL "${base_url}/${src}" -o ".github/prompts/${dest}"
  echo "Downloaded ${dest}"
done
```

#### PowerShell

```powershell
# Create the prompts directory
New-Item -ItemType Directory -Path ".github/prompts" -Force | Out-Null

# Available prompt files — comment out any you don't need
$files = @(
  @{ Source = "configure-filter-prompt.md"; Dest = "apiops-configure-filter.prompt.md" }
  @{ Source = "configure-overrides-prompt.md"; Dest = "apiops-configure-overrides.prompt.md" }
  # Choose ONE of the following identity setup prompts:
  @{ Source = "identity-setup-prompt-github-actions.md"; Dest = "apiops-setup-workflow-identity.prompt.md" }
  # @{ Source = "identity-setup-prompt-azure-devops.md"; Dest = "apiops-setup-workflow-identity.prompt.md" }
)

$baseUrl = "https://raw.githubusercontent.com/Azure/apiops-cli/main/src/templates/copilot"

foreach ($file in $files) {
  Invoke-WebRequest -Uri "$baseUrl/$($file.Source)" -OutFile ".github/prompts/$($file.Dest)"
  Write-Host "Downloaded $($file.Dest)"
}
```

## Using prompt files

### In VS Code

1. Open the prompt file (e.g., `.github/prompts/apiops-configure-filter.prompt.md`) in VS Code.
2. Open the Copilot Chat panel and type `#` followed by the prompt file name, or use the **Attach Context** button to select it.
3. Ask Copilot to help you complete the task described in the prompt.

For more details on using prompt files in VS Code, see the [VS Code documentation on reusable prompt files](https://code.visualstudio.com/docs/copilot/copilot-customization#_reusable-prompt-files-experimental).

### In GitHub Copilot CLI

You can reference prompt files when using [GitHub Copilot in the CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli/using-github-copilot-in-the-cli):

```bash
# Ask Copilot CLI to use a prompt file as context
gh copilot suggest --file .github/prompts/apiops-configure-filter.prompt.md "help me configure extraction filters"
```

For more details, see the [GitHub Copilot in the CLI documentation](https://docs.github.com/en/copilot/github-copilot-in-the-cli/using-github-copilot-in-the-cli).

## Further reading

- [VS Code: Reusable prompt files](https://code.visualstudio.com/docs/copilot/copilot-customization#_reusable-prompt-files-experimental)
- [GitHub Copilot in the CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli/using-github-copilot-in-the-cli)
- [APIOps `init` command reference](../commands/init.md)
- [Filtering resources guide](./filtering-resources.md)
- [Environment overrides guide](./environment-overrides.md)
