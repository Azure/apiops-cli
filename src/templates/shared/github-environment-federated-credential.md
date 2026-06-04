### {{ENV}} environment

**On macOS/Linux (Bash):**
```bash
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-env-{{ENV}}",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:'"${GITHUB_ORG}"'/'"${GITHUB_REPO}"':environment:{{ENV}}",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

**On Windows (PowerShell):**
```powershell
az ad app federated-credential create `
  --id $APP_ID `
  --parameters '{\"name\":\"github-env-{{ENV}}\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"repo:'${GITHUB_ORG}'/'${GITHUB_REPO}':environment:{{ENV}}\",\"audiences\":[\"api://AzureADTokenExchange\"]}'
```
