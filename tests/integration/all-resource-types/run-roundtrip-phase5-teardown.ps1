#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [string]$Location = 'eastus2',

    [switch]$SkipTeardown,

    [bool]$HardDelete = $true
)

$ErrorActionPreference = 'Stop'
$maskingModule = Join-Path $PSScriptRoot 'MaskingHelpers.psm1'
Import-Module $maskingModule -Force

if ($SkipTeardown) {
    Write-Host "⏭️  Teardown skipped (-SkipTeardown)"
    exit 0
}

Write-Host "🧹 PHASE 6 — Teardown"

$sourceApimName = $null
$targetApimName = $null
if ($HardDelete) {
    $sourceApimName = az apim list --resource-group $SourceResourceGroup --query "[0].name" -o tsv 2>$null
    $targetApimName = az apim list --resource-group $TargetResourceGroup --query "[0].name" -o tsv 2>$null
}

Write-Host "   Deleting $(Protect-ResourceGroupName -Value $SourceResourceGroup)..."
az group delete --name $SourceResourceGroup --yes --no-wait 2>$null
Write-Host "   Deleting $(Protect-ResourceGroupName -Value $TargetResourceGroup)..."
az group delete --name $TargetResourceGroup --yes --no-wait 2>$null

if (-not $HardDelete) {
    Write-Host "🧹 Teardown initiated (async deletions)"
    exit 0
}

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
