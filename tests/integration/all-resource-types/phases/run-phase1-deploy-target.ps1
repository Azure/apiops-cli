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
    [string]$LogLevel = 'Info',

    # When set, seed extra "unmatched" resources into the target APIM that do
    # NOT exist in the source. Phase 5 then publishes with --delete-unmatched
    # and phase 6 compare verifies these resources were removed.
    [switch]$TestDeleteUnmatched
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference   = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }
Import-Module (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'shared/modules/LogMasking.psm1') -Force
Import-Module (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'shared/modules/ScriptRuntime.psm1') -Force
Import-Module (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'shared/modules/DeploymentOps.psm1') -Force

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

$deployParameters = @("skuName=$SkuName", "location=$Location", "publisherEmail=$PublisherEmail")
if (-not [string]::IsNullOrWhiteSpace($apimNameValue)) {
    $deployParameters += "apimName=$apimNameValue"
}

$result = New-ResourceGroupDeployment `
    -ResourceGroupName $ResourceGroupName `
    -DeploymentName    $deploymentName `
    -TemplateFile      $bicepFile `
    -Parameters        $deployParameters `
    -Verbosity         $azVerbosity `
    -Replacements      $azReplacements `
    -FailureLabel      'Target APIM deployment'

if (-not $result.properties.outputs) {
    throw "Target deployment returned no outputs"
}

$apimServiceName = $result.properties.outputs.apimServiceName.value
Write-Host "✅ Target APIM deployed successfully: $(Protect-ApimName -Value $apimServiceName)"

if ($TestDeleteUnmatched) {
    Write-Host "🌱 Seeding unmatched resources into target APIM for --delete-unmatched coverage..."

    $unmatchedBicepFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'bicep/target-apim-unmatched.bicep'
    if (-not (Test-Path $unmatchedBicepFile)) {
        throw "Unmatched-resources bicep file not found at: $unmatchedBicepFile"
    }

    # Seed only after the APIM instance has finished activating — child
    # resources cannot be created while the service is still provisioning.
    Wait-ApimActivation `
        -ResourceGroupName $ResourceGroupName `
        -ApimName $apimServiceName `
        -TimeoutSeconds 2700 `
        -PollIntervalSeconds 60 | Out-Null

    $seedReplacements = $azReplacements.Clone()
    $seedReplacements[$apimServiceName] = Protect-ApimName -Value $apimServiceName

    $seedDeploymentName = "target-apim-unmatched-$(Get-Date -Format 'yyyyMMddHHmmss')"
    New-ResourceGroupDeployment `
        -ResourceGroupName $ResourceGroupName `
        -DeploymentName    $seedDeploymentName `
        -TemplateFile      $unmatchedBicepFile `
        -Parameters        @("apimName=$apimServiceName") `
        -Verbosity         $azVerbosity `
        -Output            'none' `
        -Replacements      $seedReplacements `
        -FailureLabel      'Unmatched-resources deployment' | Out-Null

    Write-Host "✅ Unmatched resource seeding complete"
}

return $result.properties.outputs