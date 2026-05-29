<#
.SYNOPSIS
  Master orchestrator for the extract→publish round-trip integration test.

.DESCRIPTION
  Single entry point that orchestrates phase scripts for deploy, round-trip, and
  teardown. Works both locally and in CI.

.EXAMPLE
  .\run-roundtrip-test.ps1 -PublisherEmail admin@contoso.com

.EXAMPLE
  .\run-roundtrip-test.ps1 -PublisherEmail admin@contoso.com -SkipTeardown

.EXAMPLE
  .\run-roundtrip-test.ps1 -PublisherEmail admin@contoso.com -HardDelete
#>

#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [string]$SourceResourceGroup,

    [Parameter()]
    [string]$TargetResourceGroup,

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

$stateFile = Join-Path $PSScriptRoot ".roundtrip-state-$uniqueId.json"
$phase1Script = Join-Path $PSScriptRoot 'run-roundtrip-phase1-deploy.ps1'
$phase2Script = Join-Path $PSScriptRoot 'run-roundtrip-phase2-roundtrip.ps1'
$phase3Script = Join-Path $PSScriptRoot 'run-roundtrip-phase3-teardown.ps1'

foreach ($requiredFile in @($phase1Script, $phase2Script, $phase3Script)) {
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
        -SkuName $SkuName `
        -Location $Location `
        -LogLevel $LogLevel `
        -PublisherEmail $PublisherEmail `
        -StateFile $stateFile

    if ($LASTEXITCODE -ne 0) {
        $exitCode = $LASTEXITCODE
        exit $exitCode
    }

    & $phase2Script `
        -StateFile $stateFile `
        -LogLevel $LogLevel `
        -ExtractOutputDir $ExtractOutputDir

    $exitCode = $LASTEXITCODE
}
finally {
    & $phase3Script `
        -SourceResourceGroup $SourceResourceGroup `
        -TargetResourceGroup $TargetResourceGroup `
        -Location $Location `
        -HardDelete:$HardDelete `
        -SkipTeardown:$SkipTeardown

    if (Test-Path $stateFile) {
        Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue
    }
}

exit $exitCode
