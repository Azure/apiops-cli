# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
<#
.SYNOPSIS
  Deploys the target APIM instance for round-trip integration testing.

.DESCRIPTION
  Creates a resource group and deploys the target-apim.bicep template,
  provisioning a clean APIM instance used as the publish target.

.PARAMETER ResourceGroupName
  Name of the Azure resource group to create or update.

.PARAMETER PublisherEmail
  Publisher email required by the APIM deployment.

.PARAMETER Location
  Azure region. Default: eastus2.

.PARAMETER SkuName
  APIM SKU. Default: StandardV2. Allowed: Developer, Premium, BasicV2, StandardV2, PremiumV2.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string]$PublisherEmail,

    [string]$Location = 'eastus2',

    [ValidateSet('Developer', 'Premium', 'Standard', 'BasicV2', 'StandardV2', 'PremiumV2')]
    [string]$SkuName = 'StandardV2',

    [string]$ApimName,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Info'
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference   = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }
Import-Module (Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/LogMasking.psm1') -Force
Import-Module (Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/ScriptRuntime.psm1') -Force
Import-Module (Join-Path (Split-Path $PSScriptRoot -Parent) 'modules/DeploymentOps.psm1') -Force

$bicepFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'bicep/target-apim.bicep'

if (-not (Test-Path $bicepFile)) {
    Write-Error "Bicep file not found at: $bicepFile"
}

# Verify az CLI authentication and capture subscription id for masked logging
$account = Assert-AzCliLoggedIn
$apimNameValue = Get-BoundParameterValueOrNull -BoundParameters $PSBoundParameters -Name 'ApimName'
$subscriptionId = $account.id

Write-Host "Starting target APIM deployment..."
Write-Host "Subscription:   $($account.name) ($(Protect-SubscriptionId -Value $subscriptionId))"
Write-Host "Resource Group: $(Protect-ResourceGroupName -Value $ResourceGroupName)"
Write-Host "SKU:            $SkuName"
Write-Host "Location:       $Location"
Write-Host "Log Level:      $LogLevel"

Write-Host "Creating resource group..."
az group create --name $ResourceGroupName --location $Location --output none
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create target resource group"
}

Write-Host "Deploying target-apim.bicep (this takes 30-45 minutes)..."
$azVerbosity = @()
switch ($LogLevel) {
    'Verbose' { $azVerbosity = @('--verbose') }
    'Debug'   { $azVerbosity = @('--debug') }
}

$azReplacements = @{
    $subscriptionId    = Protect-SubscriptionId -Value $subscriptionId
    $ResourceGroupName = Protect-ResourceGroupName   -Value $ResourceGroupName
}

$deploymentName = "target-apim-$(Get-Date -Format 'yyyyMMddHHmmss')"

$azArgs = @(
    'deployment', 'group', 'create',
    '--resource-group', $ResourceGroupName,
    '--name',           $deploymentName,
    '--template-file',  $bicepFile,
    '--parameters',     "skuName=$SkuName", "location=$Location", "publisherEmail=$PublisherEmail",
    '--output',         'json'
) + $azVerbosity

if (-not [string]::IsNullOrWhiteSpace($apimNameValue)) {
  $azArgs += @('--parameters', "apimName=$apimNameValue")
}

$raw = Invoke-MaskedAzCommand -Replacements $azReplacements -Arguments $azArgs

if ($LASTEXITCODE -ne 0) {
    Write-DeploymentFailureDetails `
        -ResourceGroupName $ResourceGroupName `
        -DeploymentName    $deploymentName `
        -Replacements      $azReplacements
    throw "Target APIM deployment failed (deployment '$deploymentName' in resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)'). See failed-operation details above."
}

$result = $raw | ConvertFrom-Json
if (-not $result.properties.outputs) {
    throw "Target deployment returned no outputs"
}

# Deploy A2A weather Function App code (zip deploy with WEBSITE_RUN_FROM_PACKAGE)
$funcAppName = $result.properties.outputs.funcAppName.value
$funcAppDir  = Join-Path (Split-Path $PSScriptRoot -Parent) 'function-app'
$funcZipPath = Join-Path ([System.IO.Path]::GetTempPath()) 'a2a-func-tgt.zip'

if (Test-Path $funcAppDir) {
    Write-Host "📦 Deploying A2A weather Function App code to target..." -ForegroundColor Cyan
    if (Test-Path $funcZipPath) { Remove-Item $funcZipPath -Force }
    Compress-Archive -Path (Join-Path $funcAppDir '*') -DestinationPath $funcZipPath -Force

    $funcDeployArgs = @(
        'functionapp', 'deployment', 'source', 'config-zip',
        '--resource-group', $ResourceGroupName,
        '--name',           $funcAppName,
        '--src',            $funcZipPath,
        '--output',         'none'
    )
    Invoke-MaskedAzCommand -Replacements $azReplacements -Arguments $funcDeployArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Target Function App code deployment failed — A2A managed endpoint may not work correctly on target."
    } else {
        Write-Host "   ✅ Target Function App code deployed" -ForegroundColor Green
    }

    Remove-Item $funcZipPath -Force -ErrorAction SilentlyContinue
} else {
    Write-Warning "Function App source not found at $funcAppDir — skipping."
}

Write-Host "✅ Target APIM deployed successfully: $(Protect-ApimName -Value $result.properties.outputs.apimServiceName.value)"

return $result.properties.outputs