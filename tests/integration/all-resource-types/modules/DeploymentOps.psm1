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

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastState = $null
    while ((Get-Date) -lt $deadline) {
        $state = az apim show --resource-group $ResourceGroupName --name $ApimName --query provisioningState --output tsv 2>$null
        if ($state -ne $lastState) {
            Write-Host "  provisioningState: $state" -ForegroundColor Gray
            $lastState = $state
        }
        if ($state -eq 'Succeeded') { return $true }
        if ($state -eq 'Failed') { throw "APIM '$maskedApim' entered Failed state during activation wait" }
        Start-Sleep -Seconds $PollIntervalSeconds
    }
    throw "APIM '$maskedApim' did not reach Succeeded within ${TimeoutSeconds}s (last state: $lastState)"
}

Export-ModuleMember -Function `
    Write-DeploymentFailureDetails, `
    Wait-ApimActivation
