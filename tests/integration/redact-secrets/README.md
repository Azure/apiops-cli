# Redact Secrets Integration Test

This integration test validates that `apiops extract` redacts secrets from APIM artifacts.

## Coverage

- Secret named values are redacted to `*** REDACTED ***`
- Inline policy secrets are redacted across these scopes:
  - Service policy
  - Product policy
  - API policy
  - API operation policy
  - GraphQL resolver policy
- APIM named value references (for example `{{rs-nv-secret}}`) are preserved

## Prerequisites

- Azure CLI authenticated (`az login`)
- Permissions to deploy/delete APIM resources
- Built CLI (`npm run build`)

## Run locally

```powershell
pwsh -NoLogo -NoProfile -File ./tests/integration/redact-secrets/run-redact-secrets-test.ps1 -PublisherEmail admin@contoso.com
```

Optional parameters:

- `-SkuName` (`Developer`, `Premium`, `Standard`, `BasicV2`, `StandardV2`, `PremiumV2`)
- `-Location`
- `-LogLevel` (`Info`, `Verbose`, `Debug`)
- `-SkipTeardown`
