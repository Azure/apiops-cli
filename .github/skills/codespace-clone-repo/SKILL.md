---
name: "codespace-clone-repo"
description: "Clone another GitHub repository from a Codespace/dev container using GitHub CLI web login (no PAT), especially when GITHUB_TOKEN defaults interfere with auth. Use when gh auth login fails or when testing apiops init/pipeline changes across repos."
domain: "developer-workflow"
confidence: "high"
source: "manual + repeated Codespaces troubleshooting"
---

## Context

Use this skill when a user needs to clone another repository from a Codespace or dev container and must avoid PAT-based auth and environment-provided `GITHUB_TOKEN`/`GH_TOKEN` credentials.

This pattern is useful for cross-repo validation such as `apiops init` pipeline testing.

## Fast Path

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

Then clone:

```bash
git clone https://github.com/<owner>/<repo>.git
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
git clone https://github.com/<owner>/<repo>.git
```
