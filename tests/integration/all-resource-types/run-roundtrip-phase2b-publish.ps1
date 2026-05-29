#requires -Version 7.0
<#
.SYNOPSIS
  Phase 2b — Generate target environment overrides and publish artifacts to target APIM.

.DESCRIPTION
  Generates a .overrides.yaml file inside ExtractOutputDir that rewrites source
  environment references (Key Vault, App Insights, Event Hub) to target equivalents,
  then runs `apiops publish` to apply the artifacts. Can be invoked standalone or as
  part of the run-roundtrip-phase2-roundtrip.ps1 orchestrator.

  Requires that run-roundtrip-phase2a-extract.ps1 (or equivalent) has already
  populated ExtractOutputDir.

.EXAMPLE
  .\run-roundtrip-phase2b-publish.ps1 -StateFile ./roundtrip-state.json

.EXAMPLE
  .\run-roundtrip-phase2b-publish.ps1 -StateFile ./roundtrip-state.json -LogLevel Debug -ExtractOutputDir ./my-artifacts
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$StateFile,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$maskingModule = Join-Path $PSScriptRoot 'MaskingHelpers.psm1'

foreach ($requiredFile in @($maskingModule, $StateFile)) {
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

function Get-ApiopsLogLevel([string]$ScriptLogLevel) {
    switch ($ScriptLogLevel) {
        'Info'    { return 'info' }
        'Verbose' { return 'warn' }
        'Debug'   { return 'debug' }
        default   { return 'info' }
    }
}

function Get-ApiopsAuthArgs {
    # In CI, we explicitly pass client/tenant to apiops so DefaultAzureCredential
    # can use the intended federated identity after long-running deploy phases.
    # If env vars are unset (local runs), apiops falls back to default credential chain.
    $authArgs = @()

    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_CLIENT_ID)) {
        $authArgs += @('--client-id', $env:AZURE_CLIENT_ID)
    }

    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_TENANT_ID)) {
        $authArgs += @('--tenant-id', $env:AZURE_TENANT_ID)
    }

    return $authArgs
}

$state       = Get-Content -Path $StateFile -Raw | ConvertFrom-Json
$targetSubId = $state.targetSubscriptionId
$targetRg    = $state.targetResourceGroup
$targetName  = $state.targetApimName

$apiopsLogLevel = Get-ApiopsLogLevel -ScriptLogLevel $LogLevel
$apiopsAuthArgs = Get-ApiopsAuthArgs

Write-Host "🔧 Publish — Generate override config for target environment"
$targetKvUri        = az keyvault list --resource-group $targetRg --query "[0].properties.vaultUri" -o tsv
$targetAiResourceId = az monitor app-insights component list --resource-group $targetRg --query "[0].id" -o tsv
$targetAiKey        = az monitor app-insights component list --resource-group $targetRg --query "[0].instrumentationKey" -o tsv
$targetEhNs         = az eventhubs namespace list --resource-group $targetRg --query "[0].name" -o tsv

if (-not $targetKvUri) {
    Write-Host "❌ Could not resolve target Key Vault URI in $(Protect-ResourceGroupName -Value $targetRg)"
    exit 2
}
if (-not $targetAiResourceId -or -not $targetAiKey) {
    Write-Host "❌ Could not resolve target Application Insights details in $(Protect-ResourceGroupName -Value $targetRg)"
    exit 2
}
if (-not $targetEhNs) {
    Write-Host "❌ Could not resolve target Event Hub namespace in $(Protect-ResourceGroupName -Value $targetRg)"
    exit 2
}

$targetEhConnStr = az eventhubs namespace authorization-rule keys list `
    --resource-group $targetRg `
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

Write-Host "📤 Publish — Publish artifacts to target APIM"
$publishExitCode = Invoke-MaskedApiopsCommand -Replacements @{
    $targetSubId = Protect-SubscriptionId -Value $targetSubId
    $targetRg    = Protect-ResourceGroupName -Value $targetRg
    $targetName  = Protect-ApimName -Value $targetName
} -Arguments @(
    'publish',
    '--subscription-id', $targetSubId,
    '--resource-group',  $targetRg,
    '--service-name',    $targetName,
    '--source',          $ExtractOutputDir,
    '--overrides',       $overrideFile,
    '--log-level',       $apiopsLogLevel
) + $apiopsAuthArgs

if ($publishExitCode -ne 0) {
    Write-Host "❌ Publish failed (exit code $publishExitCode)"
    exit 2
}

exit 0
