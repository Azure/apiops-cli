// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * GitHub Actions publish workflow template
 * Push-to-main trigger with commit ID choice and a single parameterized publish
 * job driven by a workflow-level environment variable (TARGET_ENV)
 */

export interface PublishWorkflowConfig {
  artifactDir: string;
  environments: string[];
}

export function generatePublishWorkflow(config: PublishWorkflowConfig): string {
  const defaultEnvironment = config.environments[0] ?? 'dev';
  const envChoices = config.environments.map((env) => `          - ${env}`).join('\n');

  return `name: Run APIM Publisher

on:
  push:
    branches:
      - main
    paths:
      - '${config.artifactDir}/**'
      - 'configuration.*.yaml'
  workflow_dispatch:
    inputs:
      COMMIT_ID_CHOICE:
        description: 'Choose "publish-all-artifacts-in-repo" only when you want to force republishing all artifacts (e.g. after build failure). Otherwise stick with the default behavior of "publish-artifacts-in-last-commit"'
        required: true
        type: choice
        default: publish-artifacts-in-last-commit
        options:
          - publish-artifacts-in-last-commit
          - publish-all-artifacts-in-repo
      ENVIRONMENT:
        description: 'Choose which environment to publish to'
        required: true
        type: choice
        default: ${defaultEnvironment}
        options:
${envChoices}

permissions:
  id-token: write
  contents: read

# A single workflow-level variable selects the target environment. On manual runs
# it comes from the ENVIRONMENT input; on push to main it defaults to '${defaultEnvironment}'.
env:
  TARGET_ENV: \${{ github.event.inputs.ENVIRONMENT || '${defaultEnvironment}' }}

jobs:
  get-commit:
    runs-on: ubuntu-latest
    outputs:
      commit_id: \${{ steps.commit.outputs.commit_id }}
    steps:
      - name: Set the Commit Id
        id: commit
        run: echo "commit_id=\${GITHUB_SHA}" >> $GITHUB_OUTPUT

  publish:
    runs-on: ubuntu-latest
    environment: \${{ github.event.inputs.ENVIRONMENT || '${defaultEnvironment}' }}
    needs: get-commit
    steps:
      - name: Checkout repository
        uses: actions/checkout@v5
        with:
          fetch-depth: 2

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm install

      - name: Resolve target environment
        id: env
        run: |
          echo "name=\${TARGET_ENV}" >> "$GITHUB_OUTPUT"
          echo "upper=\$(echo "\${TARGET_ENV}" | tr '[:lower:]' '[:upper:]')" >> "$GITHUB_OUTPUT"

      - name: Azure Login (Federated Credential)
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Validate token source values
        env:
          AVAILABLE_SECRETS_JSON: \${{ toJSON(secrets) }}
        run: |
          missing=0
          config_file="configuration.\${TARGET_ENV}.yaml"
          tokens=$(grep -o '{#\\[[^]]*\\]#}' "$config_file" | sed -E 's/^\\{#\\[([^]]+)\\]#\\}$/\\1/' | sort -u || true)

          if [ -z "$tokens" ]; then
            echo "No tokens found in $config_file"
            exit 0
          fi

          while IFS= read -r token; do
            if [ -z "$token" ]; then
              continue
            fi

            if ! echo "$token" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$'; then
              echo "::error::Token '$token' is not a valid environment variable name. Use letters, numbers, and underscores only."
              missing=1
              continue
            fi

            value=$(jq -r --arg token "$token" '.[$token] // empty' <<< "$AVAILABLE_SECRETS_JSON")
            if [ -z "$value" ]; then
              echo "::error::Missing secret for token '$token'"
              missing=1
              continue
            fi

            printf '%s=%s\\n' "$token" "$value" >> "$GITHUB_ENV"
          done <<< "$tokens"

          if [ "$missing" -ne 0 ]; then
            exit 1
          fi

      - name: Substitute tokens in configuration file
        uses: cschleiden/replace-tokens@v1.3
        with:
          tokenPrefix: '{#['
          tokenSuffix: ']#}'
          files: '["configuration.\${{ env.TARGET_ENV }}.yaml"]'
          # Token values are injected in the previous step based on token names.
          # Ensure tokens in the configuration file match secret names exactly.

      - name: Validate token substitution
        run: |
          config_file="configuration.\${TARGET_ENV}.yaml"
          if grep -q '{#\\[' "$config_file"; then
            echo "Unresolved tokens remain in $config_file"
            grep -o '{#\\[[^]]*\\]#}' "$config_file" | sort -u
            exit 1
          fi

      - name: Dry-run validation (incremental)
        if: \${{ github.event.inputs.COMMIT_ID_CHOICE != 'publish-all-artifacts-in-repo' }}
        run: |
          npx apiops publish \\
            --subscription-id \${{ secrets.AZURE_SUBSCRIPTION_ID }} \\
            --resource-group \${{ secrets[format('APIM_RESOURCE_GROUP_{0}', steps.env.outputs.upper)] }} \\
            --service-name \${{ secrets[format('APIM_SERVICE_NAME_{0}', steps.env.outputs.upper)] }} \\
            --source ${config.artifactDir} \\
            --overrides configuration.\${{ env.TARGET_ENV }}.yaml \\
            --commit-id \${{ needs.get-commit.outputs.commit_id }} \\
            --dry-run

      - name: Dry-run validation (all artifacts)
        if: \${{ github.event.inputs.COMMIT_ID_CHOICE == 'publish-all-artifacts-in-repo' }}
        run: |
          npx apiops publish \\
            --subscription-id \${{ secrets.AZURE_SUBSCRIPTION_ID }} \\
            --resource-group \${{ secrets[format('APIM_RESOURCE_GROUP_{0}', steps.env.outputs.upper)] }} \\
            --service-name \${{ secrets[format('APIM_SERVICE_NAME_{0}', steps.env.outputs.upper)] }} \\
            --source ${config.artifactDir} \\
            --overrides configuration.\${{ env.TARGET_ENV }}.yaml \\
            --dry-run

      - name: Publish (incremental - last commit only)
        if: \${{ github.event.inputs.COMMIT_ID_CHOICE != 'publish-all-artifacts-in-repo' }}
        run: |
          npx apiops publish \\
            --subscription-id \${{ secrets.AZURE_SUBSCRIPTION_ID }} \\
            --resource-group \${{ secrets[format('APIM_RESOURCE_GROUP_{0}', steps.env.outputs.upper)] }} \\
            --service-name \${{ secrets[format('APIM_SERVICE_NAME_{0}', steps.env.outputs.upper)] }} \\
            --source ${config.artifactDir} \\
            --overrides configuration.\${{ env.TARGET_ENV }}.yaml \\
            --commit-id \${{ needs.get-commit.outputs.commit_id }}

      - name: Publish (all artifacts)
        if: \${{ github.event.inputs.COMMIT_ID_CHOICE == 'publish-all-artifacts-in-repo' }}
        run: |
          npx apiops publish \\
            --subscription-id \${{ secrets.AZURE_SUBSCRIPTION_ID }} \\
            --resource-group \${{ secrets[format('APIM_RESOURCE_GROUP_{0}', steps.env.outputs.upper)] }} \\
            --service-name \${{ secrets[format('APIM_SERVICE_NAME_{0}', steps.env.outputs.upper)] }} \\
            --source ${config.artifactDir} \\
            --overrides configuration.\${{ env.TARGET_ENV }}.yaml
`;
}

