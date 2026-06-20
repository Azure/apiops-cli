# All types APIM Test Assets

The goal of all-resource-types integration test is to cover all resource types in the [`ResourceType`](src/models/resource-types.ts) enum.

The round trip test first deploys a source API Management instance with all features described in the [what is deployed](#what-is-deployed) section. The test then extracts everything from the source instance and publishes the artifacts to a black target API management instance. See [round trip phases](#round-trip-phases) for more details.

## Prerequisites

- Azure CLI authenticated with `az login`
- Subscription permissions to create/delete APIM and supporting resources
- Bicep support via Azure CLI

## Quick Commands

### Run full round trip

```powershell
cd tests/integration/all-resource-types
./run-roundtrip-test.ps1 -PublisherEmail admin@contoso.com
```

### Run full round trip with log:

#### Bash
```bash
set -o pipefail && log_file="tests/integration/all-resource-types/phases/logs/roundtrip-premium-$(date +%Y%m%d-%H%M%S).log" && mkdir -p "$(dirname "$log_file")" && echo "Logging to $log_file" && pwsh -NoLogo -NoProfile -File ./tests/integration/all-resource-types/run-roundtrip-test.ps1 -SkuName Premium 2>&1 | tee "$log_file"
```

#### Powershell
```powershell
$logFile = "tests/integration/all-resource-types/phases/logs/roundtrip-premium-$((Get-Date).ToString('yyyyMMdd-HHmmss')).log"
New-Item -ItemType Directory -Path (Split-Path -Parent $logFile) -Force | Out-Null
Write-Host "Logging to $logFile"
.\tests\integration\all-resource-types\run-roundtrip-test.ps1 -SkuName Premium 2>&1 | Tee-Object -FilePath $logFile
if ($LASTEXITCODE -ne 0) { throw "Round-trip failed with exit code $LASTEXITCODE. See $logFile" }
```

## What is Deployed?

### APIs
An apim instance with the following apis
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
| `src-mcp-existing-server` | MCP (working existing-server demo via Learn) | None |
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
- **Workspace** (Premium/StandardV2/PremiumV2 only): Workspace with backend, named value, tag, group, product, API. The workspace product links groups at **both** scopes to cover the group-link scope round-trip: the service-level `administrators` group (scope `service`, auto-linked by APIM) and a workspace-scoped custom group `src-ws-group-internal` (scope `workspace`).

## Round-Trip Phases

**Phase 1: Deploy source + target** (`phases/run-phase1-deploy.ps1`).

Deploys source and target APIM environments in parallel. 

```powershell
# Minimum parameters
./phases/run-phase1-deploy.ps1 -SourceResourceGroup rg-src -TargetResourceGroup rg-tgt -PublisherEmail admin@contoso.com

# All parameters
./phases/run-phase1-deploy.ps1 -SourceResourceGroup rg-src -TargetResourceGroup rg-tgt -PublisherEmail admin@contoso.com -SkuName StandardV2 -Location eastus2 -LogLevel Verbose -SourceApimName src-apim -TargetApimName tgt-apim -SourceSubscriptionId 11111111-1111-1111-1111-111111111111 -TargetSubscriptionId 22222222-2222-2222-2222-222222222222
```

Script returns resolved names, which can be for later phases, especially in the case minimal parameters are passed to the script.  Example return value:

```powershell
@{
	sourceSubscriptionId = "11111111-1111-1111-1111-111111111111"
	sourceResourceGroup  = "rg-src"
	sourceApimName       = "src-apim"
	targetSubscriptionId = "22222222-2222-2222-2222-222222222222"
	targetResourceGroup  = "rg-tgt"
	targetApimName       = "tgt-apim"
	skuName              = "StandardV2"
	location             = "eastus2"
}
```

**Phase 2: Extract** (`phases/run-phase2-extract.ps1`).

Runs `apiops extract` against the source APIM instance and writes artifacts to the extract directory.

```powershell
# Minimum parameters
./phases/run-phase2-extract.ps1 -SourceResourceGroup rg-src -SourceApimName src-apim

# All parameters
./phases/run-phase2-extract.ps1 -SourceSubscriptionId 11111111-1111-1111-1111-111111111111 -SourceResourceGroup rg-src -SourceApimName src-apim -LogLevel Debug -ExtractOutputDir ./phases/extracted-artifacts
```

Script returns the path to the extracted files. Example return value:

```powershell
/workspaces/apiops-cli/tests/integration/all-resource-types/phases/extracted-artifacts
```

**Phase 3: Validate extract** (`phases/run-phase3-validate-extract.ps1`)

Validates extracted artifacts against the expected manifest before publish.

```powershell
# Minimum parameters
./phases/run-phase3-validate-extract.ps1

# All parameters
./phases/run-phase3-validate-extract.ps1 -SkuName PremiumV2 -LogLevel Verbose -ExtractOutputDir ./phases/extracted-artifacts
```

**Phase 4: Create target overrides** (`phases/run-phase4-create-overrides.ps1`).

Generates the target-specific `.overrides.yaml` file used by the publish phase. Script returns the value of the created configuration overrides file.

```powershell
# Minimum parameters
./phases/run-phase4-create-overrides.ps1 -TargetResourceGroup rg-tgt

# All parameters
./phases/run-phase4-create-overrides.ps1 -TargetSubscriptionId 22222222-2222-2222-2222-222222222222 -TargetResourceGroup rg-tgt -LogLevel Info -ExtractOutputDir ./phases/extracted-artifacts
```

Script returns path to created configuration overrides file. Example return value:

```powershell
/workspaces/apiops-cli/tests/integration/all-resource-types/phases/extracted-artifacts/.overrides.yaml
```

**Phase 5: Publish** (`phases/run-phase5-publish.ps1`).

Publishes extracted artifacts to the target APIM instance using the generated overrides file.

```powershell
# Minimum parameters
./phases/run-phase5-publish.ps1 -TargetResourceGroup rg-tgt -TargetApimName tgt-apim -OverrideFile ./phases/extracted-artifacts/.overrides.yaml

# All parameters
./phases/run-phase5-publish.ps1 -TargetSubscriptionId 22222222-2222-2222-2222-222222222222 -TargetResourceGroup rg-tgt -TargetApimName tgt-apim -LogLevel Debug -OverrideFile ./phases/extracted-artifacts/.overrides.yaml -ExtractOutputDir ./phases/extracted-artifacts
```

**Phase 6: Compare source and target API Management instances** (`phases/run-phase6-compare.ps1`).

Compares source and target APIM resources and reports differences or parity.

```powershell
# Minimum parameters
./phases/run-phase6-compare.ps1 -SourceResourceGroup rg-src -SourceApimName src-apim -TargetResourceGroup rg-tgt -TargetApimName tgt-apim

# All parameters
./phases/run-phase6-compare.ps1 -SourceSubscriptionId 11111111-1111-1111-1111-111111111111 -SourceResourceGroup rg-src -SourceApimName src-apim -TargetSubscriptionId 22222222-2222-2222-2222-222222222222 -TargetResourceGroup rg-tgt -TargetApimName tgt-apim -LogLevel Verbose
```

**Phase 7: Teardown** (`phases/run-phase7-teardown.ps1`).

Deletes source and target resource groups and purges soft-deleted APIM services. This phase always run, regardless of the success of previous phases, unles `-SkipTeardown` switch is specified.

```powershell
# Minimum parameters
./phases/run-phase7-teardown.ps1 -SourceResourceGroup rg-src -TargetResourceGroup rg-tgt

# All parameters
./phases/run-phase7-teardown.ps1 -SourceResourceGroup rg-src -TargetResourceGroup rg-tgt -Location eastus2 -SkipTeardown
```

## CI

Workflow: `.github/workflows/integration-test.yml` (`workflow_dispatch`)

Required environment secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `APIM_PUBLISHER_EMAIL`

## File Layout

- `bicep/` source and target templates
- `modules/` shared PowerShell helpers
- `phases/` phase scripts
- `run-roundtrip-test.ps1` full orchestrator

## Notes

- APIM provisioning takes time (typically 30-45 minutes).
- Exit codes used by compare/validation phases: `0` success, `1` diff/validation failure, `2` execution error.
