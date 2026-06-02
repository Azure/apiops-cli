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
Resolves native executable paths, including Windows cmd wrappers.

.PARAMETER Name
Command name to resolve.

.OUTPUTS
System.Management.Automation.PSCustomObject
#>
function Resolve-NativeExecutable {
    param([string]$Name)

    $resolved = Get-Command -Name $Name -CommandType Application -ErrorAction Stop |
        Select-Object -First 1

    $exePath = $resolved.Source
    $prefix  = @()

    if ($IsWindows -and ($exePath -like '*.cmd' -or $exePath -like '*.bat')) {
        $prefix  = @('/c', $exePath)
        $exePath = $env:ComSpec
    }

    return [pscustomobject]@{ FilePath = $exePath; Prefix = $prefix }
}

<#
.SYNOPSIS
Runs a process and streams masked output.

.PARAMETER FilePath
Executable to run.

.PARAMETER Arguments
Argument list for the executable.

.PARAMETER Replacements
Mask replacement map for streamed lines.

.PARAMETER CaptureStdout
Capture and return stdout instead of streaming.

.OUTPUTS
System.String
#>
function Invoke-MaskedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [hashtable]$Replacements,
        [switch]$CaptureStdout
    )

    $exe = Resolve-NativeExecutable -Name $FilePath
    $finalArgs = @() + $exe.Prefix + $Arguments

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName               = $exe.FilePath
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.RedirectStandardInput  = $false
    $psi.UseShellExecute        = $false
    $psi.CreateNoWindow         = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding  = [System.Text.Encoding]::UTF8

    foreach ($a in $finalArgs) {
        [void]$psi.ArgumentList.Add([string]$a)
    }

    $stdoutQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
    $stderrQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi

    $stdoutBuffer = $null
    if ($CaptureStdout) {
        $stdoutBuffer = [System.Collections.Generic.List[string]]::new()
    }

    $readerScript = {
        param([System.IO.StreamReader]$Reader,
              [System.Collections.Concurrent.ConcurrentQueue[string]]$Queue)
        try {
            while ($null -ne ($line = $Reader.ReadLine())) {
                [void]$Queue.Enqueue($line)
            }
        } catch {
            # IO errors on process teardown are expected; main thread owns exit.
        }
    }

    $outJob = $null
    $errJob = $null

    try {
        [void]$proc.Start()

        $outJob = Start-ThreadJob -ScriptBlock $readerScript -ArgumentList $proc.StandardOutput, $stdoutQueue
        $errJob = Start-ThreadJob -ScriptBlock $readerScript -ArgumentList $proc.StandardError,  $stderrQueue

        $line = $null
        while (-not $proc.HasExited -or
               $outJob.State -eq 'Running' -or
               $errJob.State -eq 'Running') {
            Start-Sleep -Milliseconds 100
            while ($stderrQueue.TryDequeue([ref]$line)) {
                Write-Host (Protect-LogLine -Line $line -Replacements $Replacements)
            }
            while ($stdoutQueue.TryDequeue([ref]$line)) {
                if ($CaptureStdout) {
                    [void]$stdoutBuffer.Add($line)
                } else {
                    Write-Host (Protect-LogLine -Line $line -Replacements $Replacements)
                }
            }
        }

        Wait-Job -Job $outJob, $errJob | Out-Null

        while ($stderrQueue.TryDequeue([ref]$line)) {
            Write-Host (Protect-LogLine -Line $line -Replacements $Replacements)
        }
        while ($stdoutQueue.TryDequeue([ref]$line)) {
            if ($CaptureStdout) {
                [void]$stdoutBuffer.Add($line)
            } else {
                Write-Host (Protect-LogLine -Line $line -Replacements $Replacements)
            }
        }

        $global:LASTEXITCODE = $proc.ExitCode
    }
    finally {
        if ($outJob) { Remove-Job -Job $outJob -Force -ErrorAction SilentlyContinue }
        if ($errJob) { Remove-Job -Job $errJob -Force -ErrorAction SilentlyContinue }
        $proc.Dispose()
    }

    if ($CaptureStdout) {
        return ($stdoutBuffer -join "`n")
    }
}

<#
.SYNOPSIS
Runs npx apiops with masked output and returns exit code.

.PARAMETER Arguments
Arguments passed to `apiops`.

.PARAMETER Replacements
Mask replacement map for output.

.OUTPUTS
System.Int32
#>
function Invoke-MaskedApiopsCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [hashtable]$Replacements
    )

    Invoke-MaskedProcess -FilePath 'npx' `
        -Arguments (@('apiops') + $Arguments) `
        -Replacements $Replacements

    return $LASTEXITCODE
}

<#
.SYNOPSIS
Runs az with masked output and returns captured stdout.

.PARAMETER Arguments
Arguments passed to `az`.

.PARAMETER Replacements
Mask replacement map for output.

.OUTPUTS
System.String
#>
function Invoke-MaskedAzCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [hashtable]$Replacements
    )

    return Invoke-MaskedProcess -FilePath 'az' `
        -Arguments $Arguments `
        -Replacements $Replacements `
        -CaptureStdout
}

Export-ModuleMember -Function `
    Protect-Identifier, `
    Protect-SubscriptionId, `
    Protect-ResourceGroupName, `
    Protect-ApimName, `
    Protect-LogLine, `
    Resolve-NativeExecutable, `
    Invoke-MaskedProcess, `
    Invoke-MaskedApiopsCommand, `
    Invoke-MaskedAzCommand
