<#
.SYNOPSIS
    Ensures the apiops CLI (@azure-tools/apiops-cli) is installed at the requested
    version, installing or upgrading it via npm when necessary.

.DESCRIPTION
    Standalone version of the Azure DevOps pipeline step 'Check apiops-cli version'.
    It verifies the Node.js toolchain, discovers any existing apiops install,
    compares the installed version against the requested/registry version and
    installs or upgrades as needed.

    On success it writes the resolved CLI path and version to the output, and (when
    running inside Azure DevOps) also surfaces them as pipeline variables
    APIOPS_PATH and APIOPS_VERSION.

.PARAMETER PackageName
    The npm package name. Defaults to '@azure-tools/apiops-cli'.

.EXAMPLE
    .\Check-ApiopsCliVersion.ps1

.EXAMPLE
    .\Check-ApiopsCliVersion.ps1 -ApiopsVersion '0.2.1-alpha.0'

.OUTPUTS
    PSCustomObject with Path and Version properties.
#>
[CmdletBinding()]
param(
    [string]$ApiopsVersion = 'latest',
    [string]$PackageName   = '@azure-tools/apiops-cli',
    # npm registry URL used for the direct connectivity check (curl).
    [string]$RegistryUrl   = 'https://registry.npmjs.org',
    # Deprecated / kept for backward compatibility with existing callers. Behaviour
    # is now automatic: an unreachable registry is a WARNING when apiops is already
    # installed locally, and a hard ERROR only when no local apiops version exists.
    [switch]$AllowStaleOnRegistryFailure,
    # Maximum time (seconds) to wait for 'npm install -g' before aborting, so a
    # hung/interactive npm process cannot stall the run forever.
    [int]$InstallTimeoutSeconds = 300,
    # Maximum time (seconds) to wait for the registry version probe ('npm view').
    [int]$RegistryProbeTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Tracks whether the npm registry / apiops repo could not be reached.
$script:RegistryUnreachable = $false

# Run an npm command via cmd.exe (so npm.cmd is used) with a hard timeout and a
# progress countdown. Returns an object with ExitCode, Output and TimedOut.
function Invoke-NpmCommand {
    param(
        [string[]]$NpmArgs,
        [string]$Activity,
        [int]$TimeoutSeconds
    )
    # Prefer the Windows npm launcher (npm.cmd); Get-Command may return the
    # extension-less 'npm' shell script, which Start-Process cannot execute.
    $npmCmd = $null
    $npmCmdInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCmdInfo) { $npmCmdInfo = Get-Command npm -ErrorAction SilentlyContinue }
    if ($npmCmdInfo -and $npmCmdInfo.Source -like '*.cmd') { $npmCmd = $npmCmdInfo.Source }
    if ($npmCmd) { $launcherArgs = @('/d','/c',"`"$npmCmd`"") + $NpmArgs }
    else         { $launcherArgs = @('/d','/c','npm') + $NpmArgs }

    $outFile = [System.IO.Path]::GetTempFileName()
    $errFile = [System.IO.Path]::GetTempFileName()
    $prevCI  = $env:CI
    $env:CI  = '1'   # non-interactive: npm never waits on a TTY
    try {
        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList $launcherArgs `
            -NoNewWindow -PassThru `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile

        $deadline    = (Get-Date).AddSeconds($TimeoutSeconds)
        $timedOut    = $false
        $reportEvery = 5
        $nextReport  = Get-Date
        while (-not $proc.HasExited) {
            $now = Get-Date
            if ($now -ge $deadline) { $timedOut = $true; break }
            if ($now -ge $nextReport) {
                $remaining = [int][math]::Ceiling(($deadline - $now).TotalSeconds)
                Write-Host ("  ... {0}, {1,4}s remaining before timeout" -f $Activity, $remaining)
                $nextReport = $now.AddSeconds($reportEvery)
            }
            Start-Sleep -Milliseconds 500
        }

        $npmOutput = @()
        $npmOutput += (Get-Content -LiteralPath $outFile -ErrorAction SilentlyContinue)
        $npmOutput += (Get-Content -LiteralPath $errFile -ErrorAction SilentlyContinue)
        $text = ($npmOutput -join "`n")

        if ($timedOut) {
            try { $proc.Kill($true) } catch { try { $proc.Kill() } catch {} }
            return [PSCustomObject]@{ ExitCode = -1; Output = $text; TimedOut = $true }
        }
        return [PSCustomObject]@{ ExitCode = $proc.ExitCode; Output = $text; TimedOut = $false }
    } finally {
        $env:CI = $prevCI
        Remove-Item -LiteralPath $outFile, $errFile -ErrorAction SilentlyContinue
    }
}

# Validate raw network connectivity to the npm registry using curl, which is a
# direct, unambiguous signal: any HTTP response (even 4xx/5xx) means reachable,
# while DNS / TLS / connection failures mean unreachable. This avoids inferring
# reachability from npm command output.
function Test-RegistryReachable {
    param(
        [string]$Url,
        [int]$TimeoutSeconds
    )
    Write-Host "Checking connectivity to npm registry '$Url' (timeout ${TimeoutSeconds}s)..."

    # Use the real curl binary (curl.exe). In Windows PowerShell 5.1 the bare
    # name 'curl' is an alias for Invoke-WebRequest, so we must avoid the alias.
    $curlCmd = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curlCmd) { $curlCmd = Get-Command curl -ErrorAction SilentlyContinue }

    if ($curlCmd -and $curlCmd.CommandType -ne 'Alias') {
        # Run curl via Start-Process with redirected output files. Piping native
        # stderr into the PowerShell pipeline (curl writes its progress meter /
        # verbose log to stderr) raises a terminating NativeCommandError under
        # $ErrorActionPreference='Stop'. Reachability is taken from the exit code:
        # 0 = an HTTP response was received; non-zero = a failure that we further
        # classify below (TLS/certificate errors still mean the host is reachable).
        $outFile = [System.IO.Path]::GetTempFileName()
        $errFile = [System.IO.Path]::GetTempFileName()
        try {
            $curlArgs = @('-s','-v','-o','NUL','--connect-timeout',"$TimeoutSeconds",'--max-time',"$TimeoutSeconds",$Url)
            $proc = Start-Process -FilePath $curlCmd.Source -ArgumentList $curlArgs `
                        -NoNewWindow -PassThru -Wait `
                        -RedirectStandardOutput $outFile -RedirectStandardError $errFile
            $code = $proc.ExitCode
            $log  = @()
            $log += (Get-Content -LiteralPath $errFile -ErrorAction SilentlyContinue)
            $log += (Get-Content -LiteralPath $outFile -ErrorAction SilentlyContinue)
            $log | Where-Object { $_ } | ForEach-Object { Write-Host "    $_" }
            if ($code -eq 0) { return $true }
            # A TLS/certificate validation failure means we DID reach the host and
            # completed (or nearly completed) a TLS handshake - the registry is
            # reachable, only the certificate is untrusted. Because npm may trust a
            # different CA store (or the cert is mid-rotation), this must not be
            # treated as 'unreachable'. curl SSL/cert exit codes:
            #   35 SSL connect error, 51 peer cert/fingerprint not OK,
            #   58 local cert problem, 60 peer cert not authenticated by known CA,
            #   66 SSL engine init failed, 77 CA cert file problem, 83 issuer check failed.
            $sslCertExitCodes = @(35, 51, 58, 60, 66, 77, 83)
            if ($sslCertExitCodes -contains $code) {
                Write-Host "curl exited $code (TLS/certificate validation issue); npm registry '$Url' is reachable but its certificate could not be validated. Treating as reachable."
                return $true
            }
            Write-Host "curl exited $code; npm registry '$Url' appears unreachable."
            return $false
        } finally {
            Remove-Item -LiteralPath $outFile, $errFile -ErrorAction SilentlyContinue
        }
    }

    # Fallback when curl is unavailable: any HTTP response means reachable.
    Write-Host 'curl not found; falling back to Invoke-WebRequest for the connectivity check.'
    try {
        $null = Invoke-WebRequest -Uri $Url -Method Head -TimeoutSec $TimeoutSeconds -UseBasicParsing
        return $true
    } catch {
        if ($_.Exception.Response) { return $true }
        # A certificate trust/validation failure still means the host was reached
        # (the TLS handshake got far enough to receive a certificate). Reachability
        # must not hinge on certificate trust, so treat these as reachable.
        $msg = $_.Exception.Message
        $inner = $_.Exception.InnerException
        $combined = @($msg, ($inner.Message)) -join ' '
        if ($combined -match '(?i)certificate|trust relationship|SSL/TLS|secure channel|RemoteCertificate') {
            Write-Host "Connectivity check hit a TLS/certificate validation issue ($msg); the registry is reachable but its certificate could not be validated. Treating as reachable."
            return $true
        }
        Write-Host "Connectivity check failed: $msg"
        return $false
    }
}

