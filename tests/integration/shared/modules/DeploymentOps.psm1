# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
Import-Module (Join-Path $PSScriptRoot 'LogMasking.psm1')

<#
.SYNOPSIS
Prints masked details for failed ARM deployment operations.

.PARAMETER ResourceGroupName
Resource group that contains the deployment.

.PARAMETER DeploymentName
Deployment name to inspect.

.PARAMETER Replacements
Mask replacement map for output.

.OUTPUTS
None
#>
function Write-DeploymentFailureDetails {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ResourceGroupName,
        [Parameter(Mandatory)][string]$DeploymentName,
        [hashtable]$Replacements = @{}
    )

    $maskedRg = Protect-ResourceGroupName -Value $ResourceGroupName
    Write-Host ""
    Write-Host "========== Deployment failure details ==========" -ForegroundColor Yellow
    Write-Host "Resource group: $maskedRg" -ForegroundColor Yellow
    Write-Host "Deployment:     $DeploymentName" -ForegroundColor Yellow
    Write-Host "Querying failed deployment operations (before teardown)..." -ForegroundColor Yellow

    $query = "[?properties.provisioningState=='Failed'].{resource:properties.targetResource.resourceName, type:properties.targetResource.resourceType, code:properties.statusMessage.error.code, message:properties.statusMessage.error.message, details:properties.statusMessage.error.details}"

    try {
        Invoke-MaskedProcess -FilePath 'az' -Replacements $Replacements -Arguments @(
            'deployment', 'operation', 'group', 'list',
            '--resource-group', $ResourceGroupName,
            '--name',           $DeploymentName,
            '--query',          $query,
            '--output',         'json'
        )
    } catch {
        $maskedErr = Protect-LogLine -Line ($_.Exception.Message) -Replacements $Replacements
        Write-Host "Failed to retrieve deployment operations: $maskedErr" -ForegroundColor Red
    }

    Write-Host "================================================" -ForegroundColor Yellow
}

<#
    .SYNOPSIS
    Polls a condition until it succeeds or times out.

    .PARAMETER Probe
    Scriptblock invoked on each poll. Return $true when the condition is met.

    .PARAMETER TimeoutSeconds
    Maximum wait time in seconds.

    .PARAMETER PollIntervalSeconds
    Polling interval in seconds.

    .PARAMETER TimeoutMessage
    Error message thrown when the timeout is reached.

    .OUTPUTS
    System.Boolean
    #>
    function Invoke-PolledWait {
        [CmdletBinding()]
        param(
            [Parameter(Mandatory)][scriptblock]$Probe,
            [int]$TimeoutSeconds = 300,
            [int]$PollIntervalSeconds = 10,
            [Parameter(Mandatory)][string]$TimeoutMessage
        )

        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        while ((Get-Date) -lt $deadline) {
            if (& $Probe) {
                return $true
            }

            Start-Sleep -Seconds $PollIntervalSeconds
        }

        throw $TimeoutMessage
    }

    <#
.SYNOPSIS
Waits for an APIM instance to reach Succeeded provisioning.

.PARAMETER ResourceGroupName
Resource group containing the APIM instance.

.PARAMETER ApimName
APIM service name.

.PARAMETER TimeoutSeconds
Maximum wait time in seconds.

.PARAMETER PollIntervalSeconds
Polling interval in seconds.

.OUTPUTS
System.Boolean
#>
function Wait-ApimActivation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ResourceGroupName,
        [Parameter(Mandatory)][string]$ApimName,
        [int]$TimeoutSeconds = 1800,
        [int]$PollIntervalSeconds = 20
    )

    $maskedApim = Protect-ApimName -Value $ApimName
    Write-Host "Waiting for APIM '$maskedApim' to finish Activating (timeout ${TimeoutSeconds}s)..." -ForegroundColor Cyan

    $activationState = @{ LastState = $null }
    $probe = {
        $state = az apim show --resource-group $ResourceGroupName --name $ApimName --query provisioningState --output tsv 2>$null
        if ($state -ne $activationState.LastState) {
            Write-Host "  provisioningState: $state" -ForegroundColor Gray
            $activationState.LastState = $state
        }
        if ($state -eq 'Succeeded') { return $true }
        if ($state -eq 'Failed') { throw "APIM '$maskedApim' entered Failed state during activation wait" }
        return $false
    }

    Invoke-PolledWait `
        -Probe $probe `
        -TimeoutSeconds $TimeoutSeconds `
        -PollIntervalSeconds $PollIntervalSeconds `
        -TimeoutMessage "APIM '$maskedApim' did not reach Succeeded within ${TimeoutSeconds}s (last state: $($activationState.LastState))"
}

<#
.SYNOPSIS
Waits for an APIM API to become queryable via az CLI.

.PARAMETER ResourceGroupName
Resource group containing the APIM instance.

.PARAMETER ApimServiceName
APIM service name.

.PARAMETER ApiId
The API ID to query.

.PARAMETER Replacements
Mask replacement map for output.

.PARAMETER TimeoutSeconds
Maximum wait time in seconds.

.PARAMETER PollIntervalSeconds
Polling interval in seconds.

.OUTPUTS
System.Boolean
#>
function Wait-ApimApiQueryable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ResourceGroupName,
        [Parameter(Mandatory)][string]$ApimServiceName,
        [Parameter(Mandatory)][string]$ApiId,
        [hashtable]$Replacements = @{},
        [int]$TimeoutSeconds = 300,
        [int]$PollIntervalSeconds = 10
    )

    $maskedApim = Protect-ApimName -Value $ApimServiceName
    Write-Host "Waiting for APIM API '$ApiId' to become queryable in '$maskedApim' (timeout ${TimeoutSeconds}s)..." -ForegroundColor Cyan

    $subscriptionId = az account show --query id --output tsv 2>$null
    if ([string]::IsNullOrWhiteSpace($subscriptionId)) {
        throw "Could not resolve active Azure subscription while waiting for API '$ApiId'"
    }

    $apiListUri = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.ApiManagement/service/$ApimServiceName/apis?api-version=2025-09-01-preview"

    $probe = {
        $probeArgs = @(
            'rest',
            '--method', 'get',
            '--uri', $apiListUri,
            '--query', "length(value[?name=='$ApiId'])",
            '--output', 'tsv'
        )
        $probeResult = Invoke-MaskedAzCommand -Replacements $Replacements -Arguments $probeArgs
        if ($LASTEXITCODE -eq 0 -and "$probeResult" -eq '1') {
            return $true
        }

        return $false
    }

    Invoke-PolledWait `
        -Probe $probe `
        -TimeoutSeconds $TimeoutSeconds `
        -PollIntervalSeconds $PollIntervalSeconds `
        -TimeoutMessage "Timed out waiting for API '$ApiId' to be queryable in APIM '$maskedApim' within ${TimeoutSeconds}s"
}

Export-ModuleMember -Function `
    Write-DeploymentFailureDetails, `
    Wait-ApimActivation, `
    Wait-ApimApiQueryable
