#requires -Version 7.0
<#
.SYNOPSIS
  Phase 2c — Compare source and target APIM instances via ARM REST API.

.DESCRIPTION
  Reads the source and target APIM connection details from StateFile, then delegates
  to Compare-ApimInstance.ps1 to perform a deep property comparison with normalization.
  Can be invoked standalone or as part of the run-roundtrip-phase2-roundtrip.ps1
  orchestrator.

  Exit codes:
    0 — instances match
    1 — differences found
    2 — error / fatal failure

.EXAMPLE
  .\run-roundtrip-phase2c-compare.ps1 -StateFile ./roundtrip-state.json

.EXAMPLE
  .\run-roundtrip-phase2c-compare.ps1 -StateFile ./roundtrip-state.json -LogLevel Debug
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$StateFile,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose'
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$compareScript = Join-Path $PSScriptRoot 'Compare-ApimInstance.ps1'

foreach ($requiredFile in @($compareScript, $StateFile)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

$state       = Get-Content -Path $StateFile -Raw | ConvertFrom-Json
$sourceSubId = $state.sourceSubscriptionId
$sourceRg    = $state.sourceResourceGroup
$sourceName  = $state.sourceApimName
$targetSubId = $state.targetSubscriptionId
$targetRg    = $state.targetResourceGroup
$targetName  = $state.targetApimName

Write-Host "🔍 Compare — Compare source and target APIM instances"
$compareArgs = @{
    SourceSubscriptionId = $sourceSubId
    SourceResourceGroup  = $sourceRg
    SourceApimName       = $sourceName
    TargetSubscriptionId = $targetSubId
    TargetResourceGroup  = $targetRg
    TargetApimName       = $targetName
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
