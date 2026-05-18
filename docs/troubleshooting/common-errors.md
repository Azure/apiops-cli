# Common Errors

> Searchable error reference. Find your error message, understand the cause, and apply the fix.

---

## Authentication Errors

### "Subscription ID required: use --subscription-id or set AZURE_SUBSCRIPTION_ID"

**Cause:** No Azure subscription ID was provided via the `--subscription-id` flag or the `AZURE_SUBSCRIPTION_ID` environment variable.

**Solution:**

```bash
# Option 1: Pass as a flag
apiops extract --subscription-id "00000000-0000-0000-0000-000000000000" ...

# Option 2: Set as environment variable
export AZURE_SUBSCRIPTION_ID="00000000-0000-0000-0000-000000000000"
apiops extract ...
```

---

### DefaultAzureCredential — no valid credential found

**Cause:** `DefaultAzureCredential` tried all credential sources in its chain and none succeeded. This typically means:

- You are not logged in via Azure CLI (`az login`)
- Environment variables for service principal auth are not set or are incorrect
- Managed identity is not configured on the host

**Solution:**

| Context | Fix |
|---------|-----|
| Local development | Run `az login` and select the correct subscription |
| CI/CD with OIDC | Verify `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and the federated credential configuration |
| CI/CD with service principal | Verify `--client-id`, `--client-secret`, `--tenant-id` (or equivalent env vars) |
| Managed identity | Verify the VM/container has a managed identity assigned |

See [Authentication Guide](../guides/authentication.md) for full setup instructions.

---

### 401 Unauthorized from APIM API

**Cause:** The authenticated identity does not have permission to access the APIM REST API. The credential is valid but lacks the required RBAC role.

**Solution:**

Assign one of these roles to the identity on the APIM resource or resource group:

| Operation | Minimum RBAC Role |
|-----------|-------------------|
| Extract (read-only) | `API Management Service Reader` |
| Publish (read-write) | `API Management Service Contributor` |

```bash
az role assignment create \
  --assignee "<principal-id>" \
  --role "API Management Service Contributor" \
  --scope "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.ApiManagement/service/<name>"
```

---

### 403 Forbidden from APIM API

**Cause:** Same as 401 — the identity lacks the required RBAC role. Some Azure configurations return 403 instead of 401.

**Solution:** Same as [401 Unauthorized](#401-unauthorized-from-apim-api) above.

---

## Configuration Errors

### "Filter file not found: {path}"

**Cause:** The `--filter` flag points to a file that does not exist at the specified path.

**Solution:**

1. Verify the path is correct: `ls <path>` (or `dir <path>` on Windows)
2. Use an absolute path or a path relative to the current working directory
3. Check for typos in the filename

---

### "Override file not found: {path}"

**Cause:** The `--overrides` flag points to a file that does not exist at the specified path.

**Solution:** Same as [Filter file not found](#filter-file-not-found-path) — verify the file path.

---

### "{field} must be an array"

**Cause:** A field in the filter YAML file is the wrong type. Filter fields like `apis` and `apiNames` must be arrays.

**Solution:**

```yaml
# ✅ Correct — array syntax
apis:
  - name: "petstore"
  - name: "users-api"

# ❌ Wrong — string instead of array
apis: "petstore"
```

---

### "Invalid CI provider"

**Cause:** The `--ci` flag in `apiops init` received an unsupported value.

**Solution:** Use one of the supported CI providers:

```bash
apiops init --ci github-actions    # GitHub Actions
apiops init --ci azure-devops      # Azure DevOps Pipelines
```

---

### "At least one environment must be specified"

**Cause:** The `--environments` flag in `apiops init` was provided with an empty list, or no environments were specified when required.

**Solution:**

```bash
apiops init --environments dev prod
```

---

## Publish Errors

### "Options --commit-id and --delete-unmatched are mutually exclusive"

**Cause:** Both `--commit-id` and `--delete-unmatched` were specified. These flags conflict because:

- `--commit-id` publishes only changed resources (partial set)
- `--delete-unmatched` deletes resources not in the source (requires full set)

Deleting based on a partial set would remove resources that were simply unchanged.

**Solution:** Use one or the other:

```bash
# Incremental publish (changed resources only)
apiops publish --commit-id abc123 ...

# Full publish with cleanup (all resources, delete extras)
apiops publish --delete-unmatched ...
```

---

### "Unknown cloud {name}"

**Cause:** The `--cloud` flag received an unrecognized Azure cloud name.

**Solution:** Use a supported cloud:

| Cloud | Value |
|-------|-------|
| Azure Public | `AzureCloud` (default) |
| Azure China | `AzureChinaCloud` |
| Azure US Government | `AzureUSGovernment` |

---

### Partial publish failure (exit code 1)

**Cause:** Some resources were published successfully, but others failed. The CLI does not roll back successful operations.

**Solution:**

1. Check stderr output for specific failure messages
2. Fix the failing resources (bad JSON, missing dependencies, permission issues)
3. Re-run the publish — idempotent design means already-published resources won't be affected

See [Pipeline Recovery](pipeline-recovery.md) for CI/CD-specific recovery steps.

---

## Runtime Errors

### Rate limiting (HTTP 429)

**Cause:** The Azure APIM management API has rate limits. Extracting or publishing many resources in quick succession can trigger throttling.

**Solution:**

- The CLI automatically retries on 429 responses with the delay specified in the `Retry-After` header
- If retries are exhausted, reduce the number of resources being processed (use filters for extract or incremental publish)
- Wait a few minutes and re-run

---

### Network connectivity errors

**Cause:** The CLI cannot reach the Azure APIM management endpoint. Common causes:

- No internet connectivity
- Firewall blocking `management.azure.com`
- DNS resolution failure
- Corporate proxy not configured

**Solution:**

1. Test connectivity: `curl -I https://management.azure.com`
2. If behind a proxy, set `HTTPS_PROXY` environment variable
3. If using private endpoints, ensure you're on the correct network

---

### "Not in a git repository"

**Cause:** The `--commit-id` flag was used for incremental publish, but the current directory (or artifact directory) is not inside a git repository.

**Solution:**

- Ensure you're running from within a git repository
- Or omit `--commit-id` to perform a full publish instead

---

## Exit Code Reference

| Code | Meaning |
|------|---------|
| `0` | Success — all operations completed |
| `1` | Partial failure — some operations succeeded, others failed |
| `2` | Complete failure — no operations succeeded |

---

## Related Docs

- [Debugging Guide](debugging-guide.md) — How to diagnose issues with `--log-level debug`
- [Pipeline Recovery](pipeline-recovery.md) — Recovering from failed CI/CD runs
- [Authentication Guide](../guides/authentication.md) — Full auth setup reference
