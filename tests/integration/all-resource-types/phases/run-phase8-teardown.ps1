# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0
<#
.SYNOPSIS
  Phase 8 — Tear down source and target APIM resource groups.
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
    .\run-phase8-teardown.ps1 -SourceResourceGroup rg-src -TargetResourceGroup rg-tgt
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [string]$SourceSubscriptionId,

    [string]$TargetSubscriptionId,

    [string]$Location = 'eastus2',

    [switch]$SkipTeardown
)

$ErrorActionPreference = 'Stop'
$maskingModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/LogMasking.psm1'
$integrationRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sharedDeploymentOpsModule = Join-Path (Join-Path $integrationRoot 'shared/modules') 'DeploymentOps.psm1'
Import-Module $maskingModule -Force
Import-Module $sharedDeploymentOpsModule -Force

if ($SkipTeardown) {
    Write-Host "⏭️  Teardown skipped (-SkipTeardown)"
    exit 0
}

Write-Host "🧹 PHASE 8 — Teardown"

$sourceApimName = $null
$targetApimName = $null

function Get-SubscriptionArgs {
    param([string]$SubscriptionId)

    if ([string]::IsNullOrWhiteSpace($SubscriptionId)) {
        return @()
    }

    return @('--subscription', $SubscriptionId)
}

$sourceListArgs = @('apim', 'list', '--resource-group', $SourceResourceGroup, '--query', '[0].name', '-o', 'tsv') + (Get-SubscriptionArgs -SubscriptionId $SourceSubscriptionId)
$targetListArgs = @('apim', 'list', '--resource-group', $TargetResourceGroup, '--query', '[0].name', '-o', 'tsv') + (Get-SubscriptionArgs -SubscriptionId $TargetSubscriptionId)

$sourceApimName = az @sourceListArgs 2>$null
$targetApimName = az @targetListArgs 2>$null

function Wait-ForResourceGroupsDeletion {
    param(
        [hashtable[]]$Groups,
        [int]$TimeoutMinutes = 60,
        [int]$IntervalSeconds = 30
    )

    $waitedSeconds = 0
    $timeoutSeconds = $TimeoutMinutes * 60

    while ($waitedSeconds -lt $timeoutSeconds) {
        $existingGroups = @()

        foreach ($group in $Groups) {
            if (Get-GroupExists -ResourceGroup $group.ResourceGroup -SubscriptionId $group.SubscriptionId) {
                $existingGroups += $group.ResourceGroup
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

    $maskedGroups = $Groups | ForEach-Object { Protect-ResourceGroupName -Value $_.ResourceGroup }
    throw "Timed out waiting for resource group deletion for: $($maskedGroups -join ', ')."
}


Write-Host "   Deleting $(Protect-ResourceGroupName -Value $SourceResourceGroup)..."
if (Get-GroupExists -ResourceGroup $SourceResourceGroup -SubscriptionId $SourceSubscriptionId) {
    $sourceDeleteArgs = @('group', 'delete', '--name', $SourceResourceGroup, '--yes', '--no-wait') + (Get-SubscriptionArgs -SubscriptionId $SourceSubscriptionId)
    az @sourceDeleteArgs 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start deletion for source resource group '$(Protect-ResourceGroupName -Value $SourceResourceGroup)'."
    }
}
else {
    Write-Host "   Source resource group already absent"
}

Write-Host "   Deleting $(Protect-ResourceGroupName -Value $TargetResourceGroup)..."
if (Get-GroupExists -ResourceGroup $TargetResourceGroup -SubscriptionId $TargetSubscriptionId) {
    $targetDeleteArgs = @('group', 'delete', '--name', $TargetResourceGroup, '--yes', '--no-wait') + (Get-SubscriptionArgs -SubscriptionId $TargetSubscriptionId)
    az @targetDeleteArgs 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start deletion for target resource group '$(Protect-ResourceGroupName -Value $TargetResourceGroup)'."
    }
}
else {
    Write-Host "   Target resource group already absent"
}

Write-Host "   ⏳ Waiting for resource group deletions to complete for hard-delete..."
$groups = @(
    @{ ResourceGroup = $SourceResourceGroup; SubscriptionId = $SourceSubscriptionId },
    @{ ResourceGroup = $TargetResourceGroup; SubscriptionId = $TargetSubscriptionId }
)
Wait-ForResourceGroupsDeletion -Groups $groups

if ($sourceApimName) {
    Wait-ForDeletedApimService -ServiceName $sourceApimName -ServiceLocation $Location -SubscriptionId $SourceSubscriptionId
    Write-Host "   🗑️  Purging soft-deleted APIM: $(Protect-ApimName -Value $sourceApimName)..."
    az apim deletedservice purge --service-name $sourceApimName --location $Location @(Get-SubscriptionArgs -SubscriptionId $SourceSubscriptionId) 2>$null
}

if ($targetApimName) {
    Wait-ForDeletedApimService -ServiceName $targetApimName -ServiceLocation $Location -SubscriptionId $TargetSubscriptionId
    Write-Host "   🗑️  Purging soft-deleted APIM: $(Protect-ApimName -Value $targetApimName)..."
    az apim deletedservice purge --service-name $targetApimName --location $Location @(Get-SubscriptionArgs -SubscriptionId $TargetSubscriptionId) 2>$null
}

Write-Host "🧹 Teardown complete (hard-delete)"
exit 0