# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
Adds a key/value pair only when the value is non-empty.

.PARAMETER Hashtable
Target hashtable to update.

.PARAMETER Key
Hashtable key to set.

.PARAMETER Value
Candidate value to add.

.OUTPUTS
None
#>
function Add-ArgumentIfSet {
    param(
        [Parameter(Mandatory)]
        [hashtable]$Hashtable,

        [Parameter(Mandatory)]
        [string]$Key,

        [AllowNull()]
        $Value
    )

    if (-not [string]::IsNullOrWhiteSpace($Key) -and -not [string]::IsNullOrWhiteSpace([string]$Value)) {
        $Hashtable[$Key] = $Value
    }
}

<#
.SYNOPSIS
Returns a bound parameter value, or null when not specified.

.PARAMETER BoundParameters
Bound parameter dictionary.

.PARAMETER Name
Parameter name to read.

.OUTPUTS
System.Object
#>
function Get-BoundParameterValueOrNull {
    param(
        [Parameter(Mandatory)]
        [hashtable]$BoundParameters,

        [Parameter(Mandatory)]
        [string]$Name
    )

    if ($BoundParameters.ContainsKey($Name)) {
        return $BoundParameters[$Name]
    }

    return $null
}

<#
.SYNOPSIS
Sets Verbose and Debug preferences from script log level.

.PARAMETER LogLevel
Script log level (Info, Verbose, Debug).

.OUTPUTS
None
#>
function Set-ScriptLogPreferences {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('Info', 'Verbose', 'Debug')]
        [string]$LogLevel
    )

    $verbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
    $debugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

    # Use the caller's session state so the preference variables land in the
    # invoking script's scope. Set-Variable -Scope 1 from a module function
    # only affects the module's scope chain, not the caller, so Write-Verbose
    # output would otherwise stay suppressed.
    $PSCmdlet.SessionState.PSVariable.Set('VerbosePreference', $verbosePreference)
    $PSCmdlet.SessionState.PSVariable.Set('DebugPreference', $debugPreference)
}

<#
.SYNOPSIS
Ensures az CLI is logged in and returns account context.

.PARAMETER ErrorMessage
Error to emit when az account context is missing.

.OUTPUTS
System.Object
#>
function Assert-AzCliLoggedIn {
    param(
        [string]$ErrorMessage = "Not logged in to Azure CLI. Run 'az login' first."
    )

    $account = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $account) {
        Write-Error $ErrorMessage
        exit 2
    }

    return $account
}

Export-ModuleMember -Function Add-ArgumentIfSet, Get-BoundParameterValueOrNull, Set-ScriptLogPreferences, Assert-AzCliLoggedIn