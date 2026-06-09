# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
Deep-clones a PSCustomObject/hashtable via JSON round-trip.

.PARAMETER Value
Object to clone.

.OUTPUTS
System.Object
#>
function Copy-JsonObject {
    param([Parameter(Mandatory)] $Value)
    return ($Value | ConvertTo-Json -Depth 100 | ConvertFrom-Json -Depth 100)
}

<#
.SYNOPSIS
Gets a property value from hashtable or PSCustomObject.

.PARAMETER Object
Source object.

.PARAMETER Name
Property name.

.OUTPUTS
System.Object
#>
function Get-ObjectPropertyValue {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)] [string] $Name
    )

    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }

    if ($Object -is [PSCustomObject]) {
        $p = $Object.PSObject.Properties[$Name]
        if ($p) { return $p.Value }
        return $null
    }

    return $null
}

<#
.SYNOPSIS
Sets a property value on hashtable or PSCustomObject.

.PARAMETER Object
Target object.

.PARAMETER Name
Property name.

.PARAMETER Value
Property value.

.OUTPUTS
None
#>
function Set-ObjectPropertyValue {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)] [string] $Name,
        [AllowNull()] $Value
    )

    if ($Object -is [System.Collections.IDictionary]) {
        $Object[$Name] = $Value
        return
    }

    if ($Object -is [PSCustomObject]) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    }
}

<#
.SYNOPSIS
Returns true when a resource ID points at an API operation resource.

.PARAMETER ResourceId
ARM resource ID.

.OUTPUTS
System.Boolean
#>
function Test-IsApiOperationResource {
    param([string] $ResourceId)
    if (-not $ResourceId) { return $false }
    return $ResourceId -match '/apis/[^/]+/operations/[^/]+$'
}

<#
.SYNOPSIS
Extracts API name from an API operation ARM resource ID.

.PARAMETER ResourceId
ARM resource ID.

.OUTPUTS
System.String
#>
function Get-ApiNameFromOperationResourceId {
    param([string] $ResourceId)
    if (-not $ResourceId) { return $null }
    if ($ResourceId -notmatch '/apis/([^/]+)/operations/[^/]+$') { return $null }
    return $Matches[1]
}

<#
.SYNOPSIS
Adds representation schema semantic tokens using schemaId->semantic map.

.DESCRIPTION
Annotates request/response representations with __schemaSemantic to enable
comparison by schema content rather than unstable schemaId/typeName values.

.PARAMETER Resource
Operation resource object (PSCustomObject/hashtable).

.PARAMETER SchemaSemanticMap
Hashtable mapping schemaId to normalized schema semantic string.

.OUTPUTS
None
#>
function Add-RepresentationSchemaSemantics {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Resource,
        [Parameter(Mandatory)] [hashtable] $SchemaSemanticMap
    )

    $properties = Get-ObjectPropertyValue -Object $Resource -Name 'properties'
    if (-not $properties) { return }

    function Set-RepresentationSemanticToken {
        param([AllowNull()] $Representation)

        if (-not $Representation) { return }
        if ($Representation -isnot [PSCustomObject] -and $Representation -isnot [System.Collections.IDictionary]) { return }

        $schemaId = Get-ObjectPropertyValue -Object $Representation -Name 'schemaId'
        if (-not $schemaId) { return }

        $semantic = if ($SchemaSemanticMap.Contains($schemaId)) {
            $SchemaSemanticMap[$schemaId]
        }
        else {
            "{{missing-schema:$schemaId}}"
        }

        Set-ObjectPropertyValue -Object $Representation -Name '__schemaSemantic' -Value $semantic
    }

    $request = Get-ObjectPropertyValue -Object $properties -Name 'request'
    if ($request) {
        $reqReps = Get-ObjectPropertyValue -Object $request -Name 'representations'
        if ($reqReps -is [System.Collections.IEnumerable] -and $reqReps -isnot [string]) {
            foreach ($rep in $reqReps) { Set-RepresentationSemanticToken -Representation $rep }
        }
    }

    $responses = Get-ObjectPropertyValue -Object $properties -Name 'responses'
    if ($responses -is [System.Collections.IEnumerable] -and $responses -isnot [string]) {
        foreach ($response in $responses) {
            $respReps = Get-ObjectPropertyValue -Object $response -Name 'representations'
            if ($respReps -is [System.Collections.IEnumerable] -and $respReps -isnot [string]) {
                foreach ($rep in $respReps) { Set-RepresentationSemanticToken -Representation $rep }
            }
        }
    }
}

