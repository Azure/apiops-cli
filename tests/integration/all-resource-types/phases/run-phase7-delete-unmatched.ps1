# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0
<#
.SYNOPSIS
    Phase 7 - Validate publish --delete-unmatched with revisioned APIs.
.DESCRIPTION
    Removes a revisioned API from extracted artifacts, runs publish with
    --delete-unmatched, and verifies the revisioned API resources are deleted
    from the target APIM instance.
#>

[CmdletBinding()]
param(
    [string]$TargetSubscriptionId,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetApimName,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [Parameter(Mandatory)]
    [string]$OverrideFile,

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$phaseRoot = Split-Path $PSScriptRoot -Parent
$maskingModule = Join-Path $phaseRoot 'modules/LogMasking.psm1'
$scriptArgModule = Join-Path $phaseRoot 'modules/ScriptRuntime.psm1'
$apiopsCliModule = Join-Path $phaseRoot 'modules/ApiopsCli.psm1'

foreach ($requiredFile in @($maskingModule, $scriptArgModule, $apiopsCliModule)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

Import-Module $maskingModule -Force
Import-Module $scriptArgModule -Force
Import-Module $apiopsCliModule -Force

if (-not (Test-Path $ExtractOutputDir)) {
    Write-Error "ExtractOutputDir not found: $ExtractOutputDir"
    exit 2
}

if (-not (Test-Path $OverrideFile)) {
    Write-Error "OverrideFile not found: $OverrideFile"
    exit 2
}

$targetSubscriptionIdValue = Get-BoundParameterValueOrNull -BoundParameters $PSBoundParameters -Name 'TargetSubscriptionId'
$apiopsLogLevel = Get-ApiopsLogLevel -ScriptLogLevel $LogLevel
$apiopsAuthArgs = Get-ApiopsAuthArgs

$apiFoldersToRemove = @(
    'src-rest-revisioned',
    'src-rest-revisioned;rev=2'
)

Write-Host "🧪 Delete-unmatched — remove revisioned API artifacts"
foreach ($apiFolder in $apiFoldersToRemove) {
    $apiDirectory = Join-Path $ExtractOutputDir "apis/$apiFolder"
    if (-not (Test-Path $apiDirectory)) {
        Write-Error "Expected API artifact directory not found: $apiDirectory"
        exit 2
    }

    Remove-Item -Path $apiDirectory -Recurse -Force
    Write-Host "Removed artifact directory: $apiDirectory"
}

Write-Host "🧪 Delete-unmatched — publish with --delete-unmatched"
$publishArgs = @(
    'publish',
    '--resource-group', $TargetResourceGroup,
    '--service-name',   $TargetApimName,
    '--source',         $ExtractOutputDir,
    '--overrides',      $OverrideFile,
    '--delete-unmatched',
    '--log-level',      $apiopsLogLevel
)
if (-not [string]::IsNullOrWhiteSpace($targetSubscriptionIdValue)) {
    $publishArgs += @('--subscription-id', $targetSubscriptionIdValue)
}
$publishArgs += $apiopsAuthArgs

$replacements = @{
    $TargetResourceGroup = Protect-ResourceGroupName -Value $TargetResourceGroup
    $TargetApimName      = Protect-ApimName -Value $TargetApimName
    $OverrideFile        = '.overrides.yaml'
}
Add-ArgumentIfSet -Hashtable $replacements -Key $targetSubscriptionIdValue -Value (Protect-SubscriptionId -Value $targetSubscriptionIdValue)

$publishExitCode = Invoke-MaskedApiopsCommand -Replacements $replacements -Arguments $publishArgs
if ($publishExitCode -ne 0) {
    Write-Error "Publish with --delete-unmatched failed (exit code $publishExitCode)"
    exit 2
}

Write-Host "🧪 Delete-unmatched — verify APIs are deleted from target APIM"
foreach ($apiId in $apiFoldersToRemove) {
    $listArgs = @(
        'apim', 'api', 'list',
        '--resource-group', $TargetResourceGroup,
        '--service-name', $TargetApimName,
        '--query', "[?name=='$apiId'].name",
        '--output', 'tsv'
    )
    if (-not [string]::IsNullOrWhiteSpace($targetSubscriptionIdValue)) {
        $listArgs += @('--subscription', $targetSubscriptionIdValue)
    }

    $existingApiNames = Invoke-MaskedAzCommand -Replacements $replacements -Arguments $listArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to query APIs for validation (api-id: $apiId)"
        exit 2
    }

    $apiNameMatches = $existingApiNames -split '[\r\n]+' |
        ForEach-Object { $_.Trim() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -eq $apiId }

    if ($apiNameMatches) {
        Write-Error "API still exists after delete-unmatched publish: $apiId"
        exit 2
    }
}

Write-Host "✅ Delete-unmatched validation passed for revisioned API cleanup"
exit 0
