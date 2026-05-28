# ApicExpert — History

## Core Context

- **Project:** apiops-cli — TypeScript CLI for Azure API Management and API Center
- **Spec:** `specs/001-apiops-cli/spec.md`
- **Constitution:** `.squad/identity/constitution.md` (v2.1.0)
- **User:** User (redacted)
- **Stack:** TypeScript 6.x, Node.js 22 LTS, `@azure/identity` for auth, raw APIC REST API (no SDK for payloads)
- **APIC REST API base:** `https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiCenter/services/{svc}`
- **Key distinction:** APIC and APIM are separate Azure services with separate REST APIs, separate RBAC, and different resource models.

## Learnings

<!-- Append new learnings here after each session -->
