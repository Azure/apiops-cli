# APIM REST API Resource Coverage

**API Version**: 2024-05-01 | **Date**: 2026-04-06

Comprehensive mapping of all APIM REST API resource types against v1 APIOps coverage, v2 APIOps planned coverage, and rationale for inclusion/exclusion.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Supported |
| ❌ | Not supported |
| ➖ | Not applicable (read-only, operational, or management-plane-only) |

## Service-Level Resources

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 1 | Named Value | `/namedValues/{name}` | ✅ | ✅ | ✅ | Core config. Secrets redacted in v2. |
| 2 | Tag | `/tags/{name}` | ✅ | ✅ | ✅ | Used across APIs, products, operations. |
| 3 | Gateway | `/gateways/{name}` | ✅ | ✅ | ✅ | Self-hosted gateway definitions. |
| 4 | Version Set | `/apiVersionSets/{name}` | ✅ | ✅ | ✅ | API versioning strategy definitions. |
| 5 | Backend | `/backends/{name}` | ✅ | ✅ | ✅ | Backend service definitions. |
| 6 | Logger | `/loggers/{name}` | ✅ | ✅ | ✅ | Logging targets (App Insights, Event Hub). |
| 7 | Group | `/groups/{name}` | ✅ | ✅ | ✅ | Developer groups for product access. |
| 8 | Diagnostic | `/diagnostics/{name}` | ✅ | ✅ | ✅ | Service-level diagnostic settings. |
| 9 | Policy Fragment | `/policyFragments/{name}` | ✅ | ✅ | ✅ | Reusable policy snippets. |
| 10 | Service Policy | `/policies/policy` | ✅ | ✅ | ✅ | Global policy (all APIs). |
| 11 | Subscription | `/subscriptions/{name}` | ✅ | ✅ | ✅ | API/product subscription keys. |
| 12 | Global Schema | `/schemas/{name}` | ❌ | ✅ | ✅ | **NEW in v2.** Shared schemas referenced across APIs. |
| 13 | Policy Restriction | `/policyRestrictions/{name}` | ❌ | ✅ | ✅ | **NEW in v2.** Governance — restricts which policies can be used. |
| 14 | Documentation | `/documentations/{name}` | ❌ | ✅ | ✅ | **NEW in v2.** Service-level documentation resources. |

