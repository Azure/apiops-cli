# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#requires -Version 7.0

[CmdletBinding()]
param(
    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'

$integrationRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$scriptArgModule = Join-Path (Join-Path $integrationRoot 'shared/modules') 'ScriptRuntime.psm1'
if (-not (Test-Path $scriptArgModule)) {
    Write-Error "Required file not found: $scriptArgModule"
    exit 2
}
Import-Module $scriptArgModule -Force
Set-ScriptLogPreferences -LogLevel $LogLevel

$redactionMarker = '*** REDACTED ***'
# Keep this split so CI log scrubbing does not rewrite the expected literal.
$expectedBearerNamedValueReference = ('Be' + 'arer {{rs-nv-secret}}')

function Assert-PathExists {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        throw "Expected path not found: $Path"
    }
    Write-Verbose "  [path] exists: $Path"
}

function Assert-Contains {
    param([string]$Path, [string]$Expected)
    $content = Get-Content -Path $Path -Raw
    if (-not $content.Contains($Expected)) {
        throw "Expected '$Expected' in $Path"
    }
    Write-Verbose "  [contains] '$Expected' found in $(Split-Path -Leaf $Path)"
}

function Assert-NotContains {
    param([string]$Path, [string]$Unexpected)
    $content = Get-Content -Path $Path -Raw
    if ($content.Contains($Unexpected)) {
        throw "Found unredacted value '$Unexpected' in $Path"
    }
    Write-Verbose "  [not-contains] '$Unexpected' absent from $(Split-Path -Leaf $Path)"
}

Write-Host "🔎 PHASE 3 — Validate secret redaction output"
Write-Verbose "Extract output directory: $ExtractOutputDir"

$servicePolicyPath = Join-Path $ExtractOutputDir 'policy.xml'
$productPolicyPath = Join-Path $ExtractOutputDir 'products/rs-product/policy.xml'
$apiPolicyPath = Join-Path $ExtractOutputDir 'apis/src-redact-rest/policy.xml'
$operationPolicyPath = Join-Path $ExtractOutputDir 'apis/src-redact-rest/operations/healthCheck/policy.xml'
$resolverPolicyPath = Join-Path $ExtractOutputDir 'apis/src-redact-graphql/resolvers/src-redact-resolver/policy.xml'
$secretNamedValuePath = Join-Path $ExtractOutputDir 'namedValues/rs-nv-secret/namedValueInformation.json'
$plainNamedValuePath = Join-Path $ExtractOutputDir 'namedValues/rs-nv-plain/namedValueInformation.json'

foreach ($path in @($servicePolicyPath, $productPolicyPath, $apiPolicyPath, $operationPolicyPath, $resolverPolicyPath, $secretNamedValuePath, $plainNamedValuePath)) {
    Assert-PathExists -Path $path
}

Write-Host "  → Checking service-scope policy redaction"
Assert-Contains -Path $servicePolicyPath -Expected $redactionMarker
Assert-Contains -Path $servicePolicyPath -Expected $expectedBearerNamedValueReference
Assert-Contains -Path $servicePolicyPath -Expected '{{rs-nv-secret}}'

# InstrumentationKeys are not secrets and must survive unredacted 
# (allow-listed in src/services/secret-redactor.ts). Guards against future over-redaction.
Assert-Contains -Path $servicePolicyPath -Expected 'InstrumentationKey=AI-INSTRUMENTATION-KEY-LITERAL'

Write-Host "  → Verifying service-scope secret literals are gone"
foreach ($literal in @(
    'SERVICE_AUTH_SECRET_LITERAL',
    'SERVICE_OCP_SECRET_LITERAL',
    'SERVICE_FUNCTIONS_KEY_LITERAL',
    'SERVICE_API_KEY_LITERAL',
    'SERVICE_QUERY_CODE_LITERAL',
    'SERVICE_QUERY_SIG_LITERAL',
    'SERVICE_QUERY_SUBSCRIPTION_LITERAL',
    'SERVICE_BASIC_PASSWORD_LITERAL',
    'SERVICE_CERT_BODY_LITERAL',
    'SERVICE_CERT_INLINE_LITERAL',
    'SERVICE_SIGNING_KEY_LITERAL',
    'SERVICE_DECRYPT_KEY_LITERAL',
    'SERVICE_ACCOUNT_KEY_LITERAL',
    'SERVICE_SHARED_ACCESS_KEY_LITERAL'
)) {
    Assert-NotContains -Path $servicePolicyPath -Unexpected $literal
}

Write-Host "  → Checking product / api / operation / resolver policy redaction"
Assert-Contains -Path $productPolicyPath -Expected $redactionMarker
Assert-NotContains -Path $productPolicyPath -Unexpected 'PRODUCT_AUTH_SECRET_LITERAL'

Assert-Contains -Path $apiPolicyPath -Expected $redactionMarker
Assert-NotContains -Path $apiPolicyPath -Unexpected 'API_QUERY_CODE_LITERAL'

Assert-Contains -Path $operationPolicyPath -Expected $redactionMarker
Assert-NotContains -Path $operationPolicyPath -Unexpected 'OPERATION_BASIC_PASSWORD_LITERAL'

Assert-Contains -Path $resolverPolicyPath -Expected $redactionMarker
Assert-NotContains -Path $resolverPolicyPath -Unexpected 'RESOLVER_SHARED_ACCESS_KEY_LITERAL'

Write-Host "  → Checking named value redaction"
$secretNamedValue = Get-Content -Path $secretNamedValuePath -Raw | ConvertFrom-Json
if ($secretNamedValue.properties.secret -ne $true) {
    throw "Expected secret named value flag to remain true in $secretNamedValuePath"
}
if ($secretNamedValue.properties.value -ne $redactionMarker) {
    throw "Expected secret named value to be redacted in $secretNamedValuePath"
}
Write-Verbose "  [named-value] 'rs-nv-secret' is flagged secret and redacted"

$plainNamedValue = Get-Content -Path $plainNamedValuePath -Raw | ConvertFrom-Json
if ($plainNamedValue.properties.value -ne 'plain-value') {
    throw "Expected plain named value to remain unchanged in $plainNamedValuePath"
}
Write-Verbose "  [named-value] 'rs-nv-plain' retained its plaintext value"

Write-Host "✅ Redaction checks passed"
exit 0
