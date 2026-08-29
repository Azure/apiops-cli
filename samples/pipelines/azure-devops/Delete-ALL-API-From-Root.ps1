<#
.SYNOPSIS
Deletes ALL APIs, API Version Sets, Products, Subscriptions, Users, and API Tags
from an Azure API Management (APIM) instance (root or workspace scope where applicable).

!! IRREVERSIBLE OPERATION !!

Scope:
- Root: service-level resources (no workspace)
- Workspace: workspace-level resources (where supported by the resource type)

.NOTES
- API version: 2024-05-01
- Includes retry logic for DELETEs and polling of Azure-AsyncOperation (202 / async deletes).
#>

[CmdletBinding()]
param(
    # Target environment (supplied by the pipeline from the apim-<env> variable group)
    [Parameter(Mandatory = $true)]
    [string] $SubscriptionId,

    [Parameter(Mandatory = $true)]
    [string] $ResourceGroup,

    [Parameter(Mandatory = $true)]
    [string] $ApimName,

    [string] $ApiVersion = "2024-05-01",

    # Scope configuration
    #   Root      -> Deletes from service root (no workspace)
    #   Workspace -> Deletes from a specific workspace only
    [ValidateSet("Root", "Workspace")]
    [string] $ScopeType = "Root",

    # Used only if $ScopeType -eq "Workspace"
    [string] $WorkspaceId = "Pilot-Workspace-For-Export",

    # Safety toggle: $true performs deletion, $false is a dry run
    [bool] $PerformDeletion = $true,

    # Retry / async settings
    [int] $MaxDeleteRetries         = 5,
    [int] $InitialRetryDelaySeconds = 2,
    [int] $AsyncPollIntervalSeconds = 5,
    [int] $AsyncPollTimeoutSeconds  = 600   # 10 minutes max for async operations
)

