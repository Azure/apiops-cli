#requires -Version 7.0
<#
.SYNOPSIS
  Phase 6 — Compare source and target APIM instances via ARM REST API.
.DESCRIPTION
    Runs the APIM comparison script against the resolved source and target
    resource identifiers and reports whether the instances match.

.PARAMETER SourceSubscriptionId
    Optional subscription ID for the source APIM instance.

.PARAMETER SourceResourceGroup
    Source APIM resource group.

.PARAMETER SourceApimName
    Source APIM instance name.

.PARAMETER TargetSubscriptionId
    Optional subscription ID for the target APIM instance.

.PARAMETER TargetResourceGroup
    Target APIM resource group.

.PARAMETER TargetApimName
    Target APIM instance name.

.PARAMETER LogLevel
    Logging verbosity passed to the comparison script.

.EXAMPLE
    .\run-phase6-compare.ps1 -SourceResourceGroup rg-src -TargetResourceGroup rg-tgt
#>

[CmdletBinding()]
param(
    [string]$SourceSubscriptionId,

    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [Parameter(Mandatory)]
    [string]$SourceApimName,

    [string]$TargetSubscriptionId,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetApimName,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose'
)

$ErrorActionPreference = 'Stop'

$scriptArgModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/ScriptRuntime.psm1'

$compareScript = Join-Path (Split-Path $PSScriptRoot -Parent) 'Compare-ApimInstance.ps1'

foreach ($requiredFile in @($scriptArgModule, $compareScript)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

Import-Module $scriptArgModule -Force

Set-ScriptLogPreferences -LogLevel $LogLevel

if (-not (Test-Path $compareScript)) {
    Write-Error "Required file not found: $compareScript"
    exit 2
}

$sourceSubscriptionIdValue = Get-BoundParameterValueOrNull -BoundParameters $PSBoundParameters -Name 'SourceSubscriptionId'
$targetSubscriptionIdValue = Get-BoundParameterValueOrNull -BoundParameters $PSBoundParameters -Name 'TargetSubscriptionId'

if ([string]::IsNullOrWhiteSpace($sourceSubscriptionIdValue)) {
    $sourceSubscriptionIdValue = $env:SOURCE_SUBSCRIPTION_ID
}
if ([string]::IsNullOrWhiteSpace($targetSubscriptionIdValue)) {
    $targetSubscriptionIdValue = $env:TARGET_SUBSCRIPTION_ID
}

if ([string]::IsNullOrWhiteSpace($sourceSubscriptionIdValue) -or [string]::IsNullOrWhiteSpace($targetSubscriptionIdValue)) {
    $account = Assert-AzCliLoggedIn -ErrorMessage "Unable to resolve subscription IDs for compare phase. Set -SourceSubscriptionId/-TargetSubscriptionId, SOURCE_SUBSCRIPTION_ID/TARGET_SUBSCRIPTION_ID, or run 'az login'."
    if ([string]::IsNullOrWhiteSpace($sourceSubscriptionIdValue)) { $sourceSubscriptionIdValue = $account.id }
    if ([string]::IsNullOrWhiteSpace($targetSubscriptionIdValue)) { $targetSubscriptionIdValue = $account.id }
}

Write-Host "🔍 Compare — Compare source and target APIM instances"
$compareArgs = @{
    SourceResourceGroup = $SourceResourceGroup
    SourceApimName      = $SourceApimName
    TargetResourceGroup = $TargetResourceGroup
    TargetApimName      = $TargetApimName
}
Add-ArgumentIfSet -Hashtable $compareArgs -Key 'SourceSubscriptionId' -Value $sourceSubscriptionIdValue
Add-ArgumentIfSet -Hashtable $compareArgs -Key 'TargetSubscriptionId' -Value $targetSubscriptionIdValue
switch ($LogLevel) {
    'Verbose' { $compareArgs.Verbose = $true }
    'Debug'   { $compareArgs.Debug   = $true }
}
& $compareScript @compareArgs
$compareExitCode = $LASTEXITCODE

if ($compareExitCode -eq 1) {
    Write-Host "❌ Verification found differences"
} elseif ($compareExitCode -ge 2) {
    Write-Host "❌ Verification encountered an error (exit code $compareExitCode)"
} else {
    Write-Host "✅ Verification complete — instances match"
}

exit $compareExitCode