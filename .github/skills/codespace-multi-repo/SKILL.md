---
name: "codespace-multi-repo"
description: "Clone, pull, and push across multiple repositories from a Codespace/dev container without PATs — GitHub repos via GitHub CLI web login (avoiding GITHUB_TOKEN/GH_TOKEN interference) and Azure DevOps repos via a short-lived az CLI OAuth token. Use when working across more than one repo, gh auth login fails, git push/fetch returns 403/401, or when testing apiops init/pipeline changes across repos."
domain: "developer-workflow"
confidence: "high"
source: "manual + repeated Codespaces troubleshooting"
---

## Context

Use this skill when working with **multiple repositories** from a Codespace or
dev container and you need to **clone, pull, and push** to each without PAT-based
auth or environment-provided `GITHUB_TOKEN`/`GH_TOKEN` credentials.

Repos may live on different hosts (github.com and Azure DevOps), each with its
own auth path:

| Host | Clone / pull / push auth |
|------|--------------------------|
| github.com | GitHub CLI account login (`gh auth login -w`), token-sanitized git |
| dev.azure.com | Short-lived OAuth token from `az account get-access-token` |

This pattern is useful for cross-repo validation such as `apiops init` pipeline
testing, where the CLI repo lives on GitHub and the scaffolded sample repo lives
on Azure DevOps.

## GitHub Repos: Clone, Pull, Push

Run these commands in order:

```bash
unset GITHUB_TOKEN GH_TOKEN

# Optional but recommended to clear stale account state
gh auth logout -h github.com

# Web/device login, no PAT
env -u GITHUB_TOKEN -u GH_TOKEN gh auth login \
  -h github.com \
  -p https \
  -w \
  --clipboard \
  --insecure-storage

# Verify auth source is account login, not env token
env -u GITHUB_TOKEN -u GH_TOKEN gh auth status
```

Then clone to `/workspaces`:

```bash
cd /workspaces
gh clone <owner>/<repo>
```

After cloning, open workspaces so all repos can be opened:

1. In VS Code, go to **File → Open Folder...**
2. Navigate to and select `/workspaces`
3. Click **Open**

VS Code will reload with the cloned repository as your workspace.

Pull and push use the same account auth. If the Codespace-injected env token
overrides it (see Common Failure Modes), force gh credentials per operation:

```bash
cd /workspaces/<repo>

# Pull
env -u GITHUB_TOKEN -u GH_TOKEN git \
  -c credential.helper= \
  -c credential.helper='!gh auth git-credential' \
  pull origin <branch>

# Push
env -u GITHUB_TOKEN -u GH_TOKEN git \
  -c credential.helper= \
  -c credential.helper='!gh auth git-credential' \
  push origin <branch>
```

## If Login Appears Stuck

If `gh auth login` shows:

- `First copy your one-time code: XXXX-YYYY`
- `Press Enter to open https://github.com/login/device in your browser...`

Use a second terminal:

```bash
$BROWSER https://github.com/login/device
```

Enter the one-time code in the browser and authorize, then return to the original terminal and press Enter if needed.

## Common Failure Modes

- `gh auth status` shows `(GITHUB_TOKEN)`:
  environment token is still active. Re-run with `env -u GITHUB_TOKEN -u GH_TOKEN`.

- Login exits with code `130`:
  usually interrupted (`Ctrl+C`) while waiting for device authorization. Restart login and complete browser step.

- Browser does not launch from container:
  run `$BROWSER https://github.com/login/device` manually from a separate terminal.

- Clone prompts for credentials unexpectedly:
  verify git protocol is HTTPS in `gh auth status` and re-run `gh auth login -p https` if necessary.

- `git push`/`git fetch` returns `403` even though `gh auth status` looks correct:
  Codespaces can inject `GITHUB_TOKEN`/`GH_TOKEN` that override account auth for git operations.
  Use token-sanitized commands and force gh credentials for the operation:

  ```bash
  env -u GITHUB_TOKEN -u GH_TOKEN git \
    -c credential.helper= \
    -c credential.helper='!gh auth git-credential' \
    push origin <branch>
  ```

  For fetch/pull, use the same pattern with `fetch` or `pull`.

## Azure DevOps Repos: Clone, Pull, Push (no PAT)

Azure DevOps remotes (`https://dev.azure.com/<org>/<project>/_git/<repo>`) are
not covered by the GitHub credential helper. In a Codespace the only configured
helper is for github.com, so `git push`/`pull`/`clone` hangs or fails auth.
Instead of a PAT, mint a short-lived OAuth token from the Azure CLI and pass it
inline — never echo or persist it.

```bash
# Ensure the Azure CLI is logged in (interactive if needed — do NOT pass secrets via chat)
az account show --query "{user:user.name, tenant:tenantId}" -o json

# Well-known, public Azure DevOps resource (application) ID — the same constant
# for every org worldwide; NOT a secret and not specific to your repo/tenant.
# It tells Entra ID to issue a token scoped to Azure DevOps.
ADO_RESOURCE_ID=499b84ac-1321-427f-aa17-267ca6975798
ADO_TOKEN=$(az account get-access-token \
  --resource "$ADO_RESOURCE_ID" \
  --query accessToken -o tsv)

# Push using the token as a bearer header; token stays in a variable, never printed
git -c http.extraheader="AUTHORIZATION: Bearer $ADO_TOKEN" push origin <branch>
```

Clone and pull use the identical header pattern:

```bash
# Clone
git -c http.extraheader="AUTHORIZATION: Bearer $ADO_TOKEN" \
  clone https://dev.azure.com/<org>/<project>/_git/<repo>

# Pull
git -c http.extraheader="AUTHORIZATION: Bearer $ADO_TOKEN" pull origin <branch>
```

Notes:
- `499b84ac-1321-427f-aa17-267ca6975798` is the fixed, public Azure DevOps
  application ID in Microsoft Entra ID — identical for all organizations and not
  a credential. Use it as-is for `--resource` (or `.../.default` for scope-based
  requests). It is required so Entra ID issues a token Azure DevOps will accept.
- The same `-c http.extraheader=...` pattern works for `fetch`/`pull`/`clone`.
- The az login tenant must be the tenant that backs the Azure DevOps org. If the
  push returns `TF400813`/`401`, the logged-in identity has no access to that org
  — `az login --tenant <tenant>` against the correct tenant first.
- Keep the token in a shell variable (`ADO_TOKEN=$(...)`) and reference it; do not
  print it or place it directly in a literal command.

## Safety Notes

- Never request a PAT for this workflow unless the user explicitly asks for a PAT-based approach.
- Do not route secrets through chat prompts.
- Keep authentication interactive in user terminal when account sign-in is required.

## Example End-to-End

```bash
unset GITHUB_TOKEN GH_TOKEN
gh auth logout -h github.com
env -u GITHUB_TOKEN -u GH_TOKEN gh auth login -h github.com -p https -w --clipboard --insecure-storage
env -u GITHUB_TOKEN -u GH_TOKEN gh auth status
cd /workspaces
gh clone <owner>/<repo>
```

If you later need to push from a Codespace, use:

```bash
cd /workspaces/<repo>
env -u GITHUB_TOKEN -u GH_TOKEN git \
  -c credential.helper= \
  -c credential.helper='!gh auth git-credential' \
  push origin <branch>
```

Then use **File → Open Folder...** to open `/workspaces` in VS Code.
