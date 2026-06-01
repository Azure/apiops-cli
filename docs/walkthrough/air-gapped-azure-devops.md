# Air-Gapped Setup: Azure DevOps

Deploy APIM configuration using apiops-cli on [self-hosted Azure Pipelines agents](https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/agents?view=azure-devops#self-hosted-agents) with **no internet access** at runtime. There are two supported approaches — pick the one that matches your environment and follow that walkthrough end-to-end.

---

## Choose Your Approach

| Approach | Best For | Walkthrough |
|----------|----------|-------------|
| **Local npm Registry** (recommended) | You have (or can host) an Azure Artifacts npm feed reachable from the agent. Packages flow through the feed; only the feed needs controlled connectivity to refresh. | [Local npm Registry walkthrough](air-gapped-azure-devops-local-registry.md) |
| **Offline Tarball** | No internal npm registry is available. The CLI ships as a `.tgz` in your repo and the npm cache is transferred manually to the agent. Requires re-staging on every dependency change. | [Offline Tarball walkthrough](air-gapped-azure-devops-offline-tarball.md) |

---

## Related

- [Air-gapped setup: GitHub Actions](air-gapped-github-actions.md)
- [Azure DevOps integration](../ci-cd/azure-devops.md) — standard (connected) setup
- [apiops init reference](../commands/init.md)
- [Authentication guide](../guides/authentication.md)
