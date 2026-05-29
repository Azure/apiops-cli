#requires -Version 7.0
<#
.SYNOPSIS
  Phase 2c — Compare source and target APIM instances via ARM REST API.
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
