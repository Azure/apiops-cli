# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
<#
.SYNOPSIS
    Compares two Azure API Management instances via ARM REST API.

.DESCRIPTION
    Enumerates child resources under each APIM instance and performs a deep
    comparison after normalizing instance-specific values. Part of the
    extract → publish round-trip integration test.

.EXAMPLE
    .\compare-apim-instances.ps1 `
      -SourceSubscriptionId "aaaa-bbbb" -SourceResourceGroup "rg-source" -SourceApimName "src-apim" `
      -TargetSubscriptionId "cccc-dddd" -TargetResourceGroup "rg-target" -TargetApimName "tgt-apim"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $SourceSubscriptionId,
    [Parameter(Mandatory)] [string] $SourceResourceGroup,
    [Parameter(Mandatory)] [string] $SourceApimName,
    [Parameter(Mandatory)] [string] $TargetSubscriptionId,
    [Parameter(Mandatory)] [string] $TargetResourceGroup,
    [Parameter(Mandatory)] [string] $TargetApimName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'modules/CompareSemantics.psm1') -Force

# ── Constants ───────────────────────────────────────────────────────────────

# Use the newest APIM ARM API version so resource types introduced in newer
# previews (e.g. apis/{api}/mcpServers under 2025-09-01-preview) are queryable.
$ApiVersion = '2025-09-01-preview'

$SourceBase = "https://management.azure.com/subscriptions/$SourceSubscriptionId/resourceGroups/$SourceResourceGroup/providers/Microsoft.ApiManagement/service/$SourceApimName"
$TargetBase = "https://management.azure.com/subscriptions/$TargetSubscriptionId/resourceGroups/$TargetResourceGroup/providers/Microsoft.ApiManagement/service/$TargetApimName"

# Fields that are instance-specific or read-only and must be stripped before comparison.
$StripTopLevelFields = @('id', 'type', 'name', 'systemData', 'etag')
$StripReadOnlyProperties = @(
    'provisioningState', 'createdAtUtc', 'lastModifiedDate',
    'isCurrent', 'isOnline', 'stateComment', 'createdDate'
)
# Timestamp properties stripped at ANY level (not just root) — these vary per publish
$StripTimestampProperties = @(
    'lastStatus',              # Key Vault named values (contains timeStampUtc)
    'specificationLastUpdated', # API specification timestamp
    'createdDateTime',         # Release/other resource creation timestamps
    'updatedDateTime'          # Release/other resource update timestamps
)

# Properties ignored on request/response objects (have 'representations' array):
# - description: WSDL/spec import generates varying descriptions
$RequestResponseIgnoredProperties = @('description')

# Properties ignored on representation objects (have 'contentType' or 'schemaId'):
# - description: SOAP/WSDL import generates descriptions that vary
# - schemaId/typeName: Operation reconciliation strips these before PATCH because
#   APIM rebinds representation schema refs during import. Values are therefore
#   not stable for round-trip comparison and are ignored for operation resources.
$RepresentationIgnoredProperties = @('description')
$RepresentationSchemaRefIgnoredProperties = @('schemaId', 'typeName')

# Cache of normalized API schema semantics per instance/api, keyed as:
# "{instance}|{apiName}" => @{ schemaId => normalizedSchemaJson }
$ApiSchemaSemanticCache = @{}

