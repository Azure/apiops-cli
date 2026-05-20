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
