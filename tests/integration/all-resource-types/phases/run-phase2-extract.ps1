# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0
<#
.SYNOPSIS
    Phase 2 — Extract artifacts from the source APIM instance.
.DESCRIPTION
    Runs the apiops extract command against the source APIM instance and writes
    the extracted artifacts to the output directory. The script also masks
    sensitive values in command output and validates that files were produced.

.PARAMETER SourceSubscriptionId
    Optional subscription ID for the source APIM instance.

.PARAMETER SourceResourceGroup
    Source APIM resource group.

.PARAMETER SourceApimName
    Source APIM instance name.

.PARAMETER SkuName
    APIM SKU used to extract the artifacts.

.PARAMETER LogLevel
    Logging verbosity passed to apiops and the validation step.

.PARAMETER ExtractOutputDir
    Output directory for the extracted artifacts.

.EXAMPLE
    .\run-phase2-extract.ps1 -SourceResourceGroup rg-src -SourceApimName src-apim
#>

[CmdletBinding()]
param(
    [string]$SourceSubscriptionId,

    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [Parameter(Mandatory)]
    [string]$SourceApimName,

    [ValidateSet('Developer', 'Premium', 'Standard', 'StandardV2', 'PremiumV2')]
    [string]$SkuName = 'StandardV2',

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'

$maskingModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/LogMasking.psm1'
$scriptArgModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/ScriptRuntime.psm1'
$apiopsCliModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/ApiopsCli.psm1'

foreach ($requiredFile in @($maskingModule, $scriptArgModule, $apiopsCliModule)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

Import-Module $maskingModule -Force
Import-Module $scriptArgModule -Force
Import-Module $apiopsCliModule -Force

Set-ScriptLogPreferences -LogLevel $LogLevel

$apiopsLogLevel = Get-ApiopsLogLevel -ScriptLogLevel $LogLevel
$apiopsAuthArgs = Get-ApiopsAuthArgs
$sourceSubscriptionIdValue = Get-BoundParameterValueOrNull -BoundParameters $PSBoundParameters -Name 'SourceSubscriptionId'

Write-Host "📥 Extract — Extract artifacts from source APIM"
if (Test-Path $ExtractOutputDir) {
    Remove-Item -Path $ExtractOutputDir -Recurse -Force
    Write-Host "   Cleaned previous extract output"
}

$extractArgs = @(
    'extract',
    '--resource-group', $SourceResourceGroup,
    '--service-name',   $SourceApimName,
    '--output',         $ExtractOutputDir,
    '--log-level',      $apiopsLogLevel
)
if (-not [string]::IsNullOrWhiteSpace($sourceSubscriptionIdValue)) {
    $extractArgs += @('--subscription-id', $sourceSubscriptionIdValue)
}
$extractArgs += $apiopsAuthArgs

$replacements = @{
    $SourceResourceGroup = Protect-ResourceGroupName -Value $SourceResourceGroup
    $SourceApimName      = Protect-ApimName -Value $SourceApimName
}
Add-ArgumentIfSet -Hashtable $replacements -Key $sourceSubscriptionIdValue -Value (Protect-SubscriptionId -Value $sourceSubscriptionIdValue)

$extractExitCode = Invoke-MaskedApiopsCommand -Replacements $replacements -Arguments $extractArgs

if ($extractExitCode -ne 0) {
    Write-Host "❌ Extract failed (exit code $extractExitCode)"
    exit 2
}

$extractedFiles = Get-ChildItem -Path $ExtractOutputDir -Recurse -File -ErrorAction SilentlyContinue
if (-not $extractedFiles -or $extractedFiles.Count -eq 0) {
    Write-Host "❌ Extract produced no files in $ExtractOutputDir"
    exit 2
}

if ($env:GITHUB_OUTPUT) {
    $resolvedExtractOutputDir = [System.IO.Path]::GetFullPath($ExtractOutputDir)
    "ExtractOutputDir=$resolvedExtractOutputDir" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
    "extractOutputDir=$resolvedExtractOutputDir" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
    Write-Host "📋 Phase 2 output written to GITHUB_OUTPUT (ExtractOutputDir)"
}

exit 0
