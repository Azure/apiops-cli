# Multi-Environment Deployment Guide

This guide captures the default recommendation for promoting API Management configuration across environments.

## Recommended Default

Use:

- **One shared artifact directory** committed to source control
- **One override file per environment** (dev/qa/prod)
- **Trunk-based branching** with PR review on `main`
- **Multi-stage CI/CD promotion** with approvals between stages

This keeps your API definitions consistent while allowing environment-specific values to vary safely.

## Repository Layout

```text
repo/
├── apim-artifacts/
├── configuration.extract.yaml
├── configuration.dev.yaml
├── configuration.qa.yaml
├── configuration.prod.yaml
└── .github/workflows/publish.yml
```

## Promotion Flow

1. Extract artifacts from your source environment and commit them.
2. Open a PR for changes to artifacts and override files.
3. Merge to `main`.
4. Pipeline publishes to **dev → qa → prod** with approval gates.

## Topology Guidance

| Topology | Recommendation |
|---|---|
| Separate APIM instance per environment | ✅ Preferred for isolation and clarity |
| Single APIM instance with workspaces | ⚠️ Acceptable with careful workspace targeting |
| Single APIM instance without workspaces | ❌ Not recommended for multi-environment promotion |

## Branching Strategy

| Strategy | Guidance |
|---|---|
| Trunk-based with feature branches | ✅ Recommended default |
| Environment branches | ⚠️ Use only when environments intentionally diverge |
| One branch per environment with different artifact sets | ❌ Avoid (drift risk) |

## Guardrails

- Keep resource names consistent across environments.
- Use overrides for environment-specific properties only.
- Do not commit secret values in override files.
- Prefer Key Vault references for secrets.

## Anti-Patterns to Avoid

- Maintaining different artifact directories per environment
- Storing plain-text production secrets in Git
- Promoting backward (for example, prod configuration into dev)

## Related Guides

- [Environment Overrides Guide](environment-overrides.md)
- [GitHub Actions CI/CD Guide](../ci-cd/github-actions.md)
- [Azure DevOps CI/CD Guide](../ci-cd/azure-devops.md)
