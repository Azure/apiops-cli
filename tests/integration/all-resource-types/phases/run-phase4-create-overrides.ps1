#requires -Version 7.0
<#
.SYNOPSIS
  Phase 4 — Generate target environment overrides for target APIM.
.DESCRIPTION
    Builds the override file for target-specific values and writes it into the
    extracted-artifacts directory for the publish phase to consume.

.PARAMETER TargetSubscriptionId
    Optional subscription ID for the target APIM instance.

.PARAMETER TargetResourceGroup
    Target APIM resource group.

.PARAMETER LogLevel
    Logging verbosity passed to helper commands.

.PARAMETER ExtractOutputDir
    Directory containing the extracted artifacts and generated overrides.

.EXAMPLE
    .\run-phase4-create-overrides.ps1 -TargetResourceGroup rg-tgt
#>

[CmdletBinding()]
param(
    [string]$TargetSubscriptionId,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'

$maskingModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/MaskingHelpers.psm1'
$scriptArgModule  = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/ScriptArgumentHelpers.psm1'

foreach ($requiredFile in @($maskingModule, $scriptArgModule)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

if (-not (Test-Path $ExtractOutputDir)) {
    Write-Error "ExtractOutputDir not found: $ExtractOutputDir — run the extract step first"
    exit 2
}

Import-Module $maskingModule -Force
Import-Module $scriptArgModule -Force

Set-ScriptLogPreferences -LogLevel $LogLevel

# Pull the target-specific values directly from Azure for the override file.
Write-Host "🔧 Override — Generate target environment override file"
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
      name: "tgt-eh-logs"
      connectionString: "$targetEhConnStr"
"@

$overrideYaml | Set-Content -Path $overrideFile -Encoding utf8

Write-Host "✅ Override file written: $overrideFile"
Write-Output $overrideFile