function New-CompareNormalizationContext {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $SourceName,
        [Parameter(Mandatory)] [string] $TargetName,
        [Parameter(Mandatory)] [string] $SourceSub,
        [Parameter(Mandatory)] [string] $TargetSub,
        [Parameter(Mandatory)] [string] $SourceRg,
        [Parameter(Mandatory)] [string] $TargetRg,
        [string[]] $StripTopLevelFields = @(),
        [string[]] $StripReadOnlyProperties = @(),
        [string[]] $StripTimestampProperties = @(),
        [string[]] $RequestResponseIgnoredProperties = @(),
        [string[]] $RepresentationIgnoredProperties = @(),
        [string[]] $RepresentationSchemaRefIgnoredProperties = @()
    )

    return [ordered]@{
        SourceName = $SourceName
        TargetName = $TargetName
        SourceSub = $SourceSub
        TargetSub = $TargetSub
        SourceRg = $SourceRg
        TargetRg = $TargetRg
        StripTopLevelFields = $StripTopLevelFields
        StripReadOnlyProperties = $StripReadOnlyProperties
        StripTimestampProperties = $StripTimestampProperties
        RequestResponseIgnoredProperties = $RequestResponseIgnoredProperties
        RepresentationIgnoredProperties = $RepresentationIgnoredProperties
        RepresentationSchemaRefIgnoredProperties = $RepresentationSchemaRefIgnoredProperties
    }
}

function Get-ResourceNameFromId {
    param([string] $ResourceId)
    if (-not $ResourceId) { return $null }
    return ($ResourceId -split '/')[-1]
}

