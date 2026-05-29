#requires -Version 7.0
<#
.SYNOPSIS
  Phase 2 orchestrator — Extract → Publish → Compare round-trip.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceSubscriptionId,

    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [Parameter(Mandatory)]
    [string]$SourceApimName,

    [Parameter(Mandatory)]
    [string]$TargetSubscriptionId,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetApimName,

    [Parameter(Mandatory)]
    [ValidateSet('Developer', 'Premium', 'StandardV2', 'PremiumV2')]
    [string]$SkuName,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'

$extractScript = Join-Path $PSScriptRoot 'run-roundtrip-phase2a-extract.ps1'
$publishScript = Join-Path $PSScriptRoot 'run-roundtrip-phase2b-publish.ps1'
$compareScript = Join-Path $PSScriptRoot 'run-roundtrip-phase2c-compare.ps1'

foreach ($requiredFile in @($extractScript, $publishScript, $compareScript)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

$exitCode = 0

Write-Host "📥 PHASE 2a — Extract artifacts from source APIM"
& $extractScript `
    -SourceSubscriptionId $SourceSubscriptionId `
    -SourceResourceGroup $SourceResourceGroup `
    -SourceApimName $SourceApimName `
    -SkuName $SkuName `
    -LogLevel $LogLevel `
    -ExtractOutputDir $ExtractOutputDir
$extractExitCode = $LASTEXITCODE
if ($extractExitCode -ge 2) {
    exit $extractExitCode
} elseif ($extractExitCode -ne 0) {
    $exitCode = $extractExitCode
    Write-Host "⚠️  Continuing with round-trip despite extract/validation failures..."
}

Write-Host "📤 PHASE 2b — Publish artifacts to target APIM"
& $publishScript `
    -TargetSubscriptionId $TargetSubscriptionId `
    -TargetResourceGroup $TargetResourceGroup `
    -TargetApimName $TargetApimName `
    -LogLevel $LogLevel `
    -ExtractOutputDir $ExtractOutputDir
$publishExitCode = $LASTEXITCODE
if ($publishExitCode -ne 0) {
    exit $publishExitCode
}

Write-Host "🔍 PHASE 2c — Compare source and target APIM instances"
& $compareScript `
    -SourceSubscriptionId $SourceSubscriptionId `
    -SourceResourceGroup $SourceResourceGroup `
    -SourceApimName $SourceApimName `
    -TargetSubscriptionId $TargetSubscriptionId `
    -TargetResourceGroup $TargetResourceGroup `
    -TargetApimName $TargetApimName `
    -LogLevel $LogLevel
$compareExitCode = $LASTEXITCODE
if ($compareExitCode -eq 1) {
    if ($exitCode -eq 0) { $exitCode = 1 }
} elseif ($compareExitCode -ge 2) {
    $exitCode = 2
}

exit $exitCode
