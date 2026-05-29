<#
.SYNOPSIS
  Master orchestrator for the extract→publish round-trip integration test.
#>

#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [string]$SourceResourceGroup,

    [Parameter()]
    [string]$TargetResourceGroup,

    [Parameter()]
    [string]$SourceApimName,

    [Parameter()]
    [string]$TargetApimName,

    [Parameter()]
    [string]$SourceSubscriptionId,

    [Parameter()]
    [string]$TargetSubscriptionId,

    [ValidateSet('Developer', 'Premium', 'StandardV2', 'PremiumV2')]
    [string]$SkuName = 'StandardV2',

    [string]$Location = 'eastus2',

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [Parameter(Mandatory)]
    [string]$PublisherEmail,

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts",

    [switch]$SkipTeardown,

    [switch]$HardDelete
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('HardDelete')) {
    $HardDelete = $true
}

$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
$random = -join ((97..122) | Get-Random -Count 3 | ForEach-Object { [char]$_ })
$uniqueId = "$timestamp-$random"

if (-not $SourceResourceGroup) {
    $SourceResourceGroup = "bvt-$uniqueId-src-rg"
}
if (-not $TargetResourceGroup) {
    $TargetResourceGroup = "bvt-$uniqueId-tgt-rg"
}
if (-not $SourceApimName) {
    $SourceApimName = "bvt-$timestamp$random-src-apim"
}
if (-not $TargetApimName) {
    $TargetApimName = "bvt-$timestamp$random-tgt-apim"
}

if (-not $SourceSubscriptionId) {
    $SourceSubscriptionId = $env:SOURCE_SUBSCRIPTION_ID
}
if (-not $TargetSubscriptionId) {
    $TargetSubscriptionId = $env:TARGET_SUBSCRIPTION_ID
}

if (-not $SourceSubscriptionId -or -not $TargetSubscriptionId) {
    $account = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $account) {
        Write-Error "Not logged in to Azure CLI. Run 'az login' first."
        exit 2
    }
    if (-not $SourceSubscriptionId) { $SourceSubscriptionId = $account.id }
    if (-not $TargetSubscriptionId) { $TargetSubscriptionId = $account.id }
}

$phase1Script = Join-Path $PSScriptRoot 'run-roundtrip-phase1-deploy.ps1'
$phase2Script = Join-Path $PSScriptRoot 'run-roundtrip-phase2-extract.ps1'
$phase3Script = Join-Path $PSScriptRoot 'run-roundtrip-phase3-generate-overrides.ps1'
$phase4Script = Join-Path $PSScriptRoot 'run-roundtrip-phase3-publish.ps1'
$phase5Script = Join-Path $PSScriptRoot 'run-roundtrip-phase4-compare.ps1'
$phase6Script = Join-Path $PSScriptRoot 'run-roundtrip-phase5-teardown.ps1'

foreach ($requiredFile in @($phase1Script, $phase2Script, $phase3Script, $phase4Script, $phase5Script, $phase6Script)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

$exitCode = 0

try {
    & $phase1Script `
        -SourceResourceGroup $SourceResourceGroup `
        -TargetResourceGroup $TargetResourceGroup `
        -SourceApimName $SourceApimName `
        -TargetApimName $TargetApimName `
        -SourceSubscriptionId $SourceSubscriptionId `
        -TargetSubscriptionId $TargetSubscriptionId `
        -SkuName $SkuName `
        -Location $Location `
        -LogLevel $LogLevel `
        -PublisherEmail $PublisherEmail

    if ($LASTEXITCODE -ne 0) {
        $exitCode = $LASTEXITCODE
        exit $exitCode
    }

    & $phase2Script `
        -SourceSubscriptionId $SourceSubscriptionId `
        -SourceResourceGroup $SourceResourceGroup `
        -SourceApimName $SourceApimName `
        -SkuName $SkuName `
        -LogLevel $LogLevel `
        -ExtractOutputDir $ExtractOutputDir

    if ($LASTEXITCODE -ne 0) {
        $exitCode = $LASTEXITCODE
        exit $exitCode
    }

    & $phase3Script `
        -TargetResourceGroup $TargetResourceGroup `
        -LogLevel $LogLevel `
        -ExtractOutputDir $ExtractOutputDir

    if ($LASTEXITCODE -ne 0) {
        $exitCode = $LASTEXITCODE
        exit $exitCode
    }

    & $phase4Script `
        -TargetSubscriptionId $TargetSubscriptionId `
        -TargetResourceGroup $TargetResourceGroup `
        -TargetApimName $TargetApimName `
        -LogLevel $LogLevel `
        -ExtractOutputDir $ExtractOutputDir `
        -OverrideFile (Join-Path $ExtractOutputDir '.overrides.yaml')

    if ($LASTEXITCODE -ne 0) {
        $exitCode = $LASTEXITCODE
        exit $exitCode
    }

    & $phase5Script `
        -SourceSubscriptionId $SourceSubscriptionId `
        -SourceResourceGroup $SourceResourceGroup `
        -SourceApimName $SourceApimName `
        -TargetSubscriptionId $TargetSubscriptionId `
        -TargetResourceGroup $TargetResourceGroup `
        -TargetApimName $TargetApimName `
        -LogLevel $LogLevel

    $exitCode = $LASTEXITCODE
}
finally {
    & $phase6Script `
        -SourceResourceGroup $SourceResourceGroup `
        -TargetResourceGroup $TargetResourceGroup `
        -Location $Location `
        -HardDelete:$HardDelete `
        -SkipTeardown:$SkipTeardown
}

exit $exitCode
