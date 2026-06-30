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
Import-Module $maskingModule -Force

if ($SkipTeardown) {
    Write-Host "⏭️  Teardown skipped (-SkipTeardown)"
    exit 0
}

function Get-SubscriptionArgs {
    param([string]$SubscriptionId)
    if ([string]::IsNullOrWhiteSpace($SubscriptionId)) { return @() }
    return @('--subscription', $SubscriptionId)
}

function Get-GroupExists {
    param([string]$ResourceGroup, [string]$SubscriptionId)
    $exists = az group exists --name $ResourceGroup @(Get-SubscriptionArgs -SubscriptionId $SubscriptionId) -o tsv 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to check resource group existence for '$(Protect-ResourceGroupName -Value $ResourceGroup)'."
    }
    return $exists -eq 'true'
}

function Wait-ForResourceGroupDeletion {
    param([string]$ResourceGroup, [string]$SubscriptionId, [int]$TimeoutMinutes = 60)

    $timeoutSeconds = $TimeoutMinutes * 60
    $elapsed = 0
    while ($elapsed -lt $timeoutSeconds) {
        if (-not (Get-GroupExists -ResourceGroup $ResourceGroup -SubscriptionId $SubscriptionId)) {
            return
        }

        Write-Host "   ... waiting for deletion of $(Protect-ResourceGroupName -Value $ResourceGroup) (${elapsed}s elapsed)"
        Start-Sleep -Seconds 30
        $elapsed += 30
    }

    throw "Timed out waiting for deletion of resource group '$(Protect-ResourceGroupName -Value $ResourceGroup)'."
}

function Wait-ForDeletedApimService {
    param([string]$ServiceName, [string]$ServiceLocation)

    $elapsed = 0
    while ($elapsed -lt 1800) {
        az apim deletedservice show --service-name $ServiceName --location $ServiceLocation -o none 2>$null
        if ($LASTEXITCODE -eq 0) {
            return
        }

        Start-Sleep -Seconds 15
        $elapsed += 15
    }

    throw "Timed out waiting for soft-deleted APIM service '$(Protect-ApimName -Value $ServiceName)'."
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
    Wait-ForDeletedApimService -ServiceName $sourceApimName -ServiceLocation $Location
    az apim deletedservice purge --service-name $sourceApimName --location $Location @(Get-SubscriptionArgs -SubscriptionId $SourceSubscriptionId) 2>$null
}

Write-Host "🧹 Teardown complete"
exit 0
