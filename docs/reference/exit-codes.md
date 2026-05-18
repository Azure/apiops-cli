# Exit Codes

apiops-cli uses structured exit codes to communicate operation results. This is essential for CI/CD pipelines where you need to distinguish between full success, partial failure, and total failure.

## Exit Code Reference

| Code | Name | Meaning |
|------|------|---------|
| `0` | `EXIT_SUCCESS` | All operations completed successfully |
| `1` | `EXIT_PARTIAL` | Some resources failed but others succeeded (partial failure) |
| `2` | `EXIT_FATAL` | Cannot proceed — authentication failure, invalid configuration, network unreachable, or all resources failed |

## Aggregation Logic

apiops-cli processes resources in [tiered order](./dependency-graph.md) and tracks the outcome of each operation. The final exit code is determined by aggregating all results:

| Scenario | Exit Code |
|----------|-----------|
| All resources succeed | `0` |
| Some succeed, some fail | `1` |
| All resources fail | `2` |
| Fatal error before processing (auth, config) | `2` |

## Usage in Scripts

### Bash

```bash
apiops extract --resource-group my-rg --service-name my-apim --subscription-id $SUB_ID
EXIT_CODE=$?

case $EXIT_CODE in
  0) echo "All resources extracted successfully" ;;
  1) echo "Warning: Some resources failed to extract" ;;
  2) echo "Error: Extract failed completely" ;;
esac
```

### PowerShell

```powershell
npx apiops extract --resource-group my-rg --service-name my-apim --subscription-id $env:SUB_ID
$exitCode = $LASTEXITCODE

switch ($exitCode) {
    0 { Write-Host "All resources extracted successfully" }
    1 { Write-Warning "Some resources failed to extract" }
    2 { Write-Error "Extract failed completely" }
}
```

## CI/CD Integration

### Key Behavior

Any **non-zero** exit code (`1` or `2`) causes the pipeline step to fail by default. This means **partial failures also fail the build**, which is the safest default — you're alerted to any problem.

### GitHub Actions

To allow partial success while still catching total failures:

```yaml
- name: Extract APIM resources
  id: extract
  continue-on-error: true
  run: npx apiops extract --resource-group my-rg --service-name my-apim

- name: Check extraction result
  run: |
    if [ "${{ steps.extract.outputs.exit-code }}" = "2" ]; then
      echo "::error::Extraction failed completely"
      exit 1
    elif [ "${{ steps.extract.outputs.exit-code }}" = "1" ]; then
      echo "::warning::Some resources failed to extract"
    fi
```

### Azure DevOps

```yaml
- script: npx apiops extract --resource-group my-rg --service-name my-apim
  displayName: Extract APIM resources
  continueOnError: true

- script: |
    if [ "$(Agent.JobStatus)" = "SucceededWithIssues" ]; then
      echo "##vso[task.logissue type=warning]Some resources failed to extract"
    fi
  displayName: Check extraction result
```

### Common Patterns

| Goal | Approach |
|------|----------|
| Fail on any error | Default behavior — no changes needed |
| Allow partial success | Use `continue-on-error` + check exit code |
| Log warnings but pass | Check exit code, re-exit with `0` after logging |
| Block deploys on partial failure | Keep default — exit code `1` fails the step |

## Troubleshooting

| Exit Code | Common Causes | What to Check |
|-----------|---------------|---------------|
| `1` | RBAC permissions missing for some resource types; resource-level throttling (HTTP 429); individual resource corruption | Run with `--log-level debug` to see which resources failed |
| `2` | Invalid credentials; wrong subscription/resource-group/service-name; network connectivity; APIM service not found | Verify auth with `az account show`; check service name spelling |

## Related Docs

- [Dependency Graph](./dependency-graph.md) — how tier ordering affects failure cascades
- [`apiops extract`](../commands/extract.md) — extract command reference
- [`apiops publish`](../commands/publish.md) — publish command reference
- [Troubleshooting](../troubleshooting/) — common errors and solutions
