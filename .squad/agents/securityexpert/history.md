# SecurityExpert — History

## Project Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management operations
- **Stack:** TypeScript 5.x, Node.js 22.x, Commander, @azure/identity, js-yaml, simple-git
- **User:** Elizabeth Maher
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
