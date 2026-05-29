#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceResourceGroup,

    [Parameter(Mandatory)]
    [string]$TargetResourceGroup,

    [ValidateSet('Developer', 'Premium', 'StandardV2', 'PremiumV2')]
    [string]$SkuName = 'StandardV2',

    [string]$Location = 'eastus2',

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [Parameter(Mandatory)]
    [string]$PublisherEmail,

    [Parameter(Mandatory)]
    [string]$StateFile
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$maskingModule = Join-Path $PSScriptRoot 'MaskingHelpers.psm1'
Import-Module $maskingModule -Force

$account = az account show --output json 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Error "Not logged in to Azure CLI. Run 'az login' first."
    exit 2
}

$subscriptionId = $account.id
Write-Host "🔐 Azure CLI authenticated: $($account.name) ($(Protect-SubscriptionId -Value $subscriptionId))"

$deploySourceScript = Join-Path $PSScriptRoot 'Deploy-SourceApim.ps1'
$deployTargetScript = Join-Path $PSScriptRoot 'Deploy-TargetApim.ps1'

foreach ($requiredFile in @($maskingModule, $deploySourceScript, $deployTargetScript)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

$logsDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$sourceLogFile = Join-Path $logsDir "source-deploy-$timestamp.log"
$targetLogFile = Join-Path $logsDir "target-deploy-$timestamp.log"

Write-Host "🚀 PHASE 1 — Deploy source and target APIM instances (parallel)"

$sourceJob = Start-Job -Name 'DeploySource' -ScriptBlock {
            param($script, $rg, $sku, $loc, $email, $transcriptFile, $logLevel)
            $ErrorActionPreference = 'Stop'
            Start-Transcript -Path $transcriptFile -Force -UseMinimalHeader | Out-Null
            try {
                $scriptArgs = @{
                    ResourceGroupName = $rg
                    SkuName           = $sku
                    Location          = $loc
                    PublisherEmail    = $email
                    LogLevel          = $logLevel
                }
                $result = & $script @scriptArgs
                if (-not $result -or -not $result.apimServiceName) {
                    throw "Source deployment returned no outputs"
                }
                return $result
            } finally {
                Stop-Transcript | Out-Null
            }
} -ArgumentList $deploySourceScript, $SourceResourceGroup, $SkuName, $Location, $PublisherEmail, $sourceLogFile, $LogLevel

$targetJob = Start-Job -Name 'DeployTarget' -ScriptBlock {
            param($script, $rg, $sku, $loc, $email, $transcriptFile, $logLevel)
            $ErrorActionPreference = 'Stop'
            Start-Transcript -Path $transcriptFile -Force -UseMinimalHeader | Out-Null
            try {
                $scriptArgs = @{
                    ResourceGroupName = $rg
                    SkuName           = $sku
                    Location          = $loc
                    PublisherEmail    = $email
                    LogLevel          = $logLevel
                }
                $result = & $script @scriptArgs
                if (-not $result -or -not $result.apimServiceName -or -not $result.apimServiceName.value) {
                    throw "Target deployment returned no outputs"
                }
                return $result
            } finally {
                Stop-Transcript | Out-Null
            }
} -ArgumentList $deployTargetScript, $TargetResourceGroup, $SkuName, $Location, $PublisherEmail, $targetLogFile, $LogLevel

$jobs = @($sourceJob, $targetJob)
$sourceLastPos = 0
$targetLastPos = 0

while (($jobs | Where-Object { $_.State -eq 'Running' }).Count -gt 0) {
    if (Test-Path $sourceLogFile) {
        $content = Get-Content $sourceLogFile -Raw -ErrorAction SilentlyContinue
        if ($content -and $content.Length -gt $sourceLastPos) {
            $newContent = $content.Substring($sourceLastPos)
            $newContent -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "   [SRC] $_" }
            $sourceLastPos = $content.Length
        }
    }

    if (Test-Path $targetLogFile) {
        $content = Get-Content $targetLogFile -Raw -ErrorAction SilentlyContinue
        if ($content -and $content.Length -gt $targetLastPos) {
            $newContent = $content.Substring($targetLastPos)
            $newContent -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "   [TGT] $_" }
            $targetLastPos = $content.Length
        }
    }

    Start-Sleep -Seconds 5
}

$sourceOutputs = $null
$targetOutputs = $null
$exitCode = 0

