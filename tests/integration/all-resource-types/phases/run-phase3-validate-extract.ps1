# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0
<#
.SYNOPSIS
  Phase 3 — Validate extracted artifact structure against the expected-structure manifest.
.DESCRIPTION
    Compares the extracted artifacts with the expected structure manifest and
    reports any validation issues before publish begins.

.PARAMETER SkuName
    APIM SKU used when validating the extracted artifacts.

.PARAMETER LogLevel
    Validation log verbosity.

.PARAMETER ExtractOutputDir
    Directory containing the extracted artifacts.

.EXAMPLE
    .\run-phase3-validate-extract.ps1 -SkuName StandardV2
#>

[CmdletBinding()]
param(
    [ValidateSet('Developer', 'Premium', 'StandardV2', 'PremiumV2')]
    [string]$SkuName = 'StandardV2',

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'

$scriptArgModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/ScriptRuntime.psm1'

if (-not (Test-Path $scriptArgModule)) {
    Write-Error "Required file not found: $scriptArgModule"
    exit 2
}

Import-Module $scriptArgModule -Force

Set-ScriptLogPreferences -LogLevel $LogLevel

$validateScript = Join-Path (Split-Path $PSScriptRoot -Parent) 'Test-ExtractedArtifact.ps1'
$manifestFile   = Join-Path (Split-Path $PSScriptRoot -Parent) 'expected-structure.json'

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
