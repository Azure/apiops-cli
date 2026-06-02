# All types APIM Test Assets

Infrastructure and scripts for APIOps integration tests against a source and target APIM.

## Prerequisites

- Azure CLI authenticated with `az login`
- Subscription permissions to create/delete APIM and supporting resources
- Bicep support via Azure CLI

## Quick Commands

Run full round trip:

```powershell
cd tests/integration/all-resource-types
./run-roundtrip-test.ps1 -PublisherEmail admin@contoso.com
```

Run full round trip with log:

Bash:
```bash
set -o pipefail && log_file="tests/integration/all-resource-types/phases/logs/roundtrip-premium-$(date +%Y%m%d-%H%M%S).log" && echo "Logging to $log_file" && pwsh -NoLogo -NoProfile -File ./tests/integration/all-resource-types/run-roundtrip-test.ps1 -SkuName Premium 2>&1 | tee "$log_file"
```

Powershell:
```powershell
$logFile = "tests/integration/all-resource-types/phases/logs/roundtrip-premium-$((Get-Date).ToString('yyyyMMdd-HHmmss')).log"
Write-Host "Logging to $logFile"
.\tests\integration\all-resource-types\run-roundtrip-test.ps1 -SkuName Premium 2>&1 | Tee-Object -FilePath $logFile
if ($LASTEXITCODE -ne 0) { throw "Round-trip failed with exit code $LASTEXITCODE. See $logFile" }
```

## Round-Trip Phases

| Phase | Script |
|---|---|
| Deploy source + target | `phases/run-phase1-deploy.ps1` |
| Extract | `phases/run-phase2-extract.ps1` |
| Validate extract | `phases/run-phase3-validate-extract.ps1` |
| Create target overrides | `phases/run-phase4-create-overrides.ps1` |
| Publish | `phases/run-phase5-publish.ps1` |
| Compare | `phases/run-phase6-compare.ps1` |
| Teardown | `phases/run-phase7-teardown.ps1` |

## CI

Workflow: `.github/workflows/integration-test.yml` (`workflow_dispatch`)

Required environment secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `APIM_PUBLISHER_EMAIL`

## Layout

- `bicep/` source and target templates
- `modules/` shared PowerShell helpers
- `phases/` phase scripts
- `run-roundtrip-test.ps1` full orchestrator

## Notes

- APIM provisioning is slow (typically 30-45 minutes).
- Exit codes used by compare/validation phases: `0` success, `1` diff/validation failure, `2` execution error.
