# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
Maps script log levels to apiops CLI log levels.

.PARAMETER ScriptLogLevel
Script log level (Info, Verbose, Debug).

.OUTPUTS
System.String
#>
function Get-ApiopsLogLevel {
    param(
        [Parameter(Mandatory)]
        [string]$ScriptLogLevel
    )

    switch ($ScriptLogLevel) {
        'Info'    { return 'info' }
        'Verbose' { return 'warn' }
        'Debug'   { return 'debug' }
        default   { return 'info' }
    }
}

<#
.SYNOPSIS
Builds optional auth args from OIDC environment variables.

.OUTPUTS
System.String[]
#>
function Get-ApiopsAuthArgs {
    $authArgs = @()

    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_CLIENT_ID)) {
        $authArgs += @('--client-id', $env:AZURE_CLIENT_ID)
    }

    if (-not [string]::IsNullOrWhiteSpace($env:AZURE_TENANT_ID)) {
        $authArgs += @('--tenant-id', $env:AZURE_TENANT_ID)
    }

    return $authArgs
}

Export-ModuleMember -Function Get-ApiopsLogLevel, Get-ApiopsAuthArgs