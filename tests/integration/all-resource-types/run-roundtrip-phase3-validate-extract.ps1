#requires -Version 7.0
<#
.SYNOPSIS
  Phase 3 — Validate extracted artifact structure against the expected-structure manifest.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Developer', 'Premium', 'StandardV2', 'PremiumV2')]
    [string]$SkuName,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$validateScript = Join-Path $PSScriptRoot 'Test-ExtractedArtifact.ps1'
$manifestFile   = Join-Path $PSScriptRoot 'expected-structure.json'

foreach ($requiredFile in @($validateScript, $manifestFile)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

if (-not (Test-Path $ExtractOutputDir)) {
    Write-Error "ExtractOutputDir not found: $ExtractOutputDir — run the extract step first"
    exit 2
}

Write-Host "🔎 Extract — Validate extracted artifact structure"
$validateArgs = @{
    ExtractedDir = $ExtractOutputDir
    ManifestFile = $manifestFile
    SkuName      = $SkuName
}
switch ($LogLevel) {
    'Verbose' { $validateArgs.Verbose = $true }
    'Debug'   { $validateArgs.Debug   = $true }
}
& $validateScript @validateArgs
$validateExitCode = $LASTEXITCODE

if ($validateExitCode -ne 0) {
    Write-Host "❌ Artifact validation failed (exit code $validateExitCode)"
    exit $validateExitCode
}

exit 0