function ConvertTo-NormalizedPropertyValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowNull()] $Value,
        [Parameter(Mandatory)] [hashtable] $Context,
        [switch] $IsRoot,
        [switch] $IgnoreRepresentationSchemaRefs
    )

    if ($null -eq $Value) { return $null }

    if ($Value -is [string]) {
        $s = $Value
        $s = $s -replace [regex]::Escape("/subscriptions/$($Context.SourceSub)/resourceGroups/$($Context.SourceRg)/providers/Microsoft.ApiManagement/service/$($Context.SourceName)"), '/subscriptions/{{sub}}/resourceGroups/{{rg}}/providers/Microsoft.ApiManagement/service/{{apim-name}}'
        $s = $s -replace [regex]::Escape("/subscriptions/$($Context.TargetSub)/resourceGroups/$($Context.TargetRg)/providers/Microsoft.ApiManagement/service/$($Context.TargetName)"), '/subscriptions/{{sub}}/resourceGroups/{{rg}}/providers/Microsoft.ApiManagement/service/{{apim-name}}'
        $s = $s -replace [regex]::Escape("/subscriptions/$($Context.SourceSub)/resourceGroups/$($Context.SourceRg)"), '/subscriptions/{{sub}}/resourceGroups/{{rg}}'
        $s = $s -replace [regex]::Escape("/subscriptions/$($Context.TargetSub)/resourceGroups/$($Context.TargetRg)"), '/subscriptions/{{sub}}/resourceGroups/{{rg}}'
        $s = $s -replace [regex]::Escape("/subscriptions/$($Context.SourceSub)"), '/subscriptions/{{sub}}'
        $s = $s -replace [regex]::Escape("/subscriptions/$($Context.TargetSub)"), '/subscriptions/{{sub}}'
        $s = $s -replace [regex]::Escape($Context.SourceName), '{{apim-name}}'
        $s = $s -replace [regex]::Escape($Context.TargetName), '{{apim-name}}'
        $s = $s -replace 'https://[a-zA-Z0-9-]+\.vault\.azure\.net', 'https://{{keyvault}}.vault.azure.net'
        $s = $s -replace '/secrets/(src|tgt)-', '/secrets/{{prefix}}-'
        $s = $s -replace '/providers/Microsoft\.Insights/components/[a-zA-Z0-9-]+', '/providers/Microsoft.Insights/components/{{appinsights}}'
        $s = $s -replace '/providers/Microsoft\.EventHub/namespaces/[a-zA-Z0-9-]+', '/providers/Microsoft.EventHub/namespaces/{{eventhub}}'
        $s = $s -replace '\b[0-9a-f]{24}\b', '{{auto-id}}'
        $s = $s -replace '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '{{guid}}'
        return $s
    }

    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string] -and $Value -isnot [System.Collections.IDictionary]) {
        $normalized = @(foreach ($item in $Value) {
            ConvertTo-NormalizedPropertyValue -Value $item -Context $Context -IgnoreRepresentationSchemaRefs:$IgnoreRepresentationSchemaRefs
        })
        $sorted = $normalized | Sort-Object { ($_ | ConvertTo-Json -Depth 50 -Compress) }
        return @($sorted)
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $out = [ordered]@{}
        $isRequestResponse = $Value.Contains('representations')
        $isRepresentation = $Value.Contains('contentType') -or $Value.Contains('schemaId')
        foreach ($key in ($Value.Keys | Sort-Object)) {
            if ($IsRoot -and $key -in $Context.StripReadOnlyProperties) { continue }
            if ($key -in $Context.StripTimestampProperties) { continue }
            if ($isRequestResponse -and $key -in $Context.RequestResponseIgnoredProperties) { continue }
            if ($isRepresentation -and $key -in $Context.RepresentationIgnoredProperties) { continue }
            if ($IgnoreRepresentationSchemaRefs -and $isRepresentation -and $key -in $Context.RepresentationSchemaRefIgnoredProperties) { continue }
            $out[$key] = ConvertTo-NormalizedPropertyValue -Value $Value[$key] -Context $Context -IgnoreRepresentationSchemaRefs:$IgnoreRepresentationSchemaRefs
        }
        return $out
    }

    if ($Value -is [PSCustomObject]) {
        $out = [ordered]@{}
        $isRequestResponse = $null -ne ($Value.PSObject.Properties | Where-Object { $_.Name -eq 'representations' })
        $isRepresentation = $null -ne ($Value.PSObject.Properties | Where-Object { $_.Name -eq 'contentType' -or $_.Name -eq 'schemaId' })
        foreach ($prop in ($Value.PSObject.Properties | Sort-Object Name)) {
            if ($IsRoot -and $prop.Name -in $Context.StripReadOnlyProperties) { continue }
            if ($prop.Name -in $Context.StripTimestampProperties) { continue }
            if ($isRequestResponse -and $prop.Name -in $Context.RequestResponseIgnoredProperties) { continue }
            if ($isRepresentation -and $prop.Name -in $Context.RepresentationIgnoredProperties) { continue }
            if ($IgnoreRepresentationSchemaRefs -and $isRepresentation -and $prop.Name -in $Context.RepresentationSchemaRefIgnoredProperties) { continue }
            $out[$prop.Name] = ConvertTo-NormalizedPropertyValue -Value $prop.Value -Context $Context -IgnoreRepresentationSchemaRefs:$IgnoreRepresentationSchemaRefs
        }
        return $out
    }

    return $Value
}

function ConvertTo-NormalizedResource {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Resource,
        [Parameter(Mandatory)] [hashtable] $Context,
        [switch] $IgnoreRepresentationSchemaRefs
    )

    $clone = [ordered]@{}
    foreach ($prop in $Resource.PSObject.Properties) {
        if ($prop.Name -in $Context.StripTopLevelFields) { continue }
        $clone[$prop.Name] = $prop.Value
    }

    if ($clone.Contains('properties')) {
        $clone['properties'] = ConvertTo-NormalizedPropertyValue -Value $clone['properties'] -Context $Context -IsRoot -IgnoreRepresentationSchemaRefs:$IgnoreRepresentationSchemaRefs
    }

    foreach ($key in @($clone.Keys)) {
        if ($key -eq 'properties') { continue }
        $clone[$key] = ConvertTo-NormalizedPropertyValue -Value $clone[$key] -Context $Context -IgnoreRepresentationSchemaRefs:$IgnoreRepresentationSchemaRefs
    }

    return $clone
}