# Sanity check Node toolchain (CLI requires Node >= 22)
$nodeVersion = (& node --version) 2>$null
if (-not $nodeVersion) { throw 'Node.js is not installed on this machine. Install Node.js >= 22.' }
Write-Host "Node $nodeVersion / npm $(& npm --version)"

$version = $ApiopsVersion
$pkgName = $PackageName
$pkg     = "$pkgName@$version"

function Find-Apiops {
    $cmd = Get-Command apiops -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @()
    try { $candidates += (& npm prefix -g 2>$null) } catch {}
    $candidates += @(
        "$env:AppData\npm",
        "$env:ProgramFiles\nodejs",
        "${env:ProgramFiles(x86)}\nodejs"
    )
    foreach ($dir in ($candidates | Where-Object { $_ })) {
        foreach ($name in @('apiops.cmd','apiops.exe','apiops.ps1','apiops')) {
            $p = Join-Path $dir $name
            if (Test-Path $p) { return $p }
        }
    }
    return $null
}

function Get-ApiopsInstalledVersion([string]$exePath) {
    if (-not $exePath) { return $null }
    try {
        $raw = & $exePath --version 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { return $null }
        $m = [regex]::Match($raw, '\d+\.\d+\.\d+(?:[-+][\w\.]+)?')
        if ($m.Success) { return $m.Value }
    } catch {}
    return $null
}

