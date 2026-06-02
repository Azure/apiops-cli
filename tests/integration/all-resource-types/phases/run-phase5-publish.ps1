#requires -Version 7.0
<#
.SYNOPSIS
    Phase 5 — Publish artifacts to target APIM.
.DESCRIPTION
    Ensures the override file exists, then runs the apiops publish command
    against the target APIM instance.

.PARAMETER TargetSubscriptionId
    Optional subscription ID for the target APIM instance.

.PARAMETER TargetResourceGroup
    Target APIM resource group.

.PARAMETER TargetApimName
    Target APIM instance name.

.PARAMETER LogLevel
    Logging verbosity passed to apiops and helper commands.

.PARAMETER ExtractOutputDir
    Directory containing the extracted artifacts and generated overrides.

.EXAMPLE
    .\run-phase5-publish.ps1 -TargetResourceGroup rg-tgt -TargetApimName tgt-apim
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

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$maskingModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/LogMasking.psm1'
$scriptArgModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/ScriptRuntime.psm1'
$apiopsCliModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/ApiopsCli.psm1'

foreach ($requiredFile in @($maskingModule, $scriptArgModule, $apiopsCliModule)) {
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
Import-Module $scriptArgModule -Force
Import-Module $apiopsCliModule -Force

$apiopsLogLevel = Get-ApiopsLogLevel -ScriptLogLevel $LogLevel
$apiopsAuthArgs = Get-ApiopsAuthArgs
$targetSubscriptionIdValue = Get-BoundParameterValueOrNull -BoundParameters $PSBoundParameters -Name 'TargetSubscriptionId'
$generateOverridesScript = Join-Path $PSScriptRoot 'run-phase4-create-overrides.ps1'

if (-not (Test-Path $generateOverridesScript)) {
    Write-Error "Required file not found: $generateOverridesScript"
    exit 2
}

Write-Host "🔧 Override — Generate target environment override file"
$overrideArgs = @{
    TargetResourceGroup = $TargetResourceGroup
    LogLevel            = $LogLevel
    ExtractOutputDir    = $ExtractOutputDir
}
Add-ArgumentIfSet -Hashtable $overrideArgs -Key 'TargetSubscriptionId' -Value $targetSubscriptionIdValue

$overrideFile = & $generateOverridesScript @overrideArgs
if ($LASTEXITCODE -ne 0 -or -not $overrideFile) {
    Write-Host "❌ Override generation failed"
    exit 2
}

$overrideFile = [string]$overrideFile

Write-Host "📤 Publish — Publish artifacts to target APIM"
$publishArgs = @(
    'publish',
    '--resource-group', $TargetResourceGroup,
    '--service-name',   $TargetApimName,
    '--source',         $ExtractOutputDir,
    '--overrides',      $overrideFile,
    '--log-level',      $apiopsLogLevel
)
if (-not [string]::IsNullOrWhiteSpace($targetSubscriptionIdValue)) {
    $publishArgs += @('--subscription-id', $targetSubscriptionIdValue)
}
$publishArgs += $apiopsAuthArgs

$replacements = @{
    $TargetResourceGroup = Protect-ResourceGroupName -Value $TargetResourceGroup
    $TargetApimName      = Protect-ApimName -Value $TargetApimName
}
Add-ArgumentIfSet -Hashtable $replacements -Key $targetSubscriptionIdValue -Value (Protect-SubscriptionId -Value $targetSubscriptionIdValue)

$publishExitCode = Invoke-MaskedApiopsCommand -Replacements $replacements -Arguments $publishArgs

if ($publishExitCode -ne 0) {
    Write-Host "❌ Publish failed (exit code $publishExitCode)"
    exit 2
}

exit 0