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
if ([string]::IsNullOrWhiteSpace($sourceSubscriptionIdValue)) {
    # Fall back to the active subscription of the current az login.
    Write-Verbose "No subscription id supplied; falling back to active az login subscription"
    $account = Assert-AzCliLoggedIn
    $sourceSubscriptionIdValue = $account.id
}

Write-Host "📥 PHASE 2 — Extract artifacts"
Write-Verbose "Source resource group: $(Protect-ResourceGroupName -Value $SourceResourceGroup)"
Write-Verbose "Source APIM service: $(Protect-ApimName -Value $SourceApimName)"
Write-Verbose "Subscription: $(Protect-SubscriptionId -Value $sourceSubscriptionIdValue)"
Write-Verbose "Extract output directory: $ExtractOutputDir"

if (Test-Path $ExtractOutputDir) {
    Write-Host "  → Cleaning previous extract output"
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

Write-Host "  → Running apiops extract"
$extractExitCode = Invoke-MaskedApiopsCommand -Replacements $replacements -Arguments $extractArgs
if ($extractExitCode -ne 0) {
    throw "Extract failed with exit code $extractExitCode"
}

$extractedFiles = @(Get-ChildItem -Path $ExtractOutputDir -Recurse -File -ErrorAction SilentlyContinue)
if (-not $extractedFiles -or $extractedFiles.Count -eq 0) {
    throw "Extract produced no files in $ExtractOutputDir"
}
Write-Verbose "  [extract] produced $($extractedFiles.Count) file(s)"

$resolvedExtractOutputDir = (Resolve-Path $ExtractOutputDir).Path
Write-Host "✅ Phase 2 extract complete"
if ($env:GITHUB_OUTPUT) {
    "ExtractOutputDir=$resolvedExtractOutputDir" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
    "extractOutputDir=$resolvedExtractOutputDir" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
}

return $resolvedExtractOutputDir
