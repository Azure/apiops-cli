# Architecture

## Overview

`apiops` implements a **configuration-as-code** workflow for Azure API Management (APIM). Configuration is extracted from a running APIM instance into version-controlled artifact files. Those files become the source of truth for publishing to one or more environments, driven by a CI/CD pipeline.

---

## Configuration-as-Code Workflow

The diagram below shows how `apiops` fits into a typical team workflow:

_Icon attribution: Azure Architecture Icons (https://learn.microsoft.com/en-us/azure/architecture/icons/) and Font Awesome Free (https://fontawesome.com/)._ 

```mermaid
flowchart LR
    classDef cmd font-family:monospace

    dev(["Dev"])
    init_op(["apiops init"]):::cmd
    extract_op(["apiops extract"]):::cmd
    publish_op(["apiops publish"]):::cmd
    pr["<img src='https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/solid/code-pull-request.svg' width='16' height='16' /><br/>Pull Request"]
    merge_op["<img src='https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/solid/code-merge.svg' width='16' height='16' /><br/>Merge"]

    subgraph repo["<img src='https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/brands/github.svg' width='14' height='14' /> GitHub / <img src='./10261-icon-service-Azure-DevOps.svg' width='14' height='14' /> Azure DevOps"]
        artifacts["<img src='https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/regular/folder.svg' width='16' height='16' /><br/>apim-artifacts"]
        subgraph ci["<img src='https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/solid/gear.svg' width='16' height='16' /><br/>CI/CD Workflows"]
            direction TB
            extract_pipeline["extract"]
            publish_pipeline["publish"]
            extract_pipeline --- publish_pipeline
        end
    end

    subgraph azure["Azure"]
        direction LR
        apim_src["<img src='./10042-icon-service-API-Management-Services.svg' width='18' height='18' /><br/>API Management<br/>source"]
        apim_dst["<img src='./10042-icon-service-API-Management-Services.svg' width='18' height='18' /><br/>API Management<br/>target"]
    end

    dev -- "Step 1" --> init_op --> ci
    dev -- "Step 2" --> extract_pipeline --> extract_op
    apim_src --> extract_op --> artifacts
    ci -- "Step 3" --> pr
    pr -- "Step 4" --> merge_op
    merge_op -- "Step 5" --> publish_pipeline --> publish_op
    artifacts --> publish_op --> apim_dst
```

| Step | Command | Description |
|------|---------|-------------|
| 1 | `apiops init` | Scaffolds the Git repository with CI/CD workflow files and an identity setup guide |
| 2 | `apiops extract` | Reads the running APIM configuration and writes it to local artifact files |
| 3 | Pull Request | Developer submits extracted artifact changes for review |
| 4 | Merge | Approved changes are merged |
| 5 | `apiops publish` | On merge, the publish workflow runs and applies artifact files to the target API Management instance |

### Icon Usage

> [!NOTE]
> Chart uses [Azure Architecture Icons ](https://learn.microsoft.com/en-us/azure/architecture/icons/) and GitHub icons from [Font Awesome](https://fontawesome.com/).

---

## Component Architecture

The diagram below shows the internal structure of the `apiops` CLI:

```mermaid
flowchart TB
    subgraph entrypoint["CLI Entry Point"]
        extract_cmd["extract"]
        publish_cmd["publish"]
        init_cmd["init"]
    end

    subgraph services["Services"]
        direction TB
        extract_svc["Extract Service<br/>(parallel by dependency tier)"]
        filter_svc["Filter + Transitive Resolver"]

        publish_svc["Publish Service<br/>(dependency-ordered PUT / DELETE)"]
        override_svc["Override Merger<br/>(per-environment config)"]
        git_svc["Git Diff Service<br/>(incremental publish)"]
        dry_svc["Dry-run Reporter"]

        init_svc["Init Service<br/>(CI/CD scaffolding)"]
    end

    subgraph clients["Clients"]
        apim_client["APIM REST Client<br/>(Azure Management API)"]
        store["Artifact Store"]
    end

    subgraph auth["Authentication"]
        auth_pkg["@azure/identity"]
    end

    subgraph external["External Systems"]
        azure_apim[("<img src='./10042-icon-service-API-Management-Services.svg' width='20' height='20' /><br/>Azure API Management")]
        local_files[("<img src='https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/regular/folder.svg' width='20' height='20' /><br/>Artifact Files<br/>(Local Filesystem)")]
        git_repo[("<img src='https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.x/svgs/brands/github.svg' width='20' height='20' /> GitHub / <img src='./10261-icon-service-Azure-DevOps.svg' width='20' height='20' /> Azure DevOps")]
    end

    extract_cmd --> extract_svc
    publish_cmd --> publish_svc
    init_cmd --> init_svc

    extract_svc --> filter_svc
    extract_svc --> apim_client
    extract_svc --> store

    publish_svc --> override_svc
    publish_svc --> git_svc
    publish_svc --> dry_svc
    publish_svc --> apim_client
    publish_svc --> store

    apim_client --> auth_pkg
    auth_pkg --> azure_apim
    store <--> local_files
    git_svc --> git_repo
    init_svc --> git_repo
```

## Authentication

`apiops` uses [`DefaultAzureCredential`](https://learn.microsoft.com/javascript/api/%40azure/identity/defaultazurecredential?view=azure-node-latest) from the `@azure/identity` SDK.

For the up-to-date credential chain and authentication behavior, see Microsoft docs:

- [Credential chains in the Azure Identity library for JavaScript](https://learn.microsoft.com/azure/developer/javascript/sdk/authentication/credential-chains)
- [Authenticate JavaScript apps to Azure services during local development](https://learn.microsoft.com/azure/developer/javascript/sdk/authentication/local-development-environment-service-principal)

No secrets are required when running in GitHub Actions workflows generated by `apiops init` — authentication is handled entirely via OIDC federated credentials.

---
