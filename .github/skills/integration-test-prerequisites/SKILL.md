---
name: "integration-test-prerequisites"
description: "Set up Azure and GitHub prerequisites for integration and release-tests workflows using a user-assigned managed identity, OIDC federated credentials, RBAC roles, and environment secrets. Use when troubleshooting AADSTS70025/AADSTS700213 or authorization failures during integration-test or release-tests workflow runs."
domain: "ci-cd"
confidence: "high"
source: "manual + observed from integration-test OIDC and RBAC troubleshooting"
---

## Context

Use this skill when preparing or repairing prerequisites for:

- `.github/workflows/integration-test.yml` — Extract→Publish round-trip
- `.github/workflows/integration-redact-secrets.yml` — Secret redaction validation
- `.github/workflows/release-tests.yml` — Orchestrator that calls CI, then both integration-test workflows sequentially

All integration-test workflows share the same GitHub environment (`integration-test`) and Azure identity. Setting up prerequisites once covers all three workflows.

These workflows expect:
- OIDC login through `azure/login@v3`
- GitHub environment `integration-test` (shared by all integration workflows)
- Azure identity with enough permissions to deploy resources and create role assignments in test resource groups

The `release-tests.yml` orchestrator calls `ci.yml` (no Azure prereqs), then `integration-test.yml` and `integration-redact-secrets.yml` (both use the `integration-test` environment). Secrets are passed through from the orchestrator's repo-level secrets to the called workflows' environment.

Preferred identity model: user-assigned managed identity (UAMI).

## Required Inputs

Set these values before running commands:

```bash
set -euo pipefail

SUBSCRIPTION_ID="<your-subscription-id>"
TENANT_ID="<your-tenant-id>"
IDENTITY_RESOURCE_GROUP="<resource-group-for-uami>"
IDENTITY_NAME="apiops-cli-integration-test-uami"
APIM_PUBLISHER_EMAIL="<publisher-email>"

GITHUB_OWNER="Azure"
GITHUB_REPO="apiops-cli"
GITHUB_ENVIRONMENT="integration-test"

OIDC_ISSUER="https://token.actions.githubusercontent.com"
OIDC_AUDIENCE="api://AzureADTokenExchange"
```

## Patterns

### 1) Build Correct OIDC Subject Dynamically

Do not hard-code numeric GitHub IDs. Build the subject based on repo OIDC customization settings.

```bash
OIDC_SUBJECT="repo:${GITHUB_OWNER}/${GITHUB_REPO}:environment:${GITHUB_ENVIRONMENT}"

USE_DEFAULT_SUB="$(gh api repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/oidc/customization/sub --jq '.use_default')"
if [[ "${USE_DEFAULT_SUB}" == "false" ]]; then
  OWNER_ID="$(gh api repos/${GITHUB_OWNER}/${GITHUB_REPO} --jq '.owner.id')"
  REPO_ID="$(gh api repos/${GITHUB_OWNER}/${GITHUB_REPO} --jq '.id')"
  OIDC_SUBJECT="repository_owner_id:${OWNER_ID}:repository_id:${REPO_ID}:environment:${GITHUB_ENVIRONMENT}"
fi

echo "OIDC_SUBJECT=${OIDC_SUBJECT}"
```

### 2) Provision/Reuse UAMI

```bash
az account set --subscription "${SUBSCRIPTION_ID}"

# Create resource group if it doesn't exist
az group create \
  --name "${IDENTITY_RESOURCE_GROUP}" \
  --location eastus 1>/dev/null || true

# Create or reuse UAMI
az identity create \
  --resource-group "${IDENTITY_RESOURCE_GROUP}" \
  --name "${IDENTITY_NAME}" 1>/dev/null

IDENTITY_CLIENT_ID="$(az identity show \
  --resource-group "${IDENTITY_RESOURCE_GROUP}" \
  --name "${IDENTITY_NAME}" \
  --query clientId -o tsv)"

IDENTITY_PRINCIPAL_ID="$(az identity show \
  --resource-group "${IDENTITY_RESOURCE_GROUP}" \
  --name "${IDENTITY_NAME}" \
  --query principalId -o tsv)"
```

### 3) Configure Federated Credential

```bash
az identity federated-credential create \
  --resource-group "${IDENTITY_RESOURCE_GROUP}" \
  --identity-name "${IDENTITY_NAME}" \
  --name "github-env-integration-test" \
  --issuer "${OIDC_ISSUER}" \
  --subject "${OIDC_SUBJECT}" \
  --audiences "${OIDC_AUDIENCE}"
```

### 4) Assign Azure RBAC at Subscription Scope

`User Access Administrator` is required for `Microsoft.Authorization/roleAssignments/write` during deployment.

