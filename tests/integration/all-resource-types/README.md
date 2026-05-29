# Kitchen Sink APIM — Build Verification Test Infrastructure

This directory contains Bicep templates and scripts to deploy a "kitchen sink" Azure API Management instance for end-to-end build verification testing of the APIOps CLI.

## What Gets Deployed

The kitchen sink APIM instance includes **every resource type and API protocol variation** that APIOps-v2 supports, covering all 33 resource types in the `ResourceType` enum:

### API Protocol Variations
| API | Type | Spec Format |
|-----|------|-------------|
| `src-rest-openapi` | REST | OpenAPI 3.0 YAML |
| `src-soap-passthrough` | SOAP | WSDL |
| `src-graphql-synthetic` | GraphQL | SDL (inline) |
| `src-graphql-passthrough` | GraphQL | SDL (pass-through) |
| `src-websocket` | WebSocket | None |
| `src-rest-versioned-v1` | REST (versioned) | OpenAPI |
| `src-rest-revisioned` | REST (revisioned) | OpenAPI |
| `src-mcp-from-api` | MCP (from existing API) | None |
| `src-mcp-from-external` | MCP (from external MCP server) | None |
| `src-a2a-weather-agent` | A2A (JSON-RPC + agent card) | None |

### Backend Variations
| Backend | Type |
|---------|------|
| `src-backend-http` | Simple HTTP URL |
| `src-backend-function` | Azure Function stub |
| `src-backend-logicapp` | Logic App stub |
| `src-backend-pool` | Pool (multi-backend) |
| `src-backend-circuit-breaker` | Circuit breaker |

### Other Resources
- **Named Values**: Plain text, secret, Key Vault reference
- **Tags**: 2 tags applied to APIs and products
- **Gateway**: Self-hosted gateway with API association
- **Version Set**: URL-path versioning scheme
- **Loggers**: Application Insights + Event Hub
- **Groups**: Custom group
- **Policy Fragments**: CORS + rate limit
- **Global Schema**: JSON schema
- **Policy Restriction**: Scope-based restriction
- **Documentation**: Getting started doc
- **Diagnostics**: App Insights diagnostic at service and API level
- **Service Policy**: Global CORS policy
- **Products**: Starter + Premium with policies, API/group associations, tags, wikis
- **Subscriptions**: All-APIs + product-scoped
- **Workspace** (Developer v2 only): Workspace with backend, named value, tag, product, API

## Prerequisites

- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed and authenticated (`az login`)
- An Azure subscription with permissions to create resources
- [Bicep](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/install) (bundled with recent Azure CLI)

## Run

### Deploy

```powershell
# Deploy with defaults (StandardV2 SKU, centralus, auto-generated resource names)
.\deploy-source.ps1 -ResourceGroupName rg-apiops-bvt -PublisherEmail admin@contoso.com

# Deploy with Developer SKU (classic — supports self-hosted gateways, no workspaces)
.\deploy-source.ps1 -ResourceGroupName rg-apiops-bvt -PublisherEmail admin@contoso.com -SkuName Developer

# Deploy with Premium SKU (classic — supports everything including workspaces + gateways)
.\deploy-source.ps1 -ResourceGroupName rg-apiops-bvt -PublisherEmail admin@contoso.com -SkuName Premium
```

> ⏱️ **APIM provisioning takes 30-45 minutes.** The script will wait for completion.

### Run APIOps Extract Against It

After deployment, the script outputs the exact CLI command:

```powershell
npx apiops extract \
  --subscription-id <subscription-id> \
  --resource-group  rg-apiops-bvt \
  --service-name    src-apim-bvt \
  --output-dir      ./extracted
```

### Destroy

```powershell
.\deploy-source.ps1 -ResourceGroupName rg-apiops-bvt -Destroy
```

## Round-Trip Integration Test

The round-trip test validates the full extract→publish cycle:

1. **Deploy** an all-resources source APIM (all 33 resource types)
2. **Deploy** a blank target APIM (same SKU, supporting infra only)
3. **Extract** from source using `apiops extract`
4. **Publish** extracted artifacts to target using `apiops publish`
5. **Compare** source vs target via ARM REST API (deep property comparison with normalization)
6. **Teardown** both resource groups

### Run via GitHub Actions

The workflow at `.github/workflows/integration-test.yml` provides a manual trigger (`workflow_dispatch`) with:
- **SKU selection** (StandardV2, Developer, Premium, PremiumV2)
- **Location** (default: centralus)
- **Log level** (Info, Verbose, Debug; default: Verbose)
- **Skip teardown** toggle for debugging

Requires an `integration-test` environment with secrets:
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (OIDC)
- `APIM_PUBLISHER_EMAIL`

### Comparison Script

`compare-apim-instances.ps1` can also be run standalone to diff any two APIM instances:

```powershell
.\compare-apim-instances.ps1 `
  -SourceSubscriptionId "..." -SourceResourceGroup rg-src -SourceApimName apim-src `
  -TargetSubscriptionId "..." -TargetResourceGroup rg-tgt -TargetApimName apim-tgt
```

Exit codes: `0` = match, `1` = differences found, `2` = error.

## Files

| File | Purpose |
|------|---------|
| `source-apim.bicep` | Source APIM with all 33 resource types |
| `target-apim.bicep` | Blank target APIM + supporting infra |
| `deploy-source.ps1` | Deploy/destroy the source instance |
| `run-roundtrip-test.ps1` | Master orchestrator for the full test |
| `compare-apim-instances.ps1` | ARM REST comparison script |
| `validate-extracted-artifacts.ps1` | Validate extracted artifact structure |
| `expected-structure.json` | Manifest of expected extracted files |

## Cost

This deployment incurs costs for APIM and supporting resources (App Insights, Event Hub, Key Vault). Deploy on demand and destroy after testing. See [Azure API Management pricing](https://azure.microsoft.com/pricing/details/api-management/) for details.
