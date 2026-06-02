# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
<#
.SYNOPSIS
  Validates extracted APIM artifacts against expected structure manifest.

.DESCRIPTION
  Zero-cost test hardening script that validates extracted artifacts directory
  structure, file existence, resource counts, spot-check fields, and scans for
  leaked secrets. Reads validation rules from a manifest JSON file.

  Exit codes:
    0 - all validations passed
    1 - validation failures detected
    2 - script error (manifest missing, invalid JSON, etc.)

.PARAMETER ExtractedDir
  Path to the extracted artifacts directory.

.PARAMETER ManifestFile
  Path to expected-structure.json manifest file.

.PARAMETER SkuName
  APIM SKU name (StandardV2, Developer, Premium, Standard, PremiumV2) to handle SKU-variant
  resources. Default: StandardV2.

.EXAMPLE
  .\validate-extracted-artifacts.ps1 -ExtractedDir ./extracted-artifacts -ManifestFile ./expected-structure.json -SkuName StandardV2
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ExtractedDir,

    [Parameter(Mandatory)]
    [string]$ManifestFile,

    [string]$SkuName = 'StandardV2'
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Known secret values from source-apim.bicep (MUST NOT appear in artifacts)
# ---------------------------------------------------------------------------

$KnownSecretValues = @(
    'secret-value-redacted'           # src-nv-secret named value (line 419)
    'all-resources-secret-value'       # KeyVault secret value (line 364)
)

# Patterns for connection strings and keys (regex)
$SecretPatterns = @(
    'Endpoint=sb://.*\.servicebus\.windows\.net/;SharedAccessKeyName=.*;SharedAccessKey=.*'  # Event Hub connection string
    'InstrumentationKey=[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'         # App Insights instrumentation key
)

# ---------------------------------------------------------------------------
# Validation State
# ---------------------------------------------------------------------------

$script:TotalChecks = 0
$script:PassedChecks = 0
$script:FailedChecks = 0
$script:Failures = @()

function Write-Check([string]$name, [bool]$passed, [string]$details = '') {
    $script:TotalChecks++
    if ($passed) {
        $script:PassedChecks++
        Write-Host "✅ $name"
    } else {
        $script:FailedChecks++
        Write-Host "❌ $name"
        if ($details) {
            Write-Host "   $details"
        }
        $script:Failures += "$name`: $details"
    }
}

