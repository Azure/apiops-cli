# Air-Gapped Setup: GitHub Actions

Deploy APIM configuration using apiops-cli on [self-hosted GitHub Actions runners](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners) with **no internet access** at runtime. There are two supported approaches — pick the one that matches your environment and follow that walkthrough end-to-end.

---

## Choose Your Approach

| Approach | Best For | Walkthrough |
|----------|----------|-------------|
| **Local npm Registry** (recommended) | You run [GitHub Enterprise Server](https://docs.github.com/en/enterprise-server@latest/admin/overview/about-github-enterprise-server) with [GitHub Packages](https://docs.github.com/en/enterprise-server@latest/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), or any other internal npm registry reachable from the runner (Verdaccio, Artifactory, Nexus). Packages flow through the registry; only the registry needs controlled connectivity to refresh. | [Local npm Registry walkthrough](air-gapped-github-actions-local-registry.md) |
| **Offline Tarball** | No internal npm registry is available. The CLI ships as a `.tgz` in your repo and the npm cache is transferred manually to the runner. Requires re-staging on every dependency change. | [Offline Tarball walkthrough](air-gapped-github-actions-offline-tarball.md) |

> **GitHub.com SaaS is not an air-gapped registry.** `npm.pkg.github.com` is an internet service. The Local npm Registry approach assumes [GitHub Enterprise Server](https://docs.github.com/en/enterprise-server@latest/admin/overview/about-github-enterprise-server) running inside your network (or another self-hosted npm registry).

---

## Related

- [Air-gapped setup: Azure DevOps](air-gapped-azure-devops.md)
- [GitHub Actions integration](../ci-cd/github-actions.md) — standard (connected) setup
- [apiops init reference](../commands/init.md)
- [Authentication guide](../guides/authentication.md)
