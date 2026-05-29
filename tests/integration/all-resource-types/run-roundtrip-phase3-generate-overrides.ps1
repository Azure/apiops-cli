#requires -Version 7.0
<#
.SYNOPSIS
  Phase 3 — Generate target environment overrides for publish.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$maskingModule = Join-Path $PSScriptRoot 'MaskingHelpers.psm1'

if (-not (Test-Path $maskingModule)) {
    Write-Error "Required file not found: $maskingModule"
    exit 2
}

if (-not (Test-Path $ExtractOutputDir)) {
    Write-Error "ExtractOutputDir not found: $ExtractOutputDir — run the extract step first"
    exit 2
}

Import-Module $maskingModule -Force

Write-Host "🔧 Generate Overrides — Generate override config for target environment"
$targetKvUri        = az keyvault list --resource-group $TargetResourceGroup --query "[0].properties.vaultUri" -o tsv
$targetAiResourceId = az monitor app-insights component list --resource-group $TargetResourceGroup --query "[0].id" -o tsv
$targetAiKey        = az monitor app-insights component list --resource-group $TargetResourceGroup --query "[0].instrumentationKey" -o tsv
$targetEhNs         = az eventhubs namespace list --resource-group $TargetResourceGroup --query "[0].name" -o tsv

if (-not $targetKvUri) {
    Write-Host "❌ Could not resolve target Key Vault URI in $(Protect-ResourceGroupName -Value $TargetResourceGroup)"
    exit 2
}
if (-not $targetAiResourceId -or -not $targetAiKey) {
    Write-Host "❌ Could not resolve target Application Insights details in $(Protect-ResourceGroupName -Value $TargetResourceGroup)"
    exit 2
}
if (-not $targetEhNs) {
    Write-Host "❌ Could not resolve target Event Hub namespace in $(Protect-ResourceGroupName -Value $TargetResourceGroup)"
    exit 2
}

$targetEhConnStr = az eventhubs namespace authorization-rule keys list `
    --resource-group $TargetResourceGroup `
    --namespace-name $targetEhNs `
    --name 'tgt-eh-send' `
    --query 'primaryConnectionString' -o tsv

if (-not $targetEhConnStr) {
    Write-Host "   ⚠️  Could not get Event Hub connection string — EH logger override will be empty"
}

$targetEhName = 'tgt-eh-logs'
$overrideFile = [System.IO.Path]::GetFullPath((Join-Path $ExtractOutputDir '.overrides.yaml'))
$overrideYaml = @"
namedValues:
  src-nv-keyvault:
    keyVault:
      secretIdentifier: "${targetKvUri}secrets/tgt-secret-value"

loggers:
  src-logger-appinsights:
    resourceId: "$targetAiResourceId"
    credentials:
      instrumentationKey: "$targetAiKey"
  src-logger-eventhub:
    credentials:
      name: "$targetEhName"
      connectionString: "$targetEhConnStr"
"@

$overrideYaml | Set-Content -Path $overrideFile -Encoding utf8

Write-Host "✅ Generate Overrides — Wrote $overrideFile"
exit 0