function Get-JsonFieldValue([psobject]$obj, [string]$dotPath) {
    $segments = $dotPath -split '\.'
    $current = $obj
    foreach ($segment in $segments) {
        if ($null -eq $current) { return $null }
        $current = $current.$segment
    }
    return $current
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

Write-Host "🔎 Artifact Structure Validation"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "ExtractedDir: $ExtractedDir"
Write-Host "ManifestFile: $ManifestFile"
Write-Host "SkuName:      $SkuName"
Write-Host ""

if (-not (Test-Path $ExtractedDir)) {
    Write-Host "❌ CRITICAL: Extracted artifacts directory not found: $ExtractedDir"
    exit 2
}

if (-not (Test-Path $ManifestFile)) {
    Write-Host "❌ CRITICAL: Manifest file not found: $ManifestFile"
    exit 2
}

# ---------------------------------------------------------------------------
# Load manifest
# ---------------------------------------------------------------------------

try {
    $manifest = Get-Content -Path $ManifestFile -Raw | ConvertFrom-Json
} catch {
    Write-Host "❌ CRITICAL: Failed to parse manifest JSON: $_"
    exit 2
}

# ---------------------------------------------------------------------------
# Helpers for manifest-driven validation
# ---------------------------------------------------------------------------

function Test-SkuFilter([psobject]$entry, [string]$sku) {
    # Returns $true if this entry should be SKIPPED for the given SKU
    if ($entry.skuDependent -eq $true -and $entry.skuFilter) {
        $allowed = @($entry.skuFilter)
        return ($allowed -notcontains $sku)
    }
    return $false
}

function Invoke-SpotCheck([string]$basePath, [psobject]$spotChecks, [string]$label) {
    <#
    .SYNOPSIS
        Runs spot-check assertions from the manifest's nested spotChecks format.
        Each key is a filename; value is either:
          - dot-path → expected value (for JSON fields)
          - "contentIncludes" → array of strings (for XML/text files)
          - "minLength" / "contains" → for array files (apis.json, groups.json)
    #>
    foreach ($fileProperty in $spotChecks.PSObject.Properties) {
        $fileName = $fileProperty.Name
        $assertions = $fileProperty.Value
        $filePath = Join-Path $basePath $fileName

        if (-not (Test-Path $filePath -PathType Leaf)) {
            Write-Check "Spot-check [$label]: $fileName" $false "File not found at $filePath"
            continue
        }

        $content = Get-Content -Path $filePath -Raw -ErrorAction SilentlyContinue

        foreach ($assertProp in $assertions.PSObject.Properties) {
            $field = $assertProp.Name
            $expected = $assertProp.Value

            # --- contentIncludes: verify text/XML file contains expected strings ---
            if ($field -eq 'contentIncludes') {
                $strings = @($expected)
                foreach ($s in $strings) {
                    $found = $content -match [regex]::Escape($s)
                    Write-Check "Content [$label/$fileName]: contains '$s'" $found $(if (-not $found) { "String not found in file" } else { '' })
                }
                continue
            }

            # --- minLength: verify array file has minimum entries ---
            if ($field -eq 'minLength') {
                try {
                    $arr = $content | ConvertFrom-Json
                    $len = @($arr).Count
                    $passed = $len -ge $expected
                    Write-Check "Array length [$label/$fileName]: >= $expected" $passed $(if (-not $passed) { "Found $len items" } else { '' })
                } catch {
                    Write-Check "Array length [$label/$fileName]" $false "Failed to parse JSON: $_"
                }
                continue
            }

            # --- contains: verify array file contains specific names ---
            if ($field -eq 'contains') {
                try {
                    $arr = $content | ConvertFrom-Json
                    $names = @($arr) | ForEach-Object { if ($_.name) { $_.name } else { $_ } }
                    $targets = @($expected)
                    foreach ($t in $targets) {
                        $found = $t -in $names
                        Write-Check "Array contains [$label/$fileName]: '$t'" $found $(if (-not $found) { "Not found in: $($names -join ', ')" } else { '' })
                    }
                } catch {
                    Write-Check "Array contains [$label/$fileName]" $false "Failed to parse JSON: $_"
                }
                continue
            }

            # --- dot-path field assertion (JSON files) ---
            if ($fileName -like '*.json') {
                try {
                    $obj = $content | ConvertFrom-Json
                    $actual = Get-JsonFieldValue $obj $field

                    if ($expected -eq 'exists') {
                        $passed = $null -ne $actual
                        Write-Check "Field [$label/$fileName]: $field exists" $passed $(if (-not $passed) { "Field is null/missing" } else { '' })
                    }
                    elseif ($expected -is [System.Collections.IEnumerable] -and $expected -isnot [string]) {
                        # Array comparison (e.g., protocols, tags)
                        $expectedSorted = @($expected) | Sort-Object
                        $actualSorted = @($actual) | Sort-Object
                        $passed = ($expectedSorted -join ',') -eq ($actualSorted -join ',')
                        Write-Check "Field [$label/$fileName]: $field = [$($expectedSorted -join ', ')]" $passed $(if (-not $passed) { "Got [$($actualSorted -join ', ')]" } else { '' })
                    }
                    else {
                        $passed = "$actual" -eq "$expected"
                        Write-Check "Field [$label/$fileName]: $field = $expected" $passed $(if (-not $passed) { "Got '$actual'" } else { '' })
                    }
                } catch {
                    Write-Check "Field [$label/$fileName]: $field" $false "Failed to parse JSON: $_"
                }
            }
        }
    }
}

function Invoke-DirectoryValidation([string]$basePath, [psobject]$dirSpec, [string]$dirName, [string]$parentLabel) {
    <#
    .SYNOPSIS
        Validates a single resource-type directory from the manifest.
        Handles: directory existence, minCount, expected resources (files + spotChecks + children).
    #>
    $label = if ($parentLabel) { "$parentLabel/$dirName" } else { $dirName }
    $dirPath = Join-Path $basePath $dirName

    # SKU filter check
    if (Test-SkuFilter $dirSpec $SkuName) {
        Write-Host "  ⏭️  Skipping $label (SKU: supported in $($dirSpec.skuFilter -join ', '))"
        return
    }

    # Directory exists — note-only entries (embedded in parent file) are informational
    $exists = Test-Path $dirPath -PathType Container
    if (-not $exists -and $dirSpec.note -and -not $dirSpec.expected) {
        Write-Host "  [info] $label`: $($dirSpec.note)"
        return
    }
    Write-Check "Directory: $label" $exists

    if (-not $exists) { return }

    # Min count (count subdirectories = resource instances)
    if ($dirSpec.minCount -and $dirSpec.minCount -gt 0) {
        $subdirs = @(Get-ChildItem -Path $dirPath -Directory -ErrorAction SilentlyContinue)
        $count = $subdirs.Count
        $passed = $count -ge $dirSpec.minCount
        Write-Check "Count: $label >= $($dirSpec.minCount)" $passed $(if (-not $passed) { "Found $count" } else { '' })
    }

    # Expected resources
    if ($dirSpec.expected) {
        foreach ($resource in $dirSpec.expected) {
            # Some expected entries are just strings (e.g., operation names)
            if ($resource -is [string]) {
                $resPath = Join-Path $dirPath $resource
                $resExists = (Test-Path $resPath -PathType Container) -or (Test-Path $resPath -PathType Leaf)
                Write-Check "Exists: $label/$resource" $resExists
                continue
            }

            $resName = $resource.name
            $resPath = Join-Path $dirPath $resName
            $resExists = Test-Path $resPath -PathType Container
            Write-Check "Resource: $label/$resName" $resExists

            if (-not $resExists) { continue }

            # Files check
            if ($resource.files) {
                foreach ($f in $resource.files) {
                    $fPath = Join-Path $resPath $f
                    $fExists = Test-Path $fPath -PathType Leaf
                    Write-Check "File: $label/$resName/$f" $fExists
                }
            }

            # Spot checks
            if ($resource.spotChecks) {
                Invoke-SpotCheck -basePath $resPath -spotChecks $resource.spotChecks -label "$label/$resName"
            }

            # Recursive children (e.g., apis/src-rest-openapi/operations/)
            if ($resource.children) {
                foreach ($childProp in $resource.children.PSObject.Properties) {
                    Invoke-DirectoryValidation -basePath $resPath -dirSpec $childProp.Value -dirName $childProp.Name -parentLabel "$label/$resName"
                }
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Section 1: Service-Level Artifacts
# ---------------------------------------------------------------------------

Write-Host "📁 Section 1: Service-Level Artifacts"
Write-Host ""

if ($manifest.serviceLevelArtifacts) {
    foreach ($artProp in $manifest.serviceLevelArtifacts.PSObject.Properties) {
        $fileName = $artProp.Name
        $artSpec = $artProp.Value
        $filePath = Join-Path $ExtractedDir $fileName
        $exists = Test-Path $filePath -PathType Leaf
        Write-Check "Service artifact: $fileName" $exists

        if ($exists -and $artSpec.spotChecks) {
            $content = Get-Content -Path $filePath -Raw
            if ($artSpec.spotChecks.contentIncludes) {
                foreach ($s in @($artSpec.spotChecks.contentIncludes)) {
                    $found = $content -match [regex]::Escape($s)
                    Write-Check "Content [service/$fileName]: contains '$s'" $found $(if (-not $found) { "String not found" } else { '' })
                }
            }
        }
    }
}

Write-Host ""

# ---------------------------------------------------------------------------
# Section 2: Resource Directory Validation (structure + counts + files + spot-checks)
# ---------------------------------------------------------------------------

Write-Host "📂 Section 2: Resource Directories"
Write-Host ""

if ($manifest.directories) {
    foreach ($dirProp in $manifest.directories.PSObject.Properties) {
        Invoke-DirectoryValidation -basePath $ExtractedDir -dirSpec $dirProp.Value -dirName $dirProp.Name -parentLabel ''
    }
}

Write-Host ""

# ---------------------------------------------------------------------------
# Section 3: Workspace Validation (SKU-dependent)
# ---------------------------------------------------------------------------

Write-Host "🏢 Section 3: Workspaces"
Write-Host ""

if ($manifest.workspaces) {
    $wsSpec = $manifest.workspaces
    if (Test-SkuFilter $wsSpec $SkuName) {
        Write-Host "  ⏭️  Skipping workspaces (SKU: supported in $($wsSpec.skuFilter -join ', '))"
    }
    elseif ($wsSpec.expected) {
        foreach ($ws in $wsSpec.expected) {
            $wsPath = if ($ws.path) { Join-Path $ExtractedDir $ws.path } else { Join-Path $ExtractedDir "workspaces/$($ws.name)" }
            $wsExists = Test-Path $wsPath -PathType Container
            Write-Check "Workspace: $($ws.name)" $wsExists

            if ($wsExists -and $ws.directories) {
                foreach ($wsDirProp in $ws.directories.PSObject.Properties) {
                    Invoke-DirectoryValidation -basePath $wsPath -dirSpec $wsDirProp.Value -dirName $wsDirProp.Name -parentLabel "workspaces/$($ws.name)"
                }
            }
        }
    }
}

Write-Host ""

# ---------------------------------------------------------------------------
# Section 4: Secret Leak Scan (CRITICAL)
# ---------------------------------------------------------------------------

Write-Host "🔒 Section 4: Secret Leak Scan"
Write-Host ""

$leakedSecrets = @()
# Exclude .overrides.yaml - it's a generated config file, not an extracted artifact
$scannedFiles = Get-ChildItem -Path $ExtractedDir -Include *.json,*.yaml,*.yml -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne '.overrides.yaml' }

foreach ($file in $scannedFiles) {
    $content = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    
    # Check for known secret values
    foreach ($secretValue in $KnownSecretValues) {
        if ($content -match [regex]::Escape($secretValue)) {
            $leakedSecrets += "CRITICAL: Found known secret value '$secretValue' in $($file.FullName)"
        }
    }
    
    # Check for secret patterns (connection strings, keys)
    foreach ($pattern in $SecretPatterns) {
        if ($content -match $pattern) {
            $match = $Matches[0]
            $redacted = $match.Substring(0, [Math]::Min(50, $match.Length)) + '...'
            $leakedSecrets += "CRITICAL: Found secret pattern in $($file.FullName): $redacted"
        }
    }
}

if ($leakedSecrets.Count -eq 0) {
    Write-Check "No leaked secrets found" $true
} else {
    foreach ($leak in $leakedSecrets) {
        Write-Host "🔴 $leak"
        $script:Failures += $leak
    }
    Write-Check "Secret leak scan" $false "$($leakedSecrets.Count) leaked secret(s) found"
}

Write-Host ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "Summary: $script:PassedChecks/$script:TotalChecks checks passed, $script:FailedChecks failures"

if ($script:FailedChecks -gt 0) {
    Write-Host ""
    Write-Host "Failures:"
    foreach ($failure in $script:Failures) {
        Write-Host "  • $failure"
    }
    exit 1
}

exit 0