```bash
SCOPE="/subscriptions/${SUBSCRIPTION_ID}"

for ROLE in "Contributor" "User Access Administrator" "Key Vault Administrator" "API Management Service Contributor"; do
  az role assignment create \
    --assignee-object-id "${IDENTITY_PRINCIPAL_ID}" \
    --assignee-principal-type ServicePrincipal \
    --role "${ROLE}" \
    --scope "${SCOPE}" \
    1>/dev/null
done
```

### 5) Set GitHub Environment Secrets

```bash
unset GITHUB_TOKEN GH_TOKEN

gh secret set AZURE_CLIENT_ID \
  --repo "${GITHUB_OWNER}/${GITHUB_REPO}" \
  --env "${GITHUB_ENVIRONMENT}" \
  --body "${IDENTITY_CLIENT_ID}"

gh secret set AZURE_TENANT_ID \
  --repo "${GITHUB_OWNER}/${GITHUB_REPO}" \
  --env "${GITHUB_ENVIRONMENT}" \
  --body "${TENANT_ID}"

gh secret set AZURE_SUBSCRIPTION_ID \
  --repo "${GITHUB_OWNER}/${GITHUB_REPO}" \
  --env "${GITHUB_ENVIRONMENT}" \
  --body "${SUBSCRIPTION_ID}"

gh secret set APIM_PUBLISHER_EMAIL \
  --repo "${GITHUB_OWNER}/${GITHUB_REPO}" \
  --env "${GITHUB_ENVIRONMENT}" \
  --body "${APIM_PUBLISHER_EMAIL}"
```

### 6) Set Repo-Level Secrets (for release-tests orchestrator)

The `release-tests.yml` orchestrator passes secrets to called workflows via explicit `secrets:` mapping. Since the orchestrator itself does not declare an `environment:`, it reads from **repo-level** secrets. Set the same values at the repo level:

```bash
gh secret set AZURE_CLIENT_ID \
  --repo "${GITHUB_OWNER}/${GITHUB_REPO}" \
  --body "${IDENTITY_CLIENT_ID}"

gh secret set AZURE_TENANT_ID \
  --repo "${GITHUB_OWNER}/${GITHUB_REPO}" \
  --body "${TENANT_ID}"

gh secret set AZURE_SUBSCRIPTION_ID \
  --repo "${GITHUB_OWNER}/${GITHUB_REPO}" \
  --body "${SUBSCRIPTION_ID}"

gh secret set APIM_PUBLISHER_EMAIL \
  --repo "${GITHUB_OWNER}/${GITHUB_REPO}" \
  --body "${APIM_PUBLISHER_EMAIL}"
```

> **Note:** If you only have environment-level secrets without matching repo-level secrets, the `release-tests.yml` workflow will fail because `${{ secrets.* }}` in the orchestrator resolves from repo scope. The called workflows still use the `integration-test` environment for OIDC token issuance.

## Verification

```bash
az identity federated-credential list \
  --resource-group "${IDENTITY_RESOURCE_GROUP}" \
  --identity-name "${IDENTITY_NAME}" \
  --query "[].{name:name,subject:subject,issuer:issuer,audience:audiences[0]}" -o table

az role assignment list \
  --assignee-object-id "${IDENTITY_PRINCIPAL_ID}" \
  --scope "/subscriptions/${SUBSCRIPTION_ID}" \
  --query "[].{role:roleDefinitionName,scope:scope}" -o table

unset GITHUB_TOKEN GH_TOKEN
gh api repos/${GITHUB_OWNER}/${GITHUB_REPO}/environments/${GITHUB_ENVIRONMENT}/secrets --jq '.secrets[].name'
```

## Failure Mapping

- `AADSTS70025`: Missing federated credential for presented subject.
- `AADSTS700213`: Subject mismatch between token claim and federated credential.
- `AADSTS700016`: Application/identity was deleted from the tenant. Recreate the UAMI and update secrets.
- `Microsoft.Authorization/roleAssignments/write`: Missing `User Access Administrator` or `Owner`.

## UI Access

To view or edit environment secrets in the GitHub web UI, navigate to:

```
https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/settings/environments/{environment_id}/edit
```

The numeric `environment_id` can be retrieved via:

```bash
gh api repos/${GITHUB_OWNER}/${GITHUB_REPO}/environments --jq '.environments[] | select(.name=="'${GITHUB_ENVIRONMENT}'") | .id'
```

**Note:** Viewing environment settings requires **admin** access to the repository. In organizations using JIT (just-in-time) privilege elevation, you must activate admin access before the settings page will load (otherwise you get a 404).

## Anti-Patterns

- Hard-coding `repository_owner_id` and `repository_id` values in docs/scripts.
- Assuming `repo:<owner>/<repo>:environment:<env>` subject when customization is enabled.
- Using only `Contributor` when deployment creates RBAC assignments.
- Using ephemeral `GITHUB_TOKEN` integration auth for `gh secret` management without checking scopes.
