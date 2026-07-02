# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
# MaskingHelpers — secret-redaction utilities for the round-trip integration test scripts.

$script:EnableMasking = $true

$script:BuiltinRedactions = @(
    @{ Pattern = '([?&])(t|c|s|h)=[^&''"\s]+'
       Replacement = '$1$2=<REDACTED:arm-async>' }

    @{ Pattern = '/subscriptions/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
       Replacement = '/subscriptions/<REDACTED:subscription-id>' }

    @{ Pattern = '/(operationStatuses|operationResults)/[A-Za-z0-9._-]{10,}'
       Replacement = '/$1/<REDACTED:operation-id>' }

    @{ Pattern = "(?i)(['""]?x-ms-(?:correlation-)?(?:request|client-request)-id['""]?\s*[:=]\s*['""]?)[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
       Replacement = '$1<REDACTED:request-id>' }

    @{ Pattern = "(?i)(['""]?x-ms-routing-request-id['""]?\s*[:=]\s*['""]?)[A-Z0-9]+:\d{8}T\d{6}Z:[0-9a-fA-F-]{36}"
       Replacement = '$1<REDACTED:routing-request-id>' }

    @{ Pattern = "(?i)(authorization[:\s=]+bearer\s+)[A-Za-z0-9._\-+/=]+"
       Replacement = '$1<REDACTED:bearer>' }

    @{ Pattern = '\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}'
       Replacement = '<REDACTED:jwt>' }

    @{ Pattern = '[A-Za-z0-9](?:[A-Za-z0-9._%+\-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?\.[A-Za-z]{2,}'
       Replacement = '<REDACTED:email>' }
)

<#
.SYNOPSIS
Masks generic identifiers while preserving short prefix/suffix.

.PARAMETER Value
Input string to mask.

.PARAMETER Prefix
Visible prefix length.

.PARAMETER Suffix
Visible suffix length.

.OUTPUTS
System.String
#>
function Protect-Identifier {
    param(
        [string]$Value,
        [int]$Prefix = 6,
        [int]$Suffix = 4
    )

    if (-not $script:EnableMasking) {
        return $Value
    }

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return '<REDACTED:empty>'
    }

    if ($Value.Length -le ($Prefix + $Suffix)) {
        return '<REDACTED>'
    }

    return "{0}...{1}" -f $Value.Substring(0, $Prefix), $Value.Substring($Value.Length - $Suffix)
}

<#
.SYNOPSIS
Replaces subscription IDs with a stable redaction token.

.PARAMETER Value
Subscription ID value.

.OUTPUTS
System.String
#>
function Protect-SubscriptionId {
    param([string]$Value)
    if (-not $script:EnableMasking) { return $Value }
    return '<REDACTED:subscription-id>'
}

<#
.SYNOPSIS
Masks resource group names with minimal context retained.

.PARAMETER Value
Resource group name.

.OUTPUTS
System.String
#>
function Protect-ResourceGroupName {
    param([string]$Value)

    if (-not $script:EnableMasking) { return $Value }
    if ([string]::IsNullOrWhiteSpace($Value)) { return '<REDACTED:empty>' }

    # Preserve the generated suffix for round-trip RGs: <prefix>-<date>-<time>-<rand>-<src|tgt>-rg
    if ($Value -match '^([a-z0-9]+)-\d{8}-\d{6}-([a-z0-9]+)-(src|tgt)-rg$') {
        return "$($Matches[1])-...-$($Matches[2])-$($Matches[3])-rg"
    }

    # When the name ends with a numeric suffix (≥6 digits, such as a GitHub run_id
    # or timestamp), preserve the last meaningful dash-segment before the number so
    # logs stay distinguishable.
    if ($Value -match '^(.+)-([a-zA-Z][a-zA-Z0-9]*)-(\d{6,})$') {
        $prefixPart = $Matches[1]
        $keepLen = [Math]::Min(3, $prefixPart.Length)
        $ellipsis = if ($keepLen -lt $prefixPart.Length) { '...' } else { '' }
        return "$($prefixPart.Substring(0, $keepLen))$ellipsis$($Matches[2])-$($Matches[3])"
    }

    return Protect-Identifier -Value $Value -Prefix 3 -Suffix 7
}

