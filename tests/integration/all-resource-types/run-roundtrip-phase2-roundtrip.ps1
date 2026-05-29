#requires -Version 7.0
<#
.SYNOPSIS
  Phase 2 orchestrator — Extract → Publish → Compare round-trip.

.DESCRIPTION
  Delegates to the three sub-scripts in sequence:
    run-roundtrip-phase2a-extract.ps1  — extract artifacts from source APIM
    run-roundtrip-phase2b-publish.ps1  — generate overrides and publish to target APIM
    run-roundtrip-phase2c-compare.ps1  — compare source vs target via ARM REST API

  Each sub-script can also be invoked independently for targeted re-runs.

.EXAMPLE
  .\run-roundtrip-phase2-roundtrip.ps1 -StateFile ./roundtrip-state.json

.EXAMPLE
  .\run-roundtrip-phase2-roundtrip.ps1 -StateFile ./roundtrip-state.json -LogLevel Debug -ExtractOutputDir ./my-artifacts
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

$extractScript = Join-Path $PSScriptRoot 'run-roundtrip-phase2a-extract.ps1'
$publishScript = Join-Path $PSScriptRoot 'run-roundtrip-phase2b-publish.ps1'
$compareScript = Join-Path $PSScriptRoot 'run-roundtrip-phase2c-compare.ps1'

foreach ($requiredFile in @($extractScript, $publishScript, $compareScript, $StateFile)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

$exitCode = 0

# ── Phase 2a: Extract ────────────────────────────────────────────────────────
Write-Host "📥 PHASE 2a — Extract artifacts from source APIM"
& $extractScript -StateFile $StateFile -LogLevel $LogLevel -ExtractOutputDir $ExtractOutputDir
$extractExitCode = $LASTEXITCODE
if ($extractExitCode -ge 2) {
    exit $extractExitCode
} elseif ($extractExitCode -ne 0) {
    $exitCode = $extractExitCode
    Write-Host "⚠️  Continuing with round-trip despite extract/validation failures..."
}

# ── Phase 2b: Publish ────────────────────────────────────────────────────────
Write-Host "📤 PHASE 2b — Publish artifacts to target APIM"
& $publishScript -StateFile $StateFile -LogLevel $LogLevel -ExtractOutputDir $ExtractOutputDir
$publishExitCode = $LASTEXITCODE
if ($publishExitCode -ne 0) {
    exit $publishExitCode
}

# ── Phase 2c: Compare ────────────────────────────────────────────────────────
Write-Host "🔍 PHASE 2c — Compare source and target APIM instances"
& $compareScript -StateFile $StateFile -LogLevel $LogLevel
$compareExitCode = $LASTEXITCODE
if ($compareExitCode -eq 1) {
    if ($exitCode -eq 0) { $exitCode = 1 }
} elseif ($compareExitCode -ge 2) {
    $exitCode = 2
}

exit $exitCode