## Product Resources

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 15 | Product | `/products/{name}` | ✅ | ✅ | ✅ | Product definitions. |
| 16 | Product Policy | `/products/{name}/policies/policy` | ✅ | ✅ | ✅ | Per-product policies. |
| 17 | Product Api | `/products/{name}/apis/{api}` | ✅ | ✅ | ✅ | Product → API associations. |
| 18 | Product Group | `/products/{name}/groups/{group}` | ✅ | ✅ | ✅ | Product → group associations. |
| 19 | Product Tag | `/products/{name}/tags/{tag}` | ✅ | ✅ | ✅ | Product → tag associations. |
| 20 | Product Wiki | `/products/{name}/wikis/default` | ❌ | ✅ | ✅ | **NEW in v2.** Product documentation wiki. |
| 21 | Product Subscriptions | `/products/{name}/subscriptions` | ➖ | ➖ | ➖ | Read-only listing. Subscriptions managed at service level (#11). |
| 22 | Product Api Link | `/products/{name}/apiLinks/{link}` | ❌ | ❌ | ❓ | Newer association model. May replace Product Api (#17) in future. Monitor. |
| 23 | Product Group Link | `/products/{name}/groupLinks/{link}` | ❌ | ❌ | ❓ | Newer association model. May replace Product Group (#18) in future. Monitor. |

## API Resources

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 24 | API | `/apis/{name}` | ✅ | ✅ | ✅ | API definitions. |
| 25 | Api Policy | `/apis/{name}/policies/policy` | ✅ | ✅ | ✅ | Per-API policies. |
| 26 | Api Tag | `/apis/{name}/tags/{tag}` | ✅ | ✅ | ✅ | API → tag associations. |
| 27 | Api Diagnostic | `/apis/{name}/diagnostics/{diag}` | ✅ | ✅ | ✅ | Per-API diagnostic config. |
| 28 | Api Operation | `/apis/{name}/operations/{op}` | ✅ | ✅ | ✅ | API operations (endpoints). |
| 29 | Api Operation Policy | `/apis/{name}/operations/{op}/policies/policy` | ✅ | ✅ | ✅ | Per-operation policies. |
| 30 | Api Schema | `/apis/{name}/schemas/{schema}` | ❌ | ✅ | ✅ | **NEW in v2.** Per-API schema definitions. |
| 31 | Api Release | `/apis/{name}/releases/{release}` | ❌ | ✅ | ✅ | **NEW in v2.** Controls which revision is current. |
| 32 | Api Tag Description | `/apis/{name}/tagDescriptions/{tagDesc}` | ❌ | ✅ | ✅ | **NEW in v2.** Tag descriptions for dev portal display. |
| 33 | Api Wiki | `/apis/{name}/wikis/default` | ❌ | ✅ | ✅ | **NEW in v2.** API documentation wiki. |
| 34 | GraphQL Api Resolver | `/apis/{name}/resolvers/{resolver}` | ❌ | ✅ | ✅ | **NEW in v2.** GraphQL field resolvers. |
| 35 | GraphQL Api Resolver Policy | `/apis/{name}/resolvers/{resolver}/policies/policy` | ❌ | ✅ | ✅ | **NEW in v2.** Policies on GraphQL resolvers. |
| 36 | Api Revision | `/apis/{name}/revisions` | ✅ | ✅ | ✅ | List-only API; revisions extracted via API entity. |
| 37 | Api Export | `/apis/{name}?export=true` | ➖ | ➖ | ➖ | Read-only export. Used by apiops-cli for spec extraction. |
| 38 | Api Product | `/apis/{name}/products` | ➖ | ➖ | ➖ | Read-only reverse lookup. Managed via Product Api (#17). |
| 39 | Api Issue | `/apis/{name}/issues/{issue}` | ❌ | ❌ | ❌ | Instance-specific. User-reported issues on dev portal. |
| 40 | Api Issue Attachment | `/apis/{name}/issues/{issue}/attachments/{att}` | ❌ | ❌ | ❌ | Instance-specific. Child of Api Issue. |
| 41 | Api Issue Comment | `/apis/{name}/issues/{issue}/comments/{cmt}` | ❌ | ❌ | ❌ | Instance-specific. Child of Api Issue. |

## Gateway Child Resources

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 42 | Gateway Api | `/gateways/{name}/apis/{api}` | ✅ | ✅ | ✅ | Gateway → API associations. |
| 43 | Gateway Certificate Authority | `/gateways/{gw}/certificateAuthorities/{ca}` | ❌ | ❌ | ❌ | Instance-specific. CA certs for self-hosted gateways differ per env. |
| 44 | Gateway Hostname Configuration | `/gateways/{gw}/hostnameConfigurations/{host}` | ❌ | ❌ | ❌ | Instance-specific. Custom domains differ per env. |

## Identity & Auth Resources (Instance-Specific — Excluded)

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 45 | Authorization Server | `/authorizationServers/{name}` | ❌ | ❌ | ❌ | Instance-specific. OAuth client IDs/secrets differ per env. |
| 46 | OpenID Connect Provider | `/openidConnectProviders/{name}` | ❌ | ❌ | ❌ | Instance-specific. OIDC metadata URLs/client IDs differ per env. |
| 47 | Identity Provider | `/identityProviders/{name}` | ❌ | ❌ | ❌ | Instance-specific. Dev portal IdP app registrations differ per env. |
| 48 | Certificate | `/certificates/{name}` | ❌ | ❌ | ❌ | Instance-specific. Client certs/private keys differ per env. |
| 49 | Authorization Provider | `/authorizationProviders/{name}` | ❌ | ❌ | ❌ | Instance-specific. Credential manager providers. |
| 50 | Authorization | `/authorizationProviders/{prov}/authorizations/{auth}` | ❌ | ❌ | ❌ | Instance-specific. Individual OAuth authorizations. |
| 51 | Authorization Access Policy | `...authorizations/{auth}/accessPolicies/{policy}` | ❌ | ❌ | ❌ | Instance-specific. Access policies for authorizations. |
| 52 | Authorization Login Links | `/authorizationProviders/{prov}/authorizations/{auth}/getLoginLinks` | ➖ | ➖ | ➖ | Action-only (POST). Not a resource. |

## Developer Portal Resources (Instance-Specific — Excluded)

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 53 | Portal Config | `/portalconfigs/{name}` | ❌ | ❌ | ❌ | Instance-specific. Portal look & feel per env. |
| 54 | Portal Revision | `/portalRevisions/{name}` | ❌ | ❌ | ❌ | Instance-specific. Portal publication snapshots. |
| 55 | Sign In Settings | `/portalsettings/signin` | ❌ | ❌ | ❌ | Instance-specific. Auth URLs/callbacks differ per env. |
| 56 | Sign Up Settings | `/portalsettings/signup` | ❌ | ❌ | ❌ | Instance-specific. Registration config. |
| 57 | Delegation Settings | `/portalsettings/delegation` | ❌ | ❌ | ❌ | Instance-specific. Delegation to external systems. |
| 58 | Content Type | `/contentTypes/{name}` | ❌ | ❌ | ❌ | Instance-specific. Portal CMS schema. |
| 59 | Content Item | `/contentTypes/{type}/contentItems/{item}` | ❌ | ❌ | ❌ | Instance-specific. Portal CMS content. |

## Cache & Infrastructure (Instance-Specific — Excluded)

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 60 | Cache | `/caches/{name}` | ❌ | ❌ | ❌ | Instance-specific. Points to env-specific Redis instances. |

## User & Notification Resources (Instance-Specific — Excluded)

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 61 | User | `/users/{name}` | ❌ | ❌ | ❌ | Instance-specific. User accounts per env. |
| 62 | Group User | `/groups/{group}/users/{user}` | ❌ | ❌ | ❌ | Instance-specific. User membership per env. |
| 63 | Notification | `/notifications/{name}` | ❌ | ❌ | ❌ | Instance-specific. Alert configs per env. |
| 64 | Notification Recipient Email | `/notifications/{name}/recipientEmails/{email}` | ❌ | ❌ | ❌ | Instance-specific. Recipients per env. |
| 65 | Notification Recipient User | `/notifications/{name}/recipientUsers/{user}` | ❌ | ❌ | ❌ | Instance-specific. Recipients per env. |
| 66 | Email Template | `/templates/{name}` | ❌ | ❌ | ❌ | Instance-specific. Notification email branding per env. |

## Tenant & Service Management (Operational — Excluded)

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 67 | Tenant Access | `/tenant/access/{name}` | ❌ | ❌ | ❌ | Instance-specific. Git/API management access. |
| 68 | Tenant Access Git | `/tenant/access/{name}/git` | ❌ | ❌ | ❌ | Instance-specific. Git-based config sync. |
| 69 | Tenant Configuration | `/tenant/configuration/*` | ❌ | ❌ | ❌ | Instance-specific. Tenant-level config operations. |
| 70 | Tenant Settings | `/tenant/settings` | ❌ | ❌ | ❌ | Instance-specific. Tenant-level settings. |

## Newer Link Models (Watch List)

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 71 | Tag Api Link | `/tags/{tag}/apiLinks/{link}` | ❌ | ❌ | ❓ | Reverse link model. May supplement Tag associations in future. |
| 72 | Tag Operation Link | `/tags/{tag}/operationLinks/{link}` | ❌ | ❌ | ❓ | Reverse link model. May supplement Tag associations in future. |
| 73 | Tag Product Link | `/tags/{tag}/productLinks/{link}` | ❌ | ❌ | ❓ | Reverse link model. May supplement Tag associations in future. |

## Read-Only / Operational (Not Applicable)

| # | Resource Type | ARM Path | v1 APIOps | v2 APIOps | Should Cover | Notes |
|---|-------------|----------|:---------:|:---------:|:------------:|-------|
| 74 | Api Management Service | `/` (service root) | ➖ | ➖ | ➖ | The APIM instance itself. Created via IaC (Bicep/Terraform). |
| 75 | Api Management Operations | (control plane) | ➖ | ➖ | ➖ | ARM operation metadata. |
| 76 | Api Management Service Skus | `/skus` | ➖ | ➖ | ➖ | Read-only SKU listing. |
| 77 | Api Management Skus | (global) | ➖ | ➖ | ➖ | Read-only global SKU catalog. |
| 78 | Api Management Gateway Skus | `/gateways/{gw}/skus` | ➖ | ➖ | ➖ | Read-only gateway SKU listing. |
| 79 | Api Gateway | `/gateways/{name}` (API Gateway sub-resource) | ➖ | ➖ | ➖ | Gateway infrastructure. Created via IaC. |
| 80 | Api Gateway Config Connection | `/gateways/{gw}/configConnections/{conn}` | ➖ | ➖ | ➖ | Gateway infra config. Created via IaC. |
| 81 | Api Management Workspace Link | `/workspaceLinks/{link}` | ➖ | ➖ | ➖ | Workspace infra. Created via IaC. |
| 82 | Api Management Workspace Links | `/workspaceLinks` | ➖ | ➖ | ➖ | Workspace infra listing. |
| 83 | Deleted Services | `/deletedservices` | ➖ | ➖ | ➖ | Soft-delete recovery. Operational. |
| 84 | Network Status | `/networkstatus` | ➖ | ➖ | ➖ | Read-only network diagnostics. |
| 85 | Outbound Network Dependencies | `/outboundNetworkDependenciesEndpoints` | ➖ | ➖ | ➖ | Read-only network info. |
| 86 | Perform Connectivity Check | `/connectivityCheck` | ➖ | ➖ | ➖ | Action-only (POST). Diagnostic. |
| 87 | Operation Status | `/operationStatuses/{opId}` | ➖ | ➖ | ➖ | Long-running op polling. Internal use. |
| 88 | Operations Results | `/operationResults/{opId}` | ➖ | ➖ | ➖ | Long-running op results. Internal use. |
| 89 | Region | `/regions` | ➖ | ➖ | ➖ | Read-only region listing. |
| 90 | Reports | `/reports/*` | ➖ | ➖ | ➖ | Read-only analytics. |
| 91 | Quota By Counter Keys | `/quotas/counterKeys` | ➖ | ➖ | ➖ | Runtime quota state. |
| 92 | Quota By Period Keys | `/quotas/periodKeys` | ➖ | ➖ | ➖ | Runtime quota state. |
| 93 | Tag Entity | `/tagResources` | ➖ | ➖ | ➖ | Read-only consolidated tag view. |
| 94 | Tag Resource | `/tags/{tag}/entityLinks` | ➖ | ➖ | ➖ | Read-only consolidated tag view. |
| 95 | Issue | `/issues` | ➖ | ➖ | ➖ | Read-only. Service-level issue listing. |
| 96 | User Confirmation Password | `/users/{user}/confirmations/password` | ➖ | ➖ | ➖ | Action-only (POST). |
| 97 | User Group | `/users/{user}/groups` | ➖ | ➖ | ➖ | Read-only reverse lookup. |
| 98 | User Identities | `/users/{user}/identities` | ➖ | ➖ | ➖ | Read-only. |
| 99 | User Subscription | `/users/{user}/subscriptions` | ➖ | ➖ | ➖ | Read-only reverse lookup. |
| 100 | Private Endpoint Connection | `/privateEndpointConnections/{conn}` | ➖ | ➖ | ➖ | Networking infra. Created via IaC. |
| 101 | Policy Description | `/policyDescriptions` | ➖ | ➖ | ➖ | Read-only. Policy metadata catalog. |
| 102 | Policy Restriction Validations | `/policyRestrictions/{name}/validate` | ➖ | ➖ | ➖ | Action-only (POST). Validation endpoint. |
| 103 | All Policies | `/allPolicies` | ➖ | ➖ | ➖ | Read-only aggregate view. |
| 104 | Operation | (global) | ➖ | ➖ | ➖ | ARM operation metadata. |

## Summary

| Category | Count | v1 | v2 | Delta |
|----------|------:|:--:|:--:|:-----:|
| Covered (promotable) | 33 | 23 | 33 | **+10** |
| Instance-specific (excluded) | 27 | 0 | 0 | — |
| Watch list (future) | 5 | 0 | 0 | — |
| Read-only / operational (N/A) | 31 | 0 | 0 | — |
| **Total resource types** | **96** | **23** | **33** | **+10** |

### New in v2

1. Global Schema
2. Policy Restriction
3. Documentation
4. Api Schema
5. Api Release
6. Api Tag Description
7. Api Wiki
8. Product Wiki
9. GraphQL Api Resolver
10. GraphQL Api Resolver Policy
