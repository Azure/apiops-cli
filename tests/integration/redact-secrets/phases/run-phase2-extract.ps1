# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0

[CmdletBinding()]
param(
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

$integrationRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sharedModulesDir = Join-Path $integrationRoot 'shared/modules'
$maskingModule = Join-Path $sharedModulesDir 'LogMasking.psm1'
$scriptArgModule = Join-Path $sharedModulesDir 'ScriptRuntime.psm1'
$apiopsCliModule = Join-Path $sharedModulesDir 'ApiopsCli.psm1'

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

Write-Host "📥 PHASE 2 — Extract artifacts"
if (Test-Path $ExtractOutputDir) {
    Remove-Item -Path $ExtractOutputDir -Recurse -Force
}

$extractArgs = @(
    'extract',
    '--resource-group', $SourceResourceGroup,
    '--service-name', $SourceApimName,
    '--output', $ExtractOutputDir,
    '--log-level', $apiopsLogLevel
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
    throw "Extract failed with exit code $extractExitCode"
}

$extractedFiles = @(Get-ChildItem -Path $ExtractOutputDir -Recurse -File -ErrorAction SilentlyContinue)
if (-not $extractedFiles -or $extractedFiles.Count -eq 0) {
    throw "Extract produced no files in $ExtractOutputDir"
}

$resolvedExtractOutputDir = (Resolve-Path $ExtractOutputDir).Path
if ($env:GITHUB_OUTPUT) {
    "ExtractOutputDir=$resolvedExtractOutputDir" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
    "extractOutputDir=$resolvedExtractOutputDir" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
}

return $resolvedExtractOutputDir