<#
.SYNOPSIS
Masks APIM service names with minimal context retained.

.PARAMETER Value
APIM service name.

.OUTPUTS
System.String
#>
function Protect-ApimName {
    param([string]$Value)
    return Protect-Identifier -Value $Value -Prefix 3 -Suffix 8
}

<#
.SYNOPSIS
Applies configured replacement and regex redaction rules.

.PARAMETER Line
Input log line.

.PARAMETER Replacements
Literal replacement map applied before regex masking.

.OUTPUTS
System.String
#>
function Protect-LogLine {
    param(
        [string]$Line,
        [hashtable]$Replacements
    )

    if (-not $script:EnableMasking -or [string]::IsNullOrEmpty($Line)) {
        return $Line
    }

    $protectedLine = $Line

    if ($Replacements) {
        foreach ($entry in $Replacements.GetEnumerator()) {
            if ([string]::IsNullOrEmpty($entry.Key) -or [string]::IsNullOrEmpty($entry.Value)) {
                continue
            }

            $protectedLine = $protectedLine.Replace($entry.Key, $entry.Value)
        }
    }

    foreach ($rule in $script:BuiltinRedactions) {
        $protectedLine = [System.Text.RegularExpressions.Regex]::Replace(
            $protectedLine,
            $rule.Pattern,
            $rule.Replacement)
    }

    return $protectedLine
}

<#
.SYNOPSIS
Masks secrets in pipeline input, emitting redacted lines.

.DESCRIPTION
Pipeline-friendly wrapper around Protect-LogLine so native command output can be
redacted with a pipe instead of the array-argument Invoke-Masked* helpers, e.g.:

    az deployment group create ... | Protect-Secret -Replacements $Replacements

Each line flowing through the pipe is passed through the same literal-replacement
and regex-redaction rules as Protect-LogLine.

.PARAMETER InputObject
Pipeline line to mask.

.PARAMETER Replacements
Literal replacement map applied before regex redaction.

.OUTPUTS
System.String
#>
function Protect-Secret {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline)][AllowNull()][AllowEmptyString()][string]$InputObject,
        [hashtable]$Replacements
    )

    process {
        Protect-LogLine -Line $InputObject -Replacements $Replacements
    }
}

<#
.SYNOPSIS
Resolves the apiops CLI entrypoint from repository build output.

.OUTPUTS
System.Management.Automation.PSCustomObject
#>
function Resolve-ApiopsInvocation {
    $moduleDir = Split-Path -Parent $PSCommandPath
    $repoRoot = $null
    $cursor = $moduleDir

    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        if (Test-Path (Join-Path $cursor 'package.json')) {
            $repoRoot = $cursor
            break
        }

        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) {
            break
        }
        $cursor = $parent
    }

    if ([string]::IsNullOrWhiteSpace($repoRoot)) {
        throw 'Could not locate repository root from LogMasking module path.'
    }

    $distCliPath = Join-Path $repoRoot 'dist/cli/index.js'
    if (-not (Test-Path $distCliPath)) {
        throw "apiops CLI entrypoint not found: $distCliPath. Run 'npm run build' from repository root."
    }

    return [pscustomobject]@{ FilePath = 'node'; Prefix = @($distCliPath) }
}

<#
.SYNOPSIS
Invokes the apiops CLI directly so scripts can call it like a native command:

    apiops extract --resource-group $rg ... 2>&1 | Protect-Secret -Replacements $map

Resolves the node + dist/cli entrypoint and forwards every argument. $LASTEXITCODE
is set from the CLI process.

.OUTPUTS
The CLI's stdout/stderr stream.
#>
function apiops {
    $invocation = Resolve-ApiopsInvocation
    & $invocation.FilePath $invocation.Prefix @args
}

Export-ModuleMember -Function `
    Protect-Identifier, `
    Protect-SubscriptionId, `
    Protect-ResourceGroupName, `
    Protect-ApimName, `
    Protect-LogLine, `
    Protect-Secret, `
    Resolve-ApiopsInvocation, `
    apiops
