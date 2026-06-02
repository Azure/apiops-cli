# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0
<#
.SYNOPSIS
  Phase 7 — Tear down source and target APIM resource groups.
.DESCRIPTION
    Deletes the source and target resource groups, waits for the deletions to complete, and then purges any soft-deleted APIM instances in the specified location.

.PARAMETER SourceResourceGroup
    Source APIM resource group.

.PARAMETER TargetResourceGroup
    Target APIM resource group.

.PARAMETER Location
    Azure region used when purging soft-deleted APIM instances.

.PARAMETER SkipTeardown
    Skips teardown when specified.

.EXAMPLE
    .\run-phase7-teardown.ps1 -SourceResourceGroup rg-src -TargetResourceGroup rg-tgt
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [string]$Location = 'eastus2',

    [switch]$SkipTeardown
)

$ErrorActionPreference = 'Stop'
$maskingModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/LogMasking.psm1'
Import-Module $maskingModule -Force

if ($SkipTeardown) {
    Write-Host "⏭️  Teardown skipped (-SkipTeardown)"
    exit 0
}

Write-Host "🧹 PHASE 7 — Teardown"

$sourceApimName = $null
$targetApimName = $null
$sourceApimName = az apim list --resource-group $SourceResourceGroup --query "[0].name" -o tsv 2>$null
$targetApimName = az apim list --resource-group $TargetResourceGroup --query "[0].name" -o tsv 2>$null

Write-Host "   Deleting $(Protect-ResourceGroupName -Value $SourceResourceGroup)..."
az group delete --name $SourceResourceGroup --yes --no-wait 2>$null
Write-Host "   Deleting $(Protect-ResourceGroupName -Value $TargetResourceGroup)..."
az group delete --name $TargetResourceGroup --yes --no-wait 2>$null

Write-Host "   ⏳ Waiting for resource group deletions to complete for hard-delete..."
$maxWaitMinutes = 15
$waited = 0
$interval = 30

while ($waited -lt ($maxWaitMinutes * 60)) {
    $srcExists = (az group exists --name $SourceResourceGroup -o tsv 2>$null) -eq 'true'
    $tgtExists = (az group exists --name $TargetResourceGroup -o tsv 2>$null) -eq 'true'

    if (-not $srcExists -and -not $tgtExists) {
        Write-Host "   ✅ Resource groups deleted"
        break
    }

    Write-Host "   ... waiting for resource group deletion (${waited}s elapsed)"
    Start-Sleep -Seconds $interval
    $waited += $interval
}

if ($sourceApimName) {
    Write-Host "   🗑️  Purging soft-deleted APIM: $(Protect-ApimName -Value $sourceApimName)..."
    az apim deletedservice purge --service-name $sourceApimName --location $Location 2>$null
}

if ($targetApimName) {
    Write-Host "   🗑️  Purging soft-deleted APIM: $(Protect-ApimName -Value $targetApimName)..."
    az apim deletedservice purge --service-name $targetApimName --location $Location 2>$null
}

Write-Host "🧹 Teardown complete (hard-delete)"
exit 0