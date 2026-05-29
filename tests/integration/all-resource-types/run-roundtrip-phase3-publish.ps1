#requires -Version 7.0
<#
.SYNOPSIS
  Phase 3 — Generate target environment overrides and publish artifacts to target APIM.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TargetSubscriptionId,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetApimName,

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

function Get-ApiopsLogLevel([string]$ScriptLogLevel) {
    switch ($ScriptLogLevel) {
        'Info'    { return 'info' }
        'Verbose' { return 'warn' }
        'Debug'   { return 'debug' }
        default   { return 'info' }
    }
}

function Get-ApiopsAuthArgs {
    $authArgs = @()

    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_CLIENT_ID)) {
        $authArgs += @('--client-id', $env:AZURE_CLIENT_ID)
    }

    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_TENANT_ID)) {
        $authArgs += @('--tenant-id', $env:AZURE_TENANT_ID)
    }

    return $authArgs
}

$apiopsLogLevel = Get-ApiopsLogLevel -ScriptLogLevel $LogLevel
$apiopsAuthArgs = Get-ApiopsAuthArgs

Write-Host "🔧 Publish — Generate override config for target environment"
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

Write-Host "📤 Publish — Publish artifacts to target APIM"
$publishExitCode = Invoke-MaskedApiopsCommand -Replacements @{
    $TargetSubscriptionId = Protect-SubscriptionId -Value $TargetSubscriptionId
    $TargetResourceGroup  = Protect-ResourceGroupName -Value $TargetResourceGroup
    $TargetApimName       = Protect-ApimName -Value $TargetApimName
} -Arguments @(
    'publish',
    '--subscription-id', $TargetSubscriptionId,
    '--resource-group',  $TargetResourceGroup,
    '--service-name',    $TargetApimName,
    '--source',          $ExtractOutputDir,
    '--overrides',       $overrideFile,
    '--log-level',       $apiopsLogLevel
) + $apiopsAuthArgs

if ($publishExitCode -ne 0) {
    Write-Host "❌ Publish failed (exit code $publishExitCode)"
    exit 2
}

exit 0