function Build-ResourceMap {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [AllowEmptyCollection()] [object[]] $Items,
        [string[]] $ExcludeNames = @(),
        [Parameter(Mandatory)] [scriptblock] $NormalizeResource
    )

    $map = [ordered]@{}
    if ($null -eq $Items -or $Items.Count -eq 0) { return $map }

    $autoIdItems = [System.Collections.Generic.List[object]]::new()
    foreach ($item in $Items) {
        $rName = Get-ResourceNameFromId -ResourceId $item.id
        if ($rName -in $ExcludeNames) { continue }

        if ($rName -match '^[0-9a-f]{24}$' -or $rName -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
            $autoIdItems.Add($item)
        }
        else {
            $map[$rName] = $item
        }
    }

    if ($autoIdItems.Count -gt 0) {
        $sorted = $autoIdItems | Sort-Object {
            $normResource = & $NormalizeResource $_
            $normResource | ConvertTo-Json -Depth 50 -Compress
        }
        $i = 0
        foreach ($item in $sorted) {
            $map["{{auto-id-$i}}"] = $item
            $i++
        }
    }

    return $map
}

function Compare-NormalizedResources {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Source,
        [Parameter(Mandatory)] $Target,
        [string] $Path = ''
    )

    $diffs = [System.Collections.Generic.List[string]]::new()
    $sourceJson = $Source | ConvertTo-Json -Depth 50 -Compress
    $targetJson = $Target | ConvertTo-Json -Depth 50 -Compress
    if ($sourceJson -eq $targetJson) { return ,$diffs }

    $allKeys = @()
    if ($Source -is [System.Collections.IDictionary]) { $allKeys += $Source.Keys }
    if ($Target -is [System.Collections.IDictionary]) { $allKeys += $Target.Keys }
    $allKeys = $allKeys | Select-Object -Unique | Sort-Object

    foreach ($key in $allKeys) {
        $currentPath = if ($Path) { "$Path.$key" } else { $key }
        $hasSource = $Source -is [System.Collections.IDictionary] -and $Source.Contains($key)
        $hasTarget = $Target -is [System.Collections.IDictionary] -and $Target.Contains($key)

        if ($hasSource -and -not $hasTarget) { $diffs.Add("  MISSING in target: $currentPath"); continue }
        if (-not $hasSource -and $hasTarget) { $diffs.Add("  EXTRA in target:   $currentPath"); continue }

        $sv = $Source[$key]
        $tv = $Target[$key]
        $svJson = $sv | ConvertTo-Json -Depth 50 -Compress
        $tvJson = $tv | ConvertTo-Json -Depth 50 -Compress

        if ($svJson -ne $tvJson) {
            if ($sv -is [System.Collections.IDictionary] -and $tv -is [System.Collections.IDictionary]) {
                $sub = Compare-NormalizedResources -Source $sv -Target $tv -Path $currentPath
                if ($sub -is [System.Collections.IEnumerable] -and $sub -isnot [string]) {
                    foreach ($d in $sub) { $diffs.Add($d) }
                }
            }
            else {
                $diffs.Add("  DIFF at $currentPath`n    source: $svJson`n    target: $tvJson")
            }
        }
    }

    if ($diffs.Count -eq 0) {
        $pathPrefix = if ($Path) { "${Path}: " } else { '' }
        $diffs.Add("  ${pathPrefix}JSON differs`n    source: $sourceJson`n    target: $targetJson")
    }

    return ,$diffs
}

Export-ModuleMember -Function Test-IsApiOperationResource, Get-ApiNameFromOperationResourceId, Add-RepresentationSchemaSemantics, New-CompareNormalizationContext, ConvertTo-NormalizedPropertyValue, ConvertTo-NormalizedResource, Build-ResourceMap, Compare-NormalizedResources