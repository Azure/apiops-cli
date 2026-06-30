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

function New-LocalJwtKeyBase64 {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($bytes)
}

function New-TemporaryPfxPayload {
    $subject = "CN=apiops-redact-temp-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
    $password = "Pfx-$([Guid]::NewGuid().ToString('N'))!"

    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    try {
        $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
            $subject,
            $rsa,
            [System.Security.Cryptography.HashAlgorithmName]::SHA256,
            [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
        )

        $certificate = $request.CreateSelfSigned(
            [System.DateTimeOffset]::UtcNow.AddMinutes(-5),
            [System.DateTimeOffset]::UtcNow.AddDays(1)
        )

        try {
            $pfxBytes = $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $password)
        }
        finally {
            $certificate.Dispose()
        }
    }
    finally {
        $rsa.Dispose()
    }

    return [ordered]@{
        data     = [Convert]::ToBase64String($pfxBytes)
        password = $password
    }
}

function New-LocalSecretValue {
    param(
        [Parameter(Mandatory)]
        [string]$Placeholder
    )

    switch ($Placeholder) {
        'SERVICE_SIGNING_KEY_LITERAL' {
            return New-LocalJwtKeyBase64
        }
        'SERVICE_DECRYPT_KEY_LITERAL' {
            return New-LocalJwtKeyBase64
        }
        default {
            return "rs-$([Guid]::NewGuid().ToString('N'))"
        }
    }
}

function Remove-PlaintextTempFile {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return
    }

    try {
        $fileInfo = Get-Item -Path $Path -ErrorAction Stop
        if ($fileInfo.Length -gt 0) {
            $wipeBytes = New-Object byte[] $fileInfo.Length
            [System.IO.File]::WriteAllBytes($Path, $wipeBytes)
        }
    }
    catch {
        # Best-effort wipe; always attempt deletion next.
    }
    finally {
        Remove-Item -Path $Path -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "🚀 PHASE 1 — Deploy source APIM for redaction test"
Write-Host "   Azure subscription: $(Protect-SubscriptionId -Value $resolvedSubscriptionId)"
Write-Host "Resource group: $(Protect-ResourceGroupName -Value $ResourceGroupName) | SKU: $SkuName | Location: $Location"

Write-Verbose "  → Creating resource group"
az group create --name $ResourceGroupName --location $Location --subscription $resolvedSubscriptionId --output none
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)'."
}

$bicepFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'bicep/source-apim.bicep'
$postActivationBicepFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'bicep/source-apim-post-activation.bicep'
$postActivationTemplateRaw = Get-Content -Path $postActivationBicepFile -Raw
$postActivationTemplateResolved = $postActivationTemplateRaw
$literalPattern = '\b[A-Z0-9_]+_LITERAL\b'
$literals = [System.Text.RegularExpressions.Regex]::Matches($postActivationTemplateRaw, $literalPattern) |
    ForEach-Object { $_.Value } |
    Select-Object -Unique

Write-Host "  → Resolving secret literals in post-activation template"
Write-Verbose "  [literal] found $($literals.Count) placeholder(s) to replace"
foreach ($literal in $literals) {
    $replacementValue = New-LocalSecretValue -Placeholder $literal
    $postActivationTemplateResolved = $postActivationTemplateResolved.Replace($literal, $replacementValue)
    Write-Verbose "  [literal] replaced placeholder '$literal'"
}

if ([System.Text.RegularExpressions.Regex]::IsMatch($postActivationTemplateResolved, $literalPattern)) {
    throw 'Failed to replace one or more *_LITERAL placeholders in post-activation Bicep template.'
}

$resolvedPostActivationBicepFile = Join-Path ([System.IO.Path]::GetTempPath()) ("source-apim-post-activation-$([Guid]::NewGuid().ToString('N')).bicep")
Set-Content -Path $resolvedPostActivationBicepFile -Value $postActivationTemplateResolved

$postActivationParamsFile = $null

try {
    $deploymentName = "redact-secrets-source-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Write-Host "  → Deploying source APIM service (this can take a while)"
    Write-Verbose "  [deploy] deployment name: $deploymentName"
    $tempCertificate = New-TemporaryPfxPayload
    $azReplacements = @{
        $resolvedSubscriptionId = Protect-SubscriptionId -Value $resolvedSubscriptionId
        $ResourceGroupName      = Protect-ResourceGroupName -Value $ResourceGroupName
        $tempCertificate.password = '*** REDACTED ***'
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
    Write-Verbose "  [deploy] provisioned APIM service: $(Protect-ApimName -Value $apimServiceName)"

    Write-Host "  → Waiting for APIM activation"
    Wait-ApimActivation -ResourceGroupName $ResourceGroupName -ApimName $apimServiceName -TimeoutSeconds 2700 -PollIntervalSeconds 60 | Out-Null

    Write-Host "  → Waiting for API to become queryable"
    Wait-ApimApiQueryable -ResourceGroupName $ResourceGroupName -ApimServiceName $apimServiceName -ApiId 'src-redact-rest' -Replacements $azReplacements -TimeoutSeconds 600 -PollIntervalSeconds 20 | Out-Null

    Write-Host "  → Applying post-activation policies with secret literals"
    $postDeploymentName = "redact-secrets-post-activation-$(Get-Date -Format 'yyyyMMddHHmmss')"

    # Pass secure parameters via a temporary parameters file so the PFX payload and
    # password never appear in the az CLI process argument list.
    $postParams = [ordered]@{
        '$schema'      = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
        contentVersion = '1.0.0.0'
        parameters     = [ordered]@{
            apimName                = @{ value = $apimServiceName }
            tempCertificateData     = @{ value = $tempCertificate.data }
            tempCertificatePassword = @{ value = $tempCertificate.password }
        }
    }

    $postActivationParamsFile = Join-Path ([System.IO.Path]::GetTempPath()) ("source-apim-post-activation-params-$([Guid]::NewGuid().ToString('N')).json")
    $postParams | ConvertTo-Json -Depth 5 | Set-Content -Path $postActivationParamsFile

    $postArgs = @(
        'deployment', 'group', 'create',
        '--subscription', $resolvedSubscriptionId,
        '--resource-group', $ResourceGroupName,
        '--name', $postDeploymentName,
        '--template-file', $resolvedPostActivationBicepFile,
        '--parameters', "@$postActivationParamsFile",
        '--output', 'json'
    )

    Invoke-MaskedAzCommand -Replacements $azReplacements -Arguments $postArgs | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-DeploymentFailureDetails -ResourceGroupName $ResourceGroupName -DeploymentName $postDeploymentName -Replacements $azReplacements
        throw "Post-activation deployment failed in resource group '$(Protect-ResourceGroupName -Value $ResourceGroupName)'."
    }

    Write-Host "✅ Phase 1 deploy complete"
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
}
finally {
    Remove-PlaintextTempFile -Path $resolvedPostActivationBicepFile
    if ($postActivationParamsFile) {
        Remove-PlaintextTempFile -Path $postActivationParamsFile
    }
    Clear-Variable -Name postActivationTemplateResolved, postActivationTemplateRaw, tempCertificate -ErrorAction SilentlyContinue
}
