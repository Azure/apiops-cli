#requires -Version 7.0
<#
.SYNOPSIS
  Phase 5 — Compare source and target APIM instances via ARM REST API.
#>

[CmdletBinding()]
param(
    [string]$SourceSubscriptionId,

    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [Parameter(Mandatory)]
    [string]$SourceApimName,

    [string]$TargetSubscriptionId,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetApimName,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose'
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$compareScript = Join-Path $PSScriptRoot 'Compare-ApimInstance.ps1'

if (-not (Test-Path $compareScript)) {
    Write-Error "Required file not found: $compareScript"
    exit 2
}

if ([string]::IsNullOrWhiteSpace($SourceSubscriptionId)) {
    $SourceSubscriptionId = $env:SOURCE_SUBSCRIPTION_ID
}
if ([string]::IsNullOrWhiteSpace($TargetSubscriptionId)) {
    $TargetSubscriptionId = $env:TARGET_SUBSCRIPTION_ID
}

if ([string]::IsNullOrWhiteSpace($SourceSubscriptionId) -or [string]::IsNullOrWhiteSpace($TargetSubscriptionId)) {
    $account = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $account -or -not $account.id) {
        Write-Error "Unable to resolve subscription IDs for compare phase. Set -SourceSubscriptionId/-TargetSubscriptionId, SOURCE_SUBSCRIPTION_ID/TARGET_SUBSCRIPTION_ID, or run 'az login'."
        exit 2
    }
    if ([string]::IsNullOrWhiteSpace($SourceSubscriptionId)) { $SourceSubscriptionId = $account.id }
    if ([string]::IsNullOrWhiteSpace($TargetSubscriptionId)) { $TargetSubscriptionId = $account.id }
}

Write-Host "🔍 Compare — Compare source and target APIM instances"
$compareArgs = @{
    SourceSubscriptionId = $SourceSubscriptionId
    SourceResourceGroup  = $SourceResourceGroup
    SourceApimName       = $SourceApimName
    TargetSubscriptionId = $TargetSubscriptionId
    TargetResourceGroup  = $TargetResourceGroup
    TargetApimName       = $TargetApimName
}
switch ($LogLevel) {
    'Verbose' { $compareArgs.Verbose = $true }
    'Debug'   { $compareArgs.Debug   = $true }
}
& $compareScript @compareArgs
$compareExitCode = $LASTEXITCODE

if ($compareExitCode -eq 1) {
    Write-Host "❌ Verification found differences"
} elseif ($compareExitCode -ge 2) {
    Write-Host "❌ Verification encountered an error (exit code $compareExitCode)"
} else {
    Write-Host "✅ Verification complete — instances match"
}

exit $compareExitCode