function Get-NpmRegistryVersion([string]$pkgName, [string]$requested) {
    # For pinned versions, the requested string IS the desired version (no registry call needed).
    if ($requested -and $requested -ne 'latest') { return $requested }
    # Connectivity is decided separately (Test-RegistryReachable); skip the version
    # lookup entirely when the registry is already known to be unreachable.
    if ($script:RegistryUnreachable) { return $null }

    Write-Host "Resolving latest '$pkgName' version from npm..."
    $viewArgs = @('view',$pkgName,'version','--prefer-online','--no-progress',
                  '--fetch-retries=1','--fetch-retry-mintimeout=2000','--fetch-retry-maxtimeout=5000')
    $res = Invoke-NpmCommand -NpmArgs $viewArgs -Activity 'resolving latest version' -TimeoutSeconds $RegistryProbeTimeoutSeconds
    if ($res.Output) { ($res.Output -split "`n") | Where-Object { $_ } | ForEach-Object { Write-Host "    $_" } }

    $v = ($res.Output -split "`n" | Where-Object { $_ -match '^\s*\d+\.\d+\.\d+' } | Select-Object -Last 1)
    if ($v) { return $v.ToString().Trim() }
    return $null
}

function Install-Apiops([string]$pkg) {
    Write-Host "Installing $pkg globally (timeout ${InstallTimeoutSeconds}s)..."

    # Run non-interactively: no progress spinner, no audit/fund network calls.
    $npmArgs = @('install','-g',$pkg,'--no-progress','--no-audit','--no-fund','--loglevel=http')
    $res = Invoke-NpmCommand -NpmArgs $npmArgs -Activity 'installing' -TimeoutSeconds $InstallTimeoutSeconds
    if ($res.Output) { ($res.Output -split "`n") | Where-Object { $_ } | ForEach-Object { Write-Host $_ } }

    if ($res.TimedOut) {
        # A timeout while fetching almost always means the repo is unreachable.
        $script:RegistryUnreachable = $true
        return 'Unreachable'
    }
    # On a real failure, classify with a direct curl connectivity check instead of
    # parsing npm's output: an unreachable registry is non-critical, anything else
    # is a genuine install error.
    if ($null -ne $res.ExitCode -and $res.ExitCode -ne 0) {
        if (-not (Test-RegistryReachable -Url $RegistryUrl -TimeoutSeconds $RegistryProbeTimeoutSeconds)) {
            $script:RegistryUnreachable = $true
            return 'Unreachable'
        }
        throw "npm install -g $pkg failed (exit $($res.ExitCode))."
    }

    $npmPrefix = (& npm prefix -g).Trim()
    if ($npmPrefix -and (Test-Path $npmPrefix) -and ($env:Path -notlike "*$npmPrefix*")) {
        $env:Path = "$npmPrefix;$env:Path"
    }
    # Refresh PATH from registry (covers installs that updated it)
    $env:Path = "$env:Path;" +
                [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')

    return 'Success'
}

$apiopsPath   = Find-Apiops
$installedVer = Get-ApiopsInstalledVersion $apiopsPath

# Decide registry reachability up front via a direct curl connectivity check.
$registryReachable          = Test-RegistryReachable -Url $RegistryUrl -TimeoutSeconds $RegistryProbeTimeoutSeconds
$script:RegistryUnreachable = -not $registryReachable

$desiredVer   = Get-NpmRegistryVersion $pkgName $version

Write-Host ("Installed apiops version on machine: {0}" -f ($(if ($installedVer) { $installedVer } else { '<not installed>' })))
Write-Host ("Requested apiops version:            {0}" -f $version)
if ($desiredVer) { Write-Host ("Resolved package version:            {0}" -f $desiredVer) }

# Always log apiops repository (npm registry) reachability so it's visible in logs.
if ($script:RegistryUnreachable) {
    $msg = "apiops npm repository ($pkgName): UNREACHABLE."
    if ($env:TF_BUILD) { Write-Host "##vso[task.logissue type=warning]$msg" } else { Write-Warning $msg }
} else {
    Write-Host "apiops npm repository ($pkgName): REACHABLE."
}

$needsInstall = $false
if ($script:RegistryUnreachable) {
    # Network repo not reachable: rely on whatever is installed locally.
    # Warning when a local version exists; hard error only when nothing is installed.
    if ($apiopsPath -and $installedVer) {
        Write-Warning "apiops repository is unreachable; continuing with the locally installed apiops version ($installedVer), which may be out of date."
    } else {
        throw "apiops repository is unreachable and no apiops CLI is installed locally. Cannot continue."
    }
} elseif (-not $apiopsPath -or -not $installedVer) {
    $needsInstall = $true
    Write-Host 'apiops not found on machine; installation required.'
} elseif ($desiredVer -and ($installedVer -ne $desiredVer)) {
    $needsInstall = $true
    Write-Host "Installed version ($installedVer) differs from desired ($desiredVer); upgrading."
} else {
    Write-Host 'apiops is up to date; skipping install.'
}

if ($needsInstall) {
    $installResult = Install-Apiops $pkg

    if ($installResult -eq 'Unreachable') {
        # The npm registry / apiops repo could not be reached. This is a
        # non-critical step when a usable apiops CLI is already installed:
        # warn and continue with the existing version instead of failing.
        if ($apiopsPath -and $installedVer) {
            Write-Warning "Could not reach the npm registry/apiops repo to install '$pkg'. Continuing with the already-installed apiops version ($installedVer), which may be out of date."
        } else {
            throw "Could not reach the npm registry/apiops repo to install '$pkg', and no existing apiops CLI was found on this machine. Cannot continue."
        }
    } else {
        $apiopsPath = Find-Apiops
        if (-not $apiopsPath) {
            $npmPrefix = (& npm prefix -g).Trim()
            Write-Host "npm prefix -g => $npmPrefix"
            if ($npmPrefix -and (Test-Path $npmPrefix)) {
                Write-Host "Contents of npm global prefix:"
                Get-ChildItem -LiteralPath $npmPrefix | Format-Table Name,Length -AutoSize | Out-String | Write-Host
            }
            throw 'apiops still not found after global install. Check that npm''s global prefix is on PATH.'
        }
        $installedVer = Get-ApiopsInstalledVersion $apiopsPath
    }
}

Write-Host "Using apiops CLI: $apiopsPath (version $installedVer)"

# Expose results to the calling pipeline step (same runspace) so it can decide how
# to surface an online-repository outage (e.g. mark the step as a warning).
$global:ApiopsRepoReachable = -not [bool]$script:RegistryUnreachable
$global:ApiopsPath          = $apiopsPath
$global:ApiopsVersion       = $installedVer

# If running inside Azure DevOps, surface the resolved CLI path + version to downstream steps.
if ($env:TF_BUILD) {
    Write-Host "##vso[task.setvariable variable=APIOPS_PATH]$apiopsPath"
    Write-Host "##vso[task.setvariable variable=APIOPS_VERSION]$installedVer"
}

# Emit a result object for standalone callers.
[PSCustomObject]@{
    Path    = $apiopsPath
    Version = $installedVer
}
