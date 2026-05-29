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
  APIM SKU. Default: StandardV2. Allowed: Developer, Premium, StandardV2, PremiumV2.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string]$PublisherEmail,

    [string]$Location = 'eastus2',

    [ValidateSet('Developer', 'Premium', 'StandardV2', 'PremiumV2')]
    [string]$SkuName = 'StandardV2',

    [string]$ApimName,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Info'
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference   = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }
Import-Module (Join-Path $PSScriptRoot 'MaskingHelpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'DeploymentHelpers.psm1') -Force

$bicepFile = Join-Path $PSScriptRoot 'target-apim.bicep'

if (-not (Test-Path $bicepFile)) {
    Write-Error "Bicep file not found at: $bicepFile"
}

# Verify az CLI authentication and capture subscription id for masked logging
$account = az account show --output json 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Error "Not logged in to Azure CLI. Run 'az login' first."
}
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

if (-not [string]::IsNullOrWhiteSpace($ApimName)) {
    $azArgs += @('--parameters', "apimName=$ApimName")
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

Write-Host "✅ Target APIM deployed successfully: $(Protect-ApimName -Value $result.properties.outputs.apimServiceName.value)"

return $result.properties.outputs