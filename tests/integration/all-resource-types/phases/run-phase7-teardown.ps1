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

function Wait-ForResourceGroupsDeletion {
    param(
        [string[]]$ResourceGroups,
        [int]$TimeoutMinutes = 60,
        [int]$IntervalSeconds = 30
    )

    $waitedSeconds = 0
    $timeoutSeconds = $TimeoutMinutes * 60

    while ($waitedSeconds -lt $timeoutSeconds) {
        $existingGroups = @()

        foreach ($resourceGroup in $ResourceGroups) {
            if ((az group exists --name $resourceGroup -o tsv 2>$null) -eq 'true') {
                $existingGroups += $resourceGroup
            }
        }

        if ($existingGroups.Count -eq 0) {
            Write-Host "   ✅ Resource groups deleted"
            return
        }

        $maskedNames = $existingGroups | ForEach-Object { Protect-ResourceGroupName -Value $_ }
        Write-Host "   ... waiting for resource group deletion (${waitedSeconds}s elapsed): $($maskedNames -join ', ')"
        Start-Sleep -Seconds $IntervalSeconds
        $waitedSeconds += $IntervalSeconds
    }

    $maskedGroups = $ResourceGroups | ForEach-Object { Protect-ResourceGroupName -Value $_ }
    throw "Timed out waiting for resource group deletion for: $($maskedGroups -join ', ')."
}

function Wait-ForDeletedApimService {
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName,
        [Parameter(Mandatory)]
        [string]$ServiceLocation,
        [int]$TimeoutMinutes = 30,
        [int]$IntervalSeconds = 15
    )

    $waitedSeconds = 0
    $timeoutSeconds = $TimeoutMinutes * 60

    while ($waitedSeconds -lt $timeoutSeconds) {
        az apim deletedservice show --service-name $ServiceName --location $ServiceLocation -o none 2>$null
        if ($LASTEXITCODE -eq 0) {
            return
        }

        Write-Host "   ... waiting for APIM soft-delete entry ($(Protect-ApimName -Value $ServiceName)) (${waitedSeconds}s elapsed)"
        Start-Sleep -Seconds $IntervalSeconds
        $waitedSeconds += $IntervalSeconds
    }

    throw "Timed out waiting for APIM soft-delete entry for '$(Protect-ApimName -Value $ServiceName)' in location '$ServiceLocation'."
}

Write-Host "   Deleting $(Protect-ResourceGroupName -Value $SourceResourceGroup)..."
az group delete --name $SourceResourceGroup --yes --no-wait 2>$null
Write-Host "   Deleting $(Protect-ResourceGroupName -Value $TargetResourceGroup)..."
az group delete --name $TargetResourceGroup --yes --no-wait 2>$null

Write-Host "   ⏳ Waiting for resource group deletions to complete for hard-delete..."
Wait-ForResourceGroupsDeletion -ResourceGroups @($SourceResourceGroup, $TargetResourceGroup)

if ($sourceApimName) {
    Wait-ForDeletedApimService -ServiceName $sourceApimName -ServiceLocation $Location
    Write-Host "   🗑️  Purging soft-deleted APIM: $(Protect-ApimName -Value $sourceApimName)..."
    az apim deletedservice purge --service-name $sourceApimName --location $Location 2>$null
}

if ($targetApimName) {
    Wait-ForDeletedApimService -ServiceName $targetApimName -ServiceLocation $Location
    Write-Host "   🗑️  Purging soft-deleted APIM: $(Protect-ApimName -Value $targetApimName)..."
    az apim deletedservice purge --service-name $targetApimName --location $Location 2>$null
}

Write-Host "🧹 Teardown complete (hard-delete)"
exit 0