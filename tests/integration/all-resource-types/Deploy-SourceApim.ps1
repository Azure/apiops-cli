<#
.SYNOPSIS
  Deploys or destroys the Kitchen Sink APIM instance for BVT.

.DESCRIPTION
  Creates a resource group and deploys the kitchen-sink.bicep template,
  provisioning an APIM instance pre-populated with every resource type
  and API protocol variation for build verification testing.

.PARAMETER ResourceGroupName
  Name of the Azure resource group (created if it doesn't exist).

.PARAMETER Location
  Azure region. Default: eastus2.

.PARAMETER ApimName
  APIM instance name. Default: ks-apim-bvt.

.PARAMETER SkuName
  APIM SKU. Default: StandardV2. Allowed: Developer, Premium, StandardV2, PremiumV2.

.PARAMETER Destroy
  Tear down: deletes the entire resource group.

.EXAMPLE
  # Deploy
  .\deploy-kitchen-sink.ps1 -ResourceGroupName rg-apiops-bvt -PublisherEmail admin@contoso.com

  # Deploy with custom name
  .\deploy-kitchen-sink.ps1 -ResourceGroupName rg-apiops-bvt -ApimName my-ks-apim -PublisherEmail admin@contoso.com

  # Destroy
  .\deploy-kitchen-sink.ps1 -ResourceGroupName rg-apiops-bvt -Destroy
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

    [switch]$Destroy,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Info'
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference   = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }
Import-Module (Join-Path $PSScriptRoot 'MaskingHelpers.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'DeploymentHelpers.psm1') -Force

# Map this script's LogLevel (Info/Verbose/Debug) to the apiops CLI log level
# values used in the printed example command.
function Get-ApiopsLogLevelLocal([string]$ScriptLogLevel) {
    switch ($ScriptLogLevel) {
        'Verbose' { return 'warn' }
        'Debug'   { return 'debug' }
        default   { return 'info' }
    }
}
$apiopsLogLevel = Get-ApiopsLogLevelLocal -ScriptLogLevel $LogLevel

# ---------------------------------------------------------------------------
# Destroy path
# ---------------------------------------------------------------------------
if ($Destroy) {
    Write-Host "🗑️  Deleting resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)'..." -ForegroundColor Yellow
    az group delete --name $ResourceGroupName --yes --no-wait
    Write-Host "✅ Deletion initiated (async). Resource group will be removed shortly." -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------------------
# Deploy path
# ---------------------------------------------------------------------------
$bicepFile = Join-Path $PSScriptRoot 'source-apim.bicep'
$postActivationBicepFile = Join-Path $PSScriptRoot 'source-apim-post-activation.bicep'

if (-not (Test-Path $bicepFile)) {
    Write-Error "Bicep file not found at: $bicepFile"
}
if (-not (Test-Path $postActivationBicepFile)) {
    Write-Error "Bicep file not found at: $postActivationBicepFile"
}

# Verify az CLI is authenticated
Write-Host "🔐 Verifying Azure CLI authentication..."
$account = az account show --output json 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Error "Not logged in to Azure CLI. Run 'az login' first."
}

$subscriptionId = $account.id
Write-Host "   Subscription: $($account.name) ($(Protect-SubscriptionId -Value $subscriptionId))" -ForegroundColor Gray

# Register required resource providers
Write-Host "📋 Registering required resource providers..." -ForegroundColor Cyan
$requiredProviders = @(
    'Microsoft.ApiManagement',
    'Microsoft.Insights',
    'Microsoft.OperationalInsights',
    'Microsoft.EventHub',
    'Microsoft.KeyVault',
    'Microsoft.AlertsManagement'
)
foreach ($provider in $requiredProviders) {
    $state = az provider show --namespace $provider --query "registrationState" --output tsv 2>$null
    if ($state -ne 'Registered') {
        Write-Host "   Registering $provider..." -ForegroundColor Gray
        az provider register --namespace $provider --output none
    } else {
        Write-Host "   $provider already registered" -ForegroundColor Gray
    }
}

# Wait for providers to be registered (with timeout)
Write-Host "   Waiting for provider registration to complete..." -ForegroundColor Gray
$maxWaitSeconds = 120
$waited = 0
$allRegistered = $false
while (-not $allRegistered -and $waited -lt $maxWaitSeconds) {
    $allRegistered = $true
    foreach ($provider in $requiredProviders) {
        $state = az provider show --namespace $provider --query "registrationState" --output tsv 2>$null
        if ($state -ne 'Registered') {
            $allRegistered = $false
            break
        }
    }
    if (-not $allRegistered) {
        Start-Sleep -Seconds 5
        $waited += 5
    }
}
if (-not $allRegistered) {
    Write-Warning "Some providers may still be registering. Deployment may fail if they're not ready."
}
Write-Host "   ✅ Resource providers ready" -ForegroundColor Green

# Create resource group if needed
Write-Host "📦 Ensuring resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)' exists in '$Location'..." -ForegroundColor Cyan
az group create --name $ResourceGroupName --location $Location --output none

# Deploy Bicep template
# Note: apimName is NOT passed — letting bicep use its default uniqueString-based name
Write-Host "🚀 Deploying source-apim.bicep (this takes 30-45 minutes for APIM)..."
Write-Host "   APIM Name: (auto-generated from resource group)"
Write-Host "   SKU: $SkuName"
Write-Host ""

$deploymentName = "source-apim-$(Get-Date -Format 'yyyyMMddHHmmss')"

$azVerbosity = @()
switch ($LogLevel) {
    'Verbose' { $azVerbosity = @('--verbose') }
    'Debug'   { $azVerbosity = @('--debug') }
}

$azReplacements = @{
    $subscriptionId    = Protect-SubscriptionId -Value $subscriptionId
    $ResourceGroupName = Protect-ResourceGroupName   -Value $ResourceGroupName
}

$azArgs = @(
    'deployment', 'group', 'create',
    '--resource-group', $ResourceGroupName,
    '--name',           $deploymentName,
    '--template-file',  $bicepFile,
    '--parameters',     "skuName=$SkuName", "location=$Location", "publisherEmail=$PublisherEmail",
    '--output',         'json'
) + $azVerbosity

$raw = Invoke-MaskedAzCommand -Replacements $azReplacements -Arguments $azArgs

if ($LASTEXITCODE -ne 0) {
    Write-DeploymentFailureDetails `
        -ResourceGroupName $ResourceGroupName `
        -DeploymentName    $deploymentName `
        -Replacements      $azReplacements
    throw "Source APIM deployment failed (deployment '$deploymentName' in resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)'). See failed-operation details above."
}

$result = $raw | ConvertFrom-Json

# Extract outputs
$outputs = $result.properties.outputs

# Deploy activation-sensitive APIM children after activation.
$apimServiceName = $outputs.apimServiceName.value
Wait-ApimActivation -ResourceGroupName $ResourceGroupName -ApimName $apimServiceName | Out-Null

$postDeploymentName = "source-apim-post-activation-$(Get-Date -Format 'yyyyMMddHHmmss')"
$postReplacements = $azReplacements.Clone()
$postReplacements[$apimServiceName] = Protect-ApimName -Value $apimServiceName
$postArgs = @(
    'deployment', 'group', 'create',
    '--resource-group', $ResourceGroupName,
    '--name',           $postDeploymentName,
    '--template-file',  $postActivationBicepFile,
    '--parameters',     "apimName=$apimServiceName", "skuName=$SkuName",
    '--output',         'json'
) + $azVerbosity

Write-Host "Applying post-activation APIM resources..." -ForegroundColor Cyan
$postRaw = Invoke-MaskedAzCommand -Replacements $postReplacements -Arguments $postArgs
if ($LASTEXITCODE -ne 0) {
    Write-DeploymentFailureDetails `
        -ResourceGroupName $ResourceGroupName `
        -DeploymentName    $postDeploymentName `
        -Replacements      $postReplacements
    throw "Source post-activation deployment failed (deployment '$postDeploymentName' in resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)'). See failed-operation details above."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "✅ Kitchen Sink APIM deployed successfully!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "APIOps CLI extract command:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  npx apiops extract \"
Write-Host "    --subscription-id $(Protect-SubscriptionId -Value $outputs.subscriptionId.value) \"
Write-Host "    --resource-group  $(Protect-ResourceGroupName -Value $outputs.resourceGroupName.value) \"
Write-Host "    --service-name    $(Protect-ApimName -Value $outputs.apimServiceName.value) \"
Write-Host "    --output-dir      ./extracted \"
Write-Host "    --log-level       $apiopsLogLevel"
Write-Host ""
Write-Host "Gateway URL:        $($outputs.gatewayUrl.value)" -ForegroundColor Gray
Write-Host "Workspace deployed: $($outputs.workspaceDeployed.value)" -ForegroundColor Gray
Write-Host "Gateway deployed:   $($outputs.gatewayDeployed.value)" -ForegroundColor Gray
Write-Host "SKU:                $($outputs.skuName.value)" -ForegroundColor Gray
Write-Host ""

# Output as structured object for CI pipelines
$outputObj = @{
    subscriptionId  = $outputs.subscriptionId.value
    resourceGroup   = $outputs.resourceGroupName.value
    apimServiceName = $outputs.apimServiceName.value
    gatewayUrl      = $outputs.gatewayUrl.value
    workspaceDeployed = $outputs.workspaceDeployed.value
    gatewayDeployed = $outputs.gatewayDeployed.value
    skuName         = $outputs.skuName.value
    logLevel        = $LogLevel
}

# Write to GitHub Actions output if running in CI
if ($env:GITHUB_OUTPUT) {
    foreach ($key in $outputObj.Keys) {
        "$key=$($outputObj[$key])" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
    }
    Write-Host "📋 Outputs written to GITHUB_OUTPUT" -ForegroundColor Gray
}

return $outputObj
