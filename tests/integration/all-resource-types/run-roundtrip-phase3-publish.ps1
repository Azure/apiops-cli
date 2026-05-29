#requires -Version 7.0
<#
.SYNOPSIS
  Phase 4 — Publish artifacts to target APIM using a pre-generated overrides file.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TargetSubscriptionId,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetApimName,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts",

    [string]$OverrideFile
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

if (-not (Test-Path $ExtractOutputDir)) {
    Write-Error "ExtractOutputDir not found: $ExtractOutputDir — run the extract step first"
    exit 2
}

Import-Module $maskingModule -Force
Import-Module $apiopsModule -Force

$apiopsLogLevel = Get-ApiopsLogLevel -ScriptLogLevel $LogLevel
$apiopsAuthArgs = Get-ApiopsAuthArgs

$overrideFilePath = if ([string]::IsNullOrWhiteSpace($OverrideFile)) {
    Join-Path $ExtractOutputDir '.overrides.yaml'
} else {
    $OverrideFile
}
$resolvedOverrideFile = [System.IO.Path]::GetFullPath($overrideFilePath)
if (-not (Test-Path $resolvedOverrideFile)) {
    Write-Error "OverrideFile not found: $resolvedOverrideFile — run phase 3 (generate overrides) first"
    exit 2
}

Write-Host "📤 Publish — Publish artifacts to target APIM"
$publishExitCode = Invoke-MaskedApiopsCommand -Replacements @{
    $TargetSubscriptionId = Protect-SubscriptionId -Value $TargetSubscriptionId
    $TargetResourceGroup  = Protect-ResourceGroupName -Value $TargetResourceGroup
    $TargetApimName       = Protect-ApimName -Value $TargetApimName
} -Arguments @(
    'publish',
    '--subscription-id', $TargetSubscriptionId,
    '--resource-group',  $TargetResourceGroup,
    '--service-name',    $TargetApimName,
    '--source',          $ExtractOutputDir,
    '--overrides',       $resolvedOverrideFile,
    '--log-level',       $apiopsLogLevel
) + $apiopsAuthArgs

if ($publishExitCode -ne 0) {
    Write-Host "❌ Publish failed (exit code $publishExitCode)"
    exit 2
}

exit 0
