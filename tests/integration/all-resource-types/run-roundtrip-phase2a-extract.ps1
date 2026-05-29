#requires -Version 7.0
<#
.SYNOPSIS
  Phase 2a — Extract artifacts from the source APIM instance and validate structure.

.DESCRIPTION
  Runs `apiops extract` against the source APIM instance described in StateFile, writes
  artifacts to ExtractOutputDir, then validates the extracted structure against the
  expected-structure.json manifest. Can be invoked standalone or as part of the
  run-roundtrip-phase2-roundtrip.ps1 orchestrator.

.EXAMPLE
  .\run-roundtrip-phase2a-extract.ps1 -StateFile ./roundtrip-state.json

.EXAMPLE
  .\run-roundtrip-phase2a-extract.ps1 -StateFile ./roundtrip-state.json -LogLevel Debug -ExtractOutputDir ./my-artifacts
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

$maskingModule  = Join-Path $PSScriptRoot 'MaskingHelpers.psm1'
$validateScript = Join-Path $PSScriptRoot 'Test-ExtractedArtifact.ps1'
$manifestFile   = Join-Path $PSScriptRoot 'expected-structure.json'

foreach ($requiredFile in @($maskingModule, $validateScript, $manifestFile, $StateFile)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
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
$sourceSubId = $state.sourceSubscriptionId
$sourceRg    = $state.sourceResourceGroup
$sourceName  = $state.sourceApimName
$skuName     = $state.skuName

$exitCode       = 0
$apiopsLogLevel = Get-ApiopsLogLevel -ScriptLogLevel $LogLevel
$apiopsAuthArgs = Get-ApiopsAuthArgs

Write-Host "📥 Extract — Extract artifacts from source APIM"
if (Test-Path $ExtractOutputDir) {
    Remove-Item -Path $ExtractOutputDir -Recurse -Force
    Write-Host "   Cleaned previous extract output"
}

$extractArgs = @(
    'extract',
    '--subscription-id', $sourceSubId,
    '--resource-group',  $sourceRg,
    '--service-name',    $sourceName,
    '--output',          $ExtractOutputDir,
    '--log-level',       $apiopsLogLevel
) + $apiopsAuthArgs

$extractExitCode = Invoke-MaskedApiopsCommand -Replacements @{
    $sourceSubId = Protect-SubscriptionId -Value $sourceSubId
    $sourceRg    = Protect-ResourceGroupName -Value $sourceRg
    $sourceName  = Protect-ApimName -Value $sourceName
} -Arguments $extractArgs

if ($extractExitCode -ne 0) {
    Write-Host "❌ Extract failed (exit code $extractExitCode)"
    exit 2
}

$extractedFiles = Get-ChildItem -Path $ExtractOutputDir -Recurse -File -ErrorAction SilentlyContinue
if (-not $extractedFiles -or $extractedFiles.Count -eq 0) {
    Write-Host "❌ Extract produced no files in $ExtractOutputDir"
    exit 2
}

Write-Host "🔎 Extract — Validate extracted artifact structure"
$validateArgs = @{
    ExtractedDir = $ExtractOutputDir
    ManifestFile = $manifestFile
    SkuName      = $skuName
}
switch ($LogLevel) {
    'Verbose' { $validateArgs.Verbose = $true }
    'Debug'   { $validateArgs.Debug   = $true }
}
& $validateScript @validateArgs
$validateExitCode = $LASTEXITCODE
if ($validateExitCode -ne 0) {
    Write-Host "❌ Artifact validation failed (exit code $validateExitCode)"
    $exitCode = if ($validateExitCode -eq 2) { 2 } else { 1 }
    Write-Host "⚠️  Continuing despite validation failures..."
}

exit $exitCode
