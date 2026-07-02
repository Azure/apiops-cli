# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [string]$SourceSubscriptionId,

    [string]$Location = 'centralus',

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [switch]$SkipTeardown
)

$ErrorActionPreference = 'Stop'

$integrationRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$maskingModule = Join-Path (Join-Path $integrationRoot 'shared/modules') 'LogMasking.psm1'
$deploymentOpsModule = Join-Path (Join-Path $integrationRoot 'shared/modules') 'DeploymentOps.psm1'
$scriptArgModule = Join-Path (Join-Path $integrationRoot 'shared/modules') 'ScriptRuntime.psm1'
Import-Module $maskingModule -Force
Import-Module $deploymentOpsModule -Force
Import-Module $scriptArgModule -Force

Set-ScriptLogPreferences -LogLevel $LogLevel

if ($SkipTeardown) {
    Write-Host "⏭️  Teardown skipped (-SkipTeardown)"
    exit 0
}

Write-Host "🧹 PHASE 4 — Teardown"
Write-Verbose "Source resource group: $(Protect-ResourceGroupName -Value $SourceResourceGroup)"
Write-Verbose "Location: $Location"

Remove-ApimResourceGroup -ResourceGroup $SourceResourceGroup -Location $Location -SubscriptionId $SourceSubscriptionId

Write-Host "🧹 Teardown complete"
exit 0
