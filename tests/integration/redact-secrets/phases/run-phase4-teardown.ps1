# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [string]$SourceSubscriptionId,

    [string]$Location = 'centralus',

    [switch]$SkipTeardown
)

$ErrorActionPreference = 'Stop'

$integrationRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$maskingModule = Join-Path (Join-Path $integrationRoot 'shared/modules') 'LogMasking.psm1'
$deploymentOpsModule = Join-Path (Join-Path $integrationRoot 'shared/modules') 'DeploymentOps.psm1'
Import-Module $maskingModule -Force
Import-Module $deploymentOpsModule -Force

if ($SkipTeardown) {
    Write-Host "⏭️  Teardown skipped (-SkipTeardown)"
    exit 0
}

function Get-SubscriptionArgs {
    param([string]$SubscriptionId)
    if ([string]::IsNullOrWhiteSpace($SubscriptionId)) { return @() }
    return @('--subscription', $SubscriptionId)
}

Write-Host "🧹 PHASE 4 — Teardown"

$listArgs = @('apim', 'list', '--resource-group', $SourceResourceGroup, '--query', '[0].name', '-o', 'tsv') + (Get-SubscriptionArgs -SubscriptionId $SourceSubscriptionId)
$sourceApimName = az @listArgs 2>$null

if (Get-GroupExists -ResourceGroup $SourceResourceGroup -SubscriptionId $SourceSubscriptionId) {
    az group delete --name $SourceResourceGroup --yes --no-wait @(Get-SubscriptionArgs -SubscriptionId $SourceSubscriptionId) 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start deletion for source resource group '$(Protect-ResourceGroupName -Value $SourceResourceGroup)'."
    }

    Wait-ForResourceGroupDeletion -ResourceGroup $SourceResourceGroup -SubscriptionId $SourceSubscriptionId
}

if (-not [string]::IsNullOrWhiteSpace($sourceApimName)) {
    Wait-ForDeletedApimService -ServiceName $sourceApimName -ServiceLocation $Location -SubscriptionId $SourceSubscriptionId
    az apim deletedservice purge --service-name $sourceApimName --location $Location @(Get-SubscriptionArgs -SubscriptionId $SourceSubscriptionId) 2>$null
}

Write-Host "🧹 Teardown complete"
exit 0
