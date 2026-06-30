# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0

[CmdletBinding()]
param(
    [string]$SourceResourceGroup,

    [string]$SourceApimName,

    [string]$SourceSubscriptionId,

    [ValidateSet('Developer', 'Premium', 'Standard', 'BasicV2', 'StandardV2', 'PremiumV2')]
    [string]$SkuName = 'StandardV2',

    [string]$Location = 'centralus',

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [Parameter(Mandatory)]
    [string]$PublisherEmail,

    [string]$ExtractOutputDir = "$PSScriptRoot/phases/extracted-artifacts",

    [switch]$SkipTeardown
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$integrationRoot = Split-Path $PSScriptRoot -Parent
$sharedScriptRuntimeModule = Join-Path $integrationRoot 'shared/modules/ScriptRuntime.psm1'
Import-Module $sharedScriptRuntimeModule -Force

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$random = -join ((97..122) | Get-Random -Count 3 | ForEach-Object { [char]$_ })
$uniqueId = "$timestamp-$random"

if (-not $SourceResourceGroup) {
    $SourceResourceGroup = "bvt-$uniqueId-redact-rg"
}
if (-not $SourceApimName) {
    $SourceApimName = "bvt-$timestamp$random-redact-apim"
}
if (-not $SourceSubscriptionId) {
    $SourceSubscriptionId = $env:SOURCE_SUBSCRIPTION_ID
}

$extractOutputDirValue = Get-BoundParameterValueOrNull -BoundParameters $PSBoundParameters -Name 'ExtractOutputDir'

$phase1Script = Join-Path $PSScriptRoot 'phases/run-phase1-deploy.ps1'
$phase2Script = Join-Path $PSScriptRoot 'phases/run-phase2-extract.ps1'
$phase3Script = Join-Path $PSScriptRoot 'phases/run-phase3-validate-redaction.ps1'
$phase4Script = Join-Path $PSScriptRoot 'phases/run-phase4-teardown.ps1'

foreach ($requiredFile in @($phase1Script, $phase2Script, $phase3Script, $phase4Script)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

$exitCode = 0
$currentPhase = 'phase-setup'

try {
    $currentPhase = 'phase1-deploy'
    $phase1Args = @{
        ResourceGroupName = $SourceResourceGroup
        ApimName          = $SourceApimName
        PublisherEmail    = $PublisherEmail
        SkuName           = $SkuName
        Location          = $Location
        LogLevel          = $LogLevel
    }
    Add-ArgumentIfSet -Hashtable $phase1Args -Key 'SubscriptionId' -Value $SourceSubscriptionId
    $phase1Output = & $phase1Script @phase1Args

    if (-not $phase1Output) {
        throw 'Phase 1 did not return deployment outputs.'
    }

    $SourceSubscriptionId = $phase1Output.sourceSubscriptionId
    $SourceResourceGroup = $phase1Output.sourceResourceGroup
    $SourceApimName = $phase1Output.sourceApimName
    $SkuName = $phase1Output.skuName
    $Location = $phase1Output.location

    $currentPhase = 'phase2-extract'
    $phase2Args = @{
        SourceResourceGroup  = $SourceResourceGroup
        SourceApimName       = $SourceApimName
        SourceSubscriptionId = $SourceSubscriptionId
        LogLevel             = $LogLevel
    }
    Add-ArgumentIfSet -Hashtable $phase2Args -Key 'ExtractOutputDir' -Value $extractOutputDirValue
    & $phase2Script @phase2Args | Out-Null

    $currentPhase = 'phase3-validate-redaction'
    $phase3Args = @{
        LogLevel = $LogLevel
    }
    Add-ArgumentIfSet -Hashtable $phase3Args -Key 'ExtractOutputDir' -Value $extractOutputDirValue
    & $phase3Script @phase3Args
}
catch {
    Write-Host "❌ Redaction integration test failed during $currentPhase" -ForegroundColor Red
    Write-Host "   $($_.Exception.Message)" -ForegroundColor Red

    if ($currentPhase -eq 'phase3-validate-redaction') {
        $exitCode = 1
    } else {
        $exitCode = 2
    }
}
finally {
    $phase4Args = @{
        SourceResourceGroup  = $SourceResourceGroup
        Location             = $Location
        SkipTeardown         = $SkipTeardown
    }
    Add-ArgumentIfSet -Hashtable $phase4Args -Key 'SourceSubscriptionId' -Value $SourceSubscriptionId
    & $phase4Script @phase4Args
}

exit $exitCode
