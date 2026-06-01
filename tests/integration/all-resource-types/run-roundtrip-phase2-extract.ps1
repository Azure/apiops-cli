#requires -Version 7.0
<#
.SYNOPSIS
  Phase 2 — Extract artifacts from the source APIM instance.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceSubscriptionId,

    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [Parameter(Mandatory)]
    [string]$SourceApimName,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$maskingModule = Join-Path $PSScriptRoot 'MaskingHelpers.psm1'
$apiopsModule  = Join-Path $PSScriptRoot 'ApiopsHelpers.psm1'

foreach ($requiredFile in @($maskingModule, $apiopsModule)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

Import-Module $maskingModule -Force
Import-Module $apiopsModule -Force

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

exit 0