if ($sourceJob.State -eq 'Failed') {
    Write-Host "❌ Source deployment failed:"
    $jobOutput = Receive-Job $sourceJob -ErrorAction SilentlyContinue 2>&1
    if ($jobOutput) { $jobOutput | ForEach-Object { Write-Host "   $_" } }
    if ($sourceJob.ChildJobs[0].Error) {
        $sourceJob.ChildJobs[0].Error | ForEach-Object { Write-Host "   $_" }
    }
    $exitCode = 2
} else {
    $sourceOutputs = Receive-Job $sourceJob
    Write-Host "   ✅ Source deployed: $(Protect-ApimName -Value $sourceOutputs.apimServiceName)"
}
Remove-Job $sourceJob

if ($targetJob.State -eq 'Failed') {
    Write-Host "❌ Target deployment failed:"
    $jobOutput = Receive-Job $targetJob -ErrorAction SilentlyContinue 2>&1
    if ($jobOutput) { $jobOutput | ForEach-Object { Write-Host "   $_" } }
    if ($targetJob.ChildJobs[0].Error) {
        $targetJob.ChildJobs[0].Error | ForEach-Object { Write-Host "   $_" }
    }
    $exitCode = 2
} else {
    $targetOutputs = Receive-Job $targetJob
    Write-Host "   ✅ Target deployed: $(Protect-ApimName -Value $targetOutputs.apimServiceName.value)"
}
Remove-Job $targetJob

if ($exitCode -ne 0) {
    exit $exitCode
}

$sourceSubId = if ($sourceOutputs -and $sourceOutputs.subscriptionId) { $sourceOutputs.subscriptionId } else { $subscriptionId }
$sourceRg = if ($sourceOutputs -and $sourceOutputs.resourceGroup) { $sourceOutputs.resourceGroup } else { $SourceResourceGroup }
$sourceName = if ($sourceOutputs -and $sourceOutputs.apimServiceName) { $sourceOutputs.apimServiceName } else {
    $apimName = az apim list --resource-group $SourceResourceGroup --query "[0].name" -o tsv 2>$null
    if (-not $apimName) {
        Write-Host "❌ No APIM instance found in resource group $(Protect-ResourceGroupName -Value $SourceResourceGroup)"
        exit 2
    }
    $apimName
}

$targetSubId = if ($targetOutputs -and $targetOutputs.subscriptionId.value) { $targetOutputs.subscriptionId.value } else { $subscriptionId }
$targetRg = if ($targetOutputs -and $targetOutputs.resourceGroupName.value) { $targetOutputs.resourceGroupName.value } else { $TargetResourceGroup }
$targetName = if ($targetOutputs -and $targetOutputs.apimServiceName.value) { $targetOutputs.apimServiceName.value } else {
    $apimName = az apim list --resource-group $TargetResourceGroup --query "[0].name" -o tsv 2>$null
    if (-not $apimName) {
        Write-Host "❌ No APIM instance found in resource group $(Protect-ResourceGroupName -Value $TargetResourceGroup)"
        exit 2
    }
    $apimName
}

if ($SkuName -in @('Developer', 'Premium')) {
    $postActivationState = az deployment group list `
        --resource-group $sourceRg `
        --query "sort_by([?starts_with(name, 'source-apim-post-activation-')], &properties.timestamp)[-1].properties.provisioningState" `
        -o tsv 2>$null
    if (-not $postActivationState) {
        Write-Host "❌ Could not find source-apim-post-activation deployment in $(Protect-ResourceGroupName -Value $sourceRg)"
        exit 2
    }
    if ($postActivationState -ne 'Succeeded') {
        Write-Host "❌ source-apim-post-activation deployment state is '$postActivationState' (expected 'Succeeded')"
        exit 2
    }
    Write-Host "   ✅ source-apim-post-activation deployment confirmed"
}

$state = [ordered]@{
    sourceSubscriptionId = $sourceSubId
    sourceResourceGroup  = $sourceRg
    sourceApimName       = $sourceName
    targetSubscriptionId = $targetSubId
    targetResourceGroup  = $targetRg
    targetApimName       = $targetName
    skuName              = $SkuName
    location             = $Location
}

$stateDir = Split-Path -Parent $StateFile
if (-not [string]::IsNullOrWhiteSpace($stateDir)) {
    New-Item -ItemType Directory -Path $stateDir -Force -ErrorAction SilentlyContinue | Out-Null
}

$state | ConvertTo-Json -Depth 5 | Set-Content -Path $StateFile -Encoding utf8
Write-Host "✅ PHASE 1 complete — state saved to $StateFile"
exit 0
