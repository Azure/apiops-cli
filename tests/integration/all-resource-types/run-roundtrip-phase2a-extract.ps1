#requires -Version 7.0
<#
.SYNOPSIS
  Phase 2a — Extract artifacts from the source APIM instance and validate structure.
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
    [ValidateSet('Developer', 'Premium', 'StandardV2', 'PremiumV2')]
    [string]$SkuName,

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

foreach ($requiredFile in @($maskingModule, $validateScript, $manifestFile)) {
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
    $authArgs = @()

    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_CLIENT_ID)) {
        $authArgs += @('--client-id', $env:AZURE_CLIENT_ID)
    }

    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_TENANT_ID)) {
        $authArgs += @('--tenant-id', $env:AZURE_TENANT_ID)
    }

    return $authArgs
}

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
    '--subscription-id', $SourceSubscriptionId,
    '--resource-group',  $SourceResourceGroup,
    '--service-name',    $SourceApimName,
    '--output',          $ExtractOutputDir,
    '--log-level',       $apiopsLogLevel
) + $apiopsAuthArgs

$extractExitCode = Invoke-MaskedApiopsCommand -Replacements @{
    $SourceSubscriptionId = Protect-SubscriptionId -Value $SourceSubscriptionId
    $SourceResourceGroup  = Protect-ResourceGroupName -Value $SourceResourceGroup
    $SourceApimName       = Protect-ApimName -Value $SourceApimName
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
    $exitCode = if ($validateExitCode -eq 2) { 2 } else { 1 }
    Write-Host "⚠️  Continuing despite validation failures..."
}

exit $exitCode
