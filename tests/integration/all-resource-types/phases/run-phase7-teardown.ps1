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

    [string]$SourceSubscriptionId,

    [string]$TargetSubscriptionId,

    [string]$Location = 'eastus2',

    [switch]$SkipTeardown
)

$ErrorActionPreference = 'Stop'
$maskingModule = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'shared/modules/LogMasking.psm1'
$integrationRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sharedDeploymentOpsModule = Join-Path (Join-Path $integrationRoot 'shared/modules') 'DeploymentOps.psm1'
Import-Module $maskingModule -Force
Import-Module $sharedDeploymentOpsModule -Force

if ($SkipTeardown) {
    Write-Host "⏭️  Teardown skipped (-SkipTeardown)"
    exit 0
}

Write-Host "🧹 PHASE 7 — Teardown"

Remove-ApimResourceGroup -ResourceGroup $SourceResourceGroup -Location $Location -SubscriptionId $SourceSubscriptionId
Remove-ApimResourceGroup -ResourceGroup $TargetResourceGroup -Location $Location -SubscriptionId $TargetSubscriptionId

Write-Host "🧹 Teardown complete (hard-delete)"
exit 0