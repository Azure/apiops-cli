# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory)]
    [string]$PublisherEmail,

    [ValidateSet('Developer', 'Premium', 'Standard', 'BasicV2', 'StandardV2', 'PremiumV2')]
    [string]$SkuName = 'StandardV2',

    [string]$Location = 'centralus',

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ApimName,

    [string]$SubscriptionId
)

$ErrorActionPreference = 'Stop'

$integrationRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sharedModulesDir = Join-Path $integrationRoot 'shared/modules'
$maskingModule = Join-Path $sharedModulesDir 'LogMasking.psm1'
$scriptArgModule = Join-Path $sharedModulesDir 'ScriptRuntime.psm1'
$deploymentOpsModule = Join-Path $sharedModulesDir 'DeploymentOps.psm1'

foreach ($requiredFile in @($maskingModule, $scriptArgModule, $deploymentOpsModule)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

Import-Module $maskingModule -Force
Import-Module $scriptArgModule -Force
Import-Module $deploymentOpsModule -Force

Set-ScriptLogPreferences -LogLevel $LogLevel
$account = Assert-AzCliLoggedIn

$resolvedSubscriptionId = if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) { $SubscriptionId } else { $account.id }
$apimNameValue = Get-BoundParameterValueOrNull -BoundParameters $PSBoundParameters -Name 'ApimName'

Write-Host "🚀 PHASE 1 — Deploy source APIM for redaction test"
Write-Host "   Azure subscription: $(Protect-SubscriptionId -Value $resolvedSubscriptionId)"

az group create --name $ResourceGroupName --location $Location --subscription $resolvedSubscriptionId --output none
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)'."
}

$bicepFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'bicep/source-apim.bicep'
$postActivationBicepFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'bicep/source-apim-post-activation.bicep'

$deploymentName = "redact-secrets-source-$(Get-Date -Format 'yyyyMMddHHmmss')"
$azReplacements = @{
    $resolvedSubscriptionId = Protect-SubscriptionId -Value $resolvedSubscriptionId
    $ResourceGroupName      = Protect-ResourceGroupName -Value $ResourceGroupName
}

$deployArgs = @(
    'deployment', 'group', 'create',
    '--subscription', $resolvedSubscriptionId,
    '--resource-group', $ResourceGroupName,
    '--name', $deploymentName,
    '--template-file', $bicepFile,
    '--parameters', "skuName=$SkuName", "location=$Location", "publisherEmail=$PublisherEmail",
    '--output', 'json'
)
if (-not [string]::IsNullOrWhiteSpace($apimNameValue)) {
    $deployArgs += @('--parameters', "apimName=$apimNameValue")
}

$rawDeploy = Invoke-MaskedAzCommand -Replacements $azReplacements -Arguments $deployArgs
if ($LASTEXITCODE -ne 0) {
    Write-DeploymentFailureDetails -ResourceGroupName $ResourceGroupName -DeploymentName $deploymentName -Replacements $azReplacements
    throw "Source deployment failed in resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)'."
}

$deployResult = $rawDeploy | ConvertFrom-Json
$outputs = $deployResult.properties.outputs
$apimServiceName = $outputs.apimServiceName.value

Wait-ApimActivation -ResourceGroupName $ResourceGroupName -ApimName $apimServiceName -TimeoutSeconds 2700 -PollIntervalSeconds 60 | Out-Null

Wait-ApimApiQueryable -ResourceGroupName $ResourceGroupName -ApimServiceName $apimServiceName -ApiId 'src-redact-rest' -Replacements $azReplacements -TimeoutSeconds 600 -PollIntervalSeconds 20 | Out-Null

$postDeploymentName = "redact-secrets-post-activation-$(Get-Date -Format 'yyyyMMddHHmmss')"
$postArgs = @(
    'deployment', 'group', 'create',
    '--subscription', $resolvedSubscriptionId,
    '--resource-group', $ResourceGroupName,
    '--name', $postDeploymentName,
    '--template-file', $postActivationBicepFile,
    '--parameters', "apimName=$apimServiceName",
    '--output', 'json'
)

Invoke-MaskedAzCommand -Replacements $azReplacements -Arguments $postArgs | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-DeploymentFailureDetails -ResourceGroupName $ResourceGroupName -DeploymentName $postDeploymentName -Replacements $azReplacements
    throw "Post-activation deployment failed in resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)'."
}

$result = [ordered]@{
    sourceSubscriptionId = $outputs.subscriptionId.value
    sourceResourceGroup  = $outputs.resourceGroupName.value
    sourceApimName       = $apimServiceName
    skuName              = $outputs.skuName.value
    location             = $outputs.location.value
}

if ($env:GITHUB_OUTPUT) {
    foreach ($key in $result.Keys) {
        "$key=$($result[$key])" | Out-File -FilePath $env:GITHUB_OUTPUT -Append
    }
}

return $result