function Convert-SecureStringToPlain {
    param(
        [Parameter(Mandatory)]
        [Security.SecureString] $SecureString
    )
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

function Get-AccessToken {
    if (Get-Command Get-AzAccessToken -ErrorAction SilentlyContinue) {
        try {
            $tokenObj = Get-AzAccessToken -ResourceUrl "https://management.azure.com/"
            if ($null -eq $tokenObj) {
                Write-Warning "Get-AzAccessToken returned null."
            } elseif ($tokenObj.Token) {
                $rawToken = $tokenObj.Token
                switch ($rawToken.GetType().Name) {
                    'SecureString' {
                        if (Get-Command ConvertFrom-SecureString -ErrorAction SilentlyContinue |
                            Where-Object { $_.Parameters.ContainsKey('AsPlainText') }) {
                            try {
                                return (ConvertFrom-SecureString -SecureString $rawToken -AsPlainText)
                            } catch {
                                Write-Warning "ConvertFrom-SecureString -AsPlainText failed, falling back to Marshal."
                            }
                        }
                        return Convert-SecureStringToPlain -SecureString $rawToken
                    }
                    'String' {
                        return $rawToken
                    }
                    default {
                        Write-Warning "Unexpected token type: $($rawToken.GetType().FullName). Attempting ToString()."
                        return "$rawToken"
                    }
                }
            }
        } catch {
            Write-Warning "Get-AzAccessToken failed: $($_.Exception.Message)"
        }
    }

    if (Get-Command az -ErrorAction SilentlyContinue) {
        try {
            $cliOut = az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv 2>$null
            if ($cliOut) { return $cliOut }
        } catch {
            Write-Warning "Azure CLI access token fetch failed: $($_.Exception.Message)"
        }
    }

    throw "Unable to acquire Azure access token. Use Connect-AzAccount or az login."
}

function Invoke-AzureRest {
    param(
        [Parameter(Mandatory)] [string] $Method,
        [Parameter(Mandatory)] [string] $Uri,
        [Parameter()] [object] $Body,
        [Parameter()] [hashtable] $Headers
    )
    $invokeParams = @{
        Method      = $Method
        Uri         = $Uri
        Headers     = $Headers
        ErrorAction = 'Stop'
    }
    if ($Body) {
        $invokeParams.ContentType = "application/json"
        $invokeParams.Body        = ($Body | ConvertTo-Json -Depth 10)
    }
    Invoke-RestMethod @invokeParams
}

function Get-BasePath {
    param(
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [string] $ResourceGroup,
        [Parameter(Mandatory)] [string] $ApimName,
        [Parameter(Mandatory)] [string] $ScopeType,
        [Parameter()] [string] $WorkspaceId
    )

    $base = "https://management.azure.com/subscriptions/${SubscriptionId}/resourceGroups/${ResourceGroup}/providers/Microsoft.ApiManagement/service/${ApimName}"

    if ($ScopeType -eq "Workspace") {
        if (-not $WorkspaceId) {
            throw "ScopeType is 'Workspace' but WorkspaceId is not specified."
        }
        return "${base}/workspaces/${WorkspaceId}"
    }

    return $base
}

function Get-AllPaged {
    param(
        [Parameter(Mandatory)] [string] $BaseUri,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken
    )

    $headers = @{ Authorization = "Bearer ${AccessToken}" }
    $uri     = "${BaseUri}?api-version=${ApiVersion}"

    $all = @()
    while ($uri) {
        Write-Host "Fetching page: ${uri}"
        $resp = Invoke-AzureRest -Method GET -Uri $uri -Headers $headers
        if ($resp.value) {
            $all += $resp.value
        }
        if ($resp.nextLink) {
            $uri = $resp.nextLink
        } else {
            $uri = $null
        }
    }
    return $all
}

function Wait-ForAsyncOperation {
    param(
        [Parameter(Mandatory)] [string] $AsyncOperationUrl,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $PollIntervalSeconds,
        [Parameter(Mandatory)] [int]    $TimeoutSeconds
    )

    $headers = @{ Authorization = "Bearer ${AccessToken}" }
    $start   = Get-Date

    while ($true) {
        $elapsed = (Get-Date) - $start
        if ($elapsed.TotalSeconds -ge $TimeoutSeconds) {
            throw "Async operation did not complete within ${TimeoutSeconds} seconds. Last polled URL: ${AsyncOperationUrl}"
        }

        Write-Host "Polling async operation: ${AsyncOperationUrl}"
        $resp = Invoke-AzureRest -Method GET -Uri $AsyncOperationUrl -Headers $headers

        $status = $resp.status
        if (-not $status) {
            Write-Warning "Async operation response has no 'status' field. Treating as success."
            return
        }

        Write-Host "Async status: ${status}"
        switch ($status) {
            "Succeeded" { return }
            "Failed"    { throw "Async operation failed. Response: $($resp | ConvertTo-Json -Depth 10)" }
            default     {
                Start-Sleep -Seconds $PollIntervalSeconds
            }
        }
    }
}

function Delete-WithRetry {
    param(
        [Parameter(Mandatory)] [string] $DeleteUri,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $MaxRetries,
        [Parameter(Mandatory)] [int]    $InitialDelaySeconds,
        [Parameter(Mandatory)] [string] $ResourceDescription
    )

    $headers = @{ Authorization = "Bearer ${AccessToken}" }
    $attempt = 0
    $delay   = $InitialDelaySeconds

    while ($attempt -lt $MaxRetries) {
        $attempt++
        try {
            Write-Host "DELETE ${DeleteUri}"
            $response = Invoke-WebRequest -Method DELETE -Uri $DeleteUri -Headers $headers -ErrorAction Stop

            $statusCode         = [int]$response.StatusCode
            $asyncLocation       = $response.Headers["Location"]
            $azureAsyncOperation = $response.Headers["Azure-AsyncOperation"]

            if ($statusCode -eq 202 -or $azureAsyncOperation -or $asyncLocation) {
                $pollUrl = if ($azureAsyncOperation) { $azureAsyncOperation } elseif ($asyncLocation) { $asyncLocation } else { $null }
                if ($pollUrl) {
                    Write-Host "Async delete initiated for ${ResourceDescription}. Polling: ${pollUrl}"
                    Wait-ForAsyncOperation -AsyncOperationUrl $pollUrl -AccessToken $AccessToken -PollIntervalSeconds $AsyncPollIntervalSeconds -TimeoutSeconds $AsyncPollTimeoutSeconds
                } else {
                    Write-Warning "Async delete indicated but no Azure-AsyncOperation or Location header found. Assuming success."
                }
            }

            Write-Host "[SUCCESS] Deleted ${ResourceDescription}"
            return $true
        } catch {
            $statusCode = $_.Exception.Response.StatusCode.value__ 2>$null
            $message    = $_.Exception.Message
            Write-Warning "[Attempt ${attempt}/${MaxRetries}] Failed to delete '${ResourceDescription}' - StatusCode: ${statusCode} - ${message}"

            if ($statusCode -in 429,500,502,503,504) {
                Write-Host "Transient error. Retrying in ${delay} second(s)..."
                Start-Sleep -Seconds $delay
                $delay = [int]([Math]::Min($delay * 2, 60))
                continue
            } else {
                Write-Error "Non-retriable status code (${statusCode}). Aborting delete for '${ResourceDescription}'."
                return $false
            }
        }
    }

    Write-Error "Max retries reached. Could not delete: ${ResourceDescription}"
    return $false
}

# ---------- GET helpers ----------

function Get-AllApis {
    param(
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken
    )
    $baseUri = "${BasePath}/apis"
    Get-AllPaged -BaseUri $baseUri -ApiVersion $ApiVersion -AccessToken $AccessToken
}

function Get-AllApiVersionSets {
    param(
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken
    )
    $baseUri = "${BasePath}/apiVersionSets"
    Get-AllPaged -BaseUri $baseUri -ApiVersion $ApiVersion -AccessToken $AccessToken
}

function Get-AllSubscriptions {
    param(
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken
    )
    $baseUri = "${BasePath}/subscriptions"
    Get-AllPaged -BaseUri $baseUri -ApiVersion $ApiVersion -AccessToken $AccessToken
}

function Get-AllProducts {
    param(
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken
    )
    $baseUri = "${BasePath}/products"
    Get-AllPaged -BaseUri $baseUri -ApiVersion $ApiVersion -AccessToken $AccessToken
}

function Get-AllUsers {
    param(
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [string] $ResourceGroup,
        [Parameter(Mandatory)] [string] $ApimName
    )
    # Users are service-level, not workspace-level
    $serviceBase = "https://management.azure.com/subscriptions/${SubscriptionId}/resourceGroups/${ResourceGroup}/providers/Microsoft.ApiManagement/service/${ApimName}"
    $baseUri     = "${serviceBase}/users"
    Get-AllPaged -BaseUri $baseUri -ApiVersion $ApiVersion -AccessToken $AccessToken
}

function Get-AllTags {
    param(
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [string] $ResourceGroup,
        [Parameter(Mandatory)] [string] $ApimName
    )
    # Tags are also service-level (per your example), not workspace-specific
    # GET /subscriptions/.../resourceGroups/.../providers/Microsoft.ApiManagement/service/{serviceName}/tags?api-version=...
    $serviceBase = "https://management.azure.com/subscriptions/${SubscriptionId}/resourceGroups/${ResourceGroup}/providers/Microsoft.ApiManagement/service/${ApimName}"
    $baseUri     = "${serviceBase}/tags"
    Get-AllPaged -BaseUri $baseUri -ApiVersion $ApiVersion -AccessToken $AccessToken
}

function Get-AllPolicyFragments {
    param(
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken
    )
    $baseUri = "${BasePath}/policyFragments"
    Get-AllPaged -BaseUri $baseUri -ApiVersion $ApiVersion -AccessToken $AccessToken
}

function Get-AllNamedValues {
    param(
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken
    )
    $baseUri = "${BasePath}/namedValues"
    Get-AllPaged -BaseUri $baseUri -ApiVersion $ApiVersion -AccessToken $AccessToken
}

# ---------- DELETE helpers ----------

function Delete-ApiWithRetry {
    param(
        [Parameter(Mandatory)] [string] $ApiName,
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $MaxRetries,
        [Parameter(Mandatory)] [int]    $InitialDelaySeconds
    )
    $deleteUri = "${BasePath}/apis/${ApiName}?api-version=${ApiVersion}"
    Delete-WithRetry -DeleteUri $deleteUri -AccessToken $AccessToken -MaxRetries $MaxRetries -InitialDelaySeconds $InitialDelaySeconds -ResourceDescription "API '${ApiName}'"
}

function Delete-ApiVersionSetWithRetry {
    param(
        [Parameter(Mandatory)] [string] $VersionSetId,
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $MaxRetries,
        [Parameter(Mandatory)] [int]    $InitialDelaySeconds
    )
    $deleteUri = "${BasePath}/apiVersionSets/${VersionSetId}?api-version=${ApiVersion}"
    Delete-WithRetry -DeleteUri $deleteUri -AccessToken $AccessToken -MaxRetries $MaxRetries -InitialDelaySeconds $InitialDelaySeconds -ResourceDescription "API Version Set '${VersionSetId}'"
}

function Delete-SubscriptionWithRetry {
    param(
        [Parameter(Mandatory)] [string] $SubscriptionIdApim,
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $MaxRetries,
        [Parameter(Mandatory)] [int]    $InitialDelaySeconds
    )
    $deleteUri = "${BasePath}/subscriptions/${SubscriptionIdApim}?api-version=${ApiVersion}"
    Delete-WithRetry -DeleteUri $deleteUri -AccessToken $AccessToken -MaxRetries $MaxRetries -InitialDelaySeconds $InitialDelaySeconds -ResourceDescription "Subscription '${SubscriptionIdApim}'"
}

function Delete-ProductWithRetry {
    param(
        [Parameter(Mandatory)] [string] $ProductId,
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $MaxRetries,
        [Parameter(Mandatory)] [int]    $InitialDelaySeconds
    )
    $deleteUri = "${BasePath}/products/${ProductId}?api-version=${ApiVersion}"
    Delete-WithRetry -DeleteUri $deleteUri -AccessToken $AccessToken -MaxRetries $MaxRetries -InitialDelaySeconds $InitialDelaySeconds -ResourceDescription "Product '${ProductId}'"
}

function Delete-UserWithRetry {
    param(
        [Parameter(Mandatory)] [string] $UserId,
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [string] $ResourceGroup,
        [Parameter(Mandatory)] [string] $ApimName,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $MaxRetries,
        [Parameter(Mandatory)] [int]    $InitialDelaySeconds
    )

    # DELETE https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.ApiManagement/service/{serviceName}/users/{userId}?api-version=2024-05-01
    $serviceBase = "https://management.azure.com/subscriptions/${SubscriptionId}/resourceGroups/${ResourceGroup}/providers/Microsoft.ApiManagement/service/${ApimName}"
    $deleteUri   = "${serviceBase}/users/${UserId}?api-version=${ApiVersion}"

    Delete-WithRetry -DeleteUri $deleteUri -AccessToken $AccessToken -MaxRetries $MaxRetries -InitialDelaySeconds $InitialDelaySeconds -ResourceDescription "User '${UserId}'"
}

function Delete-TagWithRetry {
    param(
        [Parameter(Mandatory)] [string] $TagId,
        [Parameter(Mandatory)] [string] $SubscriptionId,
        [Parameter(Mandatory)] [string] $ResourceGroup,
        [Parameter(Mandatory)] [string] $ApimName,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $MaxRetries,
        [Parameter(Mandatory)] [int]    $InitialDelaySeconds
    )

    # As per your example:
    # DELETE https://management.azure.com/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/Microsoft.ApiManagement/service/{serviceName}/tags/{tagId}?api-version=2024-05-01
    $serviceBase = "https://management.azure.com/subscriptions/${SubscriptionId}/resourceGroups/${ResourceGroup}/providers/Microsoft.ApiManagement/service/${ApimName}"
    $deleteUri   = "${serviceBase}/tags/${TagId}?api-version=${ApiVersion}"

    Delete-WithRetry -DeleteUri $deleteUri -AccessToken $AccessToken -MaxRetries $MaxRetries -InitialDelaySeconds $InitialDelaySeconds -ResourceDescription "Tag '${TagId}'"
}

function Delete-PolicyFragmentWithRetry {
    param(
        [Parameter(Mandatory)] [string] $PolicyFragmentId,
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $MaxRetries,
        [Parameter(Mandatory)] [int]    $InitialDelaySeconds
    )
    $deleteUri = "${BasePath}/policyFragments/${PolicyFragmentId}?api-version=${ApiVersion}"
    Delete-WithRetry -DeleteUri $deleteUri -AccessToken $AccessToken -MaxRetries $MaxRetries -InitialDelaySeconds $InitialDelaySeconds -ResourceDescription "Policy Fragment '${PolicyFragmentId}'"
}

function Delete-NamedValueWithRetry {
    param(
        [Parameter(Mandatory)] [string] $NamedValueId,
        [Parameter(Mandatory)] [string] $BasePath,
        [Parameter(Mandatory)] [string] $ApiVersion,
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [int]    $MaxRetries,
        [Parameter(Mandatory)] [int]    $InitialDelaySeconds
    )
    $deleteUri = "${BasePath}/namedValues/${NamedValueId}?api-version=${ApiVersion}"
    Delete-WithRetry -DeleteUri $deleteUri -AccessToken $AccessToken -MaxRetries $MaxRetries -InitialDelaySeconds $InitialDelaySeconds -ResourceDescription "Named Value '${NamedValueId}'"
}

# ==================== MAIN ====================

Write-Host "Starting deletion for APIM service '${ApimName}' in resource group '${ResourceGroup}' (Subscription: ${SubscriptionId})" -ForegroundColor Cyan
Write-Host "ScopeType: ${ScopeType}" -ForegroundColor Cyan
if ($ScopeType -eq "Workspace") {
    Write-Host "WorkspaceId: ${WorkspaceId}" -ForegroundColor Cyan
}
if (-not $PerformDeletion) {
    Write-Warning "PerformDeletion is FALSE. DRY RUN mode."
}

$accessToken = Get-AccessToken
if (-not $accessToken -or [string]::IsNullOrWhiteSpace($accessToken)) {
    throw "Access token acquisition succeeded but token string is empty."
}

$basePath   = Get-BasePath -SubscriptionId $SubscriptionId -ResourceGroup $ResourceGroup -ApimName $ApimName -ScopeType $ScopeType -WorkspaceId $WorkspaceId
$allResults = @()

# ---- 1) APIs ----
$apis = Get-AllApis -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken
if (-not $apis -or $apis.Count -eq 0) {
    Write-Warning "No APIs were found."
} else {
    Write-Host "Found $($apis.Count) API(s)." -ForegroundColor Green
}

foreach ($api in $apis) {
    $apiName = $api.name
    Write-Host "Processing API: ${apiName}"

    if ($PerformDeletion) {
        $deleted = Delete-ApiWithRetry -ApiName $apiName -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken -MaxRetries $MaxDeleteRetries -InitialDelaySeconds $InitialRetryDelaySeconds
    } else {
        Write-Host "[DRY RUN] Would delete API: ${apiName}"
        $deleted = $null
    }

    $allResults += [pscustomobject]@{
        Type      = 'API'
        Name      = $apiName
        Deleted   = $deleted
        Timestamp = (Get-Date).ToString("u")
    }
}

# ---- 2) API Version Sets ----
$versionSets = Get-AllApiVersionSets -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken
if (-not $versionSets -or $versionSets.Count -eq 0) {
    Write-Warning "No API Version Sets were found."
} else {
    Write-Host "Found $($versionSets.Count) API Version Set(s)." -ForegroundColor Green
}

foreach ($vs in $versionSets) {
    $vsId = $vs.name
    Write-Host "Processing API Version Set: ${vsId}"

    if ($PerformDeletion) {
        $deleted = Delete-ApiVersionSetWithRetry -VersionSetId $vsId -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken -MaxRetries $MaxDeleteRetries -InitialDelaySeconds $InitialRetryDelaySeconds
    } else {
        Write-Host "[DRY RUN] Would delete API Version Set: ${vsId}"
        $deleted = $null
    }

    $allResults += [pscustomobject]@{
        Type      = 'ApiVersionSet'
        Name      = $vsId
        Deleted   = $deleted
        Timestamp = (Get-Date).ToString("u")
    }
}

# ---- 3) Products ----
$products = Get-AllProducts -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken
if (-not $products -or $products.Count -eq 0) {
    Write-Warning "No Products were found."
} else {
    Write-Host "Found $($products.Count) Product(s)." -ForegroundColor Green
}

foreach ($p in $products) {
    $productId = $p.name
    Write-Host "Processing Product: ${productId}"

    if ($PerformDeletion) {
        $deleted = Delete-ProductWithRetry -ProductId $productId -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken -MaxRetries $MaxDeleteRetries -InitialDelaySeconds $InitialRetryDelaySeconds
    } else {
        Write-Host "[DRY RUN] Would delete Product: ${productId}"
        $deleted = $null
    }

    $allResults += [pscustomobject]@{
        Type      = 'Product'
        Name      = $productId
        Deleted   = $deleted
        Timestamp = (Get-Date).ToString("u")
    }
}

# ---- 4) Subscriptions ----
$subs = Get-AllSubscriptions -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken
if (-not $subs -or $subs.Count -eq 0) {
    Write-Warning "No Subscriptions were found."
} else {
    Write-Host "Found $($subs.Count) Subscription(s)." -ForegroundColor Green
}

foreach ($sub in $subs) {
    $sid = $sub.name
    Write-Host "Processing Subscription: ${sid}"

    if ($PerformDeletion) {
        $deleted = Delete-SubscriptionWithRetry -SubscriptionIdApim $sid -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken -MaxRetries $MaxDeleteRetries -InitialDelaySeconds $InitialRetryDelaySeconds
    } else {
        Write-Host "[DRY RUN] Would delete Subscription: ${sid}"
        $deleted = $null
    }

    $allResults += [pscustomobject]@{
        Type      = 'Subscription'
        Name      = $sid
        Deleted   = $deleted
        Timestamp = (Get-Date).ToString("u")
    }
}

# ---- 5) Users (service-level) ----
$users = Get-AllUsers -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken -SubscriptionId $SubscriptionId -ResourceGroup $ResourceGroup -ApimName $ApimName
if (-not $users -or $users.Count -eq 0) {
    Write-Warning "No Users were found."
} else {
    Write-Host "Found $($users.Count) User(s)." -ForegroundColor Green
}

foreach ($user in $users) {
    $userId = $user.name
    Write-Host "Processing User: ${userId}"

    if ($PerformDeletion) {
        $deleted = Delete-UserWithRetry -UserId $userId -SubscriptionId $SubscriptionId -ResourceGroup $ResourceGroup -ApimName $ApimName -ApiVersion $ApiVersion -AccessToken $accessToken -MaxRetries $MaxDeleteRetries -InitialDelaySeconds $InitialRetryDelaySeconds
    } else {
        Write-Host "[DRY RUN] Would delete User: ${userId}"
        $deleted = $null
    }

    $allResults += [pscustomobject]@{
        Type      = 'User'
        Name      = $userId
        Deleted   = $deleted
        Timestamp = (Get-Date).ToString("u")
    }
}

# ---- 6) Tags (service-level) ----
$tags = Get-AllTags -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken -SubscriptionId $SubscriptionId -ResourceGroup $ResourceGroup -ApimName $ApimName
if (-not $tags -or $tags.Count -eq 0) {
    Write-Warning "No Tags were found."
} else {
    Write-Host "Found $($tags.Count) Tag(s)." -ForegroundColor Green
}

foreach ($tag in $tags) {
    $tagId = $tag.name
    Write-Host "Processing Tag: ${tagId}"

    if ($PerformDeletion) {
        $deleted = Delete-TagWithRetry -TagId $tagId -SubscriptionId $SubscriptionId -ResourceGroup $ResourceGroup -ApimName $ApimName -ApiVersion $ApiVersion -AccessToken $accessToken -MaxRetries $MaxDeleteRetries -InitialDelaySeconds $InitialRetryDelaySeconds
    } else {
        Write-Host "[DRY RUN] Would delete Tag: ${tagId}"
        $deleted = $null
    }

    $allResults += [pscustomobject]@{
        Type      = 'Tag'
        Name      = $tagId
        Deleted   = $deleted
        Timestamp = (Get-Date).ToString("u")
    }
}

# ---- 7) Policy Fragments ----
# Deleted before Named Values because fragments can reference named values.
$policyFragments = Get-AllPolicyFragments -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken
if (-not $policyFragments -or $policyFragments.Count -eq 0) {
    Write-Warning "No Policy Fragments were found."
} else {
    Write-Host "Found $($policyFragments.Count) Policy Fragment(s)." -ForegroundColor Green
}

foreach ($pf in $policyFragments) {
    $pfId = $pf.name
    Write-Host "Processing Policy Fragment: ${pfId}"

    if ($PerformDeletion) {
        $deleted = Delete-PolicyFragmentWithRetry -PolicyFragmentId $pfId -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken -MaxRetries $MaxDeleteRetries -InitialDelaySeconds $InitialRetryDelaySeconds
    } else {
        Write-Host "[DRY RUN] Would delete Policy Fragment: ${pfId}"
        $deleted = $null
    }

    $allResults += [pscustomobject]@{
        Type      = 'PolicyFragment'
        Name      = $pfId
        Deleted   = $deleted
        Timestamp = (Get-Date).ToString("u")
    }
}

# ---- 8) Named Values ----
$namedValues = Get-AllNamedValues -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken
if (-not $namedValues -or $namedValues.Count -eq 0) {
    Write-Warning "No Named Values were found."
} else {
    Write-Host "Found $($namedValues.Count) Named Value(s)." -ForegroundColor Green
}

foreach ($nv in $namedValues) {
    $nvId = $nv.name
    Write-Host "Processing Named Value: ${nvId}"

    if ($PerformDeletion) {
        $deleted = Delete-NamedValueWithRetry -NamedValueId $nvId -BasePath $basePath -ApiVersion $ApiVersion -AccessToken $accessToken -MaxRetries $MaxDeleteRetries -InitialDelaySeconds $InitialRetryDelaySeconds
    } else {
        Write-Host "[DRY RUN] Would delete Named Value: ${nvId}"
        $deleted = $null
    }

    $allResults += [pscustomobject]@{
        Type      = 'NamedValue'
        Name      = $nvId
        Deleted   = $deleted
        Timestamp = (Get-Date).ToString("u")
    }
}

# ---- Summary ----
Write-Host "`nSummary:" -ForegroundColor Cyan
if ($allResults.Count -gt 0) {
    $allResults | Format-Table -AutoSize
} else {
    Write-Host "No resources processed."
}

$failed = $allResults | Where-Object { $_.Deleted -eq $false }
if ($PerformDeletion -and $failed.Count -gt 0) {
    Write-Warning "$($failed.Count) resource(s) failed to delete."
} elseif ($PerformDeletion) {
    Write-Host "All deletions completed successfully (where applicable)." -ForegroundColor Green
} else {
    Write-Host "Dry run complete. Set PerformDeletion = \$true to execute deletions." -ForegroundColor Yellow
}