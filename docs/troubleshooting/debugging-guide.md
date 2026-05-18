# Debugging Guide

> How to diagnose and resolve issues with apiops-cli.

---

## Diagnostic Tools

### `--log-level debug`

The most powerful diagnostic tool. Debug logging shows:

- Full authentication flow — which credential source was tried and selected
- Every Azure API call — URL, method, response status
- Resource processing steps — which resources are being extracted/published and in what order
- Dependency resolution — which transitive dependencies were discovered

```bash
apiops extract \
  --log-level debug \
  --subscription-id "$SUB_ID" \
  --resource-group mygroup \
  --service-name myapim \
  --output ./artifacts
```

### `--dry-run` (publish only)

Preview what would change without modifying anything:

```bash
apiops publish \
  --dry-run \
  --subscription-id "$SUB_ID" \
  --resource-group mygroup \
  --service-name myapim \
  --source ./artifacts
```

The dry-run report shows which resources would be created, updated, or deleted.

### `--format json`

Get machine-readable output for scripting and analysis:

```bash
apiops extract --format json ... 2>debug.log | jq '.'
```

### Artifact Inspection

Check extracted files directly:

```bash
# Verify JSON files are valid
find ./artifacts -name "*.info.json" | xargs -I {} sh -c 'jq . "{}" > /dev/null || echo "Invalid: {}"'

# Inspect a specific API's policy
cat ./artifacts/apis/petstore/policy.xml

# Check named value references in policies
grep -r "{{.*}}" ./artifacts --include="*.xml"
```

---

## Diagnostic Approach

Follow this checklist when troubleshooting:

### Step 1: Enable Debug Logging

```bash
apiops extract --log-level debug ...
```

Look for the first error or warning in the output. Debug logs are written to **stderr**, so stdout remains clean for `--format json` data.

### Step 2: Check Authentication

Is `DefaultAzureCredential` finding valid credentials?

```bash
# Verify Azure CLI is logged in
az account show

# Verify the correct subscription is selected
az account show --query '{subscription: id, tenant: tenantId}'
```

In debug logs, look for lines indicating which credential source succeeded:

- `"Using EnvironmentCredential"` — service principal via env vars
- `"Using AzureCliCredential"` — Azure CLI login
- `"Using ManagedIdentityCredential"` — managed identity

### Step 3: Check Connectivity

Can you reach the APIM management endpoint?

```bash
# Test Azure management API
curl -s -o /dev/null -w "%{http_code}" https://management.azure.com

# Test with authentication
az rest --method GET \
  --url "https://management.azure.com/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.ApiManagement/service/$APIM?api-version=2024-05-01"
```

### Step 4: Check RBAC Permissions

Does the identity have the required role?

```bash
# List role assignments for the APIM resource
az role assignment list \
  --scope "/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.ApiManagement/service/$APIM" \
  --output table
```

| Operation | Minimum role |
|-----------|-------------|
| Extract | `API Management Service Reader` |
| Publish | `API Management Service Contributor` |

### Step 5: Inspect Artifacts

Are the JSON files valid? Are policies well-formed XML?

```bash
# Check all JSON files parse correctly
find ./artifacts -name "*.json" -exec sh -c 'jq empty "$1" 2>/dev/null || echo "Bad JSON: $1"' _ {} \;

# Check XML policies for syntax issues
find ./artifacts -name "*.xml" -exec xmllint --noout {} \; 2>&1 | grep -v "^$"
```

### Step 6: Compare Dry-Run Output

Before a real publish, run with `--dry-run` and verify the changes match your expectations:

```bash
apiops publish --dry-run --format json ... | jq '.changes[]'
```

---

## Log Output

### Where Logs Go

| Stream | Content |
|--------|---------|
| **stdout** | Command output (text or JSON via `--format json`) |
| **stderr** | Log messages (debug, info, warn, error) |

This separation means you can redirect logs without corrupting output:

```bash
# Capture logs to a file, output to stdout
apiops extract --log-level debug ... 2>extract-debug.log

# Capture output to a file, logs to terminal
apiops extract --format json ... >artifacts.json
```

### Log Levels

| Level | What it shows | When to use |
|-------|--------------|-------------|
| `debug` | API call details, auth flow, resource processing steps | Diagnosing specific failures |
| `info` | Progress messages, resource counts | Normal operation (default) |
| `warn` | Non-fatal issues (git not found, commit not found) | Reviewing potential problems |
| `error` | Failures that affect the exit code | Always shown |

### Log Sanitization

The logger automatically redacts sensitive values. Fields matching these patterns are replaced with `[REDACTED]`:

- `token`, `secret`, `password`, `key`
- `authorization` headers
- `client_secret`, `access_token`

You can safely share debug logs without exposing credentials.

---

## Common Debugging Scenarios

### Extract returns empty results

1. Enable `--log-level debug` and check if the LIST API calls return empty arrays
2. Verify the APIM service name, resource group, and subscription are correct
3. If using `--filter`, check that the filter file matches existing APIs
4. Check RBAC — `Reader` role is required at minimum

### Publish reports "no changes"

1. Run with `--dry-run` to see the comparison output
2. If using `--commit-id`, verify the commit hash exists in the repository
3. Check that the artifact directory (`--source`) points to the correct path
4. Verify that artifact files have actually changed since the last publish

### Incremental publish misses changes

1. Verify the `--commit-id` value is the correct base commit
2. If the commit was rebased or amended, the diff may not capture all changes
3. Solution: omit `--commit-id` for a full publish, or use the correct base commit

### Auth works locally but fails in CI/CD

1. In CI/CD, `DefaultAzureCredential` uses different credential sources than local dev
2. Check that the CI/CD environment has the required secrets/variables configured
3. For GitHub Actions with OIDC: verify the federated credential subject matches the workflow
4. For Azure DevOps: verify the service connection is configured correctly

---

## Related Docs

- [Common Errors](common-errors.md) — Error message reference with solutions
- [Pipeline Recovery](pipeline-recovery.md) — Recovering from failed CI/CD runs
- [Authentication Guide](../guides/authentication.md) — Full auth setup reference
