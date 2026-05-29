#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$StateFile,

    [ValidateSet('Info', 'Verbose', 'Debug')]
    [string]$LogLevel = 'Verbose',

    [string]$ExtractOutputDir = "$PSScriptRoot/extracted-artifacts"
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = if ($LogLevel -in @('Verbose', 'Debug')) { 'Continue' } else { 'SilentlyContinue' }
$DebugPreference = if ($LogLevel -eq 'Debug') { 'Continue' } else { 'SilentlyContinue' }

$maskingModule = Join-Path $PSScriptRoot 'MaskingHelpers.psm1'
Import-Module $maskingModule -Force

$compareScript = Join-Path $PSScriptRoot 'Compare-ApimInstance.ps1'
$validateScript = Join-Path $PSScriptRoot 'Test-ExtractedArtifact.ps1'
$manifestFile = Join-Path $PSScriptRoot 'expected-structure.json'

foreach ($requiredFile in @($maskingModule, $compareScript, $validateScript, $manifestFile, $StateFile)) {
    if (-not (Test-Path $requiredFile)) {
        Write-Error "Required file not found: $requiredFile"
        exit 2
    }
}

function Get-ApiopsLogLevel([string]$ScriptLogLevel) {
    switch ($ScriptLogLevel) {
        'Info' { return 'info' }
        'Verbose' { return 'warn' }
        'Debug' { return 'debug' }
        default { return 'info' }
    }
}

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

$state = Get-Content -Path $StateFile -Raw | ConvertFrom-Json
$sourceSubId = $state.sourceSubscriptionId
$sourceRg = $state.sourceResourceGroup
$sourceName = $state.sourceApimName
$targetSubId = $state.targetSubscriptionId
$targetRg = $state.targetResourceGroup
$targetName = $state.targetApimName
$skuName = $state.skuName

$exitCode = 0
$apiopsLogLevel = Get-ApiopsLogLevel -ScriptLogLevel $LogLevel
$apiopsAuthArgs = Get-ApiopsAuthArgs

Write-Host "📥 PHASE 2 — Extract from source APIM"
if (Test-Path $ExtractOutputDir) {
    Remove-Item -Path $ExtractOutputDir -Recurse -Force
    Write-Host "   Cleaned previous extract output"
}

$extractArgs = @(
    'extract',
    '--subscription-id', $sourceSubId,
    '--resource-group',  $sourceRg,
    '--service-name',    $sourceName,
    '--output',          $ExtractOutputDir,
    '--log-level',       $apiopsLogLevel
) + $apiopsAuthArgs

$extractExitCode = Invoke-MaskedApiopsCommand -Replacements @{
    $sourceSubId = Protect-SubscriptionId -Value $sourceSubId
    $sourceRg    = Protect-ResourceGroupName -Value $sourceRg
    $sourceName  = Protect-ApimName -Value $sourceName
} -Arguments $extractArgs

if ($extractExitCode -ne 0) {
    Write-Host "❌ Extract failed (exit code $extractExitCode)"
    exit 2
}

$extractedFiles = Get-ChildItem -Path $ExtractOutputDir -Recurse -File -ErrorAction SilentlyContinue
if (-not $extractedFiles -or $extractedFiles.Count -eq 0) {
    Write-Host "❌ Extract produced no files in $ExtractOutputDir"
    exit 2
}

Write-Host "�� PHASE 2.1 — Validate extracted artifact structure"
$validateArgs = @{
    ExtractedDir = $ExtractOutputDir
    ManifestFile = $manifestFile
    SkuName      = $skuName
}
switch ($LogLevel) {
    'Verbose' { $validateArgs.Verbose = $true }
    'Debug'   { $validateArgs.Debug = $true }
}
& $validateScript @validateArgs
$validateExitCode = $LASTEXITCODE
if ($validateExitCode -ne 0) {
    Write-Host "❌ Artifact validation failed (exit code $validateExitCode)"
    $exitCode = if ($validateExitCode -eq 2) { 2 } else { 1 }
    Write-Host "⚠️  Continuing with round-trip despite validation failures..."
}

Write-Host "🔧 PHASE 2.5 — Generate override config for target environment"
$targetKvUri = az keyvault list --resource-group $targetRg --query "[0].properties.vaultUri" -o tsv
$targetAiResourceId = az monitor app-insights component list --resource-group $targetRg --query "[0].id" -o tsv
$targetAiKey = az monitor app-insights component list --resource-group $targetRg --query "[0].instrumentationKey" -o tsv
$targetEhNs = az eventhubs namespace list --resource-group $targetRg --query "[0].name" -o tsv

$targetEhConnStr = az eventhubs namespace authorization-rule keys list `
    --resource-group $targetRg `
    --namespace-name $targetEhNs `
    --name 'tgt-eh-send' `
    --query 'primaryConnectionString' -o tsv

if (-not $targetEhConnStr) {
    Write-Host "   ⚠️  Could not get Event Hub connection string — EH logger override will be empty"
}

$targetEhName = 'tgt-eh-logs'
$overrideFile = [System.IO.Path]::GetFullPath((Join-Path $ExtractOutputDir '.overrides.yaml'))
$overrideYaml = @"
namedValues:
  src-nv-keyvault:
    keyVault:
      secretIdentifier: "${targetKvUri}secrets/tgt-secret-value"

loggers:
  src-logger-appinsights:
    resourceId: "$targetAiResourceId"
    credentials:
      instrumentationKey: "$targetAiKey"
  src-logger-eventhub:
    credentials:
      name: "$targetEhName"
      connectionString: "$targetEhConnStr"
"@

$overrideYaml | Set-Content -Path $overrideFile -Encoding utf8

Write-Host "📤 PHASE 3 — Publish to target APIM"
$publishExitCode = Invoke-MaskedApiopsCommand -Replacements @{
    $targetSubId = Protect-SubscriptionId -Value $targetSubId
    $targetRg    = Protect-ResourceGroupName -Value $targetRg
    $targetName  = Protect-ApimName -Value $targetName
} -Arguments @(
    'publish',
    '--subscription-id', $targetSubId,
    '--resource-group',  $targetRg,
    '--service-name',    $targetName,
    '--source',          $ExtractOutputDir,
    '--overrides',       $overrideFile,
    '--log-level',       $apiopsLogLevel
) + $apiopsAuthArgs

if ($publishExitCode -ne 0) {
    Write-Host "❌ Publish failed (exit code $publishExitCode)"
    exit 2
}

Write-Host "🔍 PHASE 4 — Compare source and target APIM instances"
$compareArgs = @{
    SourceSubscriptionId = $sourceSubId
    SourceResourceGroup  = $sourceRg
    SourceApimName       = $sourceName
    TargetSubscriptionId = $targetSubId
    TargetResourceGroup  = $targetRg
    TargetApimName       = $targetName
}
switch ($LogLevel) {
    'Verbose' { $compareArgs.Verbose = $true }
    'Debug'   { $compareArgs.Debug = $true }
}
& $compareScript @compareArgs
$verifyExitCode = $LASTEXITCODE

if ($verifyExitCode -eq 1) {
    Write-Host "❌ Verification found differences"
    if ($exitCode -eq 0) { $exitCode = 1 }
} elseif ($verifyExitCode -ge 2) {
    Write-Host "❌ Verification encountered an error (exit code $verifyExitCode)"
    $exitCode = 2
} else {
    Write-Host "✅ Verification complete — instances match"
}

exit $exitCode
