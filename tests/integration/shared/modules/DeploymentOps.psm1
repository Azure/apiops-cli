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
        az deployment operation group list `
            --resource-group $ResourceGroupName `
            --name           $DeploymentName `
            --query          $query `
            --output         json 2>&1 |
            Protect-Secret -Replacements $Replacements |
            Out-Host
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
        # Merge stderr into the stream and mask it so probe failures are visible
        # (and redacted) instead of being swallowed by a redirect to $null.
        $probeOutput = az rest `
            --method get `
            --uri $apiListUri `
            --query "length(value[?name=='$ApiId'])" `
            --output tsv 2>&1 |
            Protect-Secret -Replacements $Replacements
        if ($LASTEXITCODE -eq 0) {
            # The query returns length(value[?name==ApiId]) as a bare count. API
            # names are unique, so the result is '0' (not visible yet) or '1'
            # (now queryable). -contains tolerates an incidental stderr line
            # merged in by 2>&1.
            return (@($probeOutput) -contains '1')
        }

        $probeOutput | ForEach-Object { Write-Host "  [api-probe] $_" -ForegroundColor DarkYellow }
        return $false
    }

    Invoke-PolledWait `
        -Probe $probe `
        -TimeoutSeconds $TimeoutSeconds `
        -PollIntervalSeconds $PollIntervalSeconds `
        -TimeoutMessage "Timed out waiting for API '$ApiId' to be queryable in APIM '$maskedApim' within ${TimeoutSeconds}s"
}

<#
.SYNOPSIS
Checks whether a resource group exists.

.PARAMETER ResourceGroup
Resource group name.

.PARAMETER SubscriptionId
Optional subscription id for the query.

.OUTPUTS
System.Boolean
#>
function Get-GroupExists {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ResourceGroup,
        [string]$SubscriptionId
    )

    $azArgs = @('group', 'exists', '--name', $ResourceGroup)
    if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
        $azArgs += @('--subscription', $SubscriptionId)
    }
    $azArgs += @('--output', 'tsv')

    $exists = az @azArgs 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query existence for resource group '$(Protect-ResourceGroupName -Value $ResourceGroup)'."
    }

    return $exists -eq 'true'
}

<#
.SYNOPSIS
Waits for a resource group to be deleted.

.PARAMETER ResourceGroup
Resource group name.

.PARAMETER SubscriptionId
Optional subscription id for the query.

.PARAMETER TimeoutMinutes
Maximum wait duration in minutes.

.PARAMETER IntervalSeconds
Polling interval in seconds.

.OUTPUTS
System.Boolean
#>
function Wait-ForResourceGroupDeletion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ResourceGroup,
        [string]$SubscriptionId,
        [int]$TimeoutMinutes = 60,
        [int]$IntervalSeconds = 30
    )

    $waitedSeconds = 0
    $timeoutSeconds = $TimeoutMinutes * 60
    $maskedGroup = Protect-ResourceGroupName -Value $ResourceGroup

    while ($waitedSeconds -lt $timeoutSeconds) {
        if (-not (Get-GroupExists -ResourceGroup $ResourceGroup -SubscriptionId $SubscriptionId)) {
            return $true
        }

        Write-Host "   ... waiting for deletion of $maskedGroup (${waitedSeconds}s elapsed)"
        Start-Sleep -Seconds $IntervalSeconds
        $waitedSeconds += $IntervalSeconds
    }

    throw "Timed out waiting for deletion of resource group '$maskedGroup'."
}

<#
.SYNOPSIS
Waits for APIM soft-delete metadata to become queryable.

.PARAMETER ServiceName
APIM service name.

.PARAMETER ServiceLocation
APIM location.

.PARAMETER SubscriptionId
Optional subscription id for the query.

.PARAMETER TimeoutMinutes
Maximum wait duration in minutes.

.PARAMETER IntervalSeconds
Polling interval in seconds.

.OUTPUTS
System.Boolean
#>
function Wait-ForDeletedApimService {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][string]$ServiceLocation,
        [string]$SubscriptionId,
        [int]$TimeoutMinutes = 30,
        [int]$IntervalSeconds = 15
    )

    $waitedSeconds = 0
    $timeoutSeconds = $TimeoutMinutes * 60
    $maskedApim = Protect-ApimName -Value $ServiceName

    while ($waitedSeconds -lt $timeoutSeconds) {
        $showArgs = @(
            'apim', 'deletedservice', 'show',
            '--service-name', $ServiceName,
            '--location', $ServiceLocation,
            '--output', 'none'
        )
        if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
            $showArgs += @('--subscription', $SubscriptionId)
        }

        az @showArgs 2>$null
        if ($LASTEXITCODE -eq 0) {
            return $true
        }

        Write-Host "   ... waiting for APIM soft-delete entry ($maskedApim) (${waitedSeconds}s elapsed)"
        Start-Sleep -Seconds $IntervalSeconds
        $waitedSeconds += $IntervalSeconds
    }

    throw "Timed out waiting for APIM soft-delete entry for '$maskedApim' in location '$ServiceLocation'."
}

Export-ModuleMember -Function `
    Write-DeploymentFailureDetails, `
    Wait-ApimActivation, `
    Wait-ApimApiQueryable, `
    Get-GroupExists, `
    Wait-ForResourceGroupDeletion, `
    Wait-ForDeletedApimService