$NormalizationContext = New-CompareNormalizationContext `
    -SourceName $SourceApimName -TargetName $TargetApimName `
    -SourceSub $SourceSubscriptionId -TargetSub $TargetSubscriptionId `
    -SourceRg $SourceResourceGroup -TargetRg $TargetResourceGroup `
    -StripTopLevelFields $StripTopLevelFields `
    -StripReadOnlyProperties $StripReadOnlyProperties `
    -StripTimestampProperties $StripTimestampProperties `
    -RequestResponseIgnoredProperties $RequestResponseIgnoredProperties `
    -RepresentationIgnoredProperties $RepresentationIgnoredProperties `
    -RepresentationSchemaRefIgnoredProperties $RepresentationSchemaRefIgnoredProperties

# ── Helpers ─────────────────────────────────────────────────────────────────

function Get-ArmResourceList {
    <#
    .SYNOPSIS
        GETs a paginated ARM list, following nextLink, and returns all items.
        A 404 / "Not Found" response is treated as an empty list — optional or
        singleton child resources (e.g. apis/{api}/mcpServers) legitimately do
        not exist on every parent.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Url
    )

    $items = [System.Collections.Generic.List[object]]::new()
    $currentUrl = $Url

    while ($currentUrl) {
        $separator = if ($currentUrl -match '\?') { '&' } else { '?' }
        $fullUrl = if ($currentUrl -match 'api-version=') { $currentUrl } else { "$currentUrl${separator}api-version=$ApiVersion" }

        Write-Verbose "GET $fullUrl"
        try {
            $raw = az rest --method GET --url $fullUrl 2>&1
            if ($LASTEXITCODE -ne 0) {
                $rawText = "$raw"
                if ($rawText -match '(?i)\bNot Found\b' -or $rawText -match '"code"\s*:\s*"ResourceNotFound"' -or $rawText -match '"code"\s*:\s*"NotFound"') {
                    Write-Verbose "GET $fullUrl returned Not Found — treating as empty"
                    return $items
                }
                throw "az rest failed (exit $LASTEXITCODE): $raw"
            }
            $response = $raw | ConvertFrom-Json
        }
        catch {
            throw "ARM GET failed for $fullUrl — $_"
        }

        if ($response.PSObject.Properties['value']) {
            foreach ($item in $response.value) { $items.Add($item) }
        }

        # nextLink may not exist when there's no pagination
        $currentUrl = if ($response.PSObject.Properties['nextLink']) { $response.nextLink } else { $null }
    }

    return $items
}

function Get-ResourceName {
    <# Extracts the last segment of an ARM resource ID. #>
    param([string] $ResourceId)
    return ($ResourceId -split '/')[-1]
}

function Copy-JsonObject {
    <# Deep-clones a PSCustomObject/hashtable via JSON round-trip. #>
    param([Parameter(Mandatory)] $Value)
    return ($Value | ConvertTo-Json -Depth 100 | ConvertFrom-Json -Depth 100)
}

function Get-ApiSchemaSemanticMap {
    <#
    .SYNOPSIS
        Returns a map of { schemaId => normalized schema JSON } for one API.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $InstanceKey,
        [Parameter(Mandatory)] [string] $BaseUrl,
        [Parameter(Mandatory)] [string] $ApiName
    )

    $cacheKey = "$InstanceKey|$ApiName"
    if ($ApiSchemaSemanticCache.Contains($cacheKey)) {
        return $ApiSchemaSemanticCache[$cacheKey]
    }

    $schemaMap = @{}
    try {
        $schemas = Get-ArmResourceList -Url "$BaseUrl/apis/$ApiName/schemas"
        foreach ($schema in $schemas) {
            $schemaId = Get-ResourceName -ResourceId $schema.id
            if (-not $schemaId) { continue }

            $schemaNorm = ConvertTo-NormalizedResource -Resource $schema
            $schemaSemantics = $schemaNorm | ConvertTo-Json -Depth 50 -Compress
            $schemaMap[$schemaId] = $schemaSemantics
        }
    }
    catch {
        Write-Verbose "Could not load schemas for API $ApiName on $InstanceKey — $_"
    }

    $ApiSchemaSemanticCache[$cacheKey] = $schemaMap
    return $schemaMap
}

function Build-ResourceMap {
    <#
    .SYNOPSIS
        Builds a name-keyed map from an ARM resource list, handling exclusions and
        auto-generated 24-character hex names.

    .DESCRIPTION
        Resources whose names are 24-character lowercase hex strings are auto-generated
        by APIM (e.g. schema IDs). After an extract → publish round-trip APIM creates
        new IDs, so the names never match between source and target. These resources are
        instead keyed by their sorted position after normalising their content, producing
        stable keys like {{auto-id-0}}, {{auto-id-1}}, … that align equivalent resources
        across instances for comparison.
    #>
    param(
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Items,
        [string[]] $ExcludeNames = @(),
        [Parameter(Mandatory)] [string] $SourceName,
        [Parameter(Mandatory)] [string] $TargetName,
        [Parameter(Mandatory)] [string] $SourceSub,
        [Parameter(Mandatory)] [string] $TargetSub,
        [Parameter(Mandatory)] [string] $SourceRg,
        [Parameter(Mandatory)] [string] $TargetRg
    )

    return CompareSemantics\Build-ResourceMap -Items $Items -ExcludeNames $ExcludeNames -NormalizeResource {
        param($resource)
        ConvertTo-NormalizedResource -Resource $resource
    }
}

function ConvertTo-NormalizedPropertyValue {
    <#
    .SYNOPSIS
        Recursively normalizes a property value: replaces instance-specific
        strings, strips read-only fields, sorts arrays.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowNull()] $Value,
        [Parameter(Mandatory)] [string] $SourceName,
        [Parameter(Mandatory)] [string] $TargetName,
        [Parameter(Mandatory)] [string] $SourceSub,
        [Parameter(Mandatory)] [string] $TargetSub,
        [Parameter(Mandatory)] [string] $SourceRg,
        [Parameter(Mandatory)] [string] $TargetRg,
        [switch] $IsRoot,
        [switch] $IgnoreRepresentationSchemaRefs
    )

    return CompareSemantics\ConvertTo-NormalizedPropertyValue -Value $Value -Context $NormalizationContext -IsRoot:$IsRoot -IgnoreRepresentationSchemaRefs:$IgnoreRepresentationSchemaRefs
}

function ConvertTo-NormalizedResource {
    <#
    .SYNOPSIS
        Strips top-level ARM envelope fields and applies property normalization.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Resource
    )

    $resourceId = if ($Resource.PSObject.Properties['id']) { [string]$Resource.id } else { '' }
    $ignoreRepresentationSchemaRefs = Test-ShouldIgnoreRepresentationSchemaRefs -ResourceId $resourceId
    return CompareSemantics\ConvertTo-NormalizedResource -Resource $Resource -Context $NormalizationContext -IgnoreRepresentationSchemaRefs:$ignoreRepresentationSchemaRefs
}

function Test-ShouldIgnoreRepresentationSchemaRefs {
    <#
    .SYNOPSIS
        Returns $true for operation resources where representation schema refs
        are intentionally stripped during reconciliation PATCH.
    #>
    param([string] $ResourceId)
    return Test-IsApiOperationResource -ResourceId $ResourceId
}

function Compare-NormalizedResources {
    <#
    .SYNOPSIS
        Deep-compares two normalized resource hashtables. Returns a list of diffs.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Source,
        [Parameter(Mandatory)] $Target,
        [string] $Path = ''
    )

    return CompareSemantics\Compare-NormalizedResources -Source $Source -Target $Target -Path $Path
}

function Test-SkipSecretValue {
    <# Returns $true if this resource is a secret named value whose .value should be skipped. #>
    param($Resource)
    if (-not $Resource.PSObject.Properties['properties']) { return $false }
    $props = $Resource.properties
    if (-not $props) { return $false }
    $secret = if ($props.PSObject.Properties['secret']) { $props.secret } else { $null }
    return ($secret -eq $true)
}

function Test-SkipLoggerCredentials {
    <# Returns $true if this resource is an Event Hub or App Insights logger (credentials differ per instance). #>
    param($Resource)
    if (-not $Resource.PSObject.Properties['properties']) { return $false }
    $props = $Resource.properties
    if (-not $props) { return $false }
    $lt = if ($props.PSObject.Properties['loggerType']) { $props.loggerType } else { $null }
    return ($lt -eq 'azureEventHub' -or $lt -eq 'applicationInsights')
}

function Compare-ResourceType {
    <#
    .SYNOPSIS
        Compares a single resource type between source and target APIM.
        Returns the number of differences found.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $TypeLabel,
        [Parameter(Mandatory)] [string] $SourceUrl,
        [Parameter(Mandatory)] [string] $TargetUrl,
        [string[]] $ExcludeNames = @(),
        [switch] $SkipSecretValues,
        [switch] $SkipLoggerCreds
    )

    Write-Host "  Comparing $TypeLabel ... " -NoNewline

    # Fetch source
    try {
        $sourceItems = Get-ArmResourceList -Url $SourceUrl
    }
    catch {
        Write-Host "⚠️  SKIPPED `n`tsource query failed: $_" -ForegroundColor Yellow
        Write-Verbose "Source query error for $TypeLabel — $_"
        return @{ Diffs = 0; Compared = 0; Skipped = $true }
    }

    # Fetch target
    try {
        $targetItems = Get-ArmResourceList -Url $TargetUrl
    }
    catch {
        Write-Host "⚠️  SKIPPED `n`ttarget query failed: $_" -ForegroundColor Yellow
        Write-Verbose "Target query error for $TypeLabel — $_"
        return @{ Diffs = 0; Compared = 0; Skipped = $true }
    }

    $srcCount = @($sourceItems).Count
    $tgtCount = @($targetItems).Count
    Write-Host "[$srcCount src, $tgtCount tgt] " -NoNewline -ForegroundColor DarkGray
    Write-Verbose "$TypeLabel — fetched $srcCount source, $tgtCount target"

    # Both empty is a trivial match — no comparison needed
    if ($srcCount -eq 0 -and $tgtCount -eq 0) {
        Write-Host ""
        return @{ Diffs = 0; Compared = 0; Skipped = $false }
    }

    # Index by name, handling auto-generated 24-char hex IDs via stable content keys
    $buildParams = @{
        ExcludeNames = $ExcludeNames
        SourceName   = $SourceApimName
        TargetName   = $TargetApimName
        SourceSub    = $SourceSubscriptionId
        TargetSub    = $TargetSubscriptionId
        SourceRg     = $SourceResourceGroup
        TargetRg     = $TargetResourceGroup
    }
    $sourceMap = Build-ResourceMap -Items @($sourceItems) @buildParams
    $targetMap = Build-ResourceMap -Items @($targetItems) @buildParams

    Write-Verbose "$TypeLabel — comparing $($sourceMap.Count) source vs $($targetMap.Count) target (after exclusions)"

    $diffCount = 0
    $compared = 0
    $diffDetails = [System.Collections.Generic.List[string]]::new()

    # Missing in target
    foreach ($name in $sourceMap.Keys) {
        if (-not $targetMap.Contains($name)) {
            Write-Verbose "  Missing in target: $name"
            $diffDetails.Add("  ❌ MISSING in target: $name")
            $diffCount++
        }
    }

    # Extra in target
    foreach ($name in $targetMap.Keys) {
        if (-not $sourceMap.Contains($name)) {
            Write-Verbose "  Extra in target: $name"
            $diffDetails.Add("  ❌ EXTRA in target:   $name")
            $diffCount++
        }
    }

    # Compare matched
    foreach ($name in $sourceMap.Keys) {
        if (-not $targetMap.Contains($name)) { continue }

        Write-Verbose "  Comparing: $name"
        $srcResource = $sourceMap[$name]
        $tgtResource = $targetMap[$name]

        # For API operations, compare representation schema semantics (schema payload)
        # rather than unstable schemaId/typeName values.
        $srcId = if ($srcResource.PSObject.Properties['id']) { [string]$srcResource.id } else { '' }
        $tgtId = if ($tgtResource.PSObject.Properties['id']) { [string]$tgtResource.id } else { '' }

        if ((Test-IsApiOperationResource -ResourceId $srcId) -or (Test-IsApiOperationResource -ResourceId $tgtId)) {
            $srcWork = Copy-JsonObject -Value $srcResource
            $tgtWork = Copy-JsonObject -Value $tgtResource

            $srcApiName = Get-ApiNameFromOperationResourceId -ResourceId $srcId
            $tgtApiName = Get-ApiNameFromOperationResourceId -ResourceId $tgtId
            $apiName = if ($srcApiName) { $srcApiName } else { $tgtApiName }

            if ($apiName) {
                $srcSchemaMap = Get-ApiSchemaSemanticMap -InstanceKey 'source' -BaseUrl $SourceBase -ApiName $apiName
                $tgtSchemaMap = Get-ApiSchemaSemanticMap -InstanceKey 'target' -BaseUrl $TargetBase -ApiName $apiName

                Add-RepresentationSchemaSemantics -Resource $srcWork -SchemaSemanticMap $srcSchemaMap
                Add-RepresentationSchemaSemantics -Resource $tgtWork -SchemaSemanticMap $tgtSchemaMap
            }

            $srcNorm = ConvertTo-NormalizedResource -Resource $srcWork
            $tgtNorm = ConvertTo-NormalizedResource -Resource $tgtWork
        }
        else {
            $srcNorm = ConvertTo-NormalizedResource -Resource $srcResource
            $tgtNorm = ConvertTo-NormalizedResource -Resource $tgtResource
        }

        # Skip secret named-value .value
        if ($SkipSecretValues -and (Test-SkipSecretValue $srcResource)) {
            Write-Verbose "    Skipping secret value for: $name"
            if ($srcNorm.Contains('properties') -and $srcNorm['properties'] -is [System.Collections.IDictionary]) {
                $srcNorm['properties'].Remove('value') | Out-Null
            }
            if ($tgtNorm.Contains('properties') -and $tgtNorm['properties'] -is [System.Collections.IDictionary]) {
                $tgtNorm['properties'].Remove('value') | Out-Null
            }
        }

        # Skip Event Hub logger credentials (connection strings differ per instance)
        if ($SkipLoggerCreds -and (Test-SkipLoggerCredentials $srcResource)) {
            Write-Verbose "    Skipping logger credentials for: $name"
            if ($srcNorm.Contains('properties') -and $srcNorm['properties'] -is [System.Collections.IDictionary]) {
                $srcNorm['properties'].Remove('credentials') | Out-Null
            }
            if ($tgtNorm.Contains('properties') -and $tgtNorm['properties'] -is [System.Collections.IDictionary]) {
                $tgtNorm['properties'].Remove('credentials') | Out-Null
            }
        }

        $diffs = Compare-NormalizedResources -Source $srcNorm -Target $tgtNorm
        $diffCount2 = if ($diffs -is [System.Collections.IEnumerable] -and $diffs -isnot [string]) { @($diffs).Count } else { 0 }
        $compared++

        if ($diffCount2 -gt 0) {
            Write-Verbose "    Found $diffCount2 diff(s) in: $name"
            $diffCount++
            $diffDetails.Add("  ❌ $name")
            foreach ($d in $diffs) { 
                if ($d -is [string] -and $d.Trim()) { $diffDetails.Add($d) }
            }
        }
        else {
            Write-Verbose "    ✓ $name matches"
        }
    }

    if ($diffCount -eq 0) {
        $total = $sourceMap.Count
        Write-Host "✅ ($total resources)" -ForegroundColor Green
    }
    else {
        Write-Host "❌ $diffCount difference(s)" -ForegroundColor Red
        foreach ($line in $diffDetails) { Write-Host $line -ForegroundColor Red }
    }

    return @{ Diffs = $diffCount; Compared = $compared; Skipped = $false }
}

# ── Main comparison orchestration ───────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         APIM Instance Comparison                             ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host "  Source: $SourceApimName ($SourceResourceGroup)" -ForegroundColor Cyan
Write-Host "  Target: $TargetApimName ($TargetResourceGroup)" -ForegroundColor Cyan
Write-Host ""

$totalDiffs = 0
$totalCompared = 0
$totalTypes = 0
$skippedTypes = 0

try {

    # ── Top-level resource types ────────────────────────────────────────────

    $topLevelTypes = @(
        @{ Label = 'Named Values';       Suffix = 'namedValues';      Exclude = @(); SkipSecret = $true  }
        @{ Label = 'Tags';               Suffix = 'tags';             Exclude = @()                      }
        @{ Label = 'Gateways';           Suffix = 'gateways';         Exclude = @()                      }
        @{ Label = 'API Version Sets';   Suffix = 'apiVersionSets';   Exclude = @()                      }
        @{ Label = 'Backends';           Suffix = 'backends';         Exclude = @()                      }
        @{ Label = 'Groups';             Suffix = 'groups';           Exclude = @('administrators', 'developers', 'guests') }
        @{ Label = 'Policy Fragments';   Suffix = 'policyFragments';  Exclude = @()                      }
        @{ Label = 'Global Schemas';     Suffix = 'schemas';          Exclude = @()                      }
        @{ Label = 'Loggers';            Suffix = 'loggers';          Exclude = @(); SkipLoggerCreds = $true }
        @{ Label = 'Diagnostics';        Suffix = 'diagnostics';      Exclude = @()                      }
        @{ Label = 'Service Policy';     Suffix = 'policies';         Exclude = @()                      }
        @{ Label = 'Subscriptions';      Suffix = 'subscriptions';    Exclude = @('master')              }
        @{ Label = 'Workspaces';         Suffix = 'workspaces';       Exclude = @()                      }
        @{ Label = 'Documentations';     Suffix = 'documentations';   Exclude = @()                      }
        @{ Label = 'Policy Restrictions'; Suffix = 'policyRestrictions'; Exclude = @()                   }
    )

    Write-Host "── Top-level resources ──" -ForegroundColor White

    foreach ($rt in $topLevelTypes) {
        $params = @{
            TypeLabel  = $rt.Label
            SourceUrl  = "$SourceBase/$($rt.Suffix)"
            TargetUrl  = "$TargetBase/$($rt.Suffix)"
            ExcludeNames = $rt.Exclude
        }
        if ($rt.ContainsKey('SkipSecret') -and $rt.SkipSecret)         { $params['SkipSecretValues'] = $true }
        if ($rt.ContainsKey('SkipLoggerCreds') -and $rt.SkipLoggerCreds) { $params['SkipLoggerCreds'] = $true }

        $result = Compare-ResourceType @params
        $totalTypes++
        $totalDiffs += $result.Diffs
        $totalCompared += $result.Compared
        if ($result.Skipped) { $skippedTypes++ }
    }

    # ── APIs and their children ─────────────────────────────────────────────

    Write-Host ""
    Write-Host "── APIs ──" -ForegroundColor White

    $apiResult = Compare-ResourceType -TypeLabel 'APIs' `
        -SourceUrl "$SourceBase/apis" -TargetUrl "$TargetBase/apis" `
        -ExcludeNames @('echo-api')
    $totalTypes++
    $totalDiffs += $apiResult.Diffs
    $totalCompared += $apiResult.Compared

    # Enumerate APIs from source to compare child resources
    try {
        $sourceApis = Get-ArmResourceList -Url "$SourceBase/apis"
        $apiNames = @(foreach ($api in $sourceApis) {
            $n = Get-ResourceName -ResourceId $api.id
            if ($n -ne 'echo-api') { $n }
        })
    }
    catch {
        Write-Host "  ⚠️  Could not enumerate APIs for child comparison: $_" -ForegroundColor Yellow
        $apiNames = @()
    }

    $apiChildTypes = @(
        @{ Label = 'Operations';      Suffix = 'operations'      }
        @{ Label = 'Policies';        Suffix = 'policies'        }
        @{ Label = 'Schemas';         Suffix = 'schemas'         }
        @{ Label = 'Tags';            Suffix = 'tags'            }
        @{ Label = 'Diagnostics';     Suffix = 'diagnostics'     }
        @{ Label = 'Resolvers';       Suffix = 'resolvers'       }
        @{ Label = 'Releases';        Suffix = 'releases'        }
        @{ Label = 'Wikis';           Suffix = 'wikis'           }
        @{ Label = 'Tag Descriptions'; Suffix = 'tagDescriptions' }
        # NOTE: 'mcpServers' is intentionally omitted. ARM does not expose a
        # list collection at apis/{api}/mcpServers (returns HTTP 500), and the
        # singleton apis/{api}/mcpServers/default returns 404 even on working
        # MCP APIs. MCP server configuration (mcpProperties, mcpTools,
        # backendId) lives on the parent API resource and is verified by the
        # top-level "Comparing APIs" deep comparison above.
    )

    foreach ($apiName in $apiNames) {
        Write-Host "  API: $apiName" -ForegroundColor DarkCyan

        foreach ($child in $apiChildTypes) {
            $result = Compare-ResourceType `
                -TypeLabel "  API/$apiName/$($child.Label)" `
                -SourceUrl "$SourceBase/apis/$apiName/$($child.Suffix)" `
                -TargetUrl "$TargetBase/apis/$apiName/$($child.Suffix)"
            $totalTypes++
            $totalDiffs += $result.Diffs
            $totalCompared += $result.Compared
            if ($result.Skipped) { $skippedTypes++ }
        }

        # API Operation Policies — enumerate operations then check each
        try {
            $ops = Get-ArmResourceList -Url "$SourceBase/apis/$apiName/operations"
            foreach ($op in $ops) {
                $opName = Get-ResourceName -ResourceId $op.id
                $result = Compare-ResourceType `
                    -TypeLabel "  API/$apiName/operations/$opName/Policies" `
                    -SourceUrl "$SourceBase/apis/$apiName/operations/$opName/policies" `
                    -TargetUrl "$TargetBase/apis/$apiName/operations/$opName/policies"
                $totalTypes++
                $totalDiffs += $result.Diffs
                $totalCompared += $result.Compared
                if ($result.Skipped) { $skippedTypes++ }
            }
        }
        catch {
            Write-Verbose "Could not enumerate operations for API $apiName — $_"
        }

        # API Resolver Policies — enumerate resolvers then check each
        try {
            $resolvers = Get-ArmResourceList -Url "$SourceBase/apis/$apiName/resolvers"
            foreach ($resolver in $resolvers) {
                $resolverName = Get-ResourceName -ResourceId $resolver.id
                $result = Compare-ResourceType `
                    -TypeLabel "  API/$apiName/resolvers/$resolverName/Policies" `
                    -SourceUrl "$SourceBase/apis/$apiName/resolvers/$resolverName/policies" `
                    -TargetUrl "$TargetBase/apis/$apiName/resolvers/$resolverName/policies"
                $totalTypes++
                $totalDiffs += $result.Diffs
                $totalCompared += $result.Compared
                if ($result.Skipped) { $skippedTypes++ }
            }
        }
        catch {
            Write-Verbose "Could not enumerate resolvers for API $apiName — $_"
        }
    }

    # ── Products and their children ─────────────────────────────────────────

    Write-Host ""
    Write-Host "── Products ──" -ForegroundColor White

    $productChildTypes = @(
        @{ Label = 'Policies'; Suffix = 'policies' }
        @{ Label = 'APIs';     Suffix = 'apis'     }
        @{ Label = 'Groups';   Suffix = 'groups'   }
        @{ Label = 'Tags';     Suffix = 'tags'     }
        @{ Label = 'Wikis';    Suffix = 'wikis'    }
    )

    try {
        $sourceProducts = Get-ArmResourceList -Url "$SourceBase/products"
        $productNames = @(foreach ($p in $sourceProducts) {
            $n = Get-ResourceName -ResourceId $p.id
            if ($n -notin @('starter', 'unlimited')) { $n }
        })
    }
    catch {
        Write-Host "  ⚠️  Could not enumerate products: $_" -ForegroundColor Yellow
        $productNames = @()
    }

    foreach ($productName in $productNames) {
        Write-Host "  Product: $productName" -ForegroundColor DarkCyan

        foreach ($child in $productChildTypes) {
            $result = Compare-ResourceType `
                -TypeLabel "  Product/$productName/$($child.Label)" `
                -SourceUrl "$SourceBase/products/$productName/$($child.Suffix)" `
                -TargetUrl "$TargetBase/products/$productName/$($child.Suffix)"
            $totalTypes++
            $totalDiffs += $result.Diffs
            $totalCompared += $result.Compared
            if ($result.Skipped) { $skippedTypes++ }
        }
    }

    # ── Gateways and their child APIs ───────────────────────────────────────

    Write-Host ""
    Write-Host "── Gateway APIs ──" -ForegroundColor White

    try {
        $sourceGateways = Get-ArmResourceList -Url "$SourceBase/gateways"
        foreach ($gw in $sourceGateways) {
            $gwName = Get-ResourceName -ResourceId $gw.id
            Write-Host "  Gateway: $gwName" -ForegroundColor DarkCyan

            $result = Compare-ResourceType `
                -TypeLabel "  Gateway/$gwName/APIs" `
                -SourceUrl "$SourceBase/gateways/$gwName/apis" `
                -TargetUrl "$TargetBase/gateways/$gwName/apis"
            $totalTypes++
            $totalDiffs += $result.Diffs
            $totalCompared += $result.Compared
            if ($result.Skipped) { $skippedTypes++ }
        }
    }
    catch {
        Write-Host "  ⚠️  Gateways not available (v2 SKU?): $_" -ForegroundColor Yellow
    }

    # ── Workspaces and their children ───────────────────────────────────────

    Write-Host ""
    Write-Host "── Workspace children ──" -ForegroundColor White

    try {
        $sourceWorkspaces = Get-ArmResourceList -Url "$SourceBase/workspaces"
        foreach ($ws in $sourceWorkspaces) {
            $wsName = Get-ResourceName -ResourceId $ws.id
            Write-Host "  Workspace: $wsName" -ForegroundColor DarkCyan

            # Compare common workspace child resource types
            $wsChildTypes = @(
                'apis', 'products', 'backends', 'namedValues', 'tags',
                'groups', 'policyFragments', 'schemas', 'loggers',
                'diagnostics', 'policies', 'subscriptions', 'apiVersionSets'
            )

            foreach ($wsChild in $wsChildTypes) {
                $result = Compare-ResourceType `
                    -TypeLabel "  Workspace/$wsName/$wsChild" `
                    -SourceUrl "$SourceBase/workspaces/$wsName/$wsChild" `
                    -TargetUrl "$TargetBase/workspaces/$wsName/$wsChild"
                $totalTypes++
                $totalDiffs += $result.Diffs
                $totalCompared += $result.Compared
                if ($result.Skipped) { $skippedTypes++ }
            }

            # Compare workspace product associations via link APIs
            # Classic endpoints (products/{p}/apis, products/{p}/tags) return HTTP 500
            # in workspace scope; use the link endpoints instead.
            try {
                $wsProducts = Get-ArmResourceList -Url "$SourceBase/workspaces/$wsName/products"
                foreach ($wsProd in $wsProducts) {
                    $wsProdName = Get-ResourceName -ResourceId $wsProd.id
                    Write-Host "  Workspace/$wsName/Product: $wsProdName" -ForegroundColor DarkCyan

                    # Product → API associations via apiLinks
                    $result = Compare-ResourceType `
                        -TypeLabel "  Workspace/$wsName/Product/$wsProdName/apiLinks" `
                        -SourceUrl "$SourceBase/workspaces/$wsName/products/$wsProdName/apiLinks" `
                        -TargetUrl "$TargetBase/workspaces/$wsName/products/$wsProdName/apiLinks"
                    $totalTypes++
                    $totalDiffs += $result.Diffs
                    $totalCompared += $result.Compared
                    if ($result.Skipped) { $skippedTypes++ }
                }
            }
            catch {
                Write-Verbose "Could not enumerate workspace products for $wsName — $_"
            }

            # Compare workspace product ↔ tag associations via productLinks
            try {
                $wsTags = Get-ArmResourceList -Url "$SourceBase/workspaces/$wsName/tags"
                foreach ($wsTagItem in $wsTags) {
                    $wsTagName = Get-ResourceName -ResourceId $wsTagItem.id
                    Write-Host "  Workspace/$wsName/Tag: $wsTagName" -ForegroundColor DarkCyan

                    # Tag → Product associations via productLinks
                    $result = Compare-ResourceType `
                        -TypeLabel "  Workspace/$wsName/Tag/$wsTagName/productLinks" `
                        -SourceUrl "$SourceBase/workspaces/$wsName/tags/$wsTagName/productLinks" `
                        -TargetUrl "$TargetBase/workspaces/$wsName/tags/$wsTagName/productLinks"
                    $totalTypes++
                    $totalDiffs += $result.Diffs
                    $totalCompared += $result.Compared
                    if ($result.Skipped) { $skippedTypes++ }

                    # Tag → API associations via apiLinks
                    $result = Compare-ResourceType `
                        -TypeLabel "  Workspace/$wsName/Tag/$wsTagName/apiLinks" `
                        -SourceUrl "$SourceBase/workspaces/$wsName/tags/$wsTagName/apiLinks" `
                        -TargetUrl "$TargetBase/workspaces/$wsName/tags/$wsTagName/apiLinks"
                    $totalTypes++
                    $totalDiffs += $result.Diffs
                    $totalCompared += $result.Compared
                    if ($result.Skipped) { $skippedTypes++ }
                }
            }
            catch {
                Write-Verbose "Could not enumerate workspace tags for $wsName — $_"
            }
        }
    }
    catch {
        Write-Host "  ⚠️  Workspaces not available (requires Premium, StandardV2, or PremiumV2): $_" -ForegroundColor Yellow
    }

    # ── Summary ─────────────────────────────────────────────────────────────

    Write-Host ""
    Write-Host "══════════════════════════════════════════════════════════════" -ForegroundColor Cyan

    if ($totalDiffs -eq 0) {
        Write-Host "✅ PASS — $totalTypes resource types compared, $totalCompared total resources matched" -ForegroundColor Green
        if ($skippedTypes -gt 0) {
            Write-Host "   ($skippedTypes type(s) skipped due to query failures)" -ForegroundColor Yellow
        }
        exit 0
    }
    else {
        Write-Host "❌ FAIL — $totalDiffs difference(s) found across $totalTypes resource types ($totalCompared resources compared)" -ForegroundColor Red
        if ($skippedTypes -gt 0) {
            Write-Host "   ($skippedTypes type(s) skipped due to query failures)" -ForegroundColor Yellow
        }
        exit 1
    }
}
catch {
    Write-Host ""
    Write-Host "💥 ERROR — $_" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed
    exit 2
}
