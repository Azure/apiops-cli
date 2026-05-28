# SecurityExpert — History

## Project Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management operations
- **Stack:** TypeScript 5.x, Node.js 22.x, Commander, @azure/identity, js-yaml, simple-git
- **Repo:** Azure/apiops-cli (public, open source)
- **Security posture:** AI-first repo with strict human-in-the-loop policy

## Key Knowledge

- Real CVEs referenced: CVE-2025-30066 (tj-actions), CVE-2026-33634 (Trivy), CVE-2025-30154 (reviewdog)
- All Actions must be pinned to full 40-char SHA
- Fork PRs touching `.github/workflows/` must auto-fail
- 2 maintainer approvals required for fork PRs
- `npm ci --ignore-scripts` (not `npm install`) in all CI pipelines
- CODEOWNERS must cover 14+ sensitive paths

## Learnings

### 2026-06-12: Open-Source Sensitivity Audit
Performed a thorough read-only sensitivity audit across all tracked files in preparation for open-source publication. Scanned for secrets/credentials, internal Microsoft URLs, PII, internal comments, internal tool configs, sensitive paths, draft docs, hardcoded Azure resource IDs, and internal dependency references. Findings delivered for compliance sign-off. No live credentials, certificates, or storage keys were found. All Azure GUIDs encountered were either zero-padded placeholders or public Azure built-in role definition IDs. Primary cleanup items: a developer machine path and alias references in `.squad/` history/decisions; one real-looking storage account name in a test fixture.

**Findings Summary:** 2 MEDIUM items, 3 LOW items. Orchestration log: `.squad/orchestration-log/2026-05-19T22-01-securityexpert.md`
- When using PowerShell transcript/trace logging, always pass `-UseMinimalHeader` to `Start-Transcript` to prevent machine/host environment details from being written to logs.
- `Start-Transcript -UseMinimalHeader` keeps machine/host details out of logs.
- **ARM async-operation URLs** (`Azure-AsyncOperation` / `Location`) include `t/c/s/h` query params that act as short-lived bearer credentials. Regex-mask them. <https://learn.microsoft.com/azure/azure-resource-manager/management/async-operations>
- **`x-ms-routing-request-id`** carries `REGION:UTC:GUID` — mask the whole value, not just the GUID. <https://learn.microsoft.com/azure/azure-resource-manager/management/request-limits-and-throttling>
- **PowerShell `Start-Transcript` double-emits native stderr** when paired with `2>&1 | Write-Host`. Either regex-mask in `Protect-LogLine` (so both copies get masked) or redirect the child's stderr to a pipe via `System.Diagnostics.Process` so the transcript never sees the raw line. Both layers together = defense in depth.
- **Do not mask all GUIDs.** Azure built-in role-definition IDs and ARM template hashes are public constants useful for debugging. Anchor secret regex to the path segment, header name, or query-parameter context that makes the value sensitive.